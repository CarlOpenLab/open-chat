package host

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	workspaceMaxDepth   = 6
	workspaceMaxEntries = 2500
	workspaceMaxBytes   = 512 * 1024
)

var workspaceSkipDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"dist":         true,
	"build":        true,
	".next":        true,
	".nuxt":        true,
	".turbo":       true,
	".cache":       true,
	".venv":        true,
	"venv":         true,
	"__pycache__":  true,
	"target":       true,
	"vendor":       true,
	".idea":        true,
}

// listWorkspaceTree scans root into a tree compatible with @antdv-next/x Folder.
func listWorkspaceTree(root string) ([]WorkspaceNode, error) {
	dir := expandHome(strings.TrimSpace(root))
	if dir == "" {
		return []WorkspaceNode{}, nil
	}
	dir = filepath.Clean(dir)
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return nil, fmt.Errorf("工作目录不存在：%s", dir)
	}
	remaining := workspaceMaxEntries
	nodes := scanWorkspaceDir(dir, 0, &remaining)
	if nodes == nil {
		return []WorkspaceNode{}, nil
	}
	return nodes, nil
}

func scanWorkspaceDir(dir string, depth int, remaining *int) []WorkspaceNode {
	if depth >= workspaceMaxDepth || *remaining <= 0 {
		return []WorkspaceNode{}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []WorkspaceNode{}
	}
	type item struct {
		name  string
		isDir bool
	}
	items := make([]item, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if name == ".DS_Store" || name == "Thumbs.db" {
			continue
		}
		isDir := e.IsDir()
		if isDir && workspaceSkipDirs[name] {
			continue
		}
		items = append(items, item{name: name, isDir: isDir})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].isDir != items[j].isDir {
			return items[i].isDir
		}
		return strings.ToLower(items[i].name) < strings.ToLower(items[j].name)
	})

	out := make([]WorkspaceNode, 0, len(items))
	for _, it := range items {
		if *remaining <= 0 {
			break
		}
		*remaining--
		node := WorkspaceNode{
			Title: it.name,
			Path:  it.name,
		}
		if it.isDir {
			node.Children = scanWorkspaceDir(filepath.Join(dir, it.name), depth+1, remaining)
		}
		out = append(out, node)
	}
	return out
}

// readWorkspaceFile reads a UTF-8 text file strictly inside root.
func readWorkspaceFile(root, relPath string) (string, error) {
	dir := expandHome(strings.TrimSpace(root))
	if dir == "" {
		return "", errors.New("未指定工作目录")
	}
	cleanRoot, err := filepath.Abs(filepath.Clean(dir))
	if err != nil {
		return "", err
	}
	rel := filepath.FromSlash(strings.TrimPrefix(strings.TrimSpace(relPath), "/"))
	if rel == "" {
		return "", errors.New("文件路径不能为空")
	}
	fullPath, err := filepath.Abs(filepath.Join(cleanRoot, rel))
	if err != nil {
		return "", err
	}
	if fullPath != cleanRoot && !strings.HasPrefix(fullPath, cleanRoot+string(os.PathSeparator)) {
		return "", errors.New("拒绝访问工作目录之外的文件")
	}
	info, err := os.Stat(fullPath)
	if err != nil {
		return "", fmt.Errorf("无法读取文件：%w", err)
	}
	if info.IsDir() {
		return "", errors.New("目标是一个目录")
	}
	if info.Size() > workspaceMaxBytes {
		return "", fmt.Errorf("文件过大（%.1f KB），暂不支持预览（上限 512 KB）", float64(info.Size())/1024)
	}
	b, err := os.ReadFile(fullPath)
	if err != nil {
		return "", err
	}
	sample := b
	if len(sample) > 8192 {
		sample = sample[:8192]
	}
	if bytes.IndexByte(sample, 0) >= 0 || !utf8.Valid(b) {
		return "", errors.New("二进制文件暂不支持文本预览")
	}
	return string(b), nil
}

// writeWorkspaceFile atomically writes UTF-8 text content strictly inside root.
func writeWorkspaceFile(root, relPath, content string) error {
	dir := expandHome(strings.TrimSpace(root))
	if dir == "" {
		return errors.New("未指定工作目录")
	}
	cleanRoot, err := filepath.Abs(filepath.Clean(dir))
	if err != nil {
		return err
	}
	rel := filepath.FromSlash(strings.TrimPrefix(strings.TrimSpace(relPath), "/"))
	if rel == "" {
		return errors.New("文件路径不能为空")
	}
	fullPath, err := filepath.Abs(filepath.Join(cleanRoot, rel))
	if err != nil {
		return err
	}
	if fullPath != cleanRoot && !strings.HasPrefix(fullPath, cleanRoot+string(os.PathSeparator)) {
		return errors.New("拒绝写入工作目录之外的文件")
	}
	if len(content) > workspaceMaxBytes*2 {
		return errors.New("文件内容过大，超出单次写入上限（1 MB）")
	}
	if !utf8.ValidString(content) {
		return errors.New("仅支持保存 UTF-8 文本文件")
	}
	mode := os.FileMode(0o644)
	if info, err := os.Stat(fullPath); err == nil {
		if info.IsDir() {
			return errors.New("目标是一个目录，无法写入")
		}
		mode = info.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(fullPath), ".open-chat-save-*")
	if err != nil {
		return os.WriteFile(fullPath, []byte(content), mode)
	}
	tmpName := tmp.Name()
	if _, err := tmp.WriteString(content); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, fullPath); err != nil {
		_ = os.Remove(tmpName)
		return os.WriteFile(fullPath, []byte(content), mode)
	}
	return nil
}
