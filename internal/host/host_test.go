package host

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"

	"github.com/CarlOpenLab/open-chat/internal/sidecar"
)

func TestCompactFoldsStreaming(t *testing.T) {
	var ev []Event
	for _, e := range []Event{
		{"type": "user_message", "blocks": []any{}},
		{"type": "thought_delta", "text": "a"},
		{"type": "thought_delta", "text": "b"},
		{"type": "tool_call", "toolCall": map[string]any{"toolCallId": "x", "status": "in_progress", "title": "读"}},
		{"type": "plan", "entries": []any{1}},
		{"type": "tool_call_update", "toolCall": map[string]any{"toolCallId": "x", "status": "completed"}},
		{"type": "plan", "entries": []any{1, 2}},
		{"type": "permission_request", "requestId": "r"},
		{"type": "permission_resolved", "requestId": "r", "optionId": "allow"},
		{"type": "message_delta", "text": "he"},
		{"type": "message_delta", "text": "llo"},
		{"type": "usage", "usage": map[string]any{}},
	} {
		ev = compact(ev, e)
	}
	types := []string{}
	for _, e := range ev {
		types = append(types, e["type"].(string))
	}
	want := []string{"user_message", "thought_delta", "tool_call", "plan", "permission_request", "message_delta"}
	if len(types) != len(want) {
		t.Fatalf("types = %v, want %v", types, want)
	}
	for i := range want {
		if types[i] != want[i] {
			t.Fatalf("types = %v, want %v", types, want)
		}
	}
	if ev[1]["text"] != "ab" || ev[5]["text"] != "hello" {
		t.Fatalf("deltas not merged: %v / %v", ev[1]["text"], ev[5]["text"])
	}
	call := ev[2]["toolCall"].(map[string]any)
	if call["status"] != "completed" || call["title"] != "读" {
		t.Fatalf("tool call not folded: %v", call)
	}
	if len(ev[3]["entries"].([]any)) != 2 {
		t.Fatalf("plan not replaced")
	}
	if ev[4]["resolved"] == nil {
		t.Fatalf("permission not marked resolved")
	}
}

func TestSidecarAgentCatalog(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not installed")
	}
	if len(sidecar.Script()) == 0 {
		t.Skip("sidecar not built (pnpm build:sidecar)")
	}
	dir := t.TempDir()
	h, err := New(Options{DataDir: dir, CacheDir: dir, Mode: "web"})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	if _, err := h.sidecar(); err != nil {
		t.Fatal(err)
	}
	var agentIDs []string
	var openCode AgentInfo
	for _, agent := range NewAPI(h).Agents() {
		agentIDs = append(agentIDs, agent.ID)
		if agent.ID == "opencode" {
			openCode = agent
		}
	}
	want := []string{"claude-code", "codex", "opencode", "codebuddy", "qoder", "oh-my-pi", "pi", "dsh"}
	if !slices.Equal(agentIDs, want) {
		t.Fatalf("agent IDs = %v, want %v", agentIDs, want)
	}
	if openCode.Command != "opencode" || openCode.Probe != "opencode" || !slices.Equal(openCode.Args, []string{"acp"}) {
		t.Fatalf("OpenCode launch = %q %q (probe %q), want opencode acp", openCode.Command, openCode.Args, openCode.Probe)
	}
}

func TestArchivePersistsAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	st, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.create(Meta{ID: "c1", Title: "hello", AgentID: "codex", AgentName: "Codex", Cwd: dir, CreatedAt: 1, UpdatedAt: 1})
	h := &Host{store: st, opts: Options{Push: func(Push) {}}, lives: map[string]*live{}}
	api := NewAPI(h)

	m, err := api.Archive("c1", true)
	if err != nil {
		t.Fatal(err)
	}
	if !m.Archived {
		t.Fatalf("expected Archived=true")
	}
	st.flush()

	st2, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := st2.meta("c1")
	if !ok || !got.Archived {
		t.Fatalf("expected archived state to persist, got ok=%v meta=%+v", ok, got)
	}

	h2 := &Host{store: st2, opts: Options{Push: func(Push) {}}, lives: map[string]*live{}}
	m2, err := NewAPI(h2).Archive("c1", false)
	if err != nil {
		t.Fatal(err)
	}
	if m2.Archived {
		t.Fatalf("expected Archived=false")
	}
	st2.flush()

	st3, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got3, ok := st3.meta("c1")
	if !ok || got3.Archived {
		t.Fatalf("expected unarchived state to persist, got ok=%v meta=%+v", ok, got3)
	}
}

