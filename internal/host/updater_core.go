package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// AgentUpdateChannel identifies how an agent binary was installed.
type AgentUpdateChannel string

const (
	auChannelMise    AgentUpdateChannel = "mise"
	auChannelNpm     AgentUpdateChannel = "npm"
	auChannelBun     AgentUpdateChannel = "bun"
	auChannelPnpm    AgentUpdateChannel = "pnpm"
	auChannelBrew    AgentUpdateChannel = "brew"
	auChannelNative  AgentUpdateChannel = "native"
	auChannelUnknown AgentUpdateChannel = "unknown"
)

// AgentUpdateStatus represents the inspection or upgrade outcome of one agent.
type AgentUpdateStatus string

const (
	auStatusUpToDate     AgentUpdateStatus = "up-to-date"
	auStatusAhead        AgentUpdateStatus = "ahead"
	auStatusOutdated     AgentUpdateStatus = "outdated"
	auStatusSkipped      AgentUpdateStatus = "skipped"
	auStatusUpdated      AgentUpdateStatus = "updated"
	auStatusFailed       AgentUpdateStatus = "failed"
	auStatusNotInstalled AgentUpdateStatus = "not-installed"
)

// AgentUpdateOptions controls inspection and upgrade behavior.
type AgentUpdateOptions struct {
	Only              []string `json:"only,omitempty"`
	Bump              *bool    `json:"bump,omitempty"`
	MinimumReleaseAge string   `json:"minimumReleaseAge,omitempty"`
}

func (o AgentUpdateOptions) bump() bool {
	if o.Bump == nil {
		return true
	}
	return *o.Bump
}

func (o AgentUpdateOptions) minReleaseAge() string {
	if o.MinimumReleaseAge == "" {
		return "0"
	}
	return o.MinimumReleaseAge
}

// AgentUpdateMiseInfo describes detected mise metadata.
type AgentUpdateMiseInfo struct {
	Bin     string `json:"bin"`
	Version string `json:"version"`
}

// AgentUpdateShadowed is an additional installation on PATH masked by the effective one.
type AgentUpdateShadowed struct {
	Channel AgentUpdateChannel `json:"channel"`
	Path    string             `json:"path"`
}

// AgentUpdateResult is the JSON-friendly inspection or upgrade result for one agent.
type AgentUpdateResult struct {
	ID              string                `json:"id"`
	Agent           string                `json:"agent"`
	Bin             string                `json:"bin"`
	Status          AgentUpdateStatus     `json:"status"`
	Channel         AgentUpdateChannel    `json:"channel,omitempty"`
	Identity        string                `json:"identity,omitempty"`
	Path            string                `json:"path,omitempty"`
	Current         string                `json:"current,omitempty"`
	Target          string                `json:"target,omitempty"`
	Command         []string              `json:"command,omitempty"`
	Note            string                `json:"note,omitempty"`
	Shadowed        []AgentUpdateShadowed `json:"shadowed,omitempty"`
	InstallChannels []AgentUpdateChannel  `json:"installChannels,omitempty"`
	CanUninstall    bool                  `json:"canUninstall,omitempty"`

	miseTool      string
	miseRequested string
	brewKind      string
}

// AgentUpdateSummary aggregates status counts across results.
type AgentUpdateSummary struct {
	Total        int `json:"total"`
	Updated      int `json:"updated"`
	UpToDate     int `json:"upToDate"`
	Outdated     int `json:"outdated"`
	Skipped      int `json:"skipped"`
	NotInstalled int `json:"notInstalled"`
	Failed       int `json:"failed"`
}

// AgentUpdateReport is returned by InspectAgentUpdates and UpgradeAgents.
type AgentUpdateReport struct {
	Mise              *AgentUpdateMiseInfo `json:"mise,omitempty"`
	AvailableChannels []AgentUpdateChannel `json:"availableChannels,omitempty"`
	Results           []AgentUpdateResult  `json:"results"`
	Summary           AgentUpdateSummary   `json:"summary"`
	Warnings          []string             `json:"warnings,omitempty"`
}

