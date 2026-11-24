// Package host is open-chat's backend: it keeps conversations, runs the
// acp-hub sidecar that drives the agents, and tells the pages what happens
// through Push. The page reaches it through API, bound with mygo or served
// over HTTP (see Serve).
package host

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// Options configure a Host.
type Options struct {
	DataDir  string
	CacheDir string
	Version  string
	Mode     string // desktop | web
	// Push delivers updates to every page.
	Push func(Push)
	// Desktop integrations; nil in web mode.
	PickFolder   func(ctx context.Context) (string, error)
	Reveal       func(path string) error
	OpenExternal func(target string) error
	Notify       func(conversationID, title, subtitle, body string, sound bool) error
	// CheckUpdates opens the update window; nil in web mode.
	CheckUpdates func()
}

// Host owns the conversations and the sidecar.
type Host struct {
	opts  Options
	store *store

	envMu     sync.Mutex
	envLoaded bool
	env       []string

	settingsMu sync.Mutex
	settings   Settings

	scMu        sync.Mutex
	sc          *sidecarProc
	presets     []preset
	nodeVersion string
	nodeErr     string

	liveMu sync.Mutex
	lives  map[string]*live

	termMu sync.Mutex
	terms  map[string]*termSession

	fileSrvMu      sync.Mutex
	fileSrv        *http.Server
	fileSrvBaseURL string
	fileSrvToken   string
}

type live struct {
	state        LiveState
	acpSessionID string
	connecting   chan struct{}
	err          error
	pending      map[string]bool
}

// New opens the data directory and prepares the host. Agents start lazily.
func New(opts Options) (*Host, error) {
	if opts.Push == nil {
		opts.Push = func(Push) {}
	}
	st, err := openStore(opts.DataDir)
	if err != nil {
		return nil, err
	}
	h := &Host{opts: opts, store: st, settings: loadSettings(opts.DataDir), lives: map[string]*live{}, terms: map[string]*termSession{}}
	// Resolve the login environment and warm the sidecar up in the
	// background, so the first conversation doesn't wait for either.
	go func() {
		_, _ = h.sidecar()
	}()
	return h, nil
}

// Close stops the agents, terminals and writes everything pending to disk.
func (h *Host) Close() {
	h.closeFileServer()
	h.closeAllTerms()
	h.scMu.Lock()
	sc := h.sc
	h.sc = nil
	h.scMu.Unlock()
	if sc != nil {
		sc.stop()
	}
	h.store.flush()
}

func (h *Host) environ() []string {
	h.envMu.Lock()
	defer h.envMu.Unlock()
	if !h.envLoaded {
		h.env = loginEnv()
		h.envLoaded = true
	}
	return h.env
}

func (h *Host) refreshEnv() {
	env := loginEnv()
	h.envMu.Lock()
	h.env = env
	h.envLoaded = true
	h.envMu.Unlock()
}

func (h *Host) getSettings() Settings {
	h.settingsMu.Lock()
	defer h.settingsMu.Unlock()
	return h.settings
}

// ------------------------------------------------------------ the sidecar

func (h *Host) nodePath() (string, error) {
	if p := h.getSettings().NodePath; p != "" {
		if lookPath(h.environ(), p) == "" {
			return "", fmt.Errorf("设置里的 node 路径不存在：%s", p)
		}
		return p, nil
	}
	if p := lookPath(h.environ(), "node"); p != "" {
		return p, nil
	}
	return "", errors.New("没有找到 Node.js（需要 22 或更高版本）。安装后重启 open-chat，或在设置里指定 node 路径")
}

