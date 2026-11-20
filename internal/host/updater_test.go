package host

import (
	"reflect"
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
