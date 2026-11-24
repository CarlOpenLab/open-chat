package host

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// API is the service the page calls: bound as "Host" in the desktop app and
// served at /api/call/<Method> in web mode. Every method is safe to call
// concurrently.
type API struct{ h *Host }

// NewAPI returns the page-facing API of h.
func NewAPI(h *Host) *API { return &API{h: h} }

// Bootstrap returns everything the first frame needs.
func (a *API) Bootstrap() Bootstrap {
	h := a.h
	home, _ := os.UserHomeDir()
	agents := h.agents()
	h.scMu.Lock()
	nodeVersion, nodeErr := h.nodeVersion, h.nodeErr
	h.scMu.Unlock()
	metas := h.store.list()
	for i := range metas {
		st := h.liveState(metas[i].ID)
		metas[i].Status = st.Status
	}
	return Bootstrap{
		Version:       h.opts.Version,
		Platform:      runtime.GOOS,
		Mode:          h.opts.Mode,
		Home:          home,
		Settings:      h.getSettings(),
		Agents:        agents,
		Conversations: metas,
		NodeVersion:   nodeVersion,
		NodeError:     nodeErr,
	}
}

// Agents probes the agents again (after the user installed one, say).
func (a *API) Agents() []AgentInfo { return a.h.agents() }

// InspectAgentUpdates checks installed coding agents, their install channels,
// and available updates without modifying anything on disk.
func (a *API) InspectAgentUpdates(ctx context.Context, opts AgentUpdateOptions) (*AgentUpdateReport, error) {
	return auInspectAll(context.WithoutCancel(ctx), a.h.environ(), opts)
}

// UpgradeAgents upgrades outdated coding agents via their original install channel
// and refreshes the host login environment when any agent was updated.
func (a *API) UpgradeAgents(ctx context.Context, opts AgentUpdateOptions) (*AgentUpdateReport, error) {
	report, err := auUpgrade(context.WithoutCancel(ctx), a.h.environ(), opts, func(p AgentUpdateProgress) {
		a.h.opts.Push(Push{Kind: "agent_update", AgentUpdate: &p})
	})
	if err != nil {
		return nil, err
	}
	if report != nil && report.Summary.Updated > 0 {
		a.h.refreshEnv()
	}
	return report, nil
}

// InstallAgent installs an agent via the chosen available channel (mise/npm/pnpm/bun/brew).
func (a *API) InstallAgent(ctx context.Context, agentID string, channel AgentUpdateChannel) (*AgentUpdateResult, error) {
	res, err := auInstall(context.WithoutCancel(ctx), a.h.environ(), agentID, channel, func(p AgentUpdateProgress) {
		a.h.opts.Push(Push{Kind: "agent_update", AgentUpdate: &p})
	})
	if err != nil {
		return nil, err
	}
	a.h.refreshEnv()
	// Re-inspect with refreshed environment so newly added shims/binaries are reflected accurately.
	if report, ierr := auInspectAll(context.WithoutCancel(ctx), a.h.environ(), AgentUpdateOptions{Only: []string{agentID}}); ierr == nil && len(report.Results) > 0 {
		r := report.Results[0]
		a.h.opts.Push(Push{Kind: "agent_update", AgentUpdate: &AgentUpdateProgress{
			Stage: "done", AgentID: r.ID, AgentName: r.Agent, Completed: 1, Total: 1, Percent: 100, Message: "安装完成", Result: &r,
		}})
		return &r, nil
	}
	return res, nil
}

// UninstallAgent removes an installed agent via its detected original channel.
func (a *API) UninstallAgent(ctx context.Context, agentID string) (*AgentUpdateResult, error) {
	res, err := auUninstall(context.WithoutCancel(ctx), a.h.environ(), agentID, func(p AgentUpdateProgress) {
		a.h.opts.Push(Push{Kind: "agent_update", AgentUpdate: &p})
	})
	if err != nil {
		return nil, err
	}
	a.h.refreshEnv()
	if report, ierr := auInspectAll(context.WithoutCancel(ctx), a.h.environ(), AgentUpdateOptions{Only: []string{agentID}}); ierr == nil && len(report.Results) > 0 {
		r := report.Results[0]
		a.h.opts.Push(Push{Kind: "agent_update", AgentUpdate: &AgentUpdateProgress{
			Stage: "done", AgentID: r.ID, AgentName: r.Agent, Completed: 1, Total: 1, Percent: 100, Message: "卸载完成", Result: &r,
		}})
		return &r, nil
	}
	return res, nil
}

