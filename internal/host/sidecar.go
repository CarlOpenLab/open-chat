package host

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/CarlOpenLab/open-chat/internal/sidecar"
)

// sidecarProc is the Node process that runs acp-hub. It speaks NDJSON:
// requests with an id get a response with that id; frames without an id
// are notifications (events of a session, a session closing).
type sidecarProc struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	writeMu sync.Mutex
	nextID  atomic.Int64

	mu      sync.Mutex
	pending map[int64]chan rpcResponse
	dead    chan struct{}
	err     error
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *RPCError       `json:"error"`
}

// RPCError is an error the sidecar reported for a call.
type RPCError struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

func (e *RPCError) Error() string { return e.Message }

type frame struct {
	ID     int64           `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result"`
	Error  *RPCError       `json:"error"`
}

// sidecarScript writes the embedded bundle into the cache directory, named
// by its hash so that concurrent versions of the app never clobber each other.
func sidecarScript(cacheDir string) (string, error) {
	src := sidecar.Script()
	if len(src) == 0 {
		return "", errors.New("sidecar 未构建：先运行 pnpm build:sidecar")
	}
	sum := sha256.Sum256(src)
	dir := filepath.Join(cacheDir, "sidecar")
	path := filepath.Join(dir, "sidecar-"+hex.EncodeToString(sum[:6])+".mjs")
	if b, err := os.ReadFile(path); err == nil && len(b) == len(src) {
		return path, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, src, 0o644); err != nil {
		return "", err
	}
	return path, os.Rename(tmp, path)
}

func startSidecar(node, script string, env []string, onNotify func(method string, params json.RawMessage)) (*sidecarProc, error) {
	cmd := execCmd(node, script)
	cmd.Env = env
	cmd.Stderr = os.Stderr
	hideWindow(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动 node 失败（%s）：%w", node, err)
	}
	p := &sidecarProc{
		cmd:     cmd,
		stdin:   stdin,
		pending: map[int64]chan rpcResponse{},
		dead:    make(chan struct{}),
	}
	ready := make(chan struct{})
	var readyOnce sync.Once
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 1<<20), 64<<20)
		for sc.Scan() {
			var f frame
			if err := json.Unmarshal(sc.Bytes(), &f); err != nil {
				log.Printf("sidecar: bad frame: %v", err)
				continue
			}
			if f.ID != 0 && f.Method == "" {
				p.mu.Lock()
				ch := p.pending[f.ID]
				delete(p.pending, f.ID)
				p.mu.Unlock()
				if ch != nil {
					ch <- rpcResponse{Result: f.Result, Error: f.Error}
				}
				continue
			}
			if f.Method == "ready" {
				readyOnce.Do(func() { close(ready) })
				continue
			}
			onNotify(f.Method, f.Params)
		}
		err := cmd.Wait()
		p.mu.Lock()
		if err == nil {
			err = errors.New("sidecar 已退出")
		}
		p.err = err
		for id, ch := range p.pending {
			ch <- rpcResponse{Error: &RPCError{Message: "sidecar 意外退出：" + err.Error(), Code: "connection_closed"}}
			delete(p.pending, id)
		}
		p.mu.Unlock()
		close(p.dead)
	}()
	select {
	case <-ready:
		return p, nil
	case <-p.dead:
		return nil, fmt.Errorf("sidecar 启动即退出：%v", p.err)
	case <-time.After(15 * time.Second):
		_ = cmd.Process.Kill()
		return nil, errors.New("sidecar 启动超时")
	}
}

func (p *sidecarProc) alive() bool {
	select {
	case <-p.dead:
		return false
	default:
		return true
	}
}

// call sends a request and waits for its response, or for ctx to end.
func (p *sidecarProc) call(ctx context.Context, method string, params any, out any) error {
	id := p.nextID.Add(1)
	ch := make(chan rpcResponse, 1)
	p.mu.Lock()
	if !p.alive() {
		p.mu.Unlock()
		return &RPCError{Message: "sidecar 未运行", Code: "connection_closed"}
	}
	p.pending[id] = ch
	p.mu.Unlock()

	b, err := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err != nil {
		return err
	}
	p.writeMu.Lock()
	_, err = p.stdin.Write(append(b, '\n'))
	p.writeMu.Unlock()
	if err != nil {
		return err
	}
	select {
	case res := <-ch:
		if res.Error != nil {
			return res.Error
		}
		if out != nil && len(res.Result) > 0 {
			return json.Unmarshal(res.Result, out)
		}
		return nil
	case <-ctx.Done():
		p.mu.Lock()
		delete(p.pending, id)
		p.mu.Unlock()
		return ctx.Err()
	}
}

func (p *sidecarProc) stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = p.call(ctx, "shutdown", nil, nil)
	_ = p.stdin.Close()
	select {
	case <-p.dead:
	case <-time.After(4 * time.Second):
		_ = p.cmd.Process.Kill()
	}
}