package host

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseBotSchedule(t *testing.T) {
	valid := []struct {
		spec string
		kind botScheduleKind
	}{
		{"", botScheduleNone},
		{"   ", botScheduleNone},
		{"daily 09:00", botScheduleDaily},
		{"DAILY 23:59", botScheduleDaily},
		{"daily 00:00", botScheduleDaily},
		{"every 30m", botScheduleInterval},
		{"EVERY 2h", botScheduleInterval},
		{"every 1h30m", botScheduleInterval},
		{"every 1m", botScheduleInterval},
		{"0 9 * * *", botScheduleCron},
		{"30 9 * * 1-5", botScheduleCron},
		{"*/30 * * * *", botScheduleCron},
		{"0 */2 * * *", botScheduleCron},
		{"0 10 1,15 * 0,7", botScheduleCron},
	}
	for _, tc := range valid {
		got, err := parseBotSchedule(tc.spec)
		if err != nil {
			t.Fatalf("parseBotSchedule(%q) unexpected error: %v", tc.spec, err)
		}
		if got.kind != tc.kind {
			t.Fatalf("parseBotSchedule(%q).kind = %v, want %v", tc.spec, got.kind, tc.kind)
		}
	}

	invalid := []string{
		"daily",
		"daily 9:00",
		"daily 24:00",
		"daily 12:60",
		"every 30s",
		"every 0m",
		"every -5m",
		"every banana",
		"cron 0 9 * * *",
		"60 9 * * *",
		"0 24 * * *",
		"0 9 32 * *",
		"0 9 * 13 *",
		"0 9 * * 8",
		"*/0 * * * *",
	}
	for _, spec := range invalid {
		if _, err := parseBotSchedule(spec); err == nil {
			t.Fatalf("parseBotSchedule(%q) expected error, got nil", spec)
		}
	}
}

func TestShouldTriggerBot(t *testing.T) {
	loc := time.Local
	baseline := time.Date(2026, 5, 1, 8, 0, 0, 0, loc)

	daily, err := parseBotSchedule("daily 09:00")
	if err != nil {
		t.Fatal(err)
	}
	if shouldTriggerBot(daily, botRunState{}, time.Date(2026, 5, 1, 8, 59, 59, 0, loc), baseline) {
		t.Fatalf("daily should not trigger before 09:00")
	}
	if !shouldTriggerBot(daily, botRunState{}, time.Date(2026, 5, 1, 9, 0, 15, 0, loc), baseline) {
		t.Fatalf("daily should trigger during 09:00 minute")
	}
	if shouldTriggerBot(daily, botRunState{lastDailyDate: "2026-05-01"}, time.Date(2026, 5, 1, 9, 0, 45, 0, loc), baseline) {
		t.Fatalf("daily should not trigger twice on same day")
	}
	if !shouldTriggerBot(daily, botRunState{lastDailyDate: "2026-05-01"}, time.Date(2026, 5, 2, 9, 0, 5, 0, loc), baseline) {
		t.Fatalf("daily should trigger on next day")
	}

	interval, err := parseBotSchedule("every 30m")
	if err != nil {
		t.Fatal(err)
	}
	if shouldTriggerBot(interval, botRunState{}, baseline.Add(29*time.Minute), baseline) {
		t.Fatalf("interval should not trigger before 30m from baseline")
	}
	if !shouldTriggerBot(interval, botRunState{}, baseline.Add(30*time.Minute), baseline) {
		t.Fatalf("interval should trigger at 30m from baseline")
	}
	last := baseline.Add(30 * time.Minute)
	if shouldTriggerBot(interval, botRunState{lastTriggered: last}, last.Add(15*time.Minute), baseline) {
		t.Fatalf("interval should wait 30m from lastTriggered")
	}
	if !shouldTriggerBot(interval, botRunState{lastTriggered: last}, last.Add(30*time.Minute), baseline) {
		t.Fatalf("interval should trigger again 30m after lastTriggered")
	}

	// Standard 5-field Unix cron: weekdays at 09:30 (2026-05-01 is Friday, 2026-05-02 is Saturday)
	cronWeekdays, err := parseBotSchedule("30 9 * * 1-5")
	if err != nil {
		t.Fatal(err)
	}
	fri0930 := time.Date(2026, 5, 1, 9, 30, 10, 0, loc)
	sat0930 := time.Date(2026, 5, 2, 9, 30, 10, 0, loc)
	if !shouldTriggerBot(cronWeekdays, botRunState{}, fri0930, baseline) {
		t.Fatalf("cron weekday 09:30 should trigger on Friday 09:30")
	}
	if shouldTriggerBot(cronWeekdays, botRunState{lastCronMinute: "2026-05-01 09:30"}, fri0930.Add(20*time.Second), baseline) {
		t.Fatalf("cron should not trigger twice in same minute")
	}
	if shouldTriggerBot(cronWeekdays, botRunState{}, sat0930, baseline) {
		t.Fatalf("cron weekday 09:30 should not trigger on Saturday")
	}
	// Sunday normalized from 7 -> 0 (2026-05-03 is Sunday)
	cronSunday, err := parseBotSchedule("0 10 * * 7")
	if err != nil {
		t.Fatal(err)
	}
	if !shouldTriggerBot(cronSunday, botRunState{}, time.Date(2026, 5, 3, 10, 0, 0, 0, loc), baseline) {
		t.Fatalf("cron dow=7 should match Sunday")
	}
}

