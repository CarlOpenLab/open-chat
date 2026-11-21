package host

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestAgentUpdateVersions(t *testing.T) {
	if got := auParseVersion("2.1.303 (Claude Code)"); got != "2.1.303" {
		t.Fatalf("got %q, want 2.1.303", got)
	}
	if auCompareVersions("0.153.2", "0.162.1") != -1 {
		t.Fatalf("expected 0.153.2 < 0.162.1")
	}
	if auCompareVersions("1.0.0", "1.0.0-rc.1") != 1 {
		t.Fatalf("expected release > prerelease")
	}
}

func TestAgentUpdateClassifyAndInspect(t *testing.T) {
	agent := auAgentSpec{
		ID:         "codex",
		Name:       "Codex",
		Bin:        "codex",
		MiseTools:  []string{"npm:@openai/codex"},
		NpmPackage: "@openai/codex",
	}
	active := auMiseToolMap{
		"npm:@openai/codex": {{
			Version:          "0.153.2",
			RequestedVersion: "0.153.2",
			InstallPath:      "/Users/u/.local/share/mise/installs/npm-openai-codex/0.153.2",
			Installed:        true,
			Active:           true,
		}},
	}
	res := auInspectAgent(agent, []string{"/Users/u/.local/share/mise/shims/codex"}, auInspectDeps{
		Facts: auSystemFacts{
			MiseDataDir: "/Users/u/.local/share/mise",
			MiseShimDir: "/Users/u/.local/share/mise/shims",
		},
		Active:           active,
		Installed:        active,
		ChannelAvailable: map[AgentUpdateChannel]bool{auChannelMise: true},
		MiseUpgradePlan:  func(string) (string, int) { return "0.162.1", 0 },
		Realpath:         func(string) (string, error) { return "/Users/u/.local/bin/mise", nil },
		Options:          auCommandOptions{Bump: true, MinimumReleaseAge: "0"},
	})
	if res.Status != auStatusOutdated {
		t.Fatalf("status = %q, want outdated (note=%q)", res.Status, res.Note)
	}
	wantCmd := []string{"mise", "upgrade", "npm:@openai/codex", "--bump", "--minimum-release-age", "0"}
	if !reflect.DeepEqual(res.Command, wantCmd) {
		t.Fatalf("command = %v, want %v", res.Command, wantCmd)
	}
}

func TestAuDefaultMiseDataDir(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows 语义")
	}
	home := `C:\Users\u`
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		localAppData = filepath.Join(home, "AppData", "Local")
	}
	want := filepath.Join(localAppData, "mise")
	if got := auDefaultMiseDataDir(home); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// Windows 上 agent 最常见的两种装法：mise shim 与 npm 全局 shim。
// 两者都是普通文件，realpath 不会像 Unix 那样解析进包目录。
func TestAgentUpdateWindowsShims(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 路径语义")
	}
	home := `C:\Users\u`
	localAppData := filepath.Join(home, "AppData", "Local")
	var spec auAgentSpec
	for _, s := range auDefaultAgents() {
		if s.ID == "claude-code" {
			spec = s
			break
		}
	}

	t.Run("mise shim with registry tool name", func(t *testing.T) {
		shim := filepath.Join(localAppData, "mise", "shims", "claude.exe")
		active := auMiseToolMap{
			"claude": {{
				Version:          "2.1.303",
				RequestedVersion: "2.1.303",
				InstallPath:      filepath.Join(localAppData, "mise", "installs", "claude", "2.1.303"),
				Installed:        true,
				Active:           true,
			}},
		}
		res := auInspectAgent(spec, []string{shim}, auInspectDeps{
			Facts: auSystemFacts{
				MiseDataDir: filepath.Join(localAppData, "mise"),
				MiseShimDir: filepath.Join(localAppData, "mise", "shims"),
			},
			Active:           active,
			Installed:        active,
			ChannelAvailable: map[AgentUpdateChannel]bool{auChannelMise: true},
			MiseUpgradePlan:  func(string) (string, int) { return "2.1.400", 0 },
			Realpath:         func(p string) (string, error) { return p, nil },
			Options:          auCommandOptions{Bump: true, MinimumReleaseAge: "0"},
		})
		if res.Status != auStatusOutdated {
			t.Fatalf("status = %q, want outdated (note=%q)", res.Status, res.Note)
		}
		wantCmd := []string{"mise", "upgrade", "claude", "--bump", "--minimum-release-age", "0"}
		if !reflect.DeepEqual(res.Command, wantCmd) {
			t.Fatalf("command = %v, want %v", res.Command, wantCmd)
		}
	})

	t.Run("npm global shim", func(t *testing.T) {
		npmDir := filepath.Join(home, "AppData", "Roaming", "npm")
		shim := filepath.Join(npmDir, "claude.cmd")
		inst := auClassifyPath(shim, spec, auClassifyContext{
			Facts: auSystemFacts{
				NpmRoots: []string{
					filepath.Join(npmDir, "node_modules"),
					npmDir, // npm prefix -g
				},
			},
			Realpath: func(p string) (string, error) { return p, nil },
		})
		if inst.Channel != auChannelNpm {
			t.Fatalf("channel = %q, want npm", inst.Channel)
		}
	})
}
