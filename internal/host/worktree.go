package host

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// worktreesRoot returns the base directory where open-chat creates isolated
// git worktrees (~/.open-chat/worktrees).
func worktreesRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return "", errors.New("无法获取用户主目录")
	}
	return filepath.Join(home, ".open-chat", "worktrees"), nil
}

func shortWorktreeToken() string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return time.Now().Format("060102") + "-" + hex.EncodeToString(b)
}

func sanitizeWorktreeSegment(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-.")
	for strings.Contains(out, "--") {
		out = strings.ReplaceAll(out, "--", "-")
	}
	if out == "" {
		return "wt-" + shortWorktreeToken()
	}
	if len(out) > 64 {
		out = strings.TrimRight(out[:64], "-.")
	}
	return out
}

// resolveMainGitRepo returns the main repository root for dir (even when dir
// is a subdirectory or an existing linked worktree).
func (h *Host) resolveMainGitRepo(ctx context.Context, dir string) (string, error) {
	top, err := h.runGit(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil || top == "" {
		return "", errors.New("当前目录不是 Git 仓库，无法创建 Worktree")
	}
	commonDir, err := h.runGit(ctx, dir, "rev-parse", "--git-common-dir")
	if err == nil && commonDir != "" {
		if !filepath.IsAbs(commonDir) {
			commonDir = filepath.Join(dir, commonDir)
		}
		commonDir = filepath.Clean(commonDir)
		if filepath.Base(commonDir) == ".git" {
			parent := filepath.Dir(commonDir)
			if isDir(parent) {
				return parent, nil
			}
		}
	}
	return filepath.Clean(top), nil
}

func (h *Host) createWithWorktree(ctx context.Context, agentID, repoDir, baseBranch, branchName string) (Meta, error) {
	a, ok := h.agent(agentID)
	if !ok {
		return Meta{}, fmt.Errorf("未知的 agent：%s", agentID)
	}
	repoDir = expandHome(strings.TrimSpace(repoDir))
	if repoDir == "" || !isDir(repoDir) {
		return Meta{}, fmt.Errorf("工作目录不存在：%s", repoDir)
	}

	mainRepo, err := h.resolveMainGitRepo(ctx, repoDir)
	if err != nil {
		return Meta{}, err
	}

	baseRef := strings.TrimSpace(baseBranch)
	if baseRef == "" {
		if cur, berr := h.runGit(ctx, repoDir, "symbolic-ref", "--short", "HEAD"); berr == nil && cur != "" {
			baseRef = cur
		} else {
			baseRef = "HEAD"
		}
	}
	if strings.HasPrefix(baseRef, "-") {
		return Meta{}, errors.New("无效的基准分支名")
	}

	branch := strings.TrimSpace(branchName)
	if branch == "" {
		branch = "wt/" + shortWorktreeToken()
	} else {
		if strings.HasPrefix(branch, "-") {
			return Meta{}, errors.New("无效的分支名")
		}
		if _, err := h.runGit(ctx, mainRepo, "check-ref-format", "--branch", branch); err != nil {
			return Meta{}, fmt.Errorf("分支名格式无效：%s", branch)
		}
	}
	if _, err := h.runGit(ctx, mainRepo, "show-ref", "--verify", "--quiet", "refs/heads/"+branch); err == nil {
		return Meta{}, fmt.Errorf("分支 %s 已存在，请换一个分支名", branch)
	}

	wtBase, err := worktreesRoot()
	if err != nil {
		return Meta{}, err
	}
	repoSlug := sanitizeWorktreeSegment(filepath.Base(mainRepo))
	dirSlug := sanitizeWorktreeSegment(strings.TrimPrefix(branch, "wt/"))
	repoBucket := filepath.Join(wtBase, repoSlug)
	if err := os.MkdirAll(repoBucket, 0o755); err != nil {
		return Meta{}, fmt.Errorf("创建 Worktree 目录失败：%w", err)
	}

	wtPath := filepath.Join(repoBucket, dirSlug)
	if _, err := os.Stat(wtPath); err == nil {
		wtPath = filepath.Join(repoBucket, dirSlug+"-"+shortWorktreeToken())
	}

	// Prune stale metadata before creating a new worktree.
	_, _ = h.runGit(ctx, mainRepo, "worktree", "prune")
	if _, err := h.runGit(ctx, mainRepo, "worktree", "add", "-b", branch, wtPath, baseRef); err != nil {
		return Meta{}, fmt.Errorf("创建 Worktree 失败：%w", err)
	}

	t := now()
	m := Meta{
		ID:             newID(),
		Title:          "新对话",
		AgentID:        a.ID,
		AgentName:      a.Name,
		Cwd:            wtPath,
		Worktree:       true,
		WorktreeRepo:   mainRepo,
		WorktreeBranch: branch,
		CreatedAt:      t,
		UpdatedAt:      t,
		Status:         "idle",
	}
	h.store.create(m)
	// Remember the source repository (not the ephemeral worktree path) in RecentDirs.
	h.rememberDir(mainRepo, a.ID)
	h.pushMeta(m)
	return m, nil
}

func (h *Host) worktreeStatus(ctx context.Context, id string) (WorktreeStatus, error) {
	m, ok := h.store.meta(id)
	if !ok {
		return WorktreeStatus{}, errors.New("对话不存在")
	}
	if !m.Worktree {
		return WorktreeStatus{}, nil
	}
	if !isDir(m.Cwd) {
		return WorktreeStatus{Exists: false, Branch: m.WorktreeBranch}, nil
	}
	branch := m.WorktreeBranch
	if cur, err := h.runGit(ctx, m.Cwd, "symbolic-ref", "--short", "HEAD"); err == nil && cur != "" {
		branch = cur
	}
	out, err := h.runGit(ctx, m.Cwd, "status", "--porcelain")
	if err != nil {
		return WorktreeStatus{Exists: true, Branch: branch}, nil
	}
	changed := 0
	if out != "" {
		for _, line := range strings.Split(out, "\n") {
			if strings.TrimSpace(line) != "" {
				changed++
			}
		}
	}
	return WorktreeStatus{
		Exists:       true,
		Dirty:        changed > 0,
		ChangedCount: changed,
		Branch:       branch,
	}, nil
}

func (h *Host) closeConversationHandles(id, cwd string) {
	h.liveMu.Lock()
	_, wasLive := h.lives[id]
	delete(h.lives, id)
	h.liveMu.Unlock()
	if wasLive {
		if sc, err := h.sidecar(); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = sc.call(ctx, "close", map[string]any{"key": id}, nil)
			cancel()
		}
	}
	if cwd == "" {
		return
	}
	cleanCwd := filepath.Clean(cwd)
	h.termMu.Lock()
	var toClose []string
	for tid, term := range h.terms {
		if filepath.Clean(term.cwd) == cleanCwd {
			toClose = append(toClose, tid)
		}
	}
	h.termMu.Unlock()
	for _, tid := range toClose {
		_ = h.termClose(tid)
	}
}