type auAgentSpec struct {
	ID           string
	Name         string
	Bin          string
	MiseTools    []string
	NpmPackage   string
	BrewCask     string
	NativeUpdate []string
	NativeDirs   []string
}

func auDefaultAgents() []auAgentSpec {
	home, _ := os.UserHomeDir()
	localBin := filepath.Join(home, ".local", "bin")
	return []auAgentSpec{
		{
			// mise 里既可能是 registry 短名（mise use -g claude），也可能是
			// npm backend 全名（mise use -g npm:@anthropic-ai/claude-code）。
			ID:           "claude-code",
			Name:         "Claude Code",
			Bin:          "claude",
			MiseTools:    []string{"claude", "npm:@anthropic-ai/claude-code"},
			NpmPackage:   "@anthropic-ai/claude-code",
			BrewCask:     "claude-code",
			NativeUpdate: []string{"claude", "install", "latest"},
			NativeDirs:   []string{localBin},
		},
		{
			ID:           "codex",
			Name:         "Codex",
			Bin:          "codex",
			MiseTools:    []string{"codex", "npm:@openai/codex"},
			NpmPackage:   "@openai/codex",
			NativeUpdate: []string{"codex", "update"},
			NativeDirs:   []string{localBin},
		},
		{
			ID:           "opencode",
			Name:         "OpenCode",
			Bin:          "opencode",
			MiseTools:    []string{"opencode", "npm:@opencode/cli"},
			NpmPackage:   "@opencode/cli",
			NativeUpdate: []string{"opencode", "upgrade"},
			NativeDirs:   []string{localBin, filepath.Join(home, ".opencode", "bin")},
		},
		{
			ID:           "pi",
			Name:         "Pi",
			Bin:          "pi",
			MiseTools:    []string{"pi", "npm:@earendil-works/pi-coding-agent"},
			NpmPackage:   "@earendil-works/pi-coding-agent",
			NativeUpdate: []string{"pi", "update", "self"},
			NativeDirs:   []string{localBin},
		},
		{
			ID:           "oh-my-pi",
			Name:         "Oh My Pi",
			Bin:          "omp",
			MiseTools:    []string{"github:can1357/oh-my-pi", "npm:@oh-my-pi/pi-coding-agent"},
			NpmPackage:   "@oh-my-pi/pi-coding-agent",
			NativeUpdate: []string{"omp", "update"},
			NativeDirs:   []string{localBin},
		},
		{
			ID:           "codebuddy",
			Name:         "CodeBuddy",
			Bin:          "codebuddy",
			MiseTools:    []string{"npm:@tencent-ai/codebuddy-code"},
			NpmPackage:   "@tencent-ai/codebuddy-code",
			NativeUpdate: []string{"codebuddy", "update"},
			NativeDirs:   []string{localBin},
		},
		{
			ID:         "dsh",
			Name:       "DeepSeek Harness",
			Bin:        "dsh",
			MiseTools:  []string{"npm:@deepseek-ai/dsh"},
			NpmPackage: "@deepseek-ai/dsh",
		},
	}
}

func auSearchKeys(a auAgentSpec) []string {
	keys := []string{a.ID, a.Name, a.Bin}
	for _, tool := range a.MiseTools {
		stripped := strings.TrimPrefix(strings.TrimPrefix(tool, "npm:"), "github:")
		keys = append(keys, tool, stripped)
		keys = append(keys, strings.Split(stripped, "/")...)
	}
	if a.NpmPackage != "" {
		keys = append(keys, a.NpmPackage)
		keys = append(keys, strings.Split(a.NpmPackage, "/")...)
	}
	return keys
}

