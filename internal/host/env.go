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
		return env
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

func withPath(env []string, extra []string) []string {
	idx := -1
	path := ""
	for i, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			idx, path = i, kv[5:]
		}
	}
	parts := filepath.SplitList(path)
	seen := map[string]bool{}
	for _, p := range parts {
		seen[p] = true
	}
	for _, p := range extra {
		if !seen[p] {
			if st, err := os.Stat(p); err == nil && st.IsDir() {
				parts = append(parts, p)
				seen[p] = true
			}
		}
	}
	kv := "PATH=" + strings.Join(parts, string(os.PathListSeparator))
	if idx >= 0 {
		env[idx] = kv
	} else {
		env = append(env, kv)
	}
	return env
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
	path := ""
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			path = kv[5:]
		}
	}
	exts := []string{""}
	if runtime.GOOS == "windows" {
		exts = []string{".exe", ".cmd", ".bat", ""}
	}
	for _, dir := range filepath.SplitList(path) {
		for _, ext := range exts {
			p := filepath.Join(dir, name+ext)
			if st, err := os.Stat(p); err == nil && !st.IsDir() && (runtime.GOOS == "windows" || st.Mode()&0o111 != 0) {
				return p
			}
		}
	}
	return ""
}