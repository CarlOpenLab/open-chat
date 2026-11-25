package host

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
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

// copyWorktreeIncludes copies local ignored files declared in <mainRepo>/.worktreeinclude
// (following Claude Code / Codex convention) into the newly created worktree.
func copyWorktreeIncludes(mainRepo, wtPath string) []string {
	incFile := filepath.Join(mainRepo, ".worktreeinclude")
	f, err := os.Open(incFile)
	if err != nil {
		return nil
	}
	defer f.Close()

	cleanRepo, err := filepath.Abs(filepath.Clean(mainRepo))
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var copied []string

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(filepath.ToSlash(line), "/")
		if strings.Contains(line, "..") || strings.HasPrefix(line, ".git/") || line == ".git" {
			continue
		}
		pattern := filepath.Join(cleanRepo, filepath.FromSlash(line))
		matches, err := filepath.Glob(pattern)
		if err != nil || len(matches) == 0 {
			continue
		}
		for _, src := range matches {
			absSrc, err := filepath.Abs(src)
			if err != nil || !strings.HasPrefix(absSrc, cleanRepo+string(os.PathSeparator)) {
				continue
			}
			rel, err := filepath.Rel(cleanRepo, absSrc)
			if err != nil || strings.HasPrefix(rel, "..") {
				continue
			}
			slashRel := filepath.ToSlash(rel)
			if seen[slashRel] {
				continue
			}
			st, err := os.Stat(absSrc)
			if err != nil || st.IsDir() || st.Size() > 16<<20 {
				continue
			}
			dst := filepath.Join(wtPath, rel)
			if _, err := os.Lstat(dst); err == nil {
				continue
			}
			if err := copySingleFile(absSrc, dst, st.Mode().Perm()); err == nil {
				seen[slashRel] = true
				copied = append(copied, slashRel)
			}
		}
	}
	return copied
}

func copySingleFile(src, dst string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(dst)
	}
	return err
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

	copied := copyWorktreeIncludes(mainRepo, wtPath)

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
		WorktreeBase:   baseRef,
		CreatedAt:      t,
		UpdatedAt:      t,
		Status:         "idle",
	}
	h.store.create(m)
	// Remember the source repository (not the ephemeral worktree path) in RecentDirs.
	h.rememberDir(mainRepo, a.ID)
	h.pushMeta(m)
	if len(copied) > 0 {
		preview := strings.Join(copied, "、")
		if len(copied) > 4 {
			preview = strings.Join(copied[:4], "、") + fmt.Sprintf(" 等 %d 个文件", len(copied))
		}
		h.emit(m.ID, Event{"type": "notice", "level": "info", "text": "已按 .worktreeinclude 同步本地文件：" + preview, "t": now()})
	}
	return m, nil
}

// attachWorktree creates a new conversation attached to an existing linked git worktree.
func (h *Host) attachWorktree(ctx context.Context, agentID, wtPath string) (Meta, error) {
	a, ok := h.agent(agentID)
	if !ok {
		return Meta{}, fmt.Errorf("未知的 agent：%s", agentID)
	}
	wtPath = expandHome(strings.TrimSpace(wtPath))
	if wtPath == "" || !isDir(wtPath) {
		return Meta{}, fmt.Errorf("Worktree 目录不存在：%s", wtPath)
	}
	mainRepo, err := h.resolveMainGitRepo(ctx, wtPath)
	if err != nil {
		return Meta{}, err
	}
	branch, _ := h.runGit(ctx, wtPath, "symbolic-ref", "--short", "HEAD")
	baseBranch, _ := h.runGit(ctx, mainRepo, "symbolic-ref", "--short", "HEAD")

	t := now()
	m := Meta{
		ID:             newID(),
		Title:          "新对话",
		AgentID:        a.ID,
		AgentName:      a.Name,
		Cwd:            filepath.Clean(wtPath),
		Worktree:       true,
		WorktreeRepo:   mainRepo,
		WorktreeBranch: branch,
		WorktreeBase:   baseBranch,
		CreatedAt:      t,
		UpdatedAt:      t,
		Status:         "idle",
	}
	h.store.create(m)
	h.rememberDir(mainRepo, a.ID)
	h.pushMeta(m)
	return m, nil
}

