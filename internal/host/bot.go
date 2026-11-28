package host

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	botStartingSentinel = "__starting__"
	botContextOpenTag   = "<bot-context>"
	botContextCloseTag  = "</bot-context>"
)

var errBotAlreadyRunning = errors.New("该 Bot 正在执行中，请等待当前任务完成")

type botScheduleKind int

const (
	botScheduleNone botScheduleKind = iota
	botScheduleDaily
	botScheduleInterval
	botScheduleCron
)

type botSchedule struct {
	kind     botScheduleKind
	hour     int
	minute   int
	interval time.Duration
	// Standard 5-field Unix cron bitmasks: minute(0-59), hour(0-23), dom(1-31), month(1-12), dow(0-6).
	cronMin   uint64
	cronHour  uint64
	cronDOM   uint64
	cronMonth uint64
	cronDOW   uint64
}

type botRunState struct {
	lastTriggered  time.Time
	lastDailyDate  string
	lastCronMinute string
}

func defaultSoulContent(name string) string {
	title := strings.TrimSpace(name)
	if title == "" {
		title = "常驻 Bot"
	}
	return fmt.Sprintf(`# %s

你是一个拥有独立身份与长期记忆的常驻 Bot，每次唤醒都是全新的独立会话。

## 职责
- 按任务要求和长期记忆（MEMORY.md）推进、巡检或总结工作。
- 用户在对话中告知你关注的项目路径、偏好或背景事实时，及时沉淀到 MEMORY.md，方便后续唤醒直接续接。

## 边界与审批
- 遇到高风险操作、破坏性变更或需要人工决策的事项时，先汇报现状与方案，等待用户确认后再继续。
`, title)
}

const defaultMemoryContent = `# 长期记忆

<!-- 记录需要跨会话保留的事实：关注的项目目录、工作约定、已排查结论与待跟进事项 -->
`

func validateBotID(botID string) (string, error) {
	id := strings.TrimSpace(botID)
	if id == "" || id == "." || id == ".." {
		return "", errors.New("无效的 Bot ID")
	}
	if strings.ContainsAny(id, "/\\\x00") || filepath.Base(id) != id {
		return "", fmt.Errorf("无效的 Bot ID：%s", botID)
	}
	return id, nil
}

func (h *Host) botByID(botID string) (Bot, bool) {
	for _, b := range h.getSettings().Bots {
		if b.ID == botID {
			return b, true
		}
	}
	return Bot{}, false
}

func (h *Host) botDir(botID string) (string, error) {
	id, err := validateBotID(botID)
	if err != nil {
		return "", err
	}
	base := h.opts.DataDir
	if base == "" {
		return "", errors.New("未配置数据目录")
	}
	return filepath.Join(base, "bots", id), nil
}