func TestBotFilesSingleSourceOfTruth(t *testing.T) {
	dir := t.TempDir()
	h := &Host{
		opts:     Options{DataDir: dir, Push: func(Push) {}},
		settings: loadSettings(dir),
		lives:    map[string]*live{},
	}
	api := NewAPI(h)

	// Path traversal rejected
	for _, bad := range []string{"", ".", "..", "../escape", "a/b", `a\b`} {
		if _, err := api.GetBotFiles(bad); err == nil {
			t.Fatalf("GetBotFiles(%q) should fail", bad)
		}
	}

	// Default files created on first read
	files, err := api.GetBotFiles("bot-demo")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(files.Soul, "常驻 Bot") || !strings.Contains(files.Memory, "长期记忆") {
		t.Fatalf("unexpected default bot files: %+v", files)
	}
	if _, err := os.Stat(files.SoulPath); err != nil {
		t.Fatalf("SOUL.md not written: %v", err)
	}
	if _, err := os.Stat(files.MemoryPath); err != nil {
		t.Fatalf("MEMORY.md not written: %v", err)
	}

	// Save and reload
	saved, err := api.SaveBotFiles("bot-demo", "# Custom Soul", "# Fact 1")
	if err != nil {
		t.Fatal(err)
	}
	if saved.Soul != "# Custom Soul" || saved.Memory != "# Fact 1" {
		t.Fatalf("saved mismatch: %+v", saved)
	}
	reloaded, err := api.GetBotFiles("bot-demo")
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Soul != "# Custom Soul" || reloaded.Memory != "# Fact 1" {
		t.Fatalf("reloaded mismatch: %+v", reloaded)
	}
}

func TestBuildAndStripBotWakePrompt(t *testing.T) {
	bot := Bot{ID: "bot-1", Name: "巡检助手"}
	files := BotFiles{
		BotID:      "bot-1",
		Dir:        "/home/user/.config/open-chat/bots/bot-1",
		Soul:       "只读检查，不随意改代码。",
		Memory:     "- 关注仓库：~/dev/demo（主分支 main）",
		MemoryPath: "/home/user/.config/open-chat/bots/bot-1/MEMORY.md",
	}
	wake := time.Date(2026, 5, 1, 9, 0, 0, 0, time.Local)
	full := buildBotWakePrompt(bot, files, "检查今天的 TODO", wake)

	for _, want := range []string{
		"<bot-context>",
		"</bot-context>",
		"只读检查，不随意改代码。",
		"- 关注仓库：~/dev/demo（主分支 main）",
		files.Dir,
		files.MemoryPath,
		"检查今天的 TODO",
	} {
		if !strings.Contains(full, want) {
			t.Fatalf("prompt missing %q:\n%s", want, full)
		}
	}
	if got := stripBotContext(full); got != "检查今天的 TODO" {
		t.Fatalf("stripBotContext = %q, want %q", got, "检查今天的 TODO")
	}
}