// CheckUpdates opens the app's update window; the check itself runs in the
// background and the window reports the result. Only desktop builds have
// one: `open-chat serve` updates by replacing the binary by hand.
func (a *API) CheckUpdates() error {
	if a.h.opts.CheckUpdates == nil {
		return errors.New("自动更新只在桌面应用中可用")
	}
	a.h.opts.CheckUpdates()
	return nil
}

// ProbeModels briefly connects to an agent to read its available configOptions (including models) without creating a conversation.
func (a *API) ProbeModels(ctx context.Context, agentID, cwd string) ([]any, error) {
	return a.h.probeAgent(context.WithoutCancel(ctx), agentID, cwd, false)
}

// RefreshModels re-reads configOptions from a freshly spawned agent process,
// so models added outside (dsh profile, npm install, provider config) show up
// without restarting open-chat.
func (a *API) RefreshModels(ctx context.Context, agentID, cwd string) ([]any, error) {
	return a.h.probeAgent(context.WithoutCancel(ctx), agentID, cwd, true)
}

// Create starts a conversation with an agent in a working directory and
// connects it in the background, so its modes and models show up quickly.
func (a *API) Create(agentID, cwd string) (Meta, error) {
	m, err := a.h.create(agentID, cwd)
	if err != nil {
		return Meta{}, err
	}
	go func() { _, _ = a.h.connect(context.Background(), m.ID) }()
	return m, nil
}

// Open returns a conversation's transcript and live state.
func (a *API) Open(id string) (Conversation, error) {
	m, ok := a.h.store.meta(id)
	if !ok {
		return Conversation{}, errors.New("对话不存在")
	}
	st := a.h.liveState(id)
	m.Status = st.Status
	return Conversation{Meta: m, Events: a.h.store.transcript(id), Live: st}, nil
}

// Connect makes sure the conversation has a live agent session.
func (a *API) Connect(ctx context.Context, id string) (LiveState, error) {
	return a.h.connect(context.WithoutCancel(ctx), id)
}

// Send sends the user's message. The reply streams in as push events.
func (a *API) Send(ctx context.Context, id string, blocks []Block) error {
	return a.h.send(context.WithoutCancel(ctx), id, blocks)
}

// Cancel stops the running turn.
func (a *API) Cancel(ctx context.Context, id string) error {
	if a.h.liveState(id).Status != "running" {
		return nil
	}
	return a.h.callLive(ctx, id, "cancel", map[string]any{})
}

// Respond answers a permission request; an empty optionID dismisses it.
func (a *API) Respond(ctx context.Context, id, requestID, optionID string) error {
	params := map[string]any{"requestId": requestID}
	if optionID != "" {
		params["optionId"] = optionID
	}
	return a.h.callLive(ctx, id, "permission", params)
}

// SetMode switches the session mode (e.g. plan mode).
func (a *API) SetMode(ctx context.Context, id, modeID string) error {
	return a.h.callLive(ctx, id, "setMode", map[string]any{"modeId": modeID})
}

// SetConfig changes a session config option, such as the model.
func (a *API) SetConfig(ctx context.Context, id, configID string, value any) error {
	if err := a.h.callLive(ctx, id, "setConfig", map[string]any{"configId": configID, "value": value}); err != nil {
		return err
	}
	// ACP keeps config options in the session only. Remember the model choice
	// on the conversation so open() can re-apply it after a restart or resume.
	if chosen, ok := value.(string); ok && isModelConfigOption(configID, a.h.liveState(id).ConfigOptions) {
		a.h.store.update(id, func(m *Meta) {
			m.ModelConfigID = configID
			m.ModelValue = chosen
		})
	}
	return nil
}

func isModelConfigOption(configID string, options []any) bool {
	for _, raw := range options {
		opt, ok := raw.(map[string]any)
		if !ok || opt["id"] != configID {
			continue
		}
		if category, _ := opt["category"].(string); category == "model" {
			return true
		}
		break
	}
	return strings.Contains(strings.ToLower(configID), "model")
}

