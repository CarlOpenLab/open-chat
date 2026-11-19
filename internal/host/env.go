package host

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// loginEnv returns the environment the user's terminal would have.
//
// Apps started from the Dock, Finder or a desktop launcher inherit a bare
// PATH (/usr/bin:/bin on macOS) that lacks Homebrew, mise, nvm, ~/.local/bin
// — exactly where node, npx, claude and codex live. Like editors do, ask the
// login shell once for its environment and merge it over ours.
func loginEnv() []string {
	env := os.Environ()
	if runtime.GOOS == "windows" {
		return withPath(env, windowsExtraPaths(env))
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
		if runtime.GOOS == "darwin" {
			shell = "/bin/zsh"
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	const mark = "__OPEN_CHAT_ENV__"
	cmd := exec.CommandContext(ctx, shell, "-ilc", "echo "+mark+"; env -0")
	cmd.Stdin = nil
	cmd.Stderr = nil
	out, err := cmd.Output()
	if err == nil {
		if i := bytes.Index(out, []byte(mark+"\n")); i >= 0 {
			merged := map[string]string{}
			order := []string{}
			put := func(kv string) {
				k, v, ok := strings.Cut(kv, "=")
				if !ok || k == "" {
					return
				}
				if _, seen := merged[k]; !seen {
					order = append(order, k)
				}
				merged[k] = v
			}
			for _, kv := range env {
				put(kv)
			}
			for _, kv := range strings.Split(string(out[i+len(mark)+1:]), "\x00") {
				k, _, _ := strings.Cut(kv, "=")
				switch k {
				case "PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "NVM_DIR", "MISE_DATA_DIR", "VOLTA_HOME", "PNPM_HOME", "BUN_INSTALL",
					"ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY",
					"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "ALL_PROXY", "all_proxy":
					put(kv)
				}
			}
			env = env[:0:0]
			for _, k := range order {
				env = append(env, k+"="+merged[k])
			}
		}
	}
	// Common install locations, in case the shell profile doesn't add them.
	home, _ := os.UserHomeDir()
	extra := []string{
		filepath.Join(home, ".local", "bin"),
		filepath.Join(home, ".local", "share", "mise", "shims"),
		filepath.Join(home, ".bun", "bin"),
		filepath.Join(home, ".volta", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
	}
	return withPath(env, extra)
}

func envLookup(env []string, key string) (idx int, name, val string) {
	for i, kv := range env {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		if strings.EqualFold(k, key) {
			return i, k, v
		}
	}
	return -1, key, ""
}

func windowsExtraPaths(env []string) []string {
	home, _ := os.UserHomeDir()
	get := func(k string) string {
		_, _, v := envLookup(env, k)
		return v
	}
	localAppData := get("LOCALAPPDATA")
	appData := get("APPDATA")
	programFiles := get("ProgramFiles")
	miseData := get("MISE_DATA_DIR")

	var extra []string
	add := func(p string) {
		if p != "" {
			extra = append(extra, p)
		}
	}
	if miseData != "" {
		add(filepath.Join(miseData, "shims"))
	}
	if localAppData != "" {
		add(filepath.Join(localAppData, "mise", "shims"))
	}
	if home != "" {
		add(filepath.Join(home, ".local", "share", "mise", "shims"))
	}
	// Fallback for mise users who rely on `mise activate` without shims.
	for _, base := range []string{miseData, filepath.Join(localAppData, "mise"), filepath.Join(home, ".local", "share", "mise")} {
		if base == "" {
			continue
		}
		if dir := latestMiseNodeDir(filepath.Join(base, "installs", "node")); dir != "" {
			add(dir)
		}
	}
	if v := get("NVM_SYMLINK"); v != "" {
		add(v)
	}
	if v := get("VOLTA_HOME"); v != "" {
		add(filepath.Join(v, "bin"))
	}
	if home != "" {
		add(filepath.Join(home, ".volta", "bin"))
	}
	if v := get("PNPM_HOME"); v != "" {
		add(v)
	}
	if localAppData != "" {
		add(filepath.Join(localAppData, "pnpm"))
	}
	if appData != "" {
		add(filepath.Join(appData, "npm"))
	}
	if v := get("BUN_INSTALL"); v != "" {
		add(filepath.Join(v, "bin"))
	}
	if home != "" {
		add(filepath.Join(home, ".bun", "bin"))
		add(filepath.Join(home, "scoop", "shims"))
		add(filepath.Join(home, ".local", "bin"))
	}
	if programFiles != "" {
		add(filepath.Join(programFiles, "nodejs"))
	}
	return extra
}

func latestMiseNodeDir(installsDir string) string {
	entries, err := os.ReadDir(installsDir)
	if err != nil {
		return ""
	}
	// Prefer "latest" symlink/dir if present, otherwise reverse lexical order.
	for _, e := range entries {
		if e.Name() == "latest" {
			p := filepath.Join(installsDir, e.Name())
			if st, err := os.Stat(filepath.Join(p, "node.exe")); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	for i := len(entries) - 1; i >= 0; i-- {
		p := filepath.Join(installsDir, entries[i].Name())
		if st, err := os.Stat(filepath.Join(p, "node.exe")); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func withPath(env []string, extra []string) []string {
	idx, key, path := envLookup(env, "PATH")
	parts := filepath.SplitList(path)
	seen := map[string]bool{}
	norm := func(p string) string {
		c := filepath.Clean(p)
		if runtime.GOOS == "windows" {
			return strings.ToLower(c)
		}
		return c
	}
	for _, p := range parts {
		if p != "" {
			seen[norm(p)] = true
		}
	}
	for _, p := range extra {
		if p == "" || seen[norm(p)] {
			continue
		}
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			parts = append(parts, p)
			seen[norm(p)] = true
		}
	}
	kv := key + "=" + strings.Join(parts, string(os.PathListSeparator))
	if idx >= 0 {
		env[idx] = kv
	} else {
		env = append(env, kv)
	}
	return env
}

// execCmd builds an exec.Cmd, wrapping .cmd/.bat shims via cmd.exe on Windows.
func execCmd(name string, args ...string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		ext := strings.ToLower(filepath.Ext(name))
		if ext == ".cmd" || ext == ".bat" {
			return exec.Command("cmd.exe", append([]string{"/c", name}, args...)...)
		}
	}
	return exec.Command(name, args...)
}

// lookPath finds an executable on the PATH of env.
func lookPath(env []string, name string) string {
	if name == "" {
		return ""
	}
	if filepath.IsAbs(name) {
		if st, err := os.Stat(name); err == nil && !st.IsDir() {
			return name
		}
		return ""
	}
	_, _, path := envLookup(env, "PATH")
	exts := []string{""}
	if runtime.GOOS == "windows" {
		if filepath.Ext(name) != "" {
			exts = []string{"", ".exe", ".cmd", ".bat"}
		} else {
			exts = []string{".exe", ".cmd", ".bat", ""}
		}
	}
	for _, dir := range filepath.SplitList(path) {
		if dir == "" {
			continue
		}
		for _, ext := range exts {
			p := filepath.Join(dir, name+ext)
			if st, err := os.Stat(p); err == nil && !st.IsDir() && (runtime.GOOS == "windows" || st.Mode()&0o111 != 0) {
				return p
			}
		}
	}
	return ""
}
