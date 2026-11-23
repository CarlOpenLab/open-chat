package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenLinkRoutes(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "src")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(sub, "main.go")
	if err := os.WriteFile(file, []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	slashed := filepath.ToSlash(file)

	var opened, revealed []string
	api := NewAPI(&Host{opts: Options{
		OpenExternal: func(target string) error { opened = append(opened, target); return nil },
		Reveal:       func(path string) error { revealed = append(revealed, path); return nil },
	}})

	for _, target := range []string{"https://example.com/a?b=c", "mailto:a@b.c"} {
		if err := api.OpenLink(target, dir); err != nil {
			t.Fatalf("OpenLink(%q): %v", target, err)
		}
	}
	for _, target := range []string{
		"src/main.go",
		"src/main.go:12",
		"src/main.go:12:3",
		slashed,
		"file://" + slashed + "#L3",
	} {
		if err := api.OpenLink(target, dir); err != nil {
			t.Fatalf("OpenLink(%q): %v", target, err)
		}
	}

	if want := []string{"https://example.com/a?b=c", "mailto:a@b.c"}; !equalStrings(opened, want) {
		t.Fatalf("opened = %v, want %v", opened, want)
	}
	if want := []string{file, file, file, file, file}; !equalStrings(revealed, want) {
		t.Fatalf("revealed = %v, want %v", revealed, want)
	}

	// In-page anchors belong to the page, not to the file manager.
	if err := api.OpenLink("#anchor", dir); err != nil || len(revealed) != 5 {
		t.Fatalf("anchor open: err = %v, revealed = %v", err, revealed)
	}

	if err := api.OpenLink("javascript:alert(1)", dir); err == nil {
		t.Fatal("javascript: link was opened")
	}
	if err := api.OpenLink("missing.go", dir); err == nil {
		t.Fatal("missing file was revealed")
	}
	if err := api.OpenLink("src/main.go", ""); err == nil {
		t.Fatal("relative path without cwd was revealed")
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
