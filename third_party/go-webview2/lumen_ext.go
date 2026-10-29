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

// ExStyle is the extended window style for the main window. Lumen sets
// WS_EX_NOREDIRECTIONBITMAP when its video engine is present: the window then
// has no GDI surface of its own, so where the transparent WebView2 page shows
// nothing, the native video window underneath is what you see.
var ExStyle uintptr

// MessageHook, if set, sees every message of the main window (observe only).
var MessageHook func(msg, wp, lp uintptr)
