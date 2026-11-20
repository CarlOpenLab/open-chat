package host

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
)

type auSystemFacts struct {
	MiseDataDir      string
	MiseShimDir      string
	MiseInstallPaths []string
	NpmRoots         []string
	BunRoots         []string
	PnpmRoots        []string
	BrewPrefixes     []string
}

type auPathInstall struct {
	Channel  AgentUpdateChannel
	Path     string
	RealPath string
	Key      string
}

type auInstallSelection struct {
	Effective *auPathInstall
	Shadowed  []auPathInstall
}

type auClassifyContext struct {
	Facts             auSystemFacts
	Realpath          func(string) (string, error)
	NativeBinaryCheck func(string) bool
}

func auIsUnderPath(path, root string) bool {
	if root == "" {
		return false
	}
	p := filepath.Clean(path)
	r := filepath.Clean(root)
	if runtime.GOOS == "windows" {
		p = strings.ToLower(p)
		r = strings.ToLower(r)
	}
	if p == r {
		return true
	}
	sep := string(filepath.Separator)
	if !strings.HasSuffix(r, sep) {
		r += sep
	}
	return strings.HasPrefix(p, r)
}

func auMatchRoot(path string, roots []string) string {
	for _, root := range roots {
		if auIsUnderPath(path, root) {
			return root
		}
	}
	return ""
}

func auSafeRealpath(path string, fn func(string) (string, error)) string {
	if fn == nil {
		fn = filepath.EvalSymlinks
	}
	if resolved, err := fn(path); err == nil && resolved != "" {
		return resolved
	}
	return path
}

func auNormalizeRoot(path string) string {
	if path == "" {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil && resolved != "" {
		return resolved
	}
	return filepath.Clean(path)
}

var auNativeMagics = [][]byte{
	{0xcf, 0xfa, 0xed, 0xfe},
	{0xce, 0xfa, 0xed, 0xfe},
	{0xfe, 0xed, 0xfa, 0xce},
	{0xfe, 0xed, 0xfa, 0xcf},
	{0xca, 0xfe, 0xba, 0xbe},
	{0xbe, 0xba, 0xfe, 0xca},
	{0x7f, 0x45, 0x4c, 0x46},
}

func auIsNativeBinaryMagic(b []byte) bool {
	if len(b) >= 2 && runtime.GOOS == "windows" && b[0] == 'M' && b[1] == 'Z' {
		return true
	}
	if len(b) < 4 {
		return false
	}
	for _, magic := range auNativeMagics {
		if b[0] == magic[0] && b[1] == magic[1] && b[2] == magic[2] && b[3] == magic[3] {
			return true
		}
	}
	return false
}

func auLooksLikeNativeBinary(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 4)
	n, err := f.Read(buf)
	if err != nil || n < 2 {
		return false
	}
	return auIsNativeBinaryMagic(buf[:n])
}

func auClassifyPath(rawPath string, agent auAgentSpec, ctx auClassifyContext) auPathInstall {
	realPath := auSafeRealpath(rawPath, ctx.Realpath)
	facts := ctx.Facts

	if root := auMatchRoot(realPath, facts.NpmRoots); root != "" {
		return auPathInstall{Channel: auChannelNpm, Path: rawPath, RealPath: realPath, Key: "npm:" + root}
	}
	if root := auMatchRoot(realPath, facts.BunRoots); root != "" {
		return auPathInstall{Channel: auChannelBun, Path: rawPath, RealPath: realPath, Key: "bun:" + root}
	}
	if root := auMatchRoot(realPath, facts.PnpmRoots); root != "" {
		return auPathInstall{Channel: auChannelPnpm, Path: rawPath, RealPath: realPath, Key: "pnpm:" + root}
	}
	if auIsUnderPath(rawPath, facts.MiseShimDir) {
		return auPathInstall{Channel: auChannelMise, Path: rawPath, RealPath: realPath, Key: "mise"}
	}
	if auMatchRoot(realPath, facts.MiseInstallPaths) != "" {
		return auPathInstall{Channel: auChannelMise, Path: rawPath, RealPath: realPath, Key: "mise"}
	}
	if prefix := auMatchRoot(realPath, facts.BrewPrefixes); prefix != "" {
		return auPathInstall{Channel: auChannelBrew, Path: rawPath, RealPath: realPath, Key: "brew:" + prefix}
	}

	inNativeDir := false
	for _, dir := range agent.NativeDirs {
		if auIsUnderPath(rawPath, dir) {
			inNativeDir = true
			break
		}
	}
	nativeCheck := ctx.NativeBinaryCheck
	if nativeCheck == nil {
		nativeCheck = auLooksLikeNativeBinary
	}
	if len(agent.NativeUpdate) > 0 && inNativeDir && nativeCheck(rawPath) {
		return auPathInstall{Channel: auChannelNative, Path: rawPath, RealPath: realPath, Key: "native:" + realPath}
	}

	return auPathInstall{Channel: auChannelUnknown, Path: rawPath, RealPath: realPath, Key: "unknown:" + rawPath}
}