func auMatchAgent(agents []auAgentSpec, query string) (auAgentSpec, bool) {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return auAgentSpec{}, false
	}
	for _, a := range agents {
		for _, k := range auSearchKeys(a) {
			if strings.ToLower(k) == q {
				return a, true
			}
		}
	}
	if len(q) < 3 {
		return auAgentSpec{}, false
	}
	for _, a := range agents {
		for _, k := range auSearchKeys(a) {
			if strings.Contains(strings.ToLower(k), q) {
				return a, true
			}
		}
	}
	return auAgentSpec{}, false
}

// ---------------------------------------------------------------- versions

var (
	auVersionPattern = regexp.MustCompile(`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`)
	auDigitsOnly     = regexp.MustCompile(`^\d+$`)
)

func auParseVersion(text string) string {
	return auVersionPattern.FindString(text)
}

type auParsedVersion struct {
	core       []int
	prerelease []string
}

func auSplitVersion(v string) auParsedVersion {
	if idx := strings.IndexByte(v, '+'); idx >= 0 {
		v = v[:idx]
	}
	coreText := v
	preText := ""
	if dash := strings.IndexByte(v, '-'); dash >= 0 {
		coreText = v[:dash]
		preText = v[dash+1:]
	}
	parts := strings.Split(coreText, ".")
	core := make([]int, len(parts))
	for i, p := range parts {
		n, _ := strconv.Atoi(p)
		core[i] = n
	}
	var pre []string
	if preText != "" {
		pre = strings.Split(preText, ".")
	}
	return auParsedVersion{core: core, prerelease: pre}
}

func auComparePrerelease(a, b []string) int {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	if len(a) == 0 {
		return 1
	}
	if len(b) == 0 {
		return -1
	}
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if i >= len(a) {
			return -1
		}
		if i >= len(b) {
			return 1
		}
		left, right := a[i], b[i]
		leftNum := auDigitsOnly.MatchString(left)
		rightNum := auDigitsOnly.MatchString(right)
		if leftNum && rightNum {
			ln, _ := strconv.Atoi(left)
			rn, _ := strconv.Atoi(right)
			if ln != rn {
				if ln < rn {
					return -1
				}
				return 1
			}
			continue
		}
		if leftNum != rightNum {
			if leftNum {
				return -1
			}
			return 1
		}
		if left != right {
			if left < right {
				return -1
			}
			return 1
		}
	}
	return 0
}

func auCompareVersions(a, b string) int {
	left := auSplitVersion(a)
	right := auSplitVersion(b)
	n := len(left.core)
	if len(right.core) > n {
		n = len(right.core)
	}
	for i := 0; i < n; i++ {
		lv, rv := 0, 0
		if i < len(left.core) {
			lv = left.core[i]
		}
		if i < len(right.core) {
			rv = right.core[i]
		}
		if lv != rv {
			if lv < rv {
				return -1
			}
			return 1
		}
	}
	return auComparePrerelease(left.prerelease, right.prerelease)
}

// ------------------------------------------------------------------ runner

type auRunResult struct {
	Code   int
	Stdout string
	Stderr string
}

func auRunCmd(ctx context.Context, env []string, cwd string, timeout time.Duration, argv []string) auRunResult {
	if len(argv) == 0 {
		return auRunResult{Code: 127, Stderr: "empty command"}
	}
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	name := argv[0]
	args := argv[1:]
	if !filepath.IsAbs(name) {
		if resolved := lookPath(env, name); resolved != "" {
			name = resolved
		}
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		ext := strings.ToLower(filepath.Ext(name))
		if ext == ".cmd" || ext == ".bat" {
			cmd = exec.CommandContext(runCtx, "cmd.exe", append([]string{"/c", name}, args...)...)
		}
	}
	if cmd == nil {
		cmd = exec.CommandContext(runCtx, name, args...)
	}
	cmd.Env = env
	if cwd != "" {
		cmd.Dir = cwd
	}
	hideWindow(cmd)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err == nil {
		return auRunResult{Code: 0, Stdout: stdout.String(), Stderr: stderr.String()}
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return auRunResult{Code: exitErr.ExitCode(), Stdout: stdout.String(), Stderr: stderr.String()}
	}
	msg := stderr.String()
	if msg == "" {
		msg = err.Error()
	}
	return auRunResult{Code: 127, Stdout: stdout.String(), Stderr: msg}
}