func (h *Host) removeWorktree(ctx context.Context, id string, force, deleteBranch bool) error {
	m, ok := h.store.meta(id)
	if !ok {
		return errors.New("对话不存在")
	}
	if !m.Worktree {
		return nil
	}
	if isDir(m.Cwd) && !force {
		st, err := h.worktreeStatus(ctx, id)
		if err == nil && st.Dirty {
			return fmt.Errorf("Worktree 有 %d 处未提交更改，请先提交或勾选强制清理", st.ChangedCount)
		}
	}

	h.closeConversationHandles(id, m.Cwd)

	repo := m.WorktreeRepo
	if repo == "" && isDir(m.Cwd) {
		repo, _ = h.resolveMainGitRepo(ctx, m.Cwd)
	}

	if repo != "" && isDir(repo) {
		if isDir(m.Cwd) {
			args := []string{"worktree", "remove"}
			if force {
				args = append(args, "--force")
			}
			args = append(args, m.Cwd)
			if _, err := h.runGit(ctx, repo, args...); err != nil {
				if !force {
					return fmt.Errorf("移除 Worktree 失败：%w", err)
				}
				_ = os.RemoveAll(m.Cwd)
			}
		}
		_, _ = h.runGit(ctx, repo, "worktree", "prune")
		if deleteBranch && m.WorktreeBranch != "" {
			flag := "-d"
			if force {
				flag = "-D"
			}
			_, _ = h.runGit(ctx, repo, "branch", flag, m.WorktreeBranch)
		}
	} else if isDir(m.Cwd) {
		if err := os.RemoveAll(m.Cwd); err != nil {
			return fmt.Errorf("清理目录失败：%w", err)
		}
	}

	// Keep the conversation valid if the user cleaned up the worktree without deleting the chat.
	if updated, ok := h.store.update(id, func(mm *Meta) {
		if repo != "" && isDir(repo) {
			mm.Cwd = repo
		}
		mm.Worktree = false
		mm.WorktreeRepo = ""
		mm.WorktreeBranch = ""
	}); ok {
		h.pushMeta(updated)
		h.pushLive(id)
	}
	return nil
}
