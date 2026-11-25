package host

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestWorktreeLifecycle(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)

	repoDir := filepath.Join(t.TempDir(), "sample-repo")
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repoDir}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v\n%s", args, err, string(out))
		}
	}
	run("init", "-b", "main")
	run("config", "user.name", "Test")
	run("config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("# demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "README.md")
	run("commit", "-m", "init")

	dataDir := t.TempDir()
	st, err := openStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	h := &Host{
		opts:      Options{DataDir: dataDir, Push: func(Push) {}},
		store:     st,
		envLoaded: true,
		env:       os.Environ(),
		presets: []preset{
			{ID: "codebuddy", Name: "CodeBuddy", Command: "codebuddy", Probe: "codebuddy"},
		},
		lives: map[string]*live{},
		terms: map[string]*termSession{},
	}

	ctx := context.Background()
	m, err := h.createWithWorktree(ctx, "codebuddy", repoDir, "main", "wt/test-feature")
	if err != nil {
		t.Fatalf("createWithWorktree failed: %v", err)
	}
	if !m.Worktree || m.WorktreeBranch != "wt/test-feature" || m.WorktreeRepo == "" {
		t.Fatalf("unexpected worktree meta: %+v", m)
	}
	if !isDir(m.Cwd) {
		t.Fatalf("expected worktree dir to exist: %s", m.Cwd)
	}
	if len(h.settings.RecentDirs) == 0 || h.settings.RecentDirs[0] != m.WorktreeRepo {
		t.Fatalf("expected RecentDirs[0] to be source repo %s, got %v", m.WorktreeRepo, h.settings.RecentDirs)
	}

	// Clean status
	ws, err := h.worktreeStatus(ctx, m.ID)
	if err != nil || !ws.Exists || ws.Dirty {
		t.Fatalf("expected clean existing worktree, got ws=%+v err=%v", ws, err)
	}

	// Make dirty -> non-force removal should be blocked
	if err := os.WriteFile(filepath.Join(m.Cwd, "dirty.txt"), []byte("wip\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ws, err = h.worktreeStatus(ctx, m.ID)
	if err != nil || !ws.Dirty || ws.ChangedCount != 1 {
		t.Fatalf("expected dirty worktree with 1 change, got ws=%+v err=%v", ws, err)
	}
	if err := h.removeWorktree(ctx, m.ID, false, true); err == nil {
		t.Fatalf("expected non-force removal of dirty worktree to fail")
	}

	// Force removal + branch cleanup
	if err := h.removeWorktree(ctx, m.ID, true, true); err != nil {
		t.Fatalf("force removeWorktree failed: %v", err)
	}
	if isDir(m.Cwd) {
		t.Fatalf("expected worktree dir to be removed: %s", m.Cwd)
	}
	if _, err := h.runGit(ctx, repoDir, "show-ref", "--verify", "--quiet", "refs/heads/wt/test-feature"); err == nil {
		t.Fatalf("expected branch wt/test-feature to be deleted")
	}
}