// ------------------------------------------------------------------ latest

const auNpmRegistry = "https://registry.npmjs.org"

func auRegistryTagURL(pkg, tag string) string {
	return auNpmRegistry + "/" + strings.Replace(pkg, "/", "%2F", 1) + "/" + tag
}

func auFetchVersion(ctx context.Context, client *http.Client, pkg, tag string) string {
	if pkg == "" {
		return ""
	}
	if tag == "" {
		tag = "latest"
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, auRegistryTagURL(pkg, tag), nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ""
	}
	var payload struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.Version)
}

type auBrewOutdatedEntry struct {
	Current string
	Latest  string
	Kind    string
}

type auBrewOutdatedItem struct {
	Name              string   `json:"name"`
	InstalledVersions []string `json:"installed_versions"`
	CurrentVersion    string   `json:"current_version"`
}

func auParseBrewOutdated(raw []byte) map[string]auBrewOutdatedEntry {
	out := map[string]auBrewOutdatedEntry{}
	var payload struct {
		Formulae []auBrewOutdatedItem `json:"formulae"`
		Casks    []auBrewOutdatedItem `json:"casks"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return out
	}
	add := func(items []auBrewOutdatedItem, kind string) {
		for _, item := range items {
			if item.Name == "" {
				continue
			}
			var cur string
			if len(item.InstalledVersions) > 0 {
				cur = item.InstalledVersions[len(item.InstalledVersions)-1]
			}
			out[item.Name] = auBrewOutdatedEntry{Current: cur, Latest: item.CurrentVersion, Kind: kind}
		}
	}
	add(payload.Formulae, "formula")
	add(payload.Casks, "cask")
	return out
}

// -------------------------------------------------------------------- plan

type auChannelInstall struct {
	Channel       AgentUpdateChannel
	Identity      string
	Current       string
	BrewKind      string
	MiseRequested string
}

type auCommandOptions struct {
	Bump              bool
	MinimumReleaseAge string
}

type auDecisionOptions struct {
	Command          []string
	MiseInactive     bool
	ChannelAvailable bool
}

type auDecision struct {
	Status  AgentUpdateStatus
	Current string
	Target  string
	Command []string
	Note    string
}

type auUpgradeEvaluation struct {
	Status AgentUpdateStatus
	Note   string
}

var (
	auExactSemverRe  = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
	auRangePrefixRe  = regexp.MustCompile(`^[~^<>=]`)
	auPartialRangeRe = regexp.MustCompile(`^\d+(\.\d+){0,2}(\.?[xX*])?$`)
	auNamedTagRe     = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9._-]*$`)
)

func auIsNamedMiseTag(requested string) bool {
	if requested == "" || requested == "latest" {
		return false
	}
	if auExactSemverRe.MatchString(requested) || auRangePrefixRe.MatchString(requested) || auPartialRangeRe.MatchString(requested) {
		return false
	}
	return auNamedTagRe.MatchString(requested)
}