// Rename sets a conversation's title; agents no longer retitle it.
func (a *API) Rename(id, title string) (Meta, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return Meta{}, errors.New("标题不能为空")
	}
	m, ok := a.h.store.update(id, func(m *Meta) { m.Title = oneLine(title, 60); m.TitleLocked = true })
	if !ok {
		return Meta{}, errors.New("对话不存在")
	}
	a.h.pushMeta(m)
	return m, nil
}

// Pin pins or unpins a conversation to the top of the sidebar.
func (a *API) Pin(id string, pinned bool) (Meta, error) {
	m, ok := a.h.store.update(id, func(m *Meta) { m.Pinned = pinned })
	if !ok {
		return Meta{}, errors.New("对话不存在")
	}
	a.h.pushMeta(m)
	return m, nil
}

// Archive archives or unarchives a conversation.
func (a *API) Archive(id string, archived bool) (Meta, error) {
	m, ok := a.h.store.update(id, func(m *Meta) { m.Archived = archived })
	if !ok {
		return Meta{}, errors.New("对话不存在")
	}
	a.h.pushMeta(m)
	return m, nil
}

// Delete removes a conversation and ends its session.
func (a *API) Delete(id string) error {
	a.h.remove(id)
	return nil
}

// SaveSettings stores the settings and returns them as stored.
func (a *API) SaveSettings(s Settings) (Settings, error) {
	h := a.h
	if s.Agents == nil {
		s.Agents = map[string]AgentOverride{}
	}
	for i, c := range s.CustomAgents {
		c.ID = strings.TrimSpace(c.ID)
		if c.ID == "" {
			c.ID = "custom-" + newID()
		}
		if strings.TrimSpace(c.Command) == "" {
			return Settings{}, errors.New("自定义 agent 需要填写启动命令")
		}
		s.CustomAgents[i] = c
	}
	h.settingsMu.Lock()
	h.settings = s
	h.settingsMu.Unlock()
	if err := saveSettings(h.opts.DataDir, s); err != nil {
		return Settings{}, err
	}
	h.scMu.Lock()
	sc := h.sc
	h.scMu.Unlock()
	if sc != nil && sc.alive() {
		go func(autoAllow bool) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = sc.call(ctx, "setAutoAllow", map[string]any{"autoAllow": autoAllow}, nil)
		}(s.AutoAllow)
	}
	h.opts.Push(Push{Kind: "settings", Settings: &s})
	return s, nil
}

// ListDir lists the subdirectories of path, for the folder picker.
func (a *API) ListDir(path string) (DirListing, error) { return listDir(path) }

// ListSkills returns local skills discovered in project and user skill directories.
func (a *API) ListSkills(cwd string) []SkillInfo { return listSkills(cwd) }

// GitInfo returns the current git branch and local branches for path.
func (a *API) GitInfo(ctx context.Context, path string) (GitInfo, error) {
	return a.h.gitInfo(ctx, path)
}

// GitCheckout switches the git repository at path to branch and returns updated info.
func (a *API) GitCheckout(ctx context.Context, path, branch string) (GitInfo, error) {
	return a.h.gitCheckout(ctx, path, branch)
}

// PickFolder shows the system's folder dialog; "" when canceled or unavailable.
func (a *API) PickFolder(ctx context.Context) (string, error) {
	if a.h.opts.PickFolder == nil {
		return "", nil
	}
	return a.h.opts.PickFolder(ctx)
}

// Reveal shows a path in the file manager.
func (a *API) Reveal(path string) error {
	if a.h.opts.Reveal == nil {
		return errors.New("网页模式下不能打开文件管理器")
	}
	return a.h.opts.Reveal(expandHome(path))
}

// OpenLink opens a link clicked in a transcript or a terminal: web links go
// to the default browser, file links (paths, file:// URLs, and paths with
// :line suffixes) go to the file manager. Relative paths resolve against cwd.
func (a *API) OpenLink(target, cwd string) error {
	target = strings.TrimSpace(target)
	if target == "" || strings.HasPrefix(target, "#") {
		return nil
	}
	u, uerr := url.Parse(target)
	scheme := ""
	if uerr == nil {
		scheme = strings.ToLower(u.Scheme)
	}
	if runtime.GOOS == "windows" && len(scheme) == 1 {
		// C:\dir\file looks like the URL scheme "c".
		scheme, u, uerr = "", nil, errors.New("path")
	}
	switch scheme {
	case "", "file":
		if uerr != nil {
			u = nil
		}
		return a.openLocalLink(target, u, cwd)
	case "javascript", "data", "vbscript":
		return fmt.Errorf("不支持的链接：%s", target)
	}
	if a.h.opts.OpenExternal == nil {
		return errors.New("网页模式下不能打开外部链接")
	}
	return a.h.opts.OpenExternal(target)
}