func TestEffectiveAutoAllowAndSettingsBots(t *testing.T) {
	dir := t.TempDir()
	h := &Host{
		opts:     Options{DataDir: dir, Push: func(Push) {}},
		settings: loadSettings(dir),
		lives:    map[string]*live{},
	}
	api := NewAPI(h)

	allowTrue := true
	allowFalse := false
	s := h.getSettings()
	s.AutoAllow = false
	s.Bots = []Bot{
		{Name: "Inherit", AgentID: "codex", Schedule: "daily 09:00", Enabled: true},
		{ID: "bot-allow", Name: "Auto", AgentID: "codex", AutoAllow: &allowTrue},
		{ID: "bot-deny", Name: "Strict", AgentID: "codex", AutoAllow: &allowFalse},
	}
	saved, err := api.SaveSettings(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Bots) != 3 || !strings.HasPrefix(saved.Bots[0].ID, "bot-") {
		t.Fatalf("unexpected saved bots: %+v", saved.Bots)
	}

	if h.effectiveAutoAllow(Meta{BotID: saved.Bots[0].ID}) != false {
		t.Fatalf("inherit bot should follow global false")
	}
	if h.effectiveAutoAllow(Meta{BotID: "bot-allow"}) != true {
		t.Fatalf("bot-allow should override global false -> true")
	}

	saved.AutoAllow = true
	if _, err := api.SaveSettings(saved); err != nil {
		t.Fatal(err)
	}
	if h.effectiveAutoAllow(Meta{BotID: saved.Bots[0].ID}) != true {
		t.Fatalf("inherit bot should follow global true")
	}
	if h.effectiveAutoAllow(Meta{BotID: "bot-deny"}) != false {
		t.Fatalf("bot-deny should override global true -> false")
	}

	// Invalid schedule rejected
	saved.Bots[0].Schedule = "every 5s"
	if _, err := api.SaveSettings(saved); err == nil {
		t.Fatalf("expected invalid schedule error")
	}
}

func TestBotOwnWorkspaceDoesNotMutateUserDefaultsAndReentrancy(t *testing.T) {
	dataDir := t.TempDir()
	st, err := openStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	s := loadSettings(dataDir)
	s.DefaultAgent = "claude-code"
	s.RecentDirs = []string{"/existing/project"}
	h := &Host{
		store:     st,
		opts:      Options{DataDir: dataDir, CacheDir: dataDir, Push: func(Push) {}},
		settings:  s,
		envLoaded: true,
		env:       os.Environ(),
		presets:   []preset{{ID: "codex", Name: "Codex", Command: "codex", Probe: "codex"}},
		lives:     map[string]*live{},
	}

	files, err := h.ensureBotFiles("bot-1")
	if err != nil {
		t.Fatal(err)
	}
	m, err := h.createOpts("codex", files.Dir, false, func(mm *Meta) {
		mm.BotID = "bot-1"
		mm.BotName = "巡检"
		mm.Title = "[巡检] 05-01 09:00"
		mm.TitleLocked = true
	})
	if err != nil {
		t.Fatalf("createOpts: %v", err)
	}

	if h.settings.DefaultAgent != "claude-code" {
		t.Fatalf("DefaultAgent mutated to %q", h.settings.DefaultAgent)
	}
	if len(h.settings.RecentDirs) != 1 || h.settings.RecentDirs[0] != "/existing/project" {
		t.Fatalf("RecentDirs mutated to %v", h.settings.RecentDirs)
	}
	wantDir := filepath.Join(dataDir, "bots", "bot-1")
	if m.Cwd != wantDir || m.Worktree || m.BotID != "bot-1" || !m.TitleLocked {
		t.Fatalf("unexpected bot meta: %+v (want Cwd=%q)", m, wantDir)
	}

	// Re-entrancy guard blocks double claim while starting or connecting/running
	if !h.tryClaimBotRun("bot-1") {
		t.Fatalf("first claim should succeed")
	}
	if h.tryClaimBotRun("bot-1") {
		t.Fatalf("second claim while starting should be rejected")
	}
	h.setBotRunConversation("bot-1", m.ID, time.Now())
	h.liveMu.Lock()
	h.lives[m.ID] = &live{state: LiveState{Status: "connecting"}}
	h.liveMu.Unlock()
	if h.tryClaimBotRun("bot-1") {
		t.Fatalf("claim while connecting should be rejected")
	}
	h.releaseBotRun(m.ID)
	h.liveMu.Lock()
	delete(h.lives, m.ID)
	h.liveMu.Unlock()
	if !h.tryClaimBotRun("bot-1") {
		t.Fatalf("claim after release should succeed")
	}
	h.clearBotStarting("bot-1")
}