func TestCodeBuddyEnvCompatibility(t *testing.T) {
	if !shouldImportLoginEnv("CODEBUDDY_INTERNET_ENVIRONMENT") {
		t.Fatalf("expected CODEBUDDY_INTERNET_ENVIRONMENT to be imported from login shell")
	}
	if !shouldImportLoginEnv("CODEBUDDY_API_KEY") || !shouldImportLoginEnv("CODEBUDDY_CONFIG_DIR") {
		t.Fatalf("expected CODEBUDDY_* variables to be imported from login shell")
	}
	if shouldImportLoginEnv("RANDOM_UNRELATED_VAR") {
		t.Fatalf("unexpectedly imported unrelated variable")
	}

	h := &Host{
		envLoaded: true,
		env: []string{
			"PATH=/usr/bin",
			"CODEBUDDY_INTERNET_ENVIRONMENT=internal",
			"CODEBUDDY_API_KEY=secret",
		},
	}

	// Default ("auto"): inherits CODEBUDDY_* from host environment.
	gotAuto := h.effectiveAgentEnv(AgentInfo{ID: "codebuddy"})
	if gotAuto["CODEBUDDY_INTERNET_ENVIRONMENT"] != "internal" || gotAuto["CODEBUDDY_API_KEY"] != "secret" {
		t.Fatalf("auto env = %#v, want internal + secret", gotAuto)
	}

	// Explicit international override (""): overrides shell "internal".
	gotIntl := h.effectiveAgentEnv(AgentInfo{
		ID:  "codebuddy",
		Env: map[string]string{"CODEBUDDY_INTERNET_ENVIRONMENT": ""},
	})
	if v, ok := gotIntl["CODEBUDDY_INTERNET_ENVIRONMENT"]; !ok || v != "" {
		t.Fatalf("intl env = %#v, want explicit empty override", gotIntl)
	}

	// When shell has no CODEBUDDY_INTERNET_ENVIRONMENT, keeps it unset ("" -> sidecar unsets) to match CLI.
	hNoRegion := &Host{envLoaded: true, env: []string{"PATH=/usr/bin"}}
	gotUnset := hNoRegion.effectiveAgentEnv(AgentInfo{ID: "codebuddy"})
	if v, ok := gotUnset["CODEBUDDY_INTERNET_ENVIRONMENT"]; !ok || v != "" {
		t.Fatalf("unset env = %#v, want explicit empty unset signal", gotUnset)
	}
}

func TestCreateWithoutWorkingDir(t *testing.T) {
	dir := t.TempDir()
	st, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	h := &Host{
		store:     st,
		opts:      Options{DataDir: dir, Push: func(Push) {}},
		envLoaded: true,
		env:       os.Environ(),
		presets:   []preset{{ID: "codex", Name: "Codex", Command: "codex", Probe: "codex"}},
		lives:     map[string]*live{},
	}

	m, err := h.create("codex", "")
	if err != nil {
		t.Fatalf("create with empty cwd failed: %v", err)
	}
	if m.Cwd != "" {
		t.Fatalf("expected empty Cwd, got %q", m.Cwd)
	}
	if len(h.settings.RecentDirs) != 0 {
		t.Fatalf("expected RecentDirs to remain empty, got %v", h.settings.RecentDirs)
	}
	if h.settings.DefaultAgent != "codex" {
		t.Fatalf("expected DefaultAgent=codex, got %q", h.settings.DefaultAgent)
	}

	scratch := h.scratchDir()
	wantScratch := filepath.Join(dir, "scratch")
	if scratch != wantScratch {
		t.Fatalf("scratchDir = %q, want %q", scratch, wantScratch)
	}
	if info, err := os.Stat(scratch); err != nil || !info.IsDir() {
		t.Fatalf("scratch dir not created: %v", err)
	}
}

func TestConversationGroupBySettingPersists(t *testing.T) {
	dir := t.TempDir()
	got := loadSettings(dir)
	if got.ConversationGroupBy != "time" {
		t.Fatalf("default ConversationGroupBy = %q, want time", got.ConversationGroupBy)
	}

	h := &Host{
		opts:     Options{DataDir: dir, Push: func(Push) {}},
		settings: got,
		lives:    map[string]*live{},
	}
	api := NewAPI(h)

	got.ConversationGroupBy = "project"
	saved, err := api.SaveSettings(got)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ConversationGroupBy != "project" {
		t.Fatalf("saved ConversationGroupBy = %q, want project", saved.ConversationGroupBy)
	}

	reloaded := loadSettings(dir)
	if reloaded.ConversationGroupBy != "project" {
		t.Fatalf("reloaded ConversationGroupBy = %q, want project", reloaded.ConversationGroupBy)
	}

	reloaded.ConversationGroupBy = "invalid"
	normalized, err := api.SaveSettings(reloaded)
	if err != nil {
		t.Fatal(err)
	}
	if normalized.ConversationGroupBy != "time" {
		t.Fatalf("invalid ConversationGroupBy normalized to %q, want time", normalized.ConversationGroupBy)
	}
}
