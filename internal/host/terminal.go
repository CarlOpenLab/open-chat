package host

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"

	"github.com/aymanbagabas/go-pty"
)

type termSession struct {
	id     string
	cwd    string
	shell  string
	ptmx   pty.Pty
	cmd    *pty.Cmd
	closed atomic.Bool
}

func (h *Host) defaultShell() (string, []string) {
	if runtime.GOOS == "windows" {
		if p := lookPath(h.environ(), "pwsh.exe"); p != "" {
			return p, []string{"-NoLogo"}
		}
		if p := lookPath(h.environ(), "powershell.exe"); p != "" {
			return p, []string{"-NoLogo"}
		}
		if comspec := os.Getenv("COMSPEC"); comspec != "" {
			return comspec, nil
		}
		return "cmd.exe", nil
	}
	for _, entry := range h.environ() {
		if strings.HasPrefix(entry, "SHELL=") {
			if sh := strings.TrimSpace(strings.TrimPrefix(entry, "SHELL=")); sh != "" {
				return sh, []string{"-l"}
			}
		}
	}
	if sh := strings.TrimSpace(os.Getenv("SHELL")); sh != "" {
		return sh, []string{"-l"}
	}
	if runtime.GOOS == "darwin" {
		return "/bin/zsh", []string{"-l"}
	}
	return "/bin/bash", []string{"-l"}
}

func (h *Host) termCreate(cwd string, cols, rows int) (TermInfo, error) {
	dir := expandHome(strings.TrimSpace(cwd))
	if dir == "" || !isDir(dir) {
		dir, _ = os.UserHomeDir()
	}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	ptmx, err := pty.New()
	if err != nil {
		return TermInfo{}, fmt.Errorf("创建终端失败：%w", err)
	}
	_ = ptmx.Resize(cols, rows)

	shellPath, shellArgs := h.defaultShell()
	cmd := ptmx.Command(shellPath, shellArgs...)
	cmd.Dir = dir
	env := make([]string, 0, len(h.environ())+3)
	env = append(env, h.environ()...)
	env = append(env, "TERM=xterm-256color", "COLORTERM=truecolor")
	cmd.Env = env

	if err := cmd.Start(); err != nil {
		_ = ptmx.Close()
		return TermInfo{}, fmt.Errorf("启动终端进程失败：%w", err)
	}

	id := "term-" + newID()
	shellName := filepath.Base(shellPath)
	sess := &termSession{
		id:    id,
		cwd:   dir,
		shell: shellName,
		ptmx:  ptmx,
		cmd:   cmd,
	}

	h.termMu.Lock()
	h.terms[id] = sess
	h.termMu.Unlock()

	go h.pumpTerm(sess)

	return TermInfo{
		ID:    id,
		Cwd:   dir,
		Shell: shellName,
	}, nil
}

func (h *Host) pumpTerm(sess *termSession) {
	buf := make([]byte, 4096)
	for {
		n, err := sess.ptmx.Read(buf)
		if n > 0 {
			encoded := base64.StdEncoding.EncodeToString(buf[:n])
			h.opts.Push(Push{
				Kind:    "term_out",
				TermOut: &TermOut{ID: sess.id, Data: encoded},
			})
		}
		if err != nil {
			break
		}
	}
	exitCode := 0
	if err := sess.cmd.Wait(); err != nil {
		exitCode = 1
	}
	if sess.closed.CompareAndSwap(false, true) {
		_ = sess.ptmx.Close()
	}
	h.termMu.Lock()
	delete(h.terms, sess.id)
	h.termMu.Unlock()

	h.opts.Push(Push{
		Kind:     "term_exit",
		TermExit: &TermExit{ID: sess.id, ExitCode: exitCode},
	})
}

func (h *Host) termWrite(id, data string) error {
	h.termMu.Lock()
	sess := h.terms[id]
	h.termMu.Unlock()
	if sess == nil || sess.closed.Load() {
		return errors.New("终端已关闭")
	}
	_, err := sess.ptmx.Write([]byte(data))
	return err
}

func (h *Host) termResize(id string, cols, rows int) error {
	h.termMu.Lock()
	sess := h.terms[id]
	h.termMu.Unlock()
	if sess == nil || sess.closed.Load() {
		return nil
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return sess.ptmx.Resize(cols, rows)
}

func (h *Host) termClose(id string) error {
	h.termMu.Lock()
	sess := h.terms[id]
	delete(h.terms, id)
	h.termMu.Unlock()
	if sess == nil {
		return nil
	}
	if sess.closed.CompareAndSwap(false, true) {
		if sess.cmd != nil && sess.cmd.Process != nil {
			_ = sess.cmd.Process.Kill()
		}
		_ = sess.ptmx.Close()
	}
	return nil
}

func (h *Host) closeAllTerms() {
	h.termMu.Lock()
	list := make([]*termSession, 0, len(h.terms))
	for id, sess := range h.terms {
		list = append(list, sess)
		delete(h.terms, id)
	}
	h.termMu.Unlock()
	for _, sess := range list {
		if sess.closed.CompareAndSwap(false, true) {
			if sess.cmd != nil && sess.cmd.Process != nil {
				_ = sess.cmd.Process.Kill()
			}
			_ = sess.ptmx.Close()
		}
	}
}
