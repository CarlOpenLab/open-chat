// open-chat: a desktop workbench for the coding agents on your machine.
//
//	open-chat                 the desktop app (mygo window + webview)
//	open-chat serve [flags]   no window: serve the same UI over HTTP
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"

	"github.com/CarlOpenLab/open-chat/internal/host"
	"github.com/CarlOpenLab/open-chat/internal/sidecar"
	"github.com/CarlOpenLab/open-chat/internal/webdist"
)

// PushEvent carries every update of the host to the pages.
var PushEvent = mygo.NewEvent[host.Push]("push")

// appVersion is the version the page shows. `mygo build` links the version
// of mygo.config.ts into mygo's package info; a plain `go run` has none.
func appVersion() string {
	if v := mygo.App.Version(); v != "" {
		return v
	}
	return "dev"
}

func dataDirs() (data, cache string) {
	if d := os.Getenv("OPEN_CHAT_DATA"); d != "" {
		return d, filepath.Join(d, "cache")
	}
	cfg, err := os.UserConfigDir()
	if err != nil {
		cfg = os.TempDir()
	}
	c, err := os.UserCacheDir()
	if err != nil {
		c = os.TempDir()
	}
	return filepath.Join(cfg, "open-chat"), filepath.Join(c, "open-chat")
}

func demoEnabled() bool {
	return os.Getenv("OPEN_CHAT_DEMO") == "1" || mygo.IsDev()
}

func main() {
	// `mygo generate` runs the app to write the bindings; it needs no sidecar.
	if len(sidecar.Script()) == 0 && os.Getenv("MYGO_GENERATE") == "" {
		log.Fatal("sidecar 未构建：先运行 `pnpm build:sidecar`（`pnpm dev` 与 `pnpm build` 会先构建它）")
	}
	if len(os.Args) > 1 && os.Args[1] == "serve" {
		serve(os.Args[2:])
		return
	}
	desktop()
}

func desktop() {
	if !mygo.App.RequestSingleInstanceLock() {
		return // another open-chat has the window (and the data directory)
	}
	// Signed updates from the GitHub releases of mygo.config.ts: the plugin
	// checks in the background, once a day, and shows its window when there
	// is a newer version. Development builds and apps a package manager
	// installed cannot update themselves; the window says why.
	mygo.Use(updater.Plugin)
	data, cache := dataDirs()
	var win *mygo.Window
	h, err := host.New(host.Options{
		DataDir:      data,
		CacheDir:     cache,
		Version:      appVersion(),
		Mode:         "desktop",
		Demo:         demoEnabled(),
		Push:         func(p host.Push) { PushEvent.Broadcast(p) },
		CheckUpdates: func() { updater.CheckForUpdates() },
		PickFolder: func(ctx context.Context) (string, error) {
			paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
				Parent:    mygo.CallerWindow(ctx),
				Title:     "选择工作目录",
				Directory: true,
			})
			if err != nil || len(paths) == 0 {
				return "", err
			}
			return paths[0], nil
		},
		Reveal: func(path string) error { mygo.Shell.ShowItemInFolder(path); return nil },
		OpenExternal: func(target string) error {
			return mygo.Shell.OpenExternal(target)
		},
		Notify: func(conversationID, title, subtitle, body string, sound bool) error {
			if !mygo.NotificationsSupported() {
				return nil
			}
			n := mygo.NewNotification(mygo.NotificationOptions{
				Group:    conversationID,
				Title:    title,
				Subtitle: subtitle,
				Body:     body,
				Silent:   !sound,
			})
			n.OnClick(func() {
				mygo.App.Focus()
				if win != nil {
					win.Show()
					win.Focus()
				}
				if conversationID != "" {
					PushEvent.Broadcast(host.Push{Kind: "focus", ConversationID: conversationID})
				}
				n.Close()
			})
			return n.Show()
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	mygo.App.OnDidBecomeActive(func() { mygo.ClearNotifications() })
	mygo.BindAs("Host", host.NewAPI(h))
	// Also in development builds: a plain `go build` has no embedded frontend
	// of its own, and this is what serves the page then.
	mygo.SetFrontend(webdist.FS())

	mygo.App.WhenReady(func() {
		opts := mygo.WindowOptions{
			Title:         "open-chat",
			URL:           "/",
			Width:         1200,
			Height:        800,
			MinWidth:      860,
			MinHeight:     540,
			TitleBarStyle: mygo.TitleBarHiddenInset,
			// The page draws the window controls, except on macOS where the
			// traffic lights are the ones users expect (the page keeps clear of
			// them with --titlebar padding).
			HideWindowButtons: runtime.GOOS != "darwin",
		}
		if runtime.GOOS == "darwin" {
			opts.TrafficLightPosition = &mygo.Point{X: 18, Y: 18}
		}
		win = mygo.NewWindow(opts)
		_ = win
		// The default menu has no room for "Check for Updates…"; on Windows
		// and Linux there is no menu bar at all, and the settings dialog
		// carries the same check there.
		if runtime.GOOS == "darwin" {
			mygo.App.SetMenu(appMenu())
		}
	})
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { h.Close() })
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
	h.Close()
}

