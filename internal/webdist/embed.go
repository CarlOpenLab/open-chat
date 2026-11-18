// Package webdist embeds the built frontend (vite build → dist/).
package webdist

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS is the frontend's files, index.html at the root.
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}