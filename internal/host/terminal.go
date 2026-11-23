package host

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// PTY output is coalesced before it crosses the IPC boundary. A chunk after a
// quiet gap — a keystroke's echo — goes out at once; a burst is gathered for a
// few milliseconds (or up to 64 KiB) so a redraw storm does not become
// hundreds of page updates that starve the keyboard.
const (
	termOutWindow = 8 * time.Millisecond
	termOutIdle   = 30 * time.Millisecond
	termOutMax    = 64 << 10
	termInQueue   = 1024
)

type termSession struct {
	id     string
	cwd    string
	shell  string
	ptmx   pty.Pty
	cmd    *pty.Cmd
	closed atomic.Bool

	inMu     sync.Mutex
	inCh     chan []byte
	inClosed bool
}

func (s *termSession) enqueueInput(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	s.inMu.Lock()
	defer s.inMu.Unlock()
	if s.inClosed || s.closed.Load() {
		return errors.New("终端已关闭")
	}
	// Copy so the caller's slice cannot be mutated while queued.
	chunk := make([]byte, len(data))
	copy(chunk, data)
	s.inCh <- chunk
	return nil
}

func (s *termSession) closeInput() {
	s.inMu.Lock()
	if !s.inClosed {
		s.inClosed = true
		close(s.inCh)
	}
	s.inMu.Unlock()
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
		inCh:  make(chan []byte, termInQueue),
	}

	h.termMu.Lock()
	h.terms[id] = sess
	h.termMu.Unlock()

	go h.pumpTermInput(sess)
	go h.pumpTerm(sess)

	return TermInfo{
		ID:    id,
		Cwd:   dir,
		Shell: shellName,
	}, nil
}

// pumpTermInput drains queued keystrokes in strict FIFO order and loops until
// every byte is written to the PTY so rapid typing never drops or reorders bytes.
func (h *Host) pumpTermInput(sess *termSession) {
	for first := range sess.inCh {
		buf := first
		// Coalesce any back-to-back queued chunks into one contiguous write.
	drain:
		for len(buf) < 4096 {
			select {
			case more, ok := <-sess.inCh:
				if !ok {
					break drain
				}
				buf = append(buf, more...)
			default:
				break drain
			}
		}
		for len(buf) > 0 {
			if sess.closed.Load() {
				return
			}
			n, err := sess.ptmx.Write(buf)
			if n > 0 {
				buf = buf[n:]
			}
			if err != nil {
				return
			}
			if n == 0 {
				time.Sleep(time.Millisecond)
			}
		}
	}
}

func (h *Host) pumpTerm(sess *termSession) {
	chunks := make(chan []byte, 64)
	flushed := make(chan struct{})
	go func() {
		defer close(flushed)
		var pending []byte
		var timer *time.Timer
		var expiry <-chan time.Time
		var last time.Time
		push := func(data []byte) {
			h.opts.Push(Push{
				Kind:    "term_out",
				TermOut: &TermOut{ID: sess.id, Data: base64.StdEncoding.EncodeToString(data)},
			})
		}
		flush := func() {
			if len(pending) > 0 {
				push(pending)
				pending = pending[:0]
			}
		}
		stopTimer := func() {
			if timer != nil {
				timer.Stop()
				timer, expiry = nil, nil
			}
		}
		for {
			select {
			case chunk, ok := <-chunks:
				if !ok {
					stopTimer()
					flush()
					return
				}
				quiet := time.Since(last) >= termOutIdle
				last = time.Now()
				if quiet && len(pending) == 0 {
					// A lone response to a keystroke: show it now.
					push(chunk)
					continue
				}
				pending = append(pending, chunk...)
				if len(pending) >= termOutMax {
					flush()
					stopTimer()
				} else if timer == nil {
					timer = time.NewTimer(termOutWindow)
					expiry = timer.C
				}
			case <-expiry:
				timer, expiry = nil, nil
				flush()
			}
		}
	}()

	buf := make([]byte, 32<<10)
	for {
		n, err := sess.ptmx.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			chunks <- chunk
		}
		if err != nil {
			break
		}
	}
	// The flusher pushes every byte the shell wrote before term_exit.
	close(chunks)
	<-flushed

	exitCode := 0
	if err := sess.cmd.Wait(); err != nil {
		exitCode = 1
	}
	if sess.closed.CompareAndSwap(false, true) {
		sess.closeInput()
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
	return sess.enqueueInput([]byte(data))
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
		sess.closeInput()
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
			sess.closeInput()
			if sess.cmd != nil && sess.cmd.Process != nil {
				_ = sess.cmd.Process.Kill()
			}
			_ = sess.ptmx.Close()
		}
	}
}