func (h *Host) sidecar() (*sidecarProc, error) {
	h.scMu.Lock()
	defer h.scMu.Unlock()
	if h.sc != nil && h.sc.alive() {
		return h.sc, nil
	}
	node, err := h.nodePath()
	if err != nil {
		h.nodeErr = err.Error()
		return nil, err
	}
	verCmd := execCmd(node, "--version")
	verCmd.Env = h.environ()
	hideWindow(verCmd)
	if out, err := verCmd.Output(); err == nil {
		h.nodeVersion = strings.TrimSpace(string(out))
	}
	script, err := sidecarScript(h.opts.CacheDir)
	if err != nil {
		h.nodeErr = err.Error()
		return nil, err
	}
	sc, err := startSidecar(node, script, h.environ(), h.onNotify)
	if err != nil {
		h.nodeErr = err.Error()
		return nil, err
	}
	var presets []preset
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := sc.call(ctx, "catalog", nil, &presets); err != nil {
		sc.stop()
		h.nodeErr = err.Error()
		return nil, err
	}
	h.sc, h.presets, h.nodeErr = sc, presets, ""
	go func() {
		<-sc.dead
		h.sidecarDied(sc)
	}()
	return sc, nil
}

// sidecarDied ends every session of a sidecar that exited.
func (h *Host) sidecarDied(sc *sidecarProc) {
	h.scMu.Lock()
	if h.sc == sc {
		h.sc = nil
	}
	h.scMu.Unlock()
	h.liveMu.Lock()
	ids := make([]string, 0, len(h.lives))
	for id := range h.lives {
		ids = append(ids, id)
	}
	h.liveMu.Unlock()
	for _, id := range ids {
		h.sessionClosed(id, "agent 宿主进程退出了")
	}
}

func (h *Host) onNotify(method string, params json.RawMessage) {
	switch method {
	case "events":
		var p struct {
			Key    string  `json:"key"`
			Events []Event `json:"events"`
		}
		if json.Unmarshal(params, &p) == nil {
			h.agentEvents(p.Key, p.Events)
		}
	case "closed":
		var p struct {
			Key   string `json:"key"`
			Error string `json:"error"`
		}
		if json.Unmarshal(params, &p) == nil {
			h.sessionClosed(p.Key, p.Error)
		}
	}
}

// ---------------------------------------------------------------- agents

func (h *Host) agents() []AgentInfo {
	h.scMu.Lock()
	presets := h.presets
	h.scMu.Unlock()
	if presets == nil {
		if _, err := h.sidecar(); err == nil {
			h.scMu.Lock()
			presets = h.presets
			h.scMu.Unlock()
		}
	}
	s := h.getSettings()
	env := h.environ()
	out := []AgentInfo{}
	for _, p := range presets {
		a := AgentInfo{
			ID: p.ID, Name: p.Name, Description: p.Description, Command: p.Command, Args: p.Args,
			Homepage: p.Homepage, Probe: p.Probe,
		}
		if o, ok := s.Agents[p.ID]; ok {
			a.Disabled = o.Disabled
			if o.Command != "" {
				a.Command, a.Args, a.Probe = o.Command, o.Args, o.Command
			}
			a.Env = o.Env
		}
		a.Resolved = lookPath(env, a.Probe)
		a.Available = a.Resolved != "" && lookPath(env, a.Command) != ""
		out = append(out, a)
	}
	for _, c := range s.CustomAgents {
		a := AgentInfo{ID: c.ID, Name: c.Name, Description: strings.TrimSpace(c.Command + " " + strings.Join(c.Args, " ")), Command: c.Command, Args: c.Args, Env: c.Env, Probe: c.Command, Custom: true}
		a.Resolved = lookPath(env, c.Command)
		a.Available = a.Resolved != ""
		out = append(out, a)
	}
	return out
}

func (h *Host) agent(id string) (AgentInfo, bool) {
	for _, a := range h.agents() {
		if a.ID == id {
			return a, true
		}
	}
	return AgentInfo{}, false
}

// ---------------------------------------------------------- conversations

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return time.Now().Format("060102") + "-" + hex.EncodeToString(b)
}

func now() int64 { return time.Now().UnixMilli() }