func (h *Host) ensureBotFiles(botID string) (BotFiles, error) {
	id, err := validateBotID(botID)
	if err != nil {
		return BotFiles{}, err
	}
	dir, err := h.botDir(id)
	if err != nil {
		return BotFiles{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return BotFiles{}, fmt.Errorf("创建 Bot 目录失败：%w", err)
	}
	soulPath := filepath.Join(dir, "SOUL.md")
	memoryPath := filepath.Join(dir, "MEMORY.md")

	name := ""
	if b, ok := h.botByID(id); ok {
		name = b.Name
	}

	soulBytes, err := os.ReadFile(soulPath)
	if errors.Is(err, os.ErrNotExist) {
		soulBytes = []byte(defaultSoulContent(name))
		if werr := writeAtomic(soulPath, soulBytes); werr != nil {
			return BotFiles{}, fmt.Errorf("初始化 SOUL.md 失败：%w", werr)
		}
	} else if err != nil {
		return BotFiles{}, fmt.Errorf("读取 SOUL.md 失败：%w", err)
	}

	memBytes, err := os.ReadFile(memoryPath)
	if errors.Is(err, os.ErrNotExist) {
		memBytes = []byte(defaultMemoryContent)
		if werr := writeAtomic(memoryPath, memBytes); werr != nil {
			return BotFiles{}, fmt.Errorf("初始化 MEMORY.md 失败：%w", werr)
		}
	} else if err != nil {
		return BotFiles{}, fmt.Errorf("读取 MEMORY.md 失败：%w", err)
	}

	return BotFiles{
		BotID:      id,
		Dir:        dir,
		Soul:       string(soulBytes),
		Memory:     string(memBytes),
		SoulPath:   soulPath,
		MemoryPath: memoryPath,
	}, nil
}

func (h *Host) saveBotFiles(botID, soul, memory string) (BotFiles, error) {
	id, err := validateBotID(botID)
	if err != nil {
		return BotFiles{}, err
	}
	dir, err := h.botDir(id)
	if err != nil {
		return BotFiles{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return BotFiles{}, fmt.Errorf("创建 Bot 目录失败：%w", err)
	}
	soulPath := filepath.Join(dir, "SOUL.md")
	memoryPath := filepath.Join(dir, "MEMORY.md")
	if err := writeAtomic(soulPath, []byte(soul)); err != nil {
		return BotFiles{}, fmt.Errorf("保存 SOUL.md 失败：%w", err)
	}
	if err := writeAtomic(memoryPath, []byte(memory)); err != nil {
		return BotFiles{}, fmt.Errorf("保存 MEMORY.md 失败：%w", err)
	}
	return BotFiles{
		BotID:      id,
		Dir:        dir,
		Soul:       soul,
		Memory:     memory,
		SoulPath:   soulPath,
		MemoryPath: memoryPath,
	}, nil
}

func parseCronField(expr string, minVal, maxVal int, allowSunday7 bool) (uint64, error) {
	if expr == "" {
		return 0, errors.New("字段为空")
	}
	var mask uint64
	for _, part := range strings.Split(expr, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return 0, fmt.Errorf("无效列表项 %q", expr)
		}
		step := 1
		rangeExpr := part
		if strings.Contains(part, "/") {
			pieces := strings.Split(part, "/")
			if len(pieces) != 2 {
				return 0, fmt.Errorf("无效步长 %q", part)
			}
			s, err := strconv.Atoi(pieces[1])
			if err != nil || s <= 0 {
				return 0, fmt.Errorf("无效步长值 %q", part)
			}
			step = s
			rangeExpr = pieces[0]
		}
		var lo, hi int
		if rangeExpr == "*" {
			lo, hi = minVal, maxVal
			if allowSunday7 && hi == 7 {
				hi = 6
			}
		} else if strings.Contains(rangeExpr, "-") {
			bounds := strings.Split(rangeExpr, "-")
			if len(bounds) != 2 {
				return 0, fmt.Errorf("无效范围 %q", part)
			}
			a, err1 := strconv.Atoi(bounds[0])
			b, err2 := strconv.Atoi(bounds[1])
			if err1 != nil || err2 != nil || a < minVal || b > maxVal || a > b {
				return 0, fmt.Errorf("范围越界 %q（允许 %d-%d）", part, minVal, maxVal)
			}
			lo, hi = a, b
		} else {
			v, err := strconv.Atoi(rangeExpr)
			if err != nil || v < minVal || v > maxVal {
				return 0, fmt.Errorf("数值越界 %q（允许 %d-%d）", part, minVal, maxVal)
			}
			if strings.Contains(part, "/") {
				lo, hi = v, maxVal
				if allowSunday7 && hi == 7 {
					hi = 6
				}
			} else {
				lo, hi = v, v
			}
		}
		for v := lo; v <= hi; v += step {
			bit := v
			if allowSunday7 && bit == 7 {
				bit = 0
			}
			mask |= 1 << uint(bit)
		}
	}
	if mask == 0 {
		return 0, fmt.Errorf("字段未匹配任何值 %q", expr)
	}
	return mask, nil
}

func parseBotSchedule(spec string) (botSchedule, error) {
	s := strings.TrimSpace(spec)
	if s == "" {
		return botSchedule{kind: botScheduleNone}, nil
	}
	fields := strings.Fields(s)
	if len(fields) == 5 {
		minMask, err := parseCronField(fields[0], 0, 59, false)
		if err != nil {
			return botSchedule{}, fmt.Errorf("Cron 分钟字段错误：%w", err)
		}
		hourMask, err := parseCronField(fields[1], 0, 23, false)
		if err != nil {
			return botSchedule{}, fmt.Errorf("Cron 小时字段错误：%w", err)
		}
		domMask, err := parseCronField(fields[2], 1, 31, false)
		if err != nil {
			return botSchedule{}, fmt.Errorf("Cron 日期字段错误：%w", err)
		}
		monMask, err := parseCronField(fields[3], 1, 12, false)
		if err != nil {
			return botSchedule{}, fmt.Errorf("Cron 月份字段错误：%w", err)
		}
		dowMask, err := parseCronField(fields[4], 0, 7, true)
		if err != nil {
			return botSchedule{}, fmt.Errorf("Cron 星期字段错误：%w", err)
		}
		return botSchedule{
			kind:      botScheduleCron,
			cronMin:   minMask,
			cronHour:  hourMask,
			cronDOM:   domMask,
			cronMonth: monMask,
			cronDOW:   dowMask,
		}, nil
	}
	if len(fields) != 2 {
		return botSchedule{}, fmt.Errorf("无效的调度表达式 %q（支持 5 位 Cron 如 0 9 * * *，或 daily HH:MM / every 30m）", spec)
	}
	kind := strings.ToLower(fields[0])
	arg := fields[1]
	switch kind {
	case "daily":
		parts := strings.Split(arg, ":")
		if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 {
			return botSchedule{}, fmt.Errorf("无效的每日时间 %q（格式应为 daily HH:MM，如 daily 09:00）", spec)
		}
		hh, err1 := strconv.Atoi(parts[0])
		mm, err2 := strconv.Atoi(parts[1])
		if err1 != nil || err2 != nil || hh < 0 || hh > 23 || mm < 0 || mm > 59 {
			return botSchedule{}, fmt.Errorf("无效的每日时间 %q（小时 00-23，分钟 00-59）", spec)
		}
		return botSchedule{kind: botScheduleDaily, hour: hh, minute: mm}, nil
	case "every":
		d, err := time.ParseDuration(arg)
		if err != nil || d < time.Minute {
			return botSchedule{}, fmt.Errorf("无效的周期间隔 %q（至少 1m，如 every 30m、every 2h）", spec)
		}
		return botSchedule{kind: botScheduleInterval, interval: d}, nil
	default:
		return botSchedule{}, fmt.Errorf("无效的调度表达式 %q（支持 5 位 Cron 如 0 9 * * *，或 daily HH:MM / every 30m）", spec)
	}
}

func shouldTriggerBot(sched botSchedule, state botRunState, now, baseline time.Time) bool {
	switch sched.kind {
	case botScheduleDaily:
		today := now.Format("2006-01-02")
		if state.lastDailyDate == today {
			return false
		}
		return now.Hour() == sched.hour && now.Minute() == sched.minute
	case botScheduleInterval:
		ref := state.lastTriggered
		if ref.IsZero() {
			ref = baseline
		}
		if ref.IsZero() {
			return false
		}
		return now.Sub(ref) >= sched.interval
	case botScheduleCron:
		minuteKey := now.Format("2006-01-02 15:04")
		if state.lastCronMinute == minuteKey {
			return false
		}
		return (sched.cronMin&(1<<uint(now.Minute()))) != 0 &&
			(sched.cronHour&(1<<uint(now.Hour()))) != 0 &&
			(sched.cronDOM&(1<<uint(now.Day()))) != 0 &&
			(sched.cronMonth&(1<<uint(now.Month()))) != 0 &&
			(sched.cronDOW&(1<<uint(now.Weekday()))) != 0
	default:
		return false
	}
}

func normalizeBots(bots []Bot) ([]Bot, error) {
	if bots == nil {
		return []Bot{}, nil
	}
	seen := map[string]bool{}
	out := make([]Bot, 0, len(bots))
	for _, b := range bots {
		b.ID = strings.TrimSpace(b.ID)
		if b.ID == "" {
			b.ID = "bot-" + newID()
		}
		if _, err := validateBotID(b.ID); err != nil {
			return nil, err
		}
		if seen[b.ID] {
			return nil, fmt.Errorf("存在重复的 Bot ID：%s", b.ID)
		}
		seen[b.ID] = true
		b.Name = strings.TrimSpace(b.Name)
		if b.Name == "" {
			return nil, errors.New("Bot 名称不能为空")
		}
		b.Avatar = strings.TrimSpace(b.Avatar)
		b.AgentID = strings.TrimSpace(b.AgentID)
		if b.AgentID == "" {
			return nil, fmt.Errorf("Bot「%s」需要选择绑定的 Agent", b.Name)
		}
		b.ModelConfigID = strings.TrimSpace(b.ModelConfigID)
		b.ModelValue = strings.TrimSpace(b.ModelValue)
		b.Schedule = strings.TrimSpace(b.Schedule)
		if _, err := parseBotSchedule(b.Schedule); err != nil {
			return nil, fmt.Errorf("Bot「%s」调度配置有误：%w", b.Name, err)
		}
		b.Prompt = strings.TrimSpace(b.Prompt)
		out = append(out, b)
	}
	return out, nil
}

func (h *Host) effectiveAutoAllow(m Meta) bool {
	if m.BotID != "" {
		if bot, ok := h.botByID(m.BotID); ok && bot.AutoAllow != nil {
			return *bot.AutoAllow
		}
	}
	return h.getSettings().AutoAllow
}

func buildBotWakePrompt(bot Bot, files BotFiles, task string, wakeTime time.Time) string {
	var b strings.Builder
	b.WriteString(botContextOpenTag)
	b.WriteString("\n")
	b.WriteString(fmt.Sprintf("Bot: %s (%s)\n", bot.Name, bot.ID))
	b.WriteString(fmt.Sprintf("唤醒时间: %s\n", wakeTime.Format("2006-01-02 15:04:05")))
	if files.Dir != "" {
		b.WriteString(fmt.Sprintf("Bot 工作目录: %s\n", files.Dir))
	}
	b.WriteString("\n## 身份与守则 (SOUL.md)\n")
	if soul := strings.TrimSpace(files.Soul); soul != "" {
		b.WriteString(soul)
		b.WriteString("\n")
	} else {
		b.WriteString("（未配置）\n")
	}
	b.WriteString("\n## 长期记忆 (MEMORY.md)\n")
	if mem := strings.TrimSpace(files.Memory); mem != "" {
		b.WriteString(mem)
		b.WriteString("\n")
	} else {
		b.WriteString("（暂无记录）\n")
	}
	b.WriteString("\n## 记忆写回说明\n")
	b.WriteString(fmt.Sprintf("- 你的长期记忆文件就在当前工作目录下的 `./MEMORY.md`（绝对路径：`%s`）。\n", files.MemoryPath))
	b.WriteString("- 只要用户在对话中告诉你新的项目路径、偏好、规则、待跟进事项，或明确要求「记住某件事」，请直接使用你的文件编辑/写入工具更新 `./MEMORY.md`（保留原有有效内容并做增量整理），并在回复中简短告知已写入记忆。\n")
	b.WriteString("- 不要修改 `./SOUL.md`，除非用户明确要求你修改自己的角色设定。\n")
	b.WriteString(botContextCloseTag)
	b.WriteString("\n\n")
	t := strings.TrimSpace(task)
	if t == "" {
		t = "请结合你的职责与当前长期记忆开展工作，汇报进展与需要关注的问题。"
	}
	b.WriteString(t)
	return b.String()
}

// stripBotContext extracts the user-facing task text from a bot wake prompt so
// conversation previews stay clean and readable.
func stripBotContext(text string) string {
	trimmed := strings.TrimSpace(text)
	if !strings.HasPrefix(trimmed, botContextOpenTag) {
		return text
	}
	if idx := strings.Index(trimmed, botContextCloseTag); idx >= 0 {
		rest := strings.TrimSpace(trimmed[idx+len(botContextCloseTag):])
		if rest != "" {
			return rest
		}
	}
	return text
}

func (h *Host) ensureBotMapsLocked() {
	if h.botRunning == nil {
		h.botRunning = map[string]string{}
	}
	if h.botRuns == nil {
		h.botRuns = map[string]botRunState{}
	}
}

func (h *Host) tryClaimBotRun(botID string) bool {
	h.botMu.Lock()
	h.ensureBotMapsLocked()
	prev := h.botRunning[botID]
	if prev == botStartingSentinel {
		h.botMu.Unlock()
		return false
	}
	if prev != "" {
		h.botMu.Unlock()
		st := h.liveState(prev).Status
		if st == "running" || st == "connecting" {
			return false
		}
		h.botMu.Lock()
		h.ensureBotMapsLocked()
		if h.botRunning[botID] == botStartingSentinel {
			h.botMu.Unlock()
			return false
		}
		if cur := h.botRunning[botID]; cur != "" && cur != prev {
			h.botMu.Unlock()
			return false
		}
	}
	h.botRunning[botID] = botStartingSentinel
	h.botMu.Unlock()
	return true
}

func (h *Host) setBotRunConversation(botID, convID string, wakeTime time.Time) {
	h.botMu.Lock()
	h.ensureBotMapsLocked()
	h.botRunning[botID] = convID
	h.botRuns[botID] = botRunState{
		lastTriggered:  wakeTime,
		lastDailyDate:  wakeTime.Format("2006-01-02"),
		lastCronMinute: wakeTime.Format("2006-01-02 15:04"),
	}
	h.botMu.Unlock()
}

func (h *Host) clearBotStarting(botID string) {
	h.botMu.Lock()
	if h.botRunning != nil && h.botRunning[botID] == botStartingSentinel {
		delete(h.botRunning, botID)
	}
	h.botMu.Unlock()
}

func (h *Host) releaseBotRun(convID string) {
	if convID == "" {
		return
	}
	h.botMu.Lock()
	for botID, cid := range h.botRunning {
		if cid == convID {
			delete(h.botRunning, botID)
		}
	}
	h.botMu.Unlock()
}

// injectBotContextIfNeeded prepends SOUL.md + MEMORY.md to the first user turn
// of an interactive Bot conversation so the user can open a fresh Bot chat and
// type naturally while still waking the agent with the Bot's full identity.
func (h *Host) injectBotContextIfNeeded(m Meta, blocks []Block) []Block {
	if m.BotID == "" || len(blocks) == 0 {
		return blocks
	}
	for _, ev := range h.store.transcript(m.ID) {
		if t, _ := ev["type"].(string); t == "user_message" {
			return blocks
		}
	}
	for _, b := range blocks {
		if b["type"] == "text" {
			if s, _ := b["text"].(string); strings.HasPrefix(strings.TrimSpace(s), botContextOpenTag) {
				return blocks
			}
		}
	}
	bot, ok := h.botByID(m.BotID)
	if !ok {
		return blocks
	}
	files, err := h.ensureBotFiles(bot.ID)
	if err != nil {
		return blocks
	}
	wakeTime := time.Now()
	out := make([]Block, len(blocks))
	injected := false
	for i, b := range blocks {
		cp := make(Block, len(b))
		for k, v := range b {
			cp[k] = v
		}
		if !injected && cp["type"] == "text" {
			s, _ := cp["text"].(string)
			cp["text"] = buildBotWakePrompt(bot, files, s, wakeTime)
			injected = true
		}
		out[i] = cp
	}
	if !injected {
		header := Block{"type": "text", "text": buildBotWakePrompt(bot, files, "", wakeTime)}
		out = append([]Block{header}, out...)
	}
	return out
}

// openBotChat opens an interactive conversation in the Bot's own workspace ready
// for the user to type directly (SOUL.md + MEMORY.md are injected on the first
// send). If the bot already has an unused empty conversation, reuse it so
// repeated clicks on the bot do not pile up blank sessions in the sidebar.
func (h *Host) openBotChat(botID string) (Meta, error) {
	bot, ok := h.botByID(botID)
	if !ok {
		return Meta{}, fmt.Errorf("未找到 Bot：%s", botID)
	}
	if _, ok := h.agent(bot.AgentID); !ok {
		return Meta{}, fmt.Errorf("Bot「%s」绑定的 Agent 不存在：%s", bot.Name, bot.AgentID)
	}
	files, err := h.ensureBotFiles(bot.ID)
	if err != nil {
		return Meta{}, err
	}
	for _, existing := range h.store.list() {
		if existing.BotID != bot.ID || existing.Archived || existing.AgentID != bot.AgentID {
			continue
		}
		if existing.Preview != "" || len(h.store.transcript(existing.ID)) > 0 {
			continue
		}
		updated, ok := h.store.update(existing.ID, func(mm *Meta) {
			mm.BotName = bot.Name
			mm.ModelConfigID = bot.ModelConfigID
			mm.ModelValue = bot.ModelValue
		})
		if ok {
			existing = updated
		}
		h.pushMeta(existing)
		if st := h.liveState(existing.ID).Status; st == "idle" || st == "error" {
			go func(id string) { _, _ = h.connect(context.Background(), id) }(existing.ID)
		}
		return existing, nil
	}
	m, err := h.createOpts(bot.AgentID, files.Dir, false, func(mm *Meta) {
		mm.BotID = bot.ID
		mm.BotName = bot.Name
		if bot.ModelConfigID != "" && bot.ModelValue != "" {
			mm.ModelConfigID = bot.ModelConfigID
			mm.ModelValue = bot.ModelValue
		}
	})
	if err != nil {
		return Meta{}, err
	}
	go func() { _, _ = h.connect(context.Background(), m.ID) }()
	return m, nil
}

func (h *Host) startBot(_ context.Context, botID, promptOverride string) (Meta, error) {
	bot, ok := h.botByID(botID)
	if !ok {
		return Meta{}, fmt.Errorf("未找到 Bot：%s", botID)
	}
	if _, ok := h.agent(bot.AgentID); !ok {
		return Meta{}, fmt.Errorf("Bot「%s」绑定的 Agent 不存在：%s", bot.Name, bot.AgentID)
	}
	if !h.tryClaimBotRun(bot.ID) {
		return Meta{}, errBotAlreadyRunning
	}

	claimed := true
	defer func() {
		if claimed {
			h.clearBotStarting(bot.ID)
		}
	}()

	files, err := h.ensureBotFiles(bot.ID)
	if err != nil {
		return Meta{}, err
	}

	wakeTime := time.Now()
	mutate := func(m *Meta) {
		m.BotID = bot.ID
		m.BotName = bot.Name
		if bot.ModelConfigID != "" && bot.ModelValue != "" {
			m.ModelConfigID = bot.ModelConfigID
			m.ModelValue = bot.ModelValue
		}
	}

	m, err := h.createOpts(bot.AgentID, files.Dir, false, mutate)
	if err != nil {
		return Meta{}, err
	}

	h.setBotRunConversation(bot.ID, m.ID, wakeTime)
	claimed = false

	task := strings.TrimSpace(promptOverride)
	if task == "" {
		task = bot.Prompt
	}
	fullPrompt := buildBotWakePrompt(bot, files, task, wakeTime)
	blocks := []Block{{"type": "text", "text": fullPrompt}}

	go func(convID string, promptBlocks []Block) {
		if err := h.send(context.Background(), convID, promptBlocks); err != nil {
			logf("bot %s send failed: %v", bot.ID, err)
			h.releaseBotRun(convID)
			return
		}
		if st := h.liveState(convID).Status; st != "running" && st != "connecting" {
			h.releaseBotRun(convID)
		}
	}(m.ID, blocks)

	return m, nil
}

func (h *Host) onBotTurnFinished(convID string, _ Event) {
	h.releaseBotRun(convID)
}

func (h *Host) startBotScheduler() {
	h.botMu.Lock()
	if h.botStop != nil {
		h.botMu.Unlock()
		return
	}
	stop := make(chan struct{})
	done := make(chan struct{})
	h.botStop = stop
	h.botDone = done
	if h.botStarted.IsZero() {
		h.botStarted = time.Now()
	}
	h.botMu.Unlock()

	go func() {
		defer close(done)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case tickNow := <-ticker.C:
				h.botTick(tickNow)
			}
		}
	}()
}

