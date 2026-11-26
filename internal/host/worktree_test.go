package host

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func setupTestGitRepo(t *testing.T) (*Host, string) {
	t.Helper()
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
	if err := os.WriteFile(filepath.Join(repoDir, ".gitignore"), []byte(".env.local\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoDir, ".worktreeinclude"), []byte(".env.local\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("# demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", ".gitignore", ".worktreeinclude", "README.md")
	run("commit", "-m", "init")
	if err := os.WriteFile(filepath.Join(repoDir, ".env.local"), []byte("TOKEN=123\n"), 0o644); err != nil {
		t.Fatal(err)
	}

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
	return h, repoDir
}

func TestWorktreeLifecycleAndInclude(t *testing.T) {
	h, repoDir := setupTestGitRepo(t)
	ctx := context.Background()

	m, err := h.createWithWorktree(ctx, "codebuddy", repoDir, "main", "wt/test-feature")
	if err != nil {
		t.Fatalf("createWithWorktree failed: %v", err)
	}
	if !m.Worktree || m.WorktreeBranch != "wt/test-feature" || m.WorktreeBase != "main" {
		t.Fatalf("unexpected worktree meta: %+v", m)
	}
	// .worktreeinclude should have copied .env.local into the new worktree.
	if b, err := os.ReadFile(filepath.Join(m.Cwd, ".env.local")); err != nil || string(b) != "TOKEN=123\n" {
		t.Fatalf("expected .env.local to be copied via .worktreeinclude, err=%v got=%q", err, string(b))
	}

	// ListWorktrees should report this linked worktree.
	list, err := h.listWorktrees(ctx, repoDir)
	if err != nil || len(list) != 1 || list[0].Branch != "wt/test-feature" {
		t.Fatalf("listWorktrees = %+v, err=%v", list, err)
	}

	// Make dirty -> non-force removal should be blocked.
	if err := os.WriteFile(filepath.Join(m.Cwd, "dirty.txt"), []byte("wip\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ws, err := h.worktreeStatus(ctx, m.ID)
	if err != nil || !ws.Dirty || ws.ChangedCount != 1 || len(ws.ChangedFiles) != 1 {
		t.Fatalf("expected dirty worktree with 1 change, got ws=%+v err=%v", ws, err)
	}
	if err := h.removeWorktree(ctx, m.ID, false, true); err == nil {
		t.Fatalf("expected non-force removal of dirty worktree to fail")
	}

	// Squash merge back to main with automatic cleanup.
	if err := h.mergeWorktree(ctx, m.ID, "squash", "feat: add dirty.txt", true); err != nil {
		t.Fatalf("mergeWorktree squash failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repoDir, "dirty.txt")); err != nil {
		t.Fatalf("expected merged file in source repo: %v", err)
	}
	if isDir(m.Cwd) {
		t.Fatalf("expected worktree dir to be cleaned up after merge: %s", m.Cwd)
	}
}

func TestRemoveWorktreeByPath(t *testing.T) {
	h, repoDir := setupTestGitRepo(t)
	ctx := context.Background()

	// Create a worktree, delete the conversation directly (leaving an orphan), then remove by path.
	m, err := h.createWithWorktree(ctx, "codebuddy", repoDir, "main", "wt/orphan-demo")
	if err != nil {
		t.Fatalf("createWithWorktree failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(m.Cwd, "temp.txt"), []byte("discard me\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.remove(m.ID)
	if err := h.removeWorktreeByPath(ctx, m.Cwd, true); err != nil {
		t.Fatalf("removeWorktreeByPath failed: %v", err)
	}
	if isDir(m.Cwd) {
		t.Fatalf("expected orphan worktree dir removed: %s", m.Cwd)
	}
	list, err := h.listWorktrees(ctx, repoDir)
	if err != nil || len(list) != 0 {
		t.Fatalf("expected 0 worktrees left, got %+v err=%v", list, err)
	}
}