func (h *Host) liveState(id string) LiveState {
	h.liveMu.Lock()
	defer h.liveMu.Unlock()
	if l, ok := h.lives[id]; ok {
		return l.state
	}
	return LiveState{Status: "idle", ConfigOptions: []any{}, Commands: []Command{}}
}

func (h *Host) pushMeta(m Meta) {
	h.liveMu.Lock()
	if l, ok := h.lives[m.ID]; ok {
		m.Status = l.state.Status
		m.Pending = len(l.pending)
	} else {
		m.Status = "idle"
	}
	h.liveMu.Unlock()
	h.opts.Push(Push{Kind: "meta", ConversationID: m.ID, Meta: &m})
}

func (h *Host) pushLive(id string) {
	st := h.liveState(id)
	h.opts.Push(Push{Kind: "live", ConversationID: id, Live: &st})
	if m, ok := h.store.meta(id); ok {
		h.pushMeta(m)
	}
}

func (h *Host) emit(id string, events ...Event) {
	h.store.append(id, events...)
	h.opts.Push(Push{Kind: "events", ConversationID: id, Events: events})
}

func (h *Host) create(agentID, cwd string) (Meta, error) {
	a, ok := h.agent(agentID)
	if !ok {
		return Meta{}, fmt.Errorf("未知的 agent：%s", agentID)
	}
	cwd = expandHome(strings.TrimSpace(cwd))
	if cwd == "" {
		cwd, _ = os.UserHomeDir()
	}
	if st, err := os.Stat(cwd); err != nil || !st.IsDir() {
		return Meta{}, fmt.Errorf("工作目录不存在：%s", cwd)
	}
	t := now()
	m := Meta{ID: newID(), Title: "新对话", AgentID: a.ID, AgentName: a.Name, Cwd: cwd, CreatedAt: t, UpdatedAt: t, Status: "idle"}
	h.store.create(m)
	h.rememberDir(cwd, a.ID)
	h.pushMeta(m)
	return m, nil
}

func (h *Host) rememberDir(dir, agentID string) {
	h.settingsMu.Lock()
	s := h.settings
	dirs := []string{dir}
	for _, d := range s.RecentDirs {
		if d != dir && len(dirs) < 8 {
			dirs = append(dirs, d)
		}
	}
	s.RecentDirs = dirs
	s.DefaultAgent = agentID
	h.settings = s
	h.settingsMu.Unlock()
	_ = saveSettings(h.opts.DataDir, s)
	h.opts.Push(Push{Kind: "settings", Settings: &s})
}

// connect makes sure the conversation has a live agent session.
func (h *Host) connect(ctx context.Context, id string) (LiveState, error) {
	m, ok := h.store.meta(id)
	if !ok {
		return LiveState{}, errors.New("对话不存在")
	}
	h.liveMu.Lock()
	if l, ok := h.lives[id]; ok {
		if l.connecting != nil {
			ch := l.connecting
			h.liveMu.Unlock()
			select {
			case <-ch:
			case <-ctx.Done():
				return LiveState{}, ctx.Err()
			}
			h.liveMu.Lock()
			l = h.lives[id]
			if l == nil {
				h.liveMu.Unlock()
				return LiveState{}, errors.New("连接已断开")
			}
			st, err := l.state, l.err
			h.liveMu.Unlock()
			return st, err
		}
		if l.state.Status == "ready" || l.state.Status == "running" {
			st := l.state
			h.liveMu.Unlock()
			return st, nil
		}
	}
	l := &live{
		state:      LiveState{Status: "connecting", ConfigOptions: []any{}, Commands: []Command{}},
		connecting: make(chan struct{}),
		pending:    map[string]bool{},
	}
	h.lives[id] = l
	h.liveMu.Unlock()
	h.pushLive(id)

	st, acpSessionID, err := h.open(ctx, m)

	h.liveMu.Lock()
	if err != nil {
		l.state = LiveState{Status: "error", Error: err.Error(), ConfigOptions: []any{}, Commands: []Command{}}
		l.err = err
	} else {
		l.state = st
		l.acpSessionID = acpSessionID
	}
	close(l.connecting)
	l.connecting = nil
	if err != nil {
		// Keep the error visible until the next attempt; the next connect retries.
		h.lives[id] = l
	}
	h.liveMu.Unlock()
	h.pushLive(id)
	return st, err
}