// appMenu is the macOS menu bar: the default one, plus "Check for Updates…"
// after About.
func appMenu() *mygo.Menu {
	return mygo.NewMenu([]*mygo.MenuItem{
		{Label: "open-chat", Submenu: []*mygo.MenuItem{
			{Role: mygo.RoleAbout},
			updater.MenuItem(),
			mygo.Separator(),
			{Role: mygo.RoleServices},
			mygo.Separator(),
			{Role: mygo.RoleHide},
			{Role: mygo.RoleHideOthers},
			{Role: mygo.RoleUnhide},
			mygo.Separator(),
			{Role: mygo.RoleQuit},
		}},
		{Role: mygo.RoleFileMenu},
		{Role: mygo.RoleEditMenu},
		{Role: mygo.RoleViewMenu},
		{Role: mygo.RoleWindowMenu},
	})
}

func serve(args []string) {
	fl := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fl.String("addr", "127.0.0.1:4310", "listen address")
	token := fl.String("token", os.Getenv("OPEN_CHAT_TOKEN"), "access token (default: random; empty with -no-auth)")
	noAuth := fl.Bool("no-auth", false, "serve without an access token (only on trusted networks)")
	demo := fl.Bool("demo", os.Getenv("OPEN_CHAT_DEMO") == "1", "list the scripted demo agent")
	dist := fl.String("dist", "", "serve the frontend from this directory instead of the embedded one")
	_ = fl.Parse(args)

	data, cache := dataDirs()
	release, ok, err := host.Lock(data)
	if err != nil {
		log.Fatalf("数据目录不可用：%v", err)
	}
	if !ok {
		fmt.Printf("open-chat 已经在运行（pid %d），窗口在那边。\n", host.Holder(data))
		return
	}
	defer release()
	hub := host.NewHub()
	h, err := host.New(host.Options{DataDir: data, CacheDir: cache, Version: appVersion(), Mode: "web", Demo: *demo, Push: hub.Push})
	if err != nil {
		log.Fatal(err)
	}
	if *noAuth {
		*token = ""
	} else if *token == "" {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		*token = hex.EncodeToString(b)
	}
	var frontend fs.FS = webdist.FS()
	if *dist != "" {
		frontend = os.DirFS(*dist)
	}
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatal(err)
	}
	url := "http://" + ln.Addr().String() + "/"
	if *token != "" {
		url += "?token=" + *token
	}
	fmt.Printf("open-chat %s serving on %s\n  data: %s\n", appVersion(), url, data)

	srv := &http.Server{Handler: host.Handler(host.NewAPI(h), hub, frontend, *token)}
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		h.Close()
		_ = srv.Close()
	}()
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
