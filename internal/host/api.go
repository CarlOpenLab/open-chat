package host

import (
	"context"
	"errors"
	"os"
	"runtime"
	"strings"
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

// ProbeModels briefly connects to an agent to read its available configOptions (including models) without creating a conversation.
func (a *API) ProbeModels(ctx context.Context, agentID, cwd string) ([]any, error) {
	return a.h.probeAgent(context.WithoutCancel(ctx), agentID, cwd)
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
	return a.h.callLive(ctx, id, "setConfig", map[string]any{"configId": configID, "value": value})
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
	h.opts.Push(Push{Kind: "settings", Settings: &s})
	return s, nil
}

// ListDir lists the subdirectories of path, for the folder picker.
func (a *API) ListDir(path string) (DirListing, error) { return listDir(path) }

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