func (h *Host) open(ctx context.Context, m Meta) (LiveState, string, error) {
	a, ok := h.agent(m.AgentID)
	if !ok {
		return LiveState{}, "", fmt.Errorf("agent %s 不存在或已被移除", m.AgentID)
	}
	if !a.Available {
		return LiveState{}, "", fmt.Errorf("没有找到 %s 的命令行（%s）。安装并登录后再试", a.Name, a.Probe)
	}
	sc, err := h.sidecar()
	if err != nil {
		return LiveState{}, "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	var res struct {
		AcpSessionID  string        `json:"acpSessionId"`
		Resumed       bool          `json:"resumed"`
		AgentInfo     *AgentVersion `json:"agentInfo"`
		Capabilities  Capabilities  `json:"capabilities"`
		Modes         *Modes        `json:"modes"`
		ConfigOptions []any         `json:"configOptions"`
	}
	params := map[string]any{
		"key":       m.ID,
		"agent":     map[string]any{"id": a.ID, "command": a.Command, "args": a.Args, "env": a.Env},
		"cwd":       m.Cwd,
		"autoAllow": h.getSettings().AutoAllow,
	}
	if m.AcpSessionID != "" {
		params["resumeId"] = m.AcpSessionID
	}
	if err := sc.call(ctx, "open", params, &res); err != nil {
		return LiveState{}, "", friendlyError(a, err)
	}
	if res.ConfigOptions == nil {
		res.ConfigOptions = []any{}
	}
	hadHistory := m.AcpSessionID != ""
	// Only persist AcpSessionID when resuming an existing session; fresh
	// sessions are persisted on the first sent prompt (Codex only writes a
	// thread to disk once a message is sent, so saving an empty session ID
	// causes session/load to fail on the next restart).
	if res.Resumed {
		h.store.update(m.ID, func(mm *Meta) { mm.AcpSessionID = res.AcpSessionID })
	} else if hadHistory {
		h.store.update(m.ID, func(mm *Meta) { mm.AcpSessionID = "" })
		noticeText := a.Name + " 无法恢复之前的上下文，接下来是一个新的会话"
		if h.shouldEmitResetNotice(m.ID, noticeText) {
			h.emit(m.ID, Event{"type": "notice", "level": "info", "text": noticeText, "t": now()})
		}
	}
	return LiveState{
		Status:        "ready",
		AgentInfo:     res.AgentInfo,
		Capabilities:  res.Capabilities,
		Modes:         res.Modes,
		ConfigOptions: res.ConfigOptions,
		Commands:      []Command{},
		Resumed:       res.Resumed,
	}, res.AcpSessionID, nil
}

// shouldEmitResetNotice returns true only if the conversation had at least one
// user message since the last identical reset notice, preventing duplicate
// notices when re-clicking an idle conversation that cannot resume sessions.
func (h *Host) shouldEmitResetNotice(id, text string) bool {
	events := h.store.transcript(id)
	hasActivity := false
	for i := len(events) - 1; i >= 0; i-- {
		e := events[i]
		t, _ := e["type"].(string)
		if t == "notice" {
			if msg, _ := e["text"].(string); msg == text {
				return hasActivity
			}
			continue
		}
		if t == "user_message" || t == "message_delta" || t == "tool_call" {
			hasActivity = true
		}
	}
	return hasActivity
}

