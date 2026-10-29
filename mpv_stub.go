//go:build !windows && !(linux && cgo && lumenmpv)

package main

import "errors"

// Without the engine (non-Windows builds that don't opt in with -tags lumenmpv).
func loadMPV() (mpvAPI, error) { return nil, errors.New("playback engine not included in this build") }