func auBuildUpgradeCommand(agent auAgentSpec, install auChannelInstall, opts auCommandOptions) []string {
	switch install.Channel {
	case auChannelMise:
		if auIsNamedMiseTag(install.MiseRequested) {
			argv := []string{"mise", "install", install.Identity + "@" + install.MiseRequested, "--force"}
			if opts.MinimumReleaseAge != "" {
				argv = append(argv, "--minimum-release-age", opts.MinimumReleaseAge)
			}
			return argv
		}
		argv := []string{"mise", "upgrade", install.Identity}
		if opts.Bump {
			argv = append(argv, "--bump")
		}
		if opts.MinimumReleaseAge != "" {
			argv = append(argv, "--minimum-release-age", opts.MinimumReleaseAge)
		}
		return argv
	case auChannelNpm:
		pkg := agent.NpmPackage
		if pkg == "" {
			pkg = install.Identity
		}
		return []string{"npm", "install", "-g", pkg + "@latest"}
	case auChannelBun:
		pkg := agent.NpmPackage
		if pkg == "" {
			pkg = install.Identity
		}
		return []string{"bun", "add", "-g", pkg + "@latest"}
	case auChannelPnpm:
		pkg := agent.NpmPackage
		if pkg == "" {
			pkg = install.Identity
		}
		return []string{"pnpm", "add", "-g", pkg + "@latest"}
	case auChannelBrew:
		if install.BrewKind == "cask" {
			return []string{"brew", "upgrade", "--cask", install.Identity}
		}
		return []string{"brew", "upgrade", install.Identity}
	case auChannelNative:
		if len(agent.NativeUpdate) == 0 {
			return nil
		}
		cp := make([]string, len(agent.NativeUpdate))
		copy(cp, agent.NativeUpdate)
		return cp
	default:
		return nil
	}
}

func auDecideUpgrade(install auChannelInstall, latest string, opts auDecisionOptions) auDecision {
	base := auDecision{Current: install.Current, Target: latest}

	if install.Channel == auChannelUnknown {
		base.Status = auStatusSkipped
		base.Note = "无法识别安装渠道，不会猜测升级方式"
		return base
	}
	if opts.MiseInactive {
		base.Status = auStatusSkipped
		base.Note = fmt.Sprintf("已安装但未在 mise 配置中；接管：mise use -g %s@latest", install.Identity)
		return base
	}
	if !opts.ChannelAvailable {
		base.Status = auStatusSkipped
		base.Note = fmt.Sprintf("%s 工具不可用，无法自动升级", install.Channel)
		return base
	}
	if len(opts.Command) == 0 {
		base.Status = auStatusSkipped
		base.Note = "没有可用的自动升级命令"
		return base
	}
	if latest == "" {
		base.Status = auStatusSkipped
		base.Note = "无法确定最新版"
		return base
	}
	if install.Current == "" {
		base.Status = auStatusSkipped
		base.Note = "无法读取当前版本"
		return base
	}

	dir := auCompareVersions(latest, install.Current)
	if dir > 0 {
		base.Status = auStatusOutdated
		base.Command = opts.Command
		return base
	}
	if dir < 0 {
		base.Status = auStatusAhead
		base.Note = fmt.Sprintf("本地版本 %s 高于最新版 %s，不降级", install.Current, latest)
		return base
	}
	base.Status = auStatusUpToDate
	return base
}

func auEvaluateUpgradeResult(before, after, target string) auUpgradeEvaluation {
	if after == "" {
		return auUpgradeEvaluation{Status: auStatusFailed, Note: "升级后无法读取版本"}
	}
	if before == "" {
		return auUpgradeEvaluation{Status: auStatusFailed, Note: "升级前无法读取版本，无法确认结果"}
	}
	change := auCompareVersions(after, before)
	if change < 0 {
		return auUpgradeEvaluation{Status: auStatusFailed, Note: fmt.Sprintf("升级后版本反而变低（%s → %s）", before, after)}
	}
	if change == 0 {
		return auUpgradeEvaluation{Status: auStatusUpToDate, Note: "命令已执行，但版本未变化"}
	}
	if target != "" && auCompareVersions(after, target) < 0 {
		return auUpgradeEvaluation{Status: auStatusUpdated, Note: fmt.Sprintf("命令成功，但未达到目标版本 %s", target)}
	}
	return auUpgradeEvaluation{Status: auStatusUpdated}
}
