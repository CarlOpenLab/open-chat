//go:build windows

package host

import (
	"os"
	"syscall"
	"unsafe"
)

var (
	kernel32     = syscall.NewLazyDLL("kernel32.dll")
	lockFileEx   = kernel32.NewProc("LockFileEx")
	unlockFileEx = kernel32.NewProc("UnlockFileEx")
)

const (
	lockfileExclusiveLock   = 0x2
	lockfileFailImmediately = 0x1
)

func tryLock(f *os.File) (bool, error) {
	var ol syscall.Overlapped
	r, _, err := lockFileEx.Call(f.Fd(), lockfileExclusiveLock|lockfileFailImmediately, 0, 1, 0, uintptr(unsafe.Pointer(&ol)))
	if r == 0 {
		if errno, ok := err.(syscall.Errno); ok && errno == 33 { // ERROR_LOCK_VIOLATION
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func unlock(f *os.File) {
	var ol syscall.Overlapped
	_, _, _ = unlockFileEx.Call(f.Fd(), 0, 1, 0, uintptr(unsafe.Pointer(&ol)))
}