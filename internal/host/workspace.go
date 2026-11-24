package host

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
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

// resolveWorkspacePath validates that relPath resolves to a regular file strictly inside root.
func resolveWorkspacePath(root, relPath string) (string, os.FileInfo, error) {
	dir := expandHome(strings.TrimSpace(root))
	if dir == "" {
		return "", nil, errors.New("未指定工作目录")
	}
	cleanRoot, err := filepath.Abs(filepath.Clean(dir))
	if err != nil {
		return "", nil, err
	}
	rel := filepath.FromSlash(strings.TrimPrefix(strings.TrimSpace(relPath), "/"))
	if rel == "" {
		return "", nil, errors.New("文件路径不能为空")
	}
	fullPath, err := filepath.Abs(filepath.Join(cleanRoot, rel))
	if err != nil {
		return "", nil, err
	}
	if fullPath != cleanRoot && !strings.HasPrefix(fullPath, cleanRoot+string(os.PathSeparator)) {
		return "", nil, errors.New("拒绝访问工作目录之外的文件")
	}
	info, err := os.Stat(fullPath)
	if err != nil {
		return "", nil, fmt.Errorf("无法读取文件：%w", err)
	}
	if info.IsDir() {
		return "", nil, errors.New("目标是一个目录")
	}
	return fullPath, info, nil
}

// workspaceMimeType returns an explicit MIME type for common previewable extensions.
func workspaceMimeType(relPath string) string {
	switch strings.ToLower(filepath.Ext(relPath)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".avif":
		return "image/avif"
	case ".ico":
		return "image/x-icon"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	case ".pdf":
		return "application/pdf"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".m4a":
		return "audio/mp4"
	case ".flac":
		return "audio/flac"
	case ".aac":
		return "audio/aac"
	case ".opus":
		return "audio/opus"
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".ogv":
		return "video/ogg"
	case ".md", ".markdown", ".mdx":
		return "text/markdown; charset=utf-8"
	default:
		if mt := mime.TypeByExtension(strings.ToLower(filepath.Ext(relPath))); mt != "" {
			return mt
		}
		return ""
	}
}

// serveWorkspaceFile streams a file strictly inside cwd using http.ServeContent,
// supporting HTTP Range requests (206 Partial Content) for smooth media playback.
func serveWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		httpError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	cwd := r.URL.Query().Get("cwd")
	relPath := r.URL.Query().Get("path")
	fullPath, info, err := resolveWorkspacePath(cwd, relPath)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		} else if strings.Contains(err.Error(), "拒绝访问") {
			status = http.StatusForbidden
		}
		httpError(w, status, err.Error())
		return
	}

	f, err := os.Open(fullPath)
	if err != nil {
		httpError(w, http.StatusInternalServerError, fmt.Sprintf("无法打开文件：%v", err))
		return
	}
	defer f.Close()

	ct := workspaceMimeType(relPath)
	if ct == "" {
		var sniff [512]byte
		n, _ := f.Read(sniff[:])
		if _, serr := f.Seek(0, io.SeekStart); serr == nil && n > 0 {
			ct = http.DetectContentType(sniff[:n])
		}
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-cache")
	if strings.HasPrefix(ct, "image/svg+xml") || strings.HasPrefix(ct, "text/html") {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'")
	}

	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// ensureFileServer lazily starts a loopback-only HTTP server for streaming workspace
// files in desktop mode (where the frontend communicates with Go via mygo RPC).
func (h *Host) ensureFileServer() (string, string, error) {
	h.fileSrvMu.Lock()
	defer h.fileSrvMu.Unlock()
	if h.fileSrv != nil {
		return h.fileSrvBaseURL, h.fileSrvToken, nil
	}

	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	token := hex.EncodeToString(b)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", "", fmt.Errorf("启动本地文件预览服务失败：%w", err)
	}

	mux := http.NewServeMux()
	handle := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Range")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		got := r.URL.Query().Get("token")
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			httpError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		serveWorkspaceFile(w, r)
	}
	mux.HandleFunc("GET /api/workspace/file", handle)
	mux.HandleFunc("OPTIONS /api/workspace/file", handle)

	srv := &http.Server{Handler: mux}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logf("workspace file server stopped: %v", err)
		}
	}()

	h.fileSrv = srv
	h.fileSrvBaseURL = "http://" + ln.Addr().String()
	h.fileSrvToken = token
	return h.fileSrvBaseURL, h.fileSrvToken, nil
}

func (h *Host) closeFileServer() {
	h.fileSrvMu.Lock()
	srv := h.fileSrv
	h.fileSrv = nil
	h.fileSrvBaseURL = ""
	h.fileSrvToken = ""
	h.fileSrvMu.Unlock()
	if srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}
}

func (h *Host) workspaceFileInfo(cwd, relPath string) (WorkspaceFileInfo, error) {
	_, info, err := resolveWorkspacePath(cwd, relPath)
	if err != nil {
		return WorkspaceFileInfo{}, err
	}
	mt := workspaceMimeType(relPath)
	if mt == "" {
		mt = "application/octet-stream"
	}
	modMs := info.ModTime().UnixMilli()
	q := url.Values{}
	q.Set("cwd", cwd)
	q.Set("path", relPath)
	q.Set("v", strconv.FormatInt(modMs, 10))

	var fileURL string
	if h.opts.Mode == "web" {
		fileURL = "api/workspace/file?" + q.Encode()
	} else {
		baseURL, token, err := h.ensureFileServer()
		if err != nil {
			return WorkspaceFileInfo{}, err
		}
		q.Set("token", token)
		fileURL = baseURL + "/api/workspace/file?" + q.Encode()
	}

	return WorkspaceFileInfo{
		URL:      fileURL,
		MimeType: mt,
		Size:     info.Size(),
		ModTime:  modMs,
	}, nil
}

// readWorkspaceFile reads a UTF-8 text file strictly inside root.
func readWorkspaceFile(root, relPath string) (string, error) {
	fullPath, info, err := resolveWorkspacePath(root, relPath)
	if err != nil {
		return "", err
	}
	if info.Size() > workspaceMaxBytes {
		return "", fmt.Errorf("文件过大（%.1f KB），暂不支持文本编辑（上限 512 KB）", float64(info.Size())/1024)
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