func (h *Host) probeAgent(ctx context.Context, agentID, cwd string, refresh bool) ([]any, error) {
	a, ok := h.agent(agentID)
	if !ok {
		return nil, fmt.Errorf("agent %s 不存在或已被移除", agentID)
	}
	if !a.Available {
		return nil, fmt.Errorf("没有找到 %s 的命令行（%s）", a.Name, a.Probe)
	}
	cwd = expandHome(strings.TrimSpace(cwd))
	if cwd == "" || !isDir(cwd) {
		cwd, _ = os.UserHomeDir()
	}
	sc, err := h.sidecar()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	var res struct {
		ConfigOptions []any `json:"configOptions"`
	}
	params := map[string]any{
		"agent": map[string]any{"id": a.ID, "command": a.Command, "args": a.Args, "env": a.Env},
		"cwd":   cwd,
		// refresh makes the sidecar spawn a fresh agent process, so config
		// changed outside (new models in dsh/magpie etc.) is picked up.
		"refresh": refresh,
	}
	if err := sc.call(ctx, "probe", params, &res); err != nil {
		return nil, friendlyError(a, err)
	}
	if res.ConfigOptions == nil {
		res.ConfigOptions = []any{}
	}
	return res.ConfigOptions, nil
}

func friendlyError(a AgentInfo, err error) error {
	msg := err.Error()
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "auth") || strings.Contains(low, "login") || strings.Contains(low, "unauthorized"):
		return fmt.Errorf("%s 需要先登录：在终端运行 %s 完成登录后重试（%s）", a.Name, a.Probe, msg)
	case strings.Contains(low, "agent_not_found") || strings.Contains(low, "enoent"):
		return fmt.Errorf("启动 %s 失败：找不到命令 %s", a.Name, a.Command)
	}
	return fmt.Errorf("连接 %s 失败：%s", a.Name, msg)
}

func (h *Host) send(ctx context.Context, id string, blocks []Block) error {
	m, ok := h.store.meta(id)
	if !ok {
		return errors.New("对话不存在")
	}
	if len(blocks) == 0 {
		return errors.New("消息不能为空")
	}
	if h.liveState(id).Status == "running" {
		return errors.New("上一轮还没结束，先停止它或等它完成")
	}
	text := ""
	for _, b := range blocks {
		if b["type"] == "text" {
			s, _ := b["text"].(string)
			text += s
		}
	}
	h.emit(id, Event{"type": "user_message", "id": newID(), "blocks": blocks, "t": now()})
	first := m.Preview == ""
	m, _ = h.store.update(id, func(mm *Meta) {
		mm.UpdatedAt = now()
		if p := oneLine(text, 80); p != "" {
			mm.Preview = p
		}
		if first && !mm.TitleLocked && mm.Title == "新对话" {
			if t := oneLine(text, 28); t != "" {
				mm.Title = t
			}
		}
	})
	h.pushMeta(m)

	if _, err := h.connect(context.WithoutCancel(ctx), id); err != nil {
		h.emit(id, Event{"type": "turn_end", "stopReason": "error", "error": err.Error(), "t": now()})
		return nil
	}
	h.liveMu.Lock()
	l := h.lives[id]
	if l == nil {
		h.liveMu.Unlock()
		return errors.New("连接已断开")
	}
	sid := l.acpSessionID
	l.state.Status = "running"
	l.state.TurnStartedAt = now()
	h.liveMu.Unlock()
	if sid != "" {
		h.store.update(id, func(mm *Meta) { mm.AcpSessionID = sid })
	}
	h.pushLive(id)

	sc, err := h.sidecar()
	if err == nil {
		err = sc.call(ctx, "prompt", map[string]any{"key": id, "blocks": blocks}, nil)
	}
	if err != nil {
		h.finishTurn(id, Event{"type": "turn_end", "stopReason": "error", "error": err.Error()})
	}
	return nil
}

