package host

// Event is one entry of a conversation's transcript: the agent's events as
// acp-hub reports them (message_delta, tool_call, plan, permission_request…)
// plus the host's own (user_message, turn_end, notice). The page reduces the
// same stream live and on load, so what it shows never depends on which.
type Event = map[string]any

// Settings are the user's preferences, stored in settings.json.
type Settings struct {
	Theme        string                   `json:"theme"`        // system | light | dark
	SendKey      string                   `json:"sendKey"`      // enter | modEnter
	AutoAllow    bool                     `json:"autoAllow"`    // answer permission requests with "allow once"
	DefaultAgent string                   `json:"defaultAgent"` // agent of new conversations
	RecentDirs   []string                 `json:"recentDirs"`
	NodePath     string                   `json:"nodePath,omitempty"`
	Agents       map[string]AgentOverride `json:"agents"`
	CustomAgents []CustomAgent            `json:"customAgents"`
}

// AgentOverride changes how a built-in agent launches.
type AgentOverride struct {
	Disabled bool              `json:"disabled,omitempty"`
	Command  string            `json:"command,omitempty"`
	Args     []string          `json:"args,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
}

// CustomAgent is any other program speaking ACP over stdio.
type CustomAgent struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env,omitempty"`
}

// AgentInfo is an agent the user may start a conversation with.
type AgentInfo struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Command     string            `json:"command"`
	Args        []string          `json:"args"`
	Env         map[string]string `json:"env,omitempty"`
	Homepage    string            `json:"homepage,omitempty"`
	Probe       string            `json:"probe"`
	// Available is whether the agent's CLI was found on the PATH.
	Available bool `json:"available"`
	// Resolved is where it was found.
	Resolved string `json:"resolved,omitempty"`
	Custom   bool   `json:"custom,omitempty"`
	Demo     bool   `json:"demo,omitempty"`
	Disabled bool   `json:"disabled,omitempty"`
}

type preset struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Command     string   `json:"command"`
	Args        []string `json:"args"`
	Probe       string   `json:"probe"`
	Homepage    string   `json:"homepage"`
	Demo        bool     `json:"demo"`
}

// Meta describes a conversation in the sidebar.
type Meta struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	TitleLocked bool   `json:"titleLocked,omitempty"`
	AgentID     string `json:"agentId"`
	AgentName   string `json:"agentName"`
	Cwd         string `json:"cwd"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
	Pinned      bool   `json:"pinned,omitempty"`
	// AcpSessionID is the agent's own session id, to resume with session/load.
	AcpSessionID string `json:"acpSessionId,omitempty"`
	Preview      string `json:"preview,omitempty"`
	// Status is live state, not stored: idle | connecting | ready | running | error.
	Status string `json:"status"`
	// Pending is how many permission requests wait on the user.
	Pending int `json:"pending,omitempty"`
}

// Conversation is a conversation with its transcript and live state.
type Conversation struct {
	Meta   Meta      `json:"meta"`
	Events []Event   `json:"events"`
	Live   LiveState `json:"live"`
}

// LiveState is what the connected agent session offers right now.
type LiveState struct {
	Status        string        `json:"status"`
	Error         string        `json:"error,omitempty"`
	AgentInfo     *AgentVersion `json:"agentInfo"`
	Capabilities  Capabilities  `json:"capabilities"`
	Modes         *Modes        `json:"modes"`
	ConfigOptions []any         `json:"configOptions"`
	Commands      []Command     `json:"commands"`
	Usage         Event         `json:"usage,omitempty"`
	Resumed       bool          `json:"resumed"`
	TurnStartedAt int64         `json:"turnStartedAt,omitempty"`
}

type AgentVersion struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type Capabilities struct {
	LoadSession     bool `json:"loadSession"`
	Image           bool `json:"image"`
	Audio           bool `json:"audio"`
	EmbeddedContext bool `json:"embeddedContext"`
}

type Modes struct {
	CurrentModeID  string `json:"currentModeId"`
	AvailableModes []Mode `json:"availableModes"`
}

type Mode struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type Command struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// Push is what the host tells the pages, as the "push" event.
type Push struct {
	Kind           string     `json:"kind"` // events | live | meta | removed | settings
	ConversationID string     `json:"conversationId,omitempty"`
	Events         []Event    `json:"events,omitempty"`
	Live           *LiveState `json:"live,omitempty"`
	Meta           *Meta      `json:"meta,omitempty"`
	Settings       *Settings  `json:"settings,omitempty"`
}

// Bootstrap is everything the page needs to draw its first frame.
type Bootstrap struct {
	Version       string     `json:"version"`
	Platform      string     `json:"platform"`
	Mode          string     `json:"mode"` // desktop | web
	Home          string     `json:"home"`
	Settings      Settings   `json:"settings"`
	Agents        []AgentInfo `json:"agents"`
	Conversations []Meta     `json:"conversations"`
	NodeVersion   string     `json:"nodeVersion"`
	NodeError     string     `json:"nodeError,omitempty"`
}

// DirListing is one directory of the folder picker.
type DirListing struct {
	Path   string   `json:"path"`
	Parent string   `json:"parent"`
	Dirs   []string `json:"dirs"`
	IsRepo bool     `json:"isRepo"`
}

// GitInfo describes the git repository and local branches for a directory.
type GitInfo struct {
	IsRepo   bool     `json:"isRepo"`
	Branch   string   `json:"branch"`
	Branches []string `json:"branches"`
}

// Block is one piece of a user's message (ACP ContentBlock).
type Block = map[string]any