func auSelectInstallations(candidates []auPathInstall) auInstallSelection {
	seen := make(map[string]bool, len(candidates))
	unique := make([]auPathInstall, 0, len(candidates))
	for _, c := range candidates {
		if seen[c.Key] {
			continue
		}
		seen[c.Key] = true
		unique = append(unique, c)
	}
	if len(unique) == 0 {
		return auInstallSelection{}
	}
	eff := unique[0]
	return auInstallSelection{Effective: &eff, Shadowed: unique[1:]}
}

func auWhichAll(bin string, env []string) []string {
	if bin == "" {
		return nil
	}
	_, _, pathEnv := envLookup(env, "PATH")
	exts := []string{""}
	if runtime.GOOS == "windows" {
		if filepath.Ext(bin) != "" {
			exts = []string{"", ".exe", ".cmd", ".bat"}
		} else {
			exts = []string{".exe", ".cmd", ".bat", ""}
		}
	}
	seen := map[string]bool{}
	var found []string
	for _, dir := range filepath.SplitList(pathEnv) {
		if dir == "" {
			continue
		}
		for _, ext := range exts {
			candidate, err := filepath.Abs(filepath.Join(dir, bin+ext))
			if err != nil {
				continue
			}
			st, err := os.Stat(candidate)
			if err != nil || st.IsDir() {
				continue
			}
			if runtime.GOOS != "windows" && st.Mode()&0o111 == 0 {
				continue
			}
			key := candidate
			if runtime.GOOS == "windows" {
				key = strings.ToLower(candidate)
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			found = append(found, candidate)
		}
	}
	return found
}

// -------------------------------------------------------------------- mise

type auMiseTool struct {
	Version          string `json:"version"`
	RequestedVersion string `json:"requested_version"`
	InstallPath      string `json:"install_path"`
	Installed        bool   `json:"installed"`
	Active           bool   `json:"active"`
}

type auMiseToolMap map[string][]auMiseTool

type auMiseSelection struct {
	Tool             string
	Active           bool
	Version          string
	RequestedVersion string
	InstallPath      string
}

var (
	auWouldInstallRe = regexp.MustCompile(`(?m)^Would install\s+(.+)$`)
	auWarnLineRe     = regexp.MustCompile(`(?i)WARN|Error|ignored|failed`)
)

func auPickEntry(entries []auMiseTool) (auMiseTool, bool) {
	if len(entries) == 0 {
		return auMiseTool{}, false
	}
	var installed []auMiseTool
	for _, e := range entries {
		if e.Installed {
			installed = append(installed, e)
		}
	}
	pool := entries
	if len(installed) > 0 {
		pool = installed
	}
	return pool[len(pool)-1], true
}

func auPickMiseTool(agent auAgentSpec, active, installed auMiseToolMap, realPath string) *auMiseSelection {
	sel := func(tool string, e auMiseTool, isActive bool) *auMiseSelection {
		return &auMiseSelection{
			Tool: tool, Active: isActive, Version: e.Version,
			RequestedVersion: e.RequestedVersion, InstallPath: e.InstallPath,
		}
	}
	if realPath != "" {
		for _, tool := range agent.MiseTools {
			for _, e := range active[tool] {
				if e.Installed && e.InstallPath != "" && auIsUnderPath(realPath, e.InstallPath) {
					return sel(tool, e, true)
				}
			}
			for _, e := range installed[tool] {
				if e.Installed && e.InstallPath != "" && auIsUnderPath(realPath, e.InstallPath) {
					if configured, ok := auPickEntry(active[tool]); ok {
						return sel(tool, configured, true)
					}
					return sel(tool, e, false)
				}
			}
		}
	}
	for _, tool := range agent.MiseTools {
		if e, ok := auPickEntry(active[tool]); ok {
			return sel(tool, e, true)
		}
	}
	for _, tool := range agent.MiseTools {
		if e, ok := auPickEntry(installed[tool]); ok {
			return sel(tool, e, false)
		}
	}
	return nil
}

func auParseMiseTarget(stdout string) string {
	if m := auWouldInstallRe.FindStringSubmatch(stdout); len(m) > 1 {
		line := strings.TrimSpace(m[1])
		if idx := strings.LastIndexByte(line, '@'); idx >= 0 && idx+1 < len(line) {
			return strings.TrimSpace(line[idx+1:])
		}
	}
	return ""
}

func auCollectWarnings(stderr string) []string {
	var out []string
	for _, line := range strings.Split(stderr, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && auWarnLineRe.MatchString(line) {
			out = append(out, line)
		}
	}
	return out
}

func auParseMiseJSON(text string) auMiseToolMap {
	idx := strings.IndexByte(text, '{')
	if idx < 0 {
		return auMiseToolMap{}
	}
	var m auMiseToolMap
	if err := json.Unmarshal([]byte(text[idx:]), &m); err != nil || m == nil {
		return auMiseToolMap{}
	}
	return m
}

type auMise struct {
	Bin string
	Cwd string
	Env []string
}

func auDiscoverMise(env []string, cwd string) *auMise {
	if cwd == "" {
		cwd, _ = os.UserHomeDir()
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		lookPath(env, "mise"),
		filepath.Join(home, ".local", "bin", "mise"),
		"/opt/homebrew/bin/mise",
		"/usr/local/bin/mise",
		filepath.Join(home, ".local", "share", "mise", "bin", "mise"),
	}
	for _, p := range candidates {
		if p == "" {
			continue
		}
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return &auMise{Bin: p, Cwd: cwd, Env: env}
		}
	}
	return nil
}