func (a *API) openLocalLink(target string, u *url.URL, cwd string) error {
	p := target
	if u != nil && u.Path != "" {
		p = u.Path
		if u.Scheme == "file" {
			if u.Host != "" && !strings.EqualFold(u.Host, "localhost") {
				p = "//" + u.Host + p
			}
			if runtime.GOOS == "windows" && len(p) >= 3 && p[0] == '/' && p[2] == ':' {
				p = p[1:]
			}
		}
	}
	p = expandHome(filepath.FromSlash(strings.TrimSpace(p)))
	if p == "" {
		return fmt.Errorf("无效的链接：%s", target)
	}
	if !filepath.IsAbs(p) {
		base := expandHome(strings.TrimSpace(cwd))
		if base == "" {
			return fmt.Errorf("无法解析相对路径：%s", target)
		}
		p = filepath.Join(base, p)
	}
	p = filepath.Clean(p)
	if _, err := os.Stat(p); err != nil {
		// Agents often link to "file.go:12" or "file.go:12:3".
		if trimmed, ok := trimLineSuffix(p); ok {
			p = trimmed
		}
	}
	if _, err := os.Stat(p); err != nil {
		return fmt.Errorf("文件不存在：%s", p)
	}
	if a.h.opts.Reveal == nil {
		return errors.New("网页模式下不能打开文件管理器")
	}
	return a.h.opts.Reveal(p)
}

// trimLineSuffix drops one or two trailing :number parts when the path
// before them exists.
func trimLineSuffix(p string) (string, bool) {
	base := p
	for range 2 {
		idx := strings.LastIndex(base, ":")
		if idx <= 0 || idx == len(base)-1 {
			return "", false
		}
		for _, r := range base[idx+1:] {
			if r < '0' || r > '9' {
				return "", false
			}
		}
		base = base[:idx]
		if _, err := os.Stat(base); err == nil {
			return base, true
		}
	}
	return "", false
}

// Notify displays a native OS desktop notification.
func (a *API) Notify(conversationID, title, subtitle, body string, sound bool) error {
	if a.h.opts.Notify == nil {
		return nil
	}
	return a.h.opts.Notify(conversationID, title, subtitle, body, sound)
}

// WorkspaceTree returns the file tree of cwd for the workspace panel.
func (a *API) WorkspaceTree(cwd string) ([]WorkspaceNode, error) {
	return listWorkspaceTree(cwd)
}

// WorkspaceReadFile returns the UTF-8 text content of a file inside cwd.
func (a *API) WorkspaceReadFile(cwd, relPath string) (string, error) {
	return readWorkspaceFile(cwd, relPath)
}

// WorkspaceWriteFile saves UTF-8 text content to a file inside cwd.
func (a *API) WorkspaceWriteFile(cwd, relPath, content string) error {
	return writeWorkspaceFile(cwd, relPath, content)
}

// WorkspaceFileInfo returns metadata and a streaming HTTP URL for a workspace file.
func (a *API) WorkspaceFileInfo(cwd, relPath string) (WorkspaceFileInfo, error) {
	return a.h.workspaceFileInfo(cwd, relPath)
}

// TermCreate spawns an interactive PTY shell session rooted at cwd.
func (a *API) TermCreate(cwd string, cols, rows int) (TermInfo, error) {
	return a.h.termCreate(cwd, cols, rows)
}

// TermWrite sends keyboard input to a running terminal session.
func (a *API) TermWrite(id, data string) error {
	return a.h.termWrite(id, data)
}

// TermResize updates the PTY dimensions of a running terminal session.
func (a *API) TermResize(id string, cols, rows int) error {
	return a.h.termResize(id, cols, rows)
}

// TermClose terminates a terminal session and releases its PTY.
func (a *API) TermClose(id string) error {
	return a.h.termClose(id)
}
