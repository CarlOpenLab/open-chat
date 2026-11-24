package host

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"reflect"
	"strings"
	"sync"
	"time"
)

// Hub fans pushes out to the pages connected over HTTP (web mode).
type Hub struct {
	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

func NewHub() *Hub { return &Hub{subs: map[chan []byte]struct{}{}} }

// Push sends p to every connected page.
func (h *Hub) Push(p Push) {
	b, err := json.Marshal(p)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- b:
		default:
			// A page that can't keep up is dropped; it reconnects and reloads.
			close(ch)
			delete(h.subs, ch)
		}
	}
}

func (h *Hub) subscribe() chan []byte {
	ch := make(chan []byte, 1024)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *Hub) unsubscribe(ch chan []byte) {
	h.mu.Lock()
	if _, ok := h.subs[ch]; ok {
		delete(h.subs, ch)
		close(ch)
	}
	h.mu.Unlock()
}

// Handler serves the frontend and the API over HTTP: POST /api/call/<Method>
// with a JSON array of arguments, and GET /api/push, a stream of pushes
// (server-sent events). When token isn't empty every request must carry it,
// as ?token= once (which sets a cookie) or as a bearer token.
func Handler(api *API, hub *Hub, frontend fs.FS, token string) http.Handler {
	mux := http.NewServeMux()
	calls := methodTable(api)

	mux.HandleFunc("POST /api/call/{method}", func(w http.ResponseWriter, r *http.Request) {
		m, ok := calls[r.PathValue("method")]
		if !ok {
			httpError(w, http.StatusNotFound, "no such method")
			return
		}
		var args []json.RawMessage
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20)).Decode(&args); err != nil {
			httpError(w, http.StatusBadRequest, "body must be a JSON array of arguments")
			return
		}
		out, err := m.call(r.Context(), args)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": out})
	})

	mux.HandleFunc("GET /api/workspace/file", serveWorkspaceFile)

	mux.HandleFunc("GET /api/push", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			httpError(w, http.StatusInternalServerError, "streaming unsupported")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		ch := hub.subscribe()
		defer hub.unsubscribe(ch)
		_, _ = fmt.Fprint(w, ": hello\n\n")
		flusher.Flush()
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case b, ok := <-ch:
				if !ok {
					return
				}
				_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
				flusher.Flush()
			case <-tick.C:
				_, _ = fmt.Fprint(w, ": ping\n\n")
				flusher.Flush()
			}
		}
	})

	files := http.FileServerFS(frontend)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(frontend, p); err != nil {
			// Client-side routes fall back to the page.
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})

	if token == "" {
		return mux
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if q := r.URL.Query().Get("token"); q != "" && subtle.ConstantTimeCompare([]byte(q), []byte(token)) == 1 {
			http.SetCookie(w, &http.Cookie{Name: "oc_token", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 30 * 24 * 3600})
			u := *r.URL
			qs := u.Query()
			qs.Del("token")
			u.RawQuery = qs.Encode()
			http.Redirect(w, r, u.RequestURI(), http.StatusFound)
			return
		}
		got := ""
		if c, err := r.Cookie("oc_token"); err == nil {
			got = c.Value
		}
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			got = strings.TrimPrefix(auth, "Bearer ")
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = fmt.Fprint(w, unauthorizedPage)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

const unauthorizedPage = `<!doctype html><meta charset="utf-8"><title>open-chat</title>
<style>body{font:15px/1.6 system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#444;background:#fafaf9}
code{background:#eee;padding:2px 6px;border-radius:4px}</style>
<div><h2>需要访问令牌</h2><p>用 <code>open-chat serve</code> 启动时打印的链接打开（带 <code>?token=</code>）。</p></div>`

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

type method struct {
	fn      reflect.Value
	params  []reflect.Type
	withCtx bool
}

var ctxType = reflect.TypeFor[context.Context]()
var errType = reflect.TypeFor[error]()

func methodTable(v any) map[string]method {
	out := map[string]method{}
	rv := reflect.ValueOf(v)
	rt := rv.Type()
	for i := 0; i < rt.NumMethod(); i++ {
		m := rt.Method(i)
		fn := rv.Method(i)
		ft := fn.Type()
		mm := method{fn: fn}
		for j := 0; j < ft.NumIn(); j++ {
			in := ft.In(j)
			if j == 0 && in == ctxType {
				mm.withCtx = true
				continue
			}
			mm.params = append(mm.params, in)
		}
		out[m.Name] = mm
	}
	return out
}

func (m method) call(ctx context.Context, raw []json.RawMessage) (any, error) {
	if len(raw) > len(m.params) {
		return nil, fmt.Errorf("too many arguments")
	}
	in := []reflect.Value{}
	if m.withCtx {
		in = append(in, reflect.ValueOf(ctx))
	}
	for i, t := range m.params {
		p := reflect.New(t)
		if i < len(raw) && len(raw[i]) > 0 {
			if err := json.Unmarshal(raw[i], p.Interface()); err != nil {
				return nil, fmt.Errorf("argument %d: %w", i+1, err)
			}
		}
		in = append(in, p.Elem())
	}
	out := m.fn.Call(in)
	var result any
	for _, o := range out {
		if o.Type() == errType {
			if !o.IsNil() {
				return nil, o.Interface().(error)
			}
			continue
		}
		result = o.Interface()
	}
	return result, nil
}