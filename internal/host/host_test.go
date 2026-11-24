package host

import (
	"os/exec"
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
	for _, agent := range NewAPI(h).Agents() {
		agentIDs = append(agentIDs, agent.ID)
	}
	want := []string{"claude-code", "codex", "oh-my-pi", "pi", "dsh"}
	if !slices.Equal(agentIDs, want) {
		t.Fatalf("agent IDs = %v, want %v", agentIDs, want)
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
