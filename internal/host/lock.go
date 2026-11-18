package host

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Lock takes an exclusive lock on the data directory and returns a release
// function. A second open-chat sharing the directory would otherwise write
// the conversation index over the other's (see the merge in store.flush).
func Lock(dir string) (release func(), ok bool, err error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, false, err
	}
	path := filepath.Join(dir, "open-chat.lock")
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return nil, false, err
	}
	locked, err := tryLock(f)
	if err != nil {
		f.Close()
		return nil, false, err
	}
	if !locked {
		// Report who holds it, when it's still running.
		b, _ := os.ReadFile(path)
		_ = b
		f.Close()
		return nil, false, nil
	}
	_ = f.Truncate(0)
	_, _ = f.WriteAt([]byte(strconv.Itoa(os.Getpid())+"\n"), 0)
	return func() {
		unlock(f)
		f.Close()
	}, true, nil
}

// Holder returns the pid recorded in dir's lock file, 0 when unknown.
func Holder(dir string) int {
	b, err := os.ReadFile(filepath.Join(dir, "open-chat.lock"))
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		return 0
	}
	return n
}