func (h *Host) listWorktrees(ctx context.Context, repoDir string) ([]WorktreeInfo, error) {
	repoDir = expandHome(strings.TrimSpace(repoDir))
	if repoDir == "" || !isDir(repoDir) {
		return []WorktreeInfo{}, nil
	}
	mainRepo, err := h.resolveMainGitRepo(ctx, repoDir)
	if err != nil {
		return []WorktreeInfo{}, nil
	}
	out, err := h.runGit(ctx, mainRepo, "worktree", "list", "--porcelain")
	if err != nil || out == "" {
		return []WorktreeInfo{}, nil
	}
	evalMain := filepath.Clean(mainRepo)
	if r, rerr := filepath.EvalSymlinks(evalMain); rerr == nil {
		evalMain = r
	}

	var list []WorktreeInfo
	var cur *WorktreeInfo
	flush := func() {
		if cur == nil || cur.Path == "" || !isDir(cur.Path) {
			cur = nil
			return
		}
		evalPath := filepath.Clean(cur.Path)
		if r, rerr := filepath.EvalSymlinks(evalPath); rerr == nil {
			evalPath = r
		}
		cur.IsMain = evalPath == evalMain
		if !cur.IsMain {
			files := h.parsePorcelainFiles(ctx, cur.Path)
			cur.ChangedCount = len(files)
			cur.Dirty = len(files) > 0
			list = append(list, *cur)
		}
		cur = nil
	}

	for _, rawLine := range strings.Split(out, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			flush()
			continue
		}
		if after, ok := strings.CutPrefix(line, "worktree "); ok {
			flush()
			cur = &WorktreeInfo{Path: strings.TrimSpace(after)}
		} else if cur != nil {
			if after, ok := strings.CutPrefix(line, "branch "); ok {
				cur.Branch = strings.TrimPrefix(strings.TrimSpace(after), "refs/heads/")
			} else if line == "detached" {
				cur.Branch = "HEAD"
			}
		}
	}
	flush()
	if list == nil {
		list = []WorktreeInfo{}
	}
	return list, nil
}

func (h *Host) parsePorcelainFiles(ctx context.Context, dir string) []WorktreeFileChange {
	out, err := h.runGit(ctx, dir, "status", "--porcelain")
	if err != nil || out == "" {
		return []WorktreeFileChange{}
	}
	files := []WorktreeFileChange{}
	for _, line := range strings.Split(out, "\n") {
		if len(line) < 4 {
			continue
		}
		x, y := line[0], line[1]
		p := strings.TrimSpace(line[3:])
		if idx := strings.Index(p, " -> "); idx >= 0 {
			p = p[idx+4:]
		}
		st := "M"
		switch {
		case x == '?' && y == '?':
			st = "?"
		case x == 'A' || y == 'A':
			st = "A"
		case x == 'D' || y == 'D':
			st = "D"
		case x == 'R' || y == 'R':
			st = "R"
		}
		files = append(files, WorktreeFileChange{Path: p, Status: st})
	}
	return files
}