func (h *Host) stopBotScheduler() {
	h.botMu.Lock()
	stop := h.botStop
	done := h.botDone
	h.botStop = nil
	h.botDone = nil
	h.botMu.Unlock()
	if stop != nil {
		close(stop)
	}
	if done != nil {
		<-done
	}
}

func (h *Host) botTick(tickNow time.Time) {
	bots := h.getSettings().Bots
	if len(bots) == 0 {
		return
	}
	h.botMu.Lock()
	baseline := h.botStarted
	runsCopy := make(map[string]botRunState, len(h.botRuns))
	for k, v := range h.botRuns {
		runsCopy[k] = v
	}
	h.botMu.Unlock()

	for _, bot := range bots {
		if !bot.Enabled || strings.TrimSpace(bot.Schedule) == "" {
			continue
		}
		sched, err := parseBotSchedule(bot.Schedule)
		if err != nil || sched.kind == botScheduleNone {
			continue
		}
		if !shouldTriggerBot(sched, runsCopy[bot.ID], tickNow, baseline) {
			continue
		}
		go func(b Bot) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			if _, err := h.startBot(ctx, b.ID, ""); err != nil && !errors.Is(err, errBotAlreadyRunning) {
				logf("scheduled bot %s (%s) failed: %v", b.Name, b.ID, err)
			}
		}(bot)
	}
}
