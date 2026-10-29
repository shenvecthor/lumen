//go:build windows

package main

// The libmpv engine inside Lumen's window. mpv draws into a child window that
// sits underneath the WebView2 interface; when the engine is in use the page
// turns its stage transparent, so the video shows through and every control,
// menu and panel stays exactly where it is.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

var (
	pCreateWindowExW = user32.NewProc("CreateWindowExW")
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	pGetModuleHandle = kernel32.NewProc("GetModuleHandleW")
)

type engine struct {
	w      webview2.WebView
	parent uintptr
	scale  func() float64

	mu      sync.Mutex
	api     mpvAPI
	player  *Player
	grab    *Grabber
	video   uintptr // child window mpv draws into
	clear   bool    // WebView2 background made transparent
	lastPos [5]int32
}

func (e *engine) emit(js string) {
	e.w.Dispatch(func() { e.w.Eval("window.__mpv&&window.__mpv(" + js + ")") })
}

// onUI runs f on the window's thread and waits for it.
func (e *engine) onUI(f func()) {
	done := make(chan struct{})
	e.w.Dispatch(func() { f(); close(done) })
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
}

func (e *engine) start() (*Player, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.player != nil {
		return e.player, nil
	}
	api, err := loadMPV()
	if err != nil {
		return nil, err
	}
	e.api = api
	if e.video == 0 {
		e.onUI(func() {
			const wsChild, wsClipSiblings, wsClipChildren, ssBlackRect = 0x40000000, 0x04000000, 0x02000000, 0x4
			hinst, _, _ := pGetModuleHandle.Call(0)
			h, _, _ := pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(u16("STATIC"))), uintptr(unsafe.Pointer(u16(""))),
				wsChild|wsClipSiblings|wsClipChildren|ssBlackRect, 0, 0, 16, 16, e.parent, 0, hinst, 0)
			e.video = h
			pSetWindowPos.Call(h, 1 /* HWND_BOTTOM */, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
		})
		if e.video == 0 {
			return nil, errors.New("couldn't create the video window")
		}
	}
	p, err := NewPlayer(api, playerOptions(strconv.FormatUint(uint64(e.video), 10)), e.emit)
	if err != nil {
		return nil, err
	}
	e.player = p
	return p, nil
}

// transparent lets the native video show through the page where the page is transparent.
func (e *engine) transparent() {
	if e.clear {
		return
	}
	e.clear = true
	e.onUI(func() {
		if c, ok := e.w.(interface{ Chromium() *edge.Chromium }); ok && c.Chromium() != nil {
			if ctl := c.Chromium().GetController(); ctl != nil {
				if c2 := ctl.GetICoreWebView2Controller2(); c2 != nil {
					c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 0, R: 0, G: 0, B: 0})
				}
			}
		}
	})
}

// place moves the video window to the stage (CSS pixels from the page).
func (e *engine) place(x, y, w, h float64, show bool) {
	if e.video == 0 {
		return
	}
	s := e.scale()
	pos := [5]int32{int32(x*s + .5), int32(y*s + .5), int32(w*s + .5), int32(h*s + .5), 0}
	if show {
		pos[4] = 1
	}
	e.mu.Lock()
	same := pos == e.lastPos
	e.lastPos = pos
	e.mu.Unlock()
	if same {
		return
	}
	e.w.Dispatch(func() {
		flags := uintptr(swpNoActivate | 0x0040) // SWP_SHOWWINDOW
		if !show {
			flags = swpNoActivate | 0x0080 // SWP_HIDEWINDOW
		}
		pSetWindowPos.Call(e.video, 1 /* HWND_BOTTOM: under the interface */, uintptr(pos[0]), uintptr(pos[1]), uintptr(pos[2]), uintptr(pos[3]), flags)
	})
}

func (e *engine) grabber() (*Grabber, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.grab != nil {
		return e.grab, nil
	}
	api, err := loadMPV()
	if err != nil {
		return nil, err
	}
	g, err := NewGrabber(api)
	if err != nil {
		return nil, err
	}
	e.grab = g
	return g, nil
}

func (e *engine) bind(srv *Server) {
	w := e.w
	w.Bind("lumenEngine", func() map[string]any {
		_, err := loadMPV()
		out := map[string]any{"ok": err == nil}
		if err != nil {
			out["error"] = err.Error()
		}
		return out
	})
	w.Bind("lumenProbe", func(p string) Probe { return probeFile(p) })
	w.Bind("lumenMpvOpen", func(path string, start float64, paused bool) error {
		p, err := e.start()
		if err != nil {
			return err
		}
		e.transparent()
		startOpt := "none"
		if start > 0 {
			startOpt = strconv.FormatFloat(start, 'f', 3, 64)
		}
		p.Set("start", startOpt)
		p.Set("pause", map[bool]string{true: "yes", false: "no"}[paused])
		return p.Command("loadfile", path, "replace")
	})
	w.Bind("lumenMpvCmd", func(args []string) error {
		if e.player == nil {
			return errors.New("engine not started")
		}
		return e.player.Command(args...)
	})
	w.Bind("lumenMpvSet", func(name, val string) error {
		if e.player == nil {
			return errors.New("engine not started")
		}
		return e.player.Set(name, val)
	})
	w.Bind("lumenMpvGet", func(name string) (string, error) {
		if e.player == nil {
			return "", errors.New("engine not started")
		}
		return e.player.Get(name)
	})
	w.Bind("lumenMpvStop", func() {
		if e.player != nil {
			e.player.Command("stop")
		}
		e.place(0, 0, 0, 0, false)
		if e.grab != nil {
			go e.grab.Forget()
		}
	})
	w.Bind("lumenMpvRect", func(x, y, wd, ht float64, show bool) { e.place(x, y, wd, ht, show) })
	w.Bind("lumenMpvFrame", func(path string, t float64, maxW int, exact bool) (string, error) {
		g, err := e.grabber()
		if err != nil {
			return "", err
		}
		return g.Frame(path, t, maxW, exact)
	})
	w.Bind("lumenMpvShot", func(name string) (string, error) {
		if e.player == nil {
			return "", errors.New("engine not started")
		}
		dir := snapshotDir()
		os.MkdirAll(dir, 0o755)
		p := filepath.Join(dir, safeName(name)+".png")
		for i := 2; fileExists(p); i++ {
			p = filepath.Join(dir, fmt.Sprintf("%s (%d).png", safeName(name), i))
		}
		if err := e.player.Command("screenshot-to-file", p, "video"); err != nil {
			return "", err
		}
		return p, nil
	})

	// Dropped files arrive with their real paths, so they can use the engine too.
	edge.FilesHook = func(tag string, paths []string) {
		var ok []string
		for _, p := range paths {
			if _, err := os.Stat(p); err == nil {
				ok = append(ok, p)
			}
		}
		go func() {
			b, _ := json.Marshal(srv.Expand(ok))
			t, _ := json.Marshal(tag)
			w.Dispatch(func() { w.Eval("window.__lumenDropped&&window.__lumenDropped(" + string(t) + "," + string(b) + ")") })
		}()
	}
}

func (e *engine) close() {
	if e.player != nil {
		e.player.Close()
	}
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func safeName(s string) string {
	out := []rune{}
	for _, r := range s {
		if r < 32 || r == '<' || r == '>' || r == ':' || r == '"' || r == '/' || r == '\\' || r == '|' || r == '?' || r == '*' {
			r = '_'
		}
		out = append(out, r)
	}
	if len(out) > 120 {
		out = out[:120]
	}
	if len(out) == 0 {
		return "Lumen"
	}
	return string(out)
}