func (h *Host) worktreeStatus(ctx context.Context, id string) (WorktreeStatus, error) {
	m, ok := h.store.meta(id)
	if !ok {
		return WorktreeStatus{}, errors.New("对话不存在")
	}
	if !m.Worktree {
		return WorktreeStatus{}, nil
	}
	baseBranch := m.WorktreeBase
	if baseBranch == "" && m.WorktreeRepo != "" && isDir(m.WorktreeRepo) {
		baseBranch, _ = h.runGit(ctx, m.WorktreeRepo, "symbolic-ref", "--short", "HEAD")
	}
	if !isDir(m.Cwd) {
		return WorktreeStatus{
			Exists:       false,
			Branch:       m.WorktreeBranch,
			BaseBranch:   baseBranch,
			ChangedFiles: []WorktreeFileChange{},
		}, nil
	}
	branch := m.WorktreeBranch
	if cur, err := h.runGit(ctx, m.Cwd, "symbolic-ref", "--short", "HEAD"); err == nil && cur != "" {
		branch = cur
	}
	files := h.parsePorcelainFiles(ctx, m.Cwd)
	ahead := 0
	if baseBranch != "" {
		if cntStr, err := h.runGit(ctx, m.Cwd, "rev-list", "--count", baseBranch+"..HEAD"); err == nil {
			if n, perr := strconv.Atoi(strings.TrimSpace(cntStr)); perr == nil {
				ahead = n
			}
		}
	}
	return WorktreeStatus{
		Exists:       true,
		Dirty:        len(files) > 0,
		ChangedCount: len(files),
		AheadCount:   ahead,
		Branch:       branch,
		BaseBranch:   baseBranch,
		ChangedFiles: files,
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

// mergeWorktree merges a worktree conversation's changes back into its base branch
// in the source repository (supporting "merge" and "squash" strategies), and
// optionally removes the worktree and temporary branch afterward.
func (h *Host) mergeWorktree(ctx context.Context, id, strategy, commitMsg string, cleanup bool) error {
	m, ok := h.store.meta(id)
	if !ok {
		return errors.New("对话不存在")
	}
	if !m.Worktree {
		return errors.New("当前对话不是 Worktree 会话")
	}
	if !isDir(m.Cwd) {
		return errors.New("Worktree 目录已不存在")
	}
	repo := m.WorktreeRepo
	if repo == "" {
		var err error
		repo, err = h.resolveMainGitRepo(ctx, m.Cwd)
		if err != nil {
			return err
		}
	}
	if !isDir(repo) {
		return fmt.Errorf("源仓库目录不存在：%s", repo)
	}

	wtBranch := m.WorktreeBranch
	if cur, err := h.runGit(ctx, m.Cwd, "symbolic-ref", "--short", "HEAD"); err == nil && cur != "" {
		wtBranch = cur
	}
	if wtBranch == "" {
		return errors.New("当前 Worktree 处于游离 HEAD，无法自动合入")
	}
	baseBranch := m.WorktreeBase
	if baseBranch == "" {
		baseBranch, _ = h.runGit(ctx, repo, "symbolic-ref", "--short", "HEAD")
	}
	if baseBranch == "" {
		return errors.New("无法确定源仓库基准分支")
	}
	if baseBranch == wtBranch {
		return errors.New("Worktree 分支与基准分支相同，无需合入")
	}

	// Step 1: If worktree has uncommitted changes, commit them first.
	wtFiles := h.parsePorcelainFiles(ctx, m.Cwd)
	msg := strings.TrimSpace(commitMsg)
	if len(wtFiles) > 0 {
		if msg == "" {
			msg = fmt.Sprintf("feat: %s", oneLine(m.Title, 50))
		}
		if _, err := h.runGit(ctx, m.Cwd, "add", "-A"); err != nil {
			return fmt.Errorf("暂存 Worktree 更改失败：%w", err)
		}
		if _, err := h.runGit(ctx, m.Cwd, "commit", "-m", msg); err != nil {
			return fmt.Errorf("提交 Worktree 更改失败：%w", err)
		}
	}

	// Verify there is actually something ahead to merge.
	cntStr, err := h.runGit(ctx, repo, "rev-list", "--count", baseBranch+".."+wtBranch)
	if err == nil {
		if n, perr := strconv.Atoi(strings.TrimSpace(cntStr)); perr == nil && n == 0 {
			return fmt.Errorf("分支 %s 相对 %s 没有新的提交", wtBranch, baseBranch)
		}
	}

	// Step 2: Refuse to merge if main repo has uncommitted changes.
	if repoFiles := h.parsePorcelainFiles(ctx, repo); len(repoFiles) > 0 {
		return fmt.Errorf("源仓库有 %d 处未提交更改，请先提交或暂存后再合入", len(repoFiles))
	}

	// Step 3: Ensure source repo is on baseBranch.
	curRepoBranch, _ := h.runGit(ctx, repo, "symbolic-ref", "--short", "HEAD")
	if curRepoBranch != baseBranch {
		if _, err := h.runGit(ctx, repo, "checkout", baseBranch); err != nil {
			return fmt.Errorf("切换源仓库到基准分支 %s 失败：%w", baseBranch, err)
		}
	}

	// Step 4: Merge or Squash into baseBranch, aborting cleanly on conflict.
	if strings.EqualFold(strategy, "squash") {
		if _, err := h.runGit(ctx, repo, "merge", "--squash", wtBranch); err != nil {
			_, _ = h.runGit(ctx, repo, "reset", "--merge")
			return fmt.Errorf("压缩合入发生冲突（已回滚源仓库）：%w", err)
		}
		if msg == "" {
			msg = fmt.Sprintf("feat: %s (%s)", oneLine(m.Title, 50), wtBranch)
		}
		if _, err := h.runGit(ctx, repo, "commit", "-m", msg); err != nil {
			_, _ = h.runGit(ctx, repo, "reset", "--merge")
			return fmt.Errorf("提交压缩合入失败：%w", err)
		}
	} else {
		if _, err := h.runGit(ctx, repo, "merge", "--no-ff", wtBranch, "-m", fmt.Sprintf("Merge branch '%s' into %s", wtBranch, baseBranch)); err != nil {
			_, _ = h.runGit(ctx, repo, "merge", "--abort")
			return fmt.Errorf("合并发生冲突（已中止合并）：%w", err)
		}
	}

	if cleanup {
		// Squash commits aren't reachable via branch ancestry, so force-delete the branch after successful merge.
		forceBranch := strings.EqualFold(strategy, "squash")
		_ = h.removeWorktree(ctx, id, forceBranch, true)
	}
	return nil
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
		mm.WorktreeBase = ""
	}); ok {
		h.pushMeta(updated)
		h.pushLive(id)
	}
	return nil
}
