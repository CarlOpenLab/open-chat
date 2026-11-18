// Package sidecar embeds the bundled Node sidecar (scripts/build-sidecar.mjs).
package sidecar

import "embed"

//go:embed all:dist
var dist embed.FS

// Script returns the bundled sidecar, or nil when it hasn't been built.
func Script() []byte {
	b, err := dist.ReadFile("dist/sidecar.mjs")
	if err != nil {
		return nil
	}
	return b
}