func (h *Host) finishTurn(id string, e Event) {
	h.liveMu.Lock()
	l := h.lives[id]
	var started int64
	if l != nil {
		started = l.state.TurnStartedAt
		if l.state.Status == "running" {
			l.state.Status = "ready"
		}
		l.state.TurnStartedAt = 0
		l.pending = map[string]bool{}
	}
	h.liveMu.Unlock()
	e["t"] = now()
	if started > 0 {
		e["durationMs"] = now() - started
	}
	h.emit(id, e)
	h.store.update(id, func(mm *Meta) { mm.UpdatedAt = now() })
	h.pushLive(id)
}

func (h *Host) agentEvents(id string, events []Event) {
	if _, ok := h.store.meta(id); !ok {
		return
	}
	liveChanged := false
	var keep []Event
	var turnEnd Event
	h.liveMu.Lock()
	l := h.lives[id]
	for _, e := range events {
		e["t"] = now()
		t, _ := e["type"].(string)
		if l != nil {
			switch t {
			case "mode_update":
				if l.state.Modes != nil {
					if cur, ok := e["currentModeId"].(string); ok {
						l.state.Modes.CurrentModeID = cur
						liveChanged = true
					}
				}
			case "config_update":
				if opts, ok := e["configOptions"].([]any); ok {
					l.state.ConfigOptions = opts
					liveChanged = true
				}
			case "commands_update":
				var cmds []Command
				b, _ := json.Marshal(e["commands"])
				_ = json.Unmarshal(b, &cmds)
				l.state.Commands = cmds
				liveChanged = true
			case "usage":
				if u, ok := e["usage"].(map[string]any); ok {
					l.state.Usage = u
					liveChanged = true
				}
			case "permission_request":
				if rid, ok := e["requestId"].(string); ok {
					l.pending[rid] = true
					liveChanged = true
				}
			case "permission_resolved":
				if rid, ok := e["requestId"].(string); ok {
					delete(l.pending, rid)
					liveChanged = true
				}
			}
		}
		if t == "turn_end" {
			turnEnd = e
			continue
		}
		if t == "session_info" {
			if title, ok := e["title"].(string); ok && strings.TrimSpace(title) != "" {
				go func(title string) {
					if m, ok := h.store.update(id, func(mm *Meta) {
						if !mm.TitleLocked {
							mm.Title = oneLine(title, 40)
						}
					}); ok {
						h.pushMeta(m)
					}
				}(title)
			}
		}
		keep = append(keep, e)
	}
	h.liveMu.Unlock()
	if len(keep) > 0 {
		h.emit(id, keep...)
	}
	if turnEnd != nil {
		h.finishTurn(id, turnEnd)
	} else if liveChanged {
		h.pushLive(id)
	}
}

func (h *Host) sessionClosed(id, reason string) {
	h.liveMu.Lock()
	l, ok := h.lives[id]
	running := ok && l.state.Status == "running"
	if ok && l.connecting == nil {
		delete(h.lives, id)
	}
	h.liveMu.Unlock()
	if !ok {
		return
	}
	if running {
		msg := "agent 会话中断了"
		if reason != "" {
			msg += "：" + reason
		}
		h.store.append(id, Event{"type": "turn_end", "stopReason": "error", "error": msg, "t": now()})
		h.opts.Push(Push{Kind: "events", ConversationID: id, Events: []Event{{"type": "turn_end", "stopReason": "error", "error": msg, "t": now()}}})
	}
	h.pushLive(id)
}

func (h *Host) callLive(ctx context.Context, id, method string, params map[string]any) error {
	if _, err := h.connect(ctx, id); err != nil {
		return err
	}
	sc, err := h.sidecar()
	if err != nil {
		return err
	}
	params["key"] = id
	return sc.call(ctx, method, params, nil)
}

func (h *Host) remove(id string) {
	h.liveMu.Lock()
	_, wasLive := h.lives[id]
	delete(h.lives, id)
	h.liveMu.Unlock()
	if wasLive {
		if sc, err := h.sidecar(); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = sc.call(ctx, "close", map[string]any{"key": id}, nil)
			cancel()
		}
	}
	h.store.remove(id)
	h.opts.Push(Push{Kind: "removed", ConversationID: id})
}