func TestInjectBotContextOnlyOnFirstTurn(t *testing.T) {
	dataDir := t.TempDir()
	st, err := openStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	s := loadSettings(dataDir)
	s.Bots = []Bot{{ID: "bot-chat", Name: "助手", AgentID: "codex"}}
	h := &Host{
		store:    st,
		opts:     Options{DataDir: dataDir, CacheDir: dataDir, Push: func(Push) {}},
		settings: s,
		lives:    map[string]*live{},
	}
	if _, err := h.saveBotFiles("bot-chat", "只读分析", "- 记住：仓库在 ~/dev/app"); err != nil {
		t.Fatal(err)
	}
	m := Meta{ID: "c-bot", BotID: "bot-chat", BotName: "助手", AgentID: "codex", AgentName: "Codex"}
	st.create(m)

	first := h.injectBotContextIfNeeded(m, []Block{{"type": "text", "text": "你好，记住我的项目"}})
	got1, _ := first[0]["text"].(string)
	if !strings.Contains(got1, "<bot-context>") || !strings.Contains(got1, "只读分析") || !strings.Contains(got1, "你好，记住我的项目") {
		t.Fatalf("first turn not injected: %q", got1)
	}
	// Already prefixed is not double-injected
	again := h.injectBotContextIfNeeded(m, first)
	if again[0]["text"] != got1 {
		t.Fatalf("already-injected block should not be wrapped twice")
	}
	// Once a user_message exists in transcript, subsequent turns stay untouched
	st.append(m.ID, Event{"type": "user_message", "blocks": first})
	second := h.injectBotContextIfNeeded(m, []Block{{"type": "text", "text": "第二句"}})
	if second[0]["text"] != "第二句" {
		t.Fatalf("second turn should not re-inject context, got %q", second[0]["text"])
	}
}

func TestOpenBotChatReusesEmptyConversation(t *testing.T) {
	dataDir := t.TempDir()
	st, err := openStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	s := loadSettings(dataDir)
	s.Bots = []Bot{{ID: "bot-reuse", Name: "巡检", AgentID: "codex"}}
	h := &Host{
		store:     st,
		opts:      Options{DataDir: dataDir, CacheDir: dataDir, Push: func(Push) {}},
		settings:  s,
		envLoaded: true,
		env:       os.Environ(),
		presets:   []preset{{ID: "codex", Name: "Codex", Command: "codex", Probe: "codex"}},
		lives:     map[string]*live{},
	}

	// Mark live as ready so background connect doesn't try to spawn a real CLI in unit test
	m1, err := h.openBotChat("bot-reuse")
	if err != nil {
		t.Fatal(err)
	}
	if m1.Title != "新对话" || m1.TitleLocked {
		t.Fatalf("expected normal auto-titleable bot conversation, got title=%q locked=%v", m1.Title, m1.TitleLocked)
	}
	h.liveMu.Lock()
	h.lives[m1.ID] = &live{state: LiveState{Status: "ready"}}
	h.liveMu.Unlock()

	// Clicking the bot again while the conversation is still empty must reuse m1
	m2, err := h.openBotChat("bot-reuse")
	if err != nil {
		t.Fatal(err)
	}
	if m2.ID != m1.ID {
		t.Fatalf("expected empty bot chat to be reused (%s), got new id %s", m1.ID, m2.ID)
	}
	if got := len(st.list()); got != 1 {
		t.Fatalf("expected 1 conversation in store, got %d", got)
	}

	// Once a message has been sent, clicking the bot opens a fresh conversation
	st.append(m1.ID, Event{"type": "user_message", "blocks": []Block{{"type": "text", "text": "hi"}}})
	m3, err := h.openBotChat("bot-reuse")
	if err != nil {
		t.Fatal(err)
	}
	if m3.ID == m1.ID {
		t.Fatalf("expected new bot chat after previous chat has messages")
	}
	h.liveMu.Lock()
	delete(h.lives, m1.ID)
	delete(h.lives, m3.ID)
	h.liveMu.Unlock()
}
