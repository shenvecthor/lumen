//go:build windows

package webview2

// Lumen patch: expose the underlying Chromium instance so the app can adjust
// WebView2 settings that the upstream wrapper doesn't surface.

import "github.com/jchv/go-webview2/pkg/edge"

func (w *webview) Chromium() *edge.Chromium {
	c, _ := w.browser.(*edge.Chromium)
	return c
}

// SizingHook, if set, is called for WM_SIZING with the edge being dragged
// (WMSZ_*) and the proposed window rectangle {left, top, right, bottom}.
// Return true after modifying the rectangle.
var SizingHook func(edge int, rect *[4]int32) bool