// ------------------------------------------------------------- utilities

func oneLine(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > max {
		return string(r[:max]) + "…"
	}
	return s
}

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, strings.TrimPrefix(p, "~"))
	}
	return p
}

func listDir(path string) (DirListing, error) {
	path = expandHome(strings.TrimSpace(path))
	if path == "" {
		path, _ = os.UserHomeDir()
	}
	path = filepath.Clean(path)
	entries, err := os.ReadDir(path)
	if err != nil {
		return DirListing{}, fmt.Errorf("打不开目录：%s", path)
	}
	out := DirListing{Path: path, Dirs: []string{}}
	if parent := filepath.Dir(path); parent != path {
		out.Parent = parent
	}
	for _, e := range entries {
		name := e.Name()
		if name == ".git" {
			out.IsRepo = true
		}
		if strings.HasPrefix(name, ".") || name == "node_modules" {
			continue
		}
		if e.IsDir() || (e.Type()&os.ModeSymlink != 0 && isDir(filepath.Join(path, name))) {
			out.Dirs = append(out.Dirs, name)
		}
	}
	sort.Slice(out.Dirs, func(i, j int) bool { return strings.ToLower(out.Dirs[i]) < strings.ToLower(out.Dirs[j]) })
	return out, nil
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func (h *Host) runGit(ctx context.Context, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	gitBin := lookPath(h.environ(), "git")
	if gitBin == "" {
		gitBin = "git"
	}
	fullArgs := append([]string{"-C", dir}, args...)
	cmd := exec.CommandContext(ctx, gitBin, fullArgs...)
	cmd.Env = h.environ()
	hideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(msg)
	}
	return strings.TrimSpace(stdout.String()), nil
}

func (h *Host) gitInfo(ctx context.Context, path string) (GitInfo, error) {
	dir := expandHome(strings.TrimSpace(path))
	if dir == "" || !isDir(dir) {
		return GitInfo{Branches: []string{}}, nil
	}
	out, err := h.runGit(ctx, dir, "rev-parse", "--is-inside-work-tree")
	if err != nil || out != "true" {
		return GitInfo{Branches: []string{}}, nil
	}
	branch, err := h.runGit(ctx, dir, "symbolic-ref", "--short", "HEAD")
	if err != nil || branch == "" {
		branch, _ = h.runGit(ctx, dir, "rev-parse", "--short", "HEAD")
	}
	rawBranches, _ := h.runGit(ctx, dir, "for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads/")
	branches := []string{}
	for _, line := range strings.Split(rawBranches, "\n") {
		if b := strings.TrimSpace(line); b != "" {
			branches = append(branches, b)
		}
	}
	return GitInfo{IsRepo: true, Branch: branch, Branches: branches}, nil
}

func (h *Host) gitCheckout(ctx context.Context, path, branch string) (GitInfo, error) {
	dir := expandHome(strings.TrimSpace(path))
	if dir == "" || !isDir(dir) {
		return GitInfo{}, errors.New("工作目录不存在")
	}
	branch = strings.TrimSpace(branch)
	if branch == "" || strings.HasPrefix(branch, "-") {
		return GitInfo{}, errors.New("无效的分支名")
	}
	if _, err := h.runGit(ctx, dir, "show-ref", "--verify", "--quiet", "refs/heads/"+branch); err != nil {
		return GitInfo{}, fmt.Errorf("本地分支不存在：%s", branch)
	}
	if _, err := h.runGit(ctx, dir, "checkout", branch); err != nil {
		return GitInfo{}, fmt.Errorf("切换分支失败：%s", err.Error())
	}
	return h.gitInfo(ctx, dir)
}

func logf(format string, args ...any) { log.Printf("open-chat: "+format, args...) }

var _ = runtime.GOOS
