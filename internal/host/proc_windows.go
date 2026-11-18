//go:build windows

package host

import (
	"os/exec"
	"syscall"
)

// The app is built with -H=windowsgui and has no console: without this every
// console child (node, and the agents it spawns) would flash a window.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}