func (m *auMise) run(ctx context.Context, timeout time.Duration, args ...string) auRunResult {
	return auRunCmd(ctx, m.Env, m.Cwd, timeout, append([]string{m.Bin}, args...))
}

func (m *auMise) version(ctx context.Context) string {
	r := m.run(ctx, 20*time.Second, "--version")
	line := strings.TrimSpace(strings.Split(strings.TrimSpace(r.Stdout), "\n")[0])
	if line == "" {
		return "unknown"
	}
	return line
}

func (m *auMise) listActive(ctx context.Context) (auMiseToolMap, []string) {
	r := m.run(ctx, 60*time.Second, "ls", "-J", "-c")
	return auParseMiseJSON(r.Stdout), auCollectWarnings(r.Stderr)
}

func (m *auMise) listInstalled(ctx context.Context) (auMiseToolMap, []string) {
	r := m.run(ctx, 60*time.Second, "ls", "-J", "--installed")
	return auParseMiseJSON(r.Stdout), auCollectWarnings(r.Stderr)
}

func (m *auMise) upgrade(ctx context.Context, tool string, bump bool, minAge string, dryRun bool) auRunResult {
	args := []string{"upgrade", tool}
	if bump {
		args = append(args, "--bump")
	}
	if dryRun {
		args = append(args, "--dry-run")
	}
	if minAge != "" {
		args = append(args, "--minimum-release-age", minAge)
	}
	timeout := 10 * time.Minute
	if dryRun {
		timeout = 60 * time.Second
	}
	return m.run(ctx, timeout, args...)
}

func (m *auMise) reshim(ctx context.Context) auRunResult {
	return m.run(ctx, 2*time.Minute, "reshim")
}

// ------------------------------------------------------------------- facts

func auFirstNonEmptyLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			return t
		}
	}
	return ""
}

func auFindNodePackageDir(realPath, pkg string) string {
	if realPath == "" || pkg == "" {
		return ""
	}
	slashPath := filepath.ToSlash(realPath)
	marker := "/node_modules/" + pkg + "/"
	if idx := strings.LastIndex(slashPath, marker); idx >= 0 {
		return filepath.FromSlash(slashPath[:idx+len(marker)-1])
	}
	exact := "/node_modules/" + pkg
	if strings.HasSuffix(slashPath, exact) {
		return filepath.FromSlash(slashPath)
	}
	return ""
}

func auReadNodePackageVersion(realPath, pkg string) string {
	dir := auFindNodePackageDir(realPath, pkg)
	if dir == "" {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return ""
	}
	var manifest struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(b, &manifest); err != nil {
		return ""
	}
	return strings.TrimSpace(manifest.Version)
}

func auCollectSystemFacts(ctx context.Context, env []string) auSystemFacts {
	home, _ := os.UserHomeDir()
	var npmRoots, pnpmRoots, brewPrefixes []string

	if lookPath(env, "npm") != "" {
		res := auRunCmd(ctx, env, home, 30*time.Second, []string{"npm", "root", "-g"})
		if res.Code == 0 {
			if root := auFirstNonEmptyLine(res.Stdout); root != "" {
				npmRoots = append(npmRoots, auNormalizeRoot(root))
			}
		}
	}
	if lookPath(env, "pnpm") != "" {
		res := auRunCmd(ctx, env, home, 30*time.Second, []string{"pnpm", "root", "-g"})
		if res.Code == 0 {
			if root := auFirstNonEmptyLine(res.Stdout); root != "" {
				pnpmRoots = append(pnpmRoots, auNormalizeRoot(root))
			}
		}
	}
	if brewPath := lookPath(env, "brew"); brewPath != "" {
		brewPrefixes = append(brewPrefixes, auNormalizeRoot(filepath.Dir(filepath.Dir(brewPath))))
	}
	if _, _, hp := envLookup(env, "HOMEBREW_PREFIX"); hp != "" {
		norm := auNormalizeRoot(hp)
		if !slices.Contains(brewPrefixes, norm) {
			brewPrefixes = append(brewPrefixes, norm)
		}
	}

	_, _, miseDataDir := envLookup(env, "MISE_DATA_DIR")
	if miseDataDir == "" {
		miseDataDir = filepath.Join(home, ".local", "share", "mise")
	}
	miseDataDir = auNormalizeRoot(miseDataDir)

	_, _, bunInstall := envLookup(env, "BUN_INSTALL")
	if bunInstall == "" {
		bunInstall = filepath.Join(home, ".bun")
	}

	return auSystemFacts{
		MiseDataDir:  miseDataDir,
		MiseShimDir:  filepath.Join(miseDataDir, "shims"),
		NpmRoots:     npmRoots,
		BunRoots:     []string{auNormalizeRoot(filepath.Join(bunInstall, "install", "global", "node_modules"))},
		PnpmRoots:    pnpmRoots,
		BrewPrefixes: brewPrefixes,
	}
}

func auBrewOutdatedMap(ctx context.Context, env []string) map[string]auBrewOutdatedEntry {
	if lookPath(env, "brew") == "" {
		return nil
	}
	home, _ := os.UserHomeDir()
	res := auRunCmd(ctx, env, home, 2*time.Minute, []string{"brew", "outdated", "--json=v2"})
	if res.Code != 0 {
		return nil
	}
	return auParseBrewOutdated([]byte(res.Stdout))
}

func auWhichFormula(ctx context.Context, env []string, bin string) string {
	if lookPath(env, "brew") == "" {
		return ""
	}
	home, _ := os.UserHomeDir()
	res := auRunCmd(ctx, env, home, 60*time.Second, []string{"brew", "which-formula", bin})
	if res.Code != 0 {
		return ""
	}
	return auFirstNonEmptyLine(res.Stdout)
}

func auListBrewCasks(ctx context.Context, env []string) []string {
	if lookPath(env, "brew") == "" {
		return nil
	}
	home, _ := os.UserHomeDir()
	res := auRunCmd(ctx, env, home, 60*time.Second, []string{"brew", "list", "--cask"})
	if res.Code != 0 {
		return nil
	}
	var out []string
	for _, line := range strings.Split(res.Stdout, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func auProbeVersion(ctx context.Context, env []string, bin string) string {
	home, _ := os.UserHomeDir()
	res := auRunCmd(ctx, env, home, 20*time.Second, []string{bin, "--version"})
	if res.Code != 0 {
		return ""
	}
	if v := auParseVersion(res.Stdout); v != "" {
		return v
	}
	return auParseVersion(res.Stderr)
}

// ----------------------------------------------------------------- service

type auInspectDeps struct {
	Facts             auSystemFacts
	Active            auMiseToolMap
	Installed         auMiseToolMap
	BrewOutdated      map[string]auBrewOutdatedEntry
	BrewCasks         []string
	ChannelAvailable  map[AgentUpdateChannel]bool
	ReadNodeVersion   func(realPath, pkg string) string
	ProbeVersion      func(path string) string
	FetchLatest       func(pkg string) string
	FetchTag          func(pkg, tag string) string
	MiseUpgradePlan   func(spec string) (target string, code int)
	WhichFormula      func(bin string) string
	Realpath          func(path string) (string, error)
	NativeBinaryCheck func(path string) bool
	Options           auCommandOptions
}

func auInstallPathsFor(tool string, active, installed auMiseToolMap) []string {
	seen := map[string]bool{}
	var paths []string
	add := func(entries []auMiseTool) {
		for _, e := range entries {
			if e.InstallPath == "" {
				continue
			}
			norm := auNormalizeRoot(e.InstallPath)
			if !seen[norm] {
				seen[norm] = true
				paths = append(paths, norm)
			}
		}
	}
	add(active[tool])
	add(installed[tool])
	return paths
}

func auActiveVersionCount(tool string, active auMiseToolMap) int {
	seen := map[string]bool{}
	for _, e := range active[tool] {
		seen[e.Version] = true
	}
	return len(seen)
}

func auInspectAgent(agent auAgentSpec, candidates []string, deps auInspectDeps) AgentUpdateResult {
	installChs := auSupportedInstallChannels(agent, deps.ChannelAvailable)
	if len(candidates) == 0 {
		return AgentUpdateResult{
			ID:              agent.ID,
			Agent:           agent.Name,
			Bin:             agent.Bin,
			Status:          auStatusNotInstalled,
			InstallChannels: installChs,
		}
	}

	firstReal := auSafeRealpath(candidates[0], deps.Realpath)
	miseSel := auPickMiseTool(agent, deps.Active, deps.Installed, firstReal)
	facts := deps.Facts
	if miseSel != nil {
		facts.MiseInstallPaths = auInstallPathsFor(miseSel.Tool, deps.Active, deps.Installed)
	} else {
		facts.MiseInstallPaths = nil
	}

	classified := make([]auPathInstall, 0, len(candidates))
	for _, c := range candidates {
		classified = append(classified, auClassifyPath(c, agent, auClassifyContext{
			Facts: facts, Realpath: deps.Realpath, NativeBinaryCheck: deps.NativeBinaryCheck,
		}))
	}
	sel := auSelectInstallations(classified)
	if sel.Effective == nil {
		return AgentUpdateResult{ID: agent.ID, Agent: agent.Name, Bin: agent.Bin, Status: auStatusNotInstalled}
	}
	eff := *sel.Effective

	channel := eff.Channel
	var identity, current, brewKind, miseRequested, stalePathNote string

	switch channel {
	case auChannelMise:
		if miseSel == nil {
			channel = auChannelUnknown
			break
		}
		miseRequested = miseSel.RequestedVersion
		tagged := auIsNamedMiseTag(miseSel.RequestedVersion)
		if !tagged && auActiveVersionCount(miseSel.Tool, deps.Active) > 1 {
			identity = miseSel.Tool + "@" + miseSel.Version
		} else {
			identity = miseSel.Tool
		}
		if tagged {
			current = deps.ProbeVersion(eff.Path)
		} else {
			current = miseSel.Version
		}

		if configured, ok := auPickEntry(deps.Active[miseSel.Tool]); miseSel.Active && ok && configured.InstallPath != "" {
			onConfigured := auIsUnderPath(eff.RealPath, configured.InstallPath)
			onInstalled := false
			for _, e := range deps.Installed[miseSel.Tool] {
				if e.InstallPath != "" && auIsUnderPath(eff.RealPath, e.InstallPath) {
					onInstalled = true
					break
				}
			}
			if !onConfigured && onInstalled {
				stalePathNote = fmt.Sprintf("PATH 上仍解析到旧版本（%s），新版本已安装；重开 shell 或重新激活 mise 后生效", eff.Path)
			}
		}
	case auChannelNpm, auChannelBun, auChannelPnpm:
		identity = agent.NpmPackage
		if identity == "" {
			identity = agent.Bin
		}
		if agent.NpmPackage != "" && deps.ReadNodeVersion != nil {
			current = deps.ReadNodeVersion(eff.RealPath, agent.NpmPackage)
		}
		if current == "" {
			current = deps.ProbeVersion(eff.Path)
		}
	case auChannelBrew:
		formula := deps.WhichFormula(agent.Bin)
		if formula != "" {
			identity = formula
			brewKind = "formula"
		} else if agent.BrewCask != "" && slices.Contains(deps.BrewCasks, agent.BrewCask) {
			identity = agent.BrewCask
			brewKind = "cask"
		} else {
			channel = auChannelUnknown
			break
		}
		if hit, ok := deps.BrewOutdated[identity]; ok && hit.Current != "" {
			current = hit.Current
		} else {
			current = deps.ProbeVersion(eff.Path)
		}
	case auChannelNative:
		if len(agent.NativeUpdate) > 0 {
			identity = agent.NativeUpdate[0]
		} else {
			identity = agent.Bin
		}
		current = deps.ProbeVersion(eff.Path)
	case auChannelUnknown:
		current = ""
	}

	var latest string
	switch channel {
	case auChannelMise:
		if miseSel != nil {
			if auIsNamedMiseTag(miseSel.RequestedVersion) {
				if agent.NpmPackage != "" && strings.HasPrefix(miseSel.Tool, "npm:") {
					latest = deps.FetchTag(agent.NpmPackage, miseSel.RequestedVersion)
				}
			} else {
				target, code := deps.MiseUpgradePlan(identity)
				if code == 0 {
					if target != "" {
						latest = target
					} else {
						latest = current
					}
				}
			}
		}
	case auChannelNpm, auChannelBun, auChannelPnpm, auChannelNative:
		if agent.NpmPackage != "" {
			latest = deps.FetchLatest(agent.NpmPackage)
		}
	case auChannelBrew:
		if deps.BrewOutdated != nil {
			if hit, ok := deps.BrewOutdated[identity]; ok && hit.Latest != "" {
				latest = hit.Latest
			} else {
				latest = current
			}
		}
	}

	inst := auChannelInstall{
		Channel: channel, Identity: identity, Current: current,
		BrewKind: brewKind, MiseRequested: miseRequested,
	}
	if inst.Identity == "" {
		inst.Identity = "?"
	}

	cmd := auBuildUpgradeCommand(agent, inst, deps.Options)
	avail := true
	if v, ok := deps.ChannelAvailable[channel]; ok {
		avail = v
	}
	dec := auDecideUpgrade(inst, latest, auDecisionOptions{
		Command:          cmd,
		MiseInactive:     channel == auChannelMise && miseSel != nil && !miseSel.Active,
		ChannelAvailable: avail,
	})

	var notes []string
	if dec.Note != "" {
		notes = append(notes, dec.Note)
	}
	if stalePathNote != "" {
		notes = append(notes, stalePathNote)
	}

	var shadowed []AgentUpdateShadowed
	for _, s := range sel.Shadowed {
		shadowed = append(shadowed, AgentUpdateShadowed{Channel: s.Channel, Path: s.Path})
	}

	var miseTool string
	if channel == auChannelMise && miseSel != nil {
		miseTool = miseSel.Tool
	}

	canUninstall := false
	switch channel {
	case auChannelMise, auChannelNpm, auChannelBun, auChannelPnpm, auChannelBrew:
		canUninstall = avail
	}

	return AgentUpdateResult{
		ID:              agent.ID,
		Agent:           agent.Name,
		Bin:             agent.Bin,
		Status:          dec.Status,
		Channel:         channel,
		Identity:        identity,
		Path:            eff.Path,
		Current:         dec.Current,
		Target:          dec.Target,
		Command:         dec.Command,
		Note:            strings.Join(notes, "；"),
		Shadowed:        shadowed,
		InstallChannels: installChs,
		CanUninstall:    canUninstall,
		miseTool:        miseTool,
		miseRequested:   miseRequested,
		brewKind:        brewKind,
	}
}

func auSelectTargets(all []auAgentSpec, only []string) ([]auAgentSpec, error) {
	if len(only) == 0 {
		return all, nil
	}
	var picked []auAgentSpec
	seen := map[string]bool{}
	for _, q := range only {
		a, ok := auMatchAgent(all, q)
		if !ok {
			return nil, fmt.Errorf("未找到匹配的 agent：%s", q)
		}
		if !seen[a.ID] {
			seen[a.ID] = true
			picked = append(picked, a)
		}
	}
	return picked, nil
}

func auBuildSummary(results []AgentUpdateResult) AgentUpdateSummary {
	s := AgentUpdateSummary{Total: len(results)}
	for _, r := range results {
		switch r.Status {
		case auStatusUpdated:
			s.Updated++
		case auStatusUpToDate, auStatusAhead:
			s.UpToDate++
		case auStatusOutdated:
			s.Outdated++
		case auStatusSkipped:
			s.Skipped++
		case auStatusNotInstalled:
			s.NotInstalled++
		case auStatusFailed:
			s.Failed++
		}
	}
	return s
}

func auDedupeStrings(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func auAddStalePathNote(r AgentUpdateResult) AgentUpdateResult {
	if r.Status != auStatusUpdated || r.Channel != auChannelMise {
		return r
	}
	if !strings.Contains(r.Path, "/installs/") && !strings.Contains(r.Path, `\installs\`) {
		return r
	}
	note := "当前 shell 的 PATH 可能仍指向旧版本；重开 shell 或重新激活 mise 后生效"
	if r.Note == "" {
		r.Note = note
	} else {
		r.Note += "；" + note
	}
	return r
}

func auInspectWithEnv(ctx context.Context, env []string, opts AgentUpdateOptions) (*AgentUpdateReport, *auMise, error) {
	targets, err := auSelectTargets(auDefaultAgents(), opts.Only)
	if err != nil {
		return nil, nil, err
	}

	home, _ := os.UserHomeDir()
	mise := auDiscoverMise(env, home)
	var (
		miseInfo  *AgentUpdateMiseInfo
		active    = auMiseToolMap{}
		installed = auMiseToolMap{}
		warnings  []string
		warnMu    sync.Mutex
	)
	addWarnings := func(ws ...string) {
		if len(ws) == 0 {
			return
		}
		warnMu.Lock()
		warnings = append(warnings, ws...)
		warnMu.Unlock()
	}

	var (
		facts        auSystemFacts
		brewOutdated map[string]auBrewOutdatedEntry
		brewCasks    []string
	)

	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		facts = auCollectSystemFacts(ctx, env)
	}()
	go func() {
		defer wg.Done()
		brewOutdated = auBrewOutdatedMap(ctx, env)
		brewCasks = auListBrewCasks(ctx, env)
	}()
	go func() {
		defer wg.Done()
		if mise == nil {
			return
		}
		miseInfo = &AgentUpdateMiseInfo{Bin: mise.Bin, Version: mise.version(ctx)}
		var w1, w2 []string
		active, w1 = mise.listActive(ctx)
		installed, w2 = mise.listInstalled(ctx)
		addWarnings(w1...)
		addWarnings(w2...)
	}()
	wg.Wait()

	httpClient := &http.Client{Timeout: 15 * time.Second}
	channelAvail := map[AgentUpdateChannel]bool{
		auChannelMise:   mise != nil,
		auChannelNpm:    lookPath(env, "npm") != "",
		auChannelBun:    lookPath(env, "bun") != "",
		auChannelPnpm:   lookPath(env, "pnpm") != "",
		auChannelBrew:   lookPath(env, "brew") != "",
		auChannelNative: true,
	}

	cmdOpts := auCommandOptions{
		Bump:              opts.bump(),
		MinimumReleaseAge: opts.minReleaseAge(),
	}

	results := make([]AgentUpdateResult, len(targets))
	var iwg sync.WaitGroup
	for i, agent := range targets {
		iwg.Add(1)
		go func(idx int, spec auAgentSpec) {
			defer iwg.Done()
			deps := auInspectDeps{
				Facts:            facts,
				Active:           active,
				Installed:        installed,
				BrewOutdated:     brewOutdated,
				BrewCasks:        brewCasks,
				ChannelAvailable: channelAvail,
				ReadNodeVersion:  auReadNodePackageVersion,
				ProbeVersion: func(p string) string {
					return auProbeVersion(ctx, env, p)
				},
				FetchLatest: func(pkg string) string {
					return auFetchVersion(ctx, httpClient, pkg, "latest")
				},
				FetchTag: func(pkg, tag string) string {
					return auFetchVersion(ctx, httpClient, pkg, tag)
				},
				MiseUpgradePlan: func(spec string) (string, int) {
					if mise == nil {
						return "", 127
					}
					res := mise.upgrade(ctx, spec, cmdOpts.Bump, cmdOpts.MinimumReleaseAge, true)
					addWarnings(auCollectWarnings(res.Stderr)...)
					return auParseMiseTarget(res.Stdout), res.Code
				},
				WhichFormula: func(bin string) string {
					return auWhichFormula(ctx, env, bin)
				},
				Options: cmdOpts,
			}
			results[idx] = auInspectAgent(spec, auWhichAll(spec.Bin, env), deps)
		}(i, agent)
	}
	iwg.Wait()

	var availList []AgentUpdateChannel
	for _, ch := range []AgentUpdateChannel{auChannelMise, auChannelNpm, auChannelPnpm, auChannelBun, auChannelBrew} {
		if channelAvail[ch] {
			availList = append(availList, ch)
		}
	}

	return &AgentUpdateReport{
		Mise:              miseInfo,
		AvailableChannels: availList,
		Results:           results,
		Summary:           auBuildSummary(results),
		Warnings:          auDedupeStrings(warnings),
	}, mise, nil
}

func auInspectAll(ctx context.Context, env []string, opts AgentUpdateOptions) (*AgentUpdateReport, error) {
	report, _, err := auInspectWithEnv(ctx, env, opts)
	return report, err
}

func auUpgrade(ctx context.Context, env []string, opts AgentUpdateOptions, onProgress func(AgentUpdateProgress)) (*AgentUpdateReport, error) {
	emit := func(p AgentUpdateProgress) {
		if onProgress != nil {
			onProgress(p)
		}
	}
	emit(AgentUpdateProgress{Stage: "inspecting", Percent: 5, Message: "正在检查可更新的 Agent…"})

	report, mise, err := auInspectWithEnv(ctx, env, opts)
	if err != nil {
		return nil, err
	}

	total := 0
	for _, r := range report.Results {
		if r.Status == auStatusOutdated && len(r.Command) > 0 && r.Path != "" {
			total++
		}
	}
	if total == 0 {
		emit(AgentUpdateProgress{Stage: "done", Completed: 0, Total: 0, Percent: 100, Message: "所有 Agent 均无需更新"})
		return report, nil
	}

	home, _ := os.UserHomeDir()
	miseRan := false
	completed := 0

	for i := range report.Results {
		r := report.Results[i]
		if r.Status != auStatusOutdated || len(r.Command) == 0 || r.Path == "" {
			continue
		}
		if r.Channel == auChannelMise {
			miseRan = true
		}

		pctStart := (completed*100 + 15) / total
		if pctStart > 92 {
			pctStart = 92
		}
		emit(AgentUpdateProgress{
			Stage:     "upgrading",
			AgentID:   r.ID,
			AgentName: r.Agent,
			Completed: completed,
			Total:     total,
			Percent:   pctStart,
			Message:   fmt.Sprintf("正在通过 %s 更新 %s (%d/%d)…", r.Channel, r.Agent, completed+1, total),
		})

		res := auRunCmd(ctx, env, home, 10*time.Minute, r.Command)
		if res.Code != 0 {
			note := auFirstNonEmptyLine(res.Stderr)
			if note == "" {
				note = auFirstNonEmptyLine(res.Stdout)
			}
			if note == "" {
				note = fmt.Sprintf("退出码 %d", res.Code)
			}
			r.Status = auStatusFailed
			r.Note = note
			report.Results[i] = r
			completed++
			resCopy := r
			emit(AgentUpdateProgress{
				Stage:     "upgrading",
				AgentID:   r.ID,
				AgentName: r.Agent,
				Completed: completed,
				Total:     total,
				Percent:   (completed * 95) / total,
				Message:   fmt.Sprintf("%s 更新失败 (%d/%d)", r.Agent, completed, total),
				Result:    &resCopy,
			})
			continue
		}

		emit(AgentUpdateProgress{
			Stage:     "verifying",
			AgentID:   r.ID,
			AgentName: r.Agent,
			Completed: completed,
			Total:     total,
			Percent:   (completed*100 + 80) / total,
			Message:   fmt.Sprintf("正在校验 %s 新版本 (%d/%d)…", r.Agent, completed+1, total),
		})

		var after string
		if r.Channel == auChannelMise && r.miseTool != "" && !auIsNamedMiseTag(r.miseRequested) && mise != nil {
			active, _ := mise.listActive(ctx)
			if entry, ok := auPickEntry(active[r.miseTool]); ok {
				after = entry.Version
			}
		} else {
			after = auProbeVersion(ctx, env, r.Path)
		}

		ev := auEvaluateUpgradeResult(r.Current, after, r.Target)
		r.Status = ev.Status
		if after != "" {
			r.Current = after
		}
		r.Note = ev.Note
		r = auAddStalePathNote(r)
		report.Results[i] = r

		completed++
		resCopy := r
		emit(AgentUpdateProgress{
			Stage:     "upgrading",
			AgentID:   r.ID,
			AgentName: r.Agent,
			Completed: completed,
			Total:     total,
			Percent:   (completed * 95) / total,
			Message:   fmt.Sprintf("%s 处理完成 (%d/%d)", r.Agent, completed, total),
			Result:    &resCopy,
		})
	}

	if miseRan && mise != nil {
		emit(AgentUpdateProgress{
			Stage:     "reshim",
			Completed: completed,
			Total:     total,
			Percent:   96,
			Message:   "正在刷新 mise shims…",
		})
		if res := mise.reshim(ctx); res.Code != 0 {
			msg := auFirstNonEmptyLine(res.Stderr)
			if msg == "" {
				msg = "未知错误"
			}
			report.Warnings = auDedupeStrings(append(report.Warnings, "reshim 失败："+msg))
		}
	}

	report.Summary = auBuildSummary(report.Results)
	emit(AgentUpdateProgress{
		Stage:     "done",
		Completed: completed,
		Total:     total,
		Percent:   100,
		Message:   "更新完成",
	})
	return report, nil
}
