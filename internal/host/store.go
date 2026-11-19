package host

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// store keeps conversations on disk: index.json lists their metadata and
// conversations/<id>.json holds each transcript. Writes are atomic
// (temp file + rename) and transcripts are written at most every 400ms
// while an agent streams.
type store struct {
	dir string

	mu     sync.Mutex
	metas  map[string]*Meta
	events map[string][]Event // loaded transcripts
	dirty  map[string]bool
	/** Conversations deleted here, so a merge with the file doesn't bring them back. */
	gone   map[string]bool
	timer  *time.Timer
}

func openStore(dir string) (*store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "conversations"), 0o755); err != nil {
		return nil, err
	}
	s := &store{dir: dir, metas: map[string]*Meta{}, events: map[string][]Event{}, dirty: map[string]bool{}, gone: map[string]bool{}}
	b, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err == nil {
		var list []*Meta
		if json.Unmarshal(b, &list) == nil {
			for _, m := range list {
				if m != nil && m.ID != "" {
					m.Status = "idle"
					m.Pending = 0
					s.metas[m.ID] = m
				}
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func (s *store) list() []Meta {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Meta, 0, len(s.metas))
	for _, m := range s.metas {
		out = append(out, *m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func (s *store) meta(id string) (Meta, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.metas[id]
	if !ok {
		return Meta{}, false
	}
	return *m, true
}

// update changes a conversation's metadata under the lock and returns the result.
func (s *store) update(id string, fn func(m *Meta)) (Meta, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.metas[id]
	if !ok {
		return Meta{}, false
	}
	fn(m)
	s.dirty["\x00index"] = true
	s.schedule()
	return *m, true
}

func (s *store) create(m Meta) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := m
	s.metas[m.ID] = &cp
	s.events[m.ID] = []Event{}
	s.dirty["\x00index"] = true
	s.dirty[m.ID] = true
	s.schedule()
}

func (s *store) remove(id string) {
	s.mu.Lock()
	delete(s.metas, id)
	delete(s.events, id)
	delete(s.dirty, id)
	s.gone[id] = true
	s.dirty["\x00index"] = true
	s.schedule()
	s.mu.Unlock()
	_ = os.Remove(s.path(id))
}

func (s *store) path(id string) string {
	return filepath.Join(s.dir, "conversations", id+".json")
}

func (s *store) transcript(id string) []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Event(nil), s.loadLocked(id)...)
}

func (s *store) loadLocked(id string) []Event {
	if ev, ok := s.events[id]; ok {
		return ev
	}
	var ev []Event
	if b, err := os.ReadFile(s.path(id)); err == nil {
		_ = json.Unmarshal(b, &ev)
	}
	if ev == nil {
		ev = []Event{}
	}
	s.events[id] = ev
	return ev
}

// append adds events to a transcript, folding streaming noise into the
// entries it updates (see compact).
func (s *store) append(id string, events ...Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.metas[id]; !ok {
		return
	}
	ev := s.loadLocked(id)
	for _, e := range events {
		ev = compact(ev, e)
	}
	s.events[id] = ev
	s.dirty[id] = true
	s.schedule()
}

func (s *store) schedule() {
	if s.timer != nil {
		return
	}
	s.timer = time.AfterFunc(400*time.Millisecond, s.flush)
}

func (s *store) flush() {
	s.mu.Lock()
	s.timer = nil
	jobs := map[string][]byte{}
	for id := range s.dirty {
		if id == "\x00index" {
			// Another instance (or an older one still shutting down) may have
			// written conversations this process never saw: keep them.
			if b, err := os.ReadFile(filepath.Join(s.dir, "index.json")); err == nil {
				var disk []*Meta
				if json.Unmarshal(b, &disk) == nil {
					for _, m := range disk {
						if m == nil || m.ID == "" || s.gone[m.ID] {
							continue
						}
						if _, known := s.metas[m.ID]; !known {
							m.Status, m.Pending = "idle", 0
							s.metas[m.ID] = m
						}
					}
				}
			}
			list := make([]*Meta, 0, len(s.metas))
			for _, m := range s.metas {
				list = append(list, m)
			}
			sort.Slice(list, func(i, j int) bool { return list[i].UpdatedAt > list[j].UpdatedAt })
			b, _ := json.MarshalIndent(list, "", " ")
			jobs[filepath.Join(s.dir, "index.json")] = b
			continue
		}
		if ev, ok := s.events[id]; ok {
			b, _ := json.Marshal(ev)
			jobs[s.path(id)] = b
		}
	}
	s.dirty = map[string]bool{}
	s.mu.Unlock()
	for path, b := range jobs {
		_ = writeAtomic(path, b)
	}
}

func writeAtomic(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// compact appends e to a transcript, merging it into what it updates within
// the current turn: adjacent text deltas join, tool call updates fold into
// their call, a plan replaces the previous plan, a resolved permission marks
// its request. Session-level state (modes, commands, config) isn't kept.
func compact(ev []Event, e Event) []Event {
	t, _ := e["type"].(string)
	switch t {
	case "mode_update", "commands_update", "config_update", "raw", "usage":
		return ev
	case "message_delta", "thought_delta":
		if n := len(ev); n > 0 {
			if last := ev[n-1]; last["type"] == t {
				a, _ := last["text"].(string)
				b, _ := e["text"].(string)
				merged := cloneEvent(last)
				merged["text"] = a + b
				ev[n-1] = merged
				return ev
			}
		}
	case "tool_call_update", "tool_call":
		call, _ := e["toolCall"].(map[string]any)
		id, _ := call["toolCallId"].(string)
		for i := len(ev) - 1; i >= 0; i-- {
			if ev[i]["type"] == "user_message" {
				break
			}
			if ev[i]["type"] != "tool_call" {
				continue
			}
			prev, _ := ev[i]["toolCall"].(map[string]any)
			if prev["toolCallId"] != id {
				continue
			}
			merged := map[string]any{}
			for k, v := range prev {
				merged[k] = v
			}
			for k, v := range call {
				merged[k] = v
			}
			next := cloneEvent(ev[i])
			next["toolCall"] = merged
			ev[i] = next
			return ev
		}
		if t == "tool_call_update" {
			next := cloneEvent(e)
			next["type"] = "tool_call"
			return append(ev, next)
		}
	case "plan":
		for i := len(ev) - 1; i >= 0; i-- {
			if ev[i]["type"] == "user_message" {
				break
			}
			if ev[i]["type"] == "plan" {
				ev[i] = e
				return ev
			}
		}
	case "permission_resolved":
		for i := len(ev) - 1; i >= 0; i-- {
			if ev[i]["type"] == "permission_request" && ev[i]["requestId"] == e["requestId"] {
				next := cloneEvent(ev[i])
				next["resolved"] = map[string]any{"optionId": e["optionId"], "auto": e["auto"]}
				ev[i] = next
				return ev
			}
		}
		return ev
	}
	return append(ev, e)
}

func cloneEvent(e Event) Event {
	out := make(Event, len(e))
	for k, v := range e {
		out[k] = v
	}
	return out
}

// settings.json

func loadSettings(dir string) Settings {
	s := Settings{Theme: "system", SendKey: "modEnter", Agents: map[string]AgentOverride{}}
	if b, err := os.ReadFile(filepath.Join(dir, "settings.json")); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	if s.Agents == nil {
		s.Agents = map[string]AgentOverride{}
	}
	if s.Theme == "" {
		s.Theme = "system"
	}
	if s.SendKey == "" {
		s.SendKey = "modEnter"
	}
	return s
}

func saveSettings(dir string, s Settings) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(dir, "settings.json"), b)
}
