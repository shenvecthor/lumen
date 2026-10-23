//go:build windows

package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	comdlg32 = windows.NewLazySystemDLL("comdlg32.dll")
	dwmapi   = windows.NewLazySystemDLL("dwmapi.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	ole32    = windows.NewLazySystemDLL("ole32.dll")

	pCoCreateInstance = ole32.NewProc("CoCreateInstance")
	pCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	pCoTaskMemFree    = ole32.NewProc("CoTaskMemFree")

	pGetOpenFileNameW      = comdlg32.NewProc("GetOpenFileNameW")
	pGetSaveFileNameW      = comdlg32.NewProc("GetSaveFileNameW")
	pGetWindowLongPtrW     = user32.NewProc("GetWindowLongPtrW")
	pSetWindowLongPtrW     = user32.NewProc("SetWindowLongPtrW")
	pGetWindowRect         = user32.NewProc("GetWindowRect")
	pGetClientRect         = user32.NewProc("GetClientRect")
	pGetDpiForWindow       = user32.NewProc("GetDpiForWindow")
	pIsZoomed              = user32.NewProc("IsZoomed")
	pSetWindowPos          = user32.NewProc("SetWindowPos")
	pMonitorFromWindow     = user32.NewProc("MonitorFromWindow")
	pGetMonitorInfoW       = user32.NewProc("GetMonitorInfoW")
	pMessageBoxW           = user32.NewProc("MessageBoxW")
	pDwmSetWindowAttribute = dwmapi.NewProc("DwmSetWindowAttribute")
	pShellExecuteW         = shell32.NewProc("ShellExecuteW")
)

const (
	wsOverlappedWindow = 0x00CF0000
	swpNoSize          = 0x0001
	swpNoMove          = 0x0002
	swpNoZOrder        = 0x0004
	swpNoActivate      = 0x0010
	swpFrameChanged    = 0x0020
	swpNoOwnerZOrder   = 0x0200
)

type rect struct{ L, T, R, B int32 }
type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}

type openFileNameW struct {
	lStructSize       uint32
	hwndOwner         uintptr
	hInstance         uintptr
	lpstrFilter       *uint16
	lpstrCustomFilter *uint16
	nMaxCustFilter    uint32
	nFilterIndex      uint32
	lpstrFile         *uint16
	nMaxFile          uint32
	lpstrFileTitle    *uint16
	nMaxFileTitle     uint32
	lpstrInitialDir   *uint16
	lpstrTitle        *uint16
	Flags             uint32
	nFileOffset       uint16
	nFileExtension    uint16
	lpstrDefExt       *uint16
	lCustData         uintptr
	lpfnHook          uintptr
	lpTemplateName    *uint16
	pvReserved        uintptr
	dwReserved        uint32
	FlagsEx           uint32
}

func u16(s string) *uint16 { p, _ := windows.UTF16PtrFromString(s); return p }

// openDialog shows the native multi-select file picker.
func openDialog(owner uintptr, subsOnly bool) []string {
	filter := "Media files\x00*.mp4;*.m4v;*.webm;*.mkv;*.mov;*.ogv;*.mp3;*.m4a;*.aac;*.flac;*.wav;*.ogg;*.opus;*.weba;*.mka;*.srt;*.vtt;*.ass;*.ssa;*.m3u;*.m3u8\x00" +
		"Playlists\x00*.m3u;*.m3u8\x00" +
		"Video\x00*.mp4;*.m4v;*.webm;*.mkv;*.mov;*.ogv\x00Audio\x00*.mp3;*.m4a;*.aac;*.flac;*.wav;*.ogg;*.opus;*.weba;*.mka\x00" +
		"Subtitles\x00*.srt;*.vtt;*.ass;*.ssa\x00All files\x00*.*\x00\x00"
	title := "Open media"
	if subsOnly {
		filter = "Subtitles\x00*.srt;*.vtt;*.ass;*.ssa\x00All files\x00*.*\x00\x00"
		title = "Load subtitles"
	}
	f16 := utf16.Encode([]rune(filter))
	buf := make([]uint16, 1<<16)
	ofn := openFileNameW{
		hwndOwner:   owner,
		lpstrFilter: &f16[0],
		lpstrFile:   &buf[0],
		nMaxFile:    uint32(len(buf)),
		lpstrTitle:  u16(title),
		// EXPLORER | ALLOWMULTISELECT | FILEMUSTEXIST | PATHMUSTEXIST | NOCHANGEDIR | HIDEREADONLY
		Flags: 0x80000 | 0x200 | 0x1000 | 0x800 | 0x8 | 0x4,
	}
	ofn.lStructSize = uint32(unsafe.Sizeof(ofn))
	if r, _, _ := pGetOpenFileNameW.Call(uintptr(unsafe.Pointer(&ofn))); r == 0 {
		return nil
	}
	// Result is "dir\0file1\0file2\0\0" or "fullpath\0\0"
	parts, start := []string{}, 0
	for i, c := range buf {
		if c == 0 {
			if i == start {
				break
			}
			parts = append(parts, windows.UTF16ToString(buf[start:i]))
			start = i + 1
		}
	}
	if len(parts) <= 1 {
		return parts
	}
	out := make([]string, 0, len(parts)-1)
	for _, n := range parts[1:] {
		out = append(out, filepath.Join(parts[0], n))
	}
	return out
}

// ---- settings export / import ----

const jsonFilter = "Lumen settings (*.json)\x00*.json\x00All files\x00*.*\x00\x00"

func exportDialog(owner uintptr, text string) string {
	return saveTextDialog(owner, text, jsonFilter, "Lumen settings.json", "Export Lumen settings", "json")
}

func saveTextDialog(owner uintptr, text, filter, defName, title, defExt string) string {
	f16 := utf16.Encode([]rune(filter))
	buf := make([]uint16, 1024)
	copy(buf, utf16.Encode([]rune(defName)))
	ofn := openFileNameW{
		hwndOwner: owner, lpstrFilter: &f16[0], lpstrFile: &buf[0], nMaxFile: uint32(len(buf)),
		lpstrTitle: u16(title), lpstrDefExt: u16(defExt),
		Flags: 0x80000 | 0x2 /*OVERWRITEPROMPT*/ | 0x800 | 0x8 | 0x4,
	}
	ofn.lStructSize = uint32(unsafe.Sizeof(ofn))
	if r, _, _ := pGetSaveFileNameW.Call(uintptr(unsafe.Pointer(&ofn))); r == 0 {
		return ""
	}
	p := windows.UTF16ToString(buf)
	if os.WriteFile(p, []byte(text), 0o644) != nil {
		return ""
	}
	return p
}

func importDialog(owner uintptr) string {
	f16 := utf16.Encode([]rune(jsonFilter))
	buf := make([]uint16, 1024)
	ofn := openFileNameW{
		hwndOwner: owner, lpstrFilter: &f16[0], lpstrFile: &buf[0], nMaxFile: uint32(len(buf)),
		lpstrTitle: u16("Import Lumen settings"), Flags: 0x80000 | 0x1000 | 0x800 | 0x8 | 0x4,
	}
	ofn.lStructSize = uint32(unsafe.Sizeof(ofn))
	if r, _, _ := pGetOpenFileNameW.Call(uintptr(unsafe.Pointer(&ofn))); r == 0 {
		return ""
	}
	p := windows.UTF16ToString(buf)
	if st, err := os.Stat(p); err != nil || st.Size() > 1<<20 {
		return ""
	}
	b, _ := os.ReadFile(p)
	return string(b)
}

// ---- folder picker (modern IFileOpenDialog via COM) ----

var (
	clsidFileOpenDialog = windows.GUID{Data1: 0xDC1C5A9C, Data2: 0xE88A, Data3: 0x4DDE, Data4: [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7}}
	iidIFileOpenDialog  = windows.GUID{Data1: 0xD57C7288, Data2: 0xD4AD, Data3: 0x4768, Data4: [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60}}
)

// comCall invokes vtable slot idx on a COM object.
func comCall(obj unsafe.Pointer, idx int, args ...uintptr) uintptr {
	vtbl := *(*unsafe.Pointer)(obj)
	fn := *(*uintptr)(unsafe.Add(vtbl, uintptr(idx)*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{uintptr(obj)}, args...)...)
	return r
}
func failed(hr uintptr) bool { return int32(uint32(hr)) < 0 }

func pickFolder(owner uintptr) string {
	pCoInitializeEx.Call(0, 0x2) // COINIT_APARTMENTTHREADED; harmless if already initialised
	var dlg unsafe.Pointer
	if hr, _, _ := pCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidFileOpenDialog)), 0, 1 /*CLSCTX_INPROC_SERVER*/,
		uintptr(unsafe.Pointer(&iidIFileOpenDialog)), uintptr(unsafe.Pointer(&dlg))); failed(hr) || dlg == nil {
		return ""
	}
	defer comCall(dlg, 2) // Release
	var opts uint32
	comCall(dlg, 10, uintptr(unsafe.Pointer(&opts)))                  // GetOptions
	comCall(dlg, 9, uintptr(opts|0x20 /*PICKFOLDERS*/|0x40 /*FORCEFILESYSTEM*/|0x800 /*PATHMUSTEXIST*/)) // SetOptions
	comCall(dlg, 17, uintptr(unsafe.Pointer(u16("Open folder"))))     // SetTitle
	if failed(comCall(dlg, 3, owner)) {                                // Show (fails on cancel)
		return ""
	}
	var item unsafe.Pointer
	if failed(comCall(dlg, 20, uintptr(unsafe.Pointer(&item)))) || item == nil { // GetResult
		return ""
	}
	defer comCall(item, 2)
	var psz *uint16
	if failed(comCall(item, 5, 0x80058000 /*SIGDN_FILESYSPATH*/, uintptr(unsafe.Pointer(&psz)))) || psz == nil { // GetDisplayName
		return ""
	}
	defer pCoTaskMemFree.Call(uintptr(unsafe.Pointer(psz)))
	return windows.UTF16PtrToString(psz)
}

// ---- snapshots ----

func snapshotDir() string {
	pics, err := windows.KnownFolderPath(windows.FOLDERID_Pictures, 0)
	if err != nil || pics == "" {
		home, _ := os.UserHomeDir()
		pics = filepath.Join(home, "Pictures")
	}
	return filepath.Join(pics, "Lumen")
}

func saveSnapshot(dataURL, name string) (string, error) {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(dataURL, prefix) || len(dataURL) > 200<<20 {
		return "", errors.New("bad image")
	}
	png, err := base64.StdEncoding.DecodeString(dataURL[len(prefix):])
	if err != nil {
		return "", err
	}
	name = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`<>:"/\|?*`, r) || r < 32 {
			return '_'
		}
		return r
	}, name)
	if len([]rune(name)) > 80 {
		name = string([]rune(name)[:80])
	}
	dir := snapshotDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	p := filepath.Join(dir, name+".png")
	if _, err := os.Stat(p); err == nil {
		p = filepath.Join(dir, name+" "+time.Now().Format("150405")+".png")
	}
	return p, os.WriteFile(p, png, 0o644)
}

func shellOpen(target string) {
	pShellExecuteW.Call(0, uintptr(unsafe.Pointer(u16("open"))), uintptr(unsafe.Pointer(u16(target))), 0, 0, 1)
}

type window struct {
	hwnd      uintptr
	full      bool
	prevStyle uintptr
	prevRect  rect
}

func (w *window) setFullscreen(on bool) {
	if on == w.full {
		return
	}
	gwlStyle := int32(-16)
	if on {
		w.prevStyle, _, _ = pGetWindowLongPtrW.Call(w.hwnd, uintptr(gwlStyle))
		pGetWindowRect.Call(w.hwnd, uintptr(unsafe.Pointer(&w.prevRect)))
		mon, _, _ := pMonitorFromWindow.Call(w.hwnd, 2) // MONITOR_DEFAULTTONEAREST
		mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
		pGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi)))
		pSetWindowLongPtrW.Call(w.hwnd, uintptr(gwlStyle), w.prevStyle&^wsOverlappedWindow)
		m := mi.Monitor
		pSetWindowPos.Call(w.hwnd, 0, uintptr(m.L), uintptr(m.T), uintptr(m.R-m.L), uintptr(m.B-m.T), swpNoOwnerZOrder|swpFrameChanged)
	} else {
		pSetWindowLongPtrW.Call(w.hwnd, uintptr(gwlStyle), w.prevStyle)
		r := w.prevRect
		pSetWindowPos.Call(w.hwnd, 0, uintptr(r.L), uintptr(r.T), uintptr(r.R-r.L), uintptr(r.B-r.T), swpNoZOrder|swpNoOwnerZOrder|swpFrameChanged)
	}
	w.full = on
}

func (w *window) setTopmost(on bool) {
	after := ^uintptr(1) // HWND_NOTOPMOST (-2)
	if on {
		after = ^uintptr(0) // HWND_TOPMOST (-1)
	}
	pSetWindowPos.Call(w.hwnd, after, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
}

func darkTitleBar(hwnd uintptr) {
	on := int32(1)
	// DWMWA_USE_IMMERSIVE_DARK_MODE: 20 on current builds, 19 on early Win10 20H1
	if r, _, _ := pDwmSetWindowAttribute.Call(hwnd, 20, uintptr(unsafe.Pointer(&on)), 4); r != 0 {
		pDwmSetWindowAttribute.Call(hwnd, 19, uintptr(unsafe.Pointer(&on)), 4)
	}
	caption := uint32(0x00110E0D) // COLORREF of #0d0e11 (Windows 11 only)
	pDwmSetWindowAttribute.Call(hwnd, 35, uintptr(unsafe.Pointer(&caption)), 4)
}

func dataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base, _ = os.UserConfigDir()
	}
	d := filepath.Join(base, "Lumen")
	os.MkdirAll(d, 0o700)
	return d
}

func fatal(msg string, offerRuntime bool) {
	flags := uintptr(0x10) // MB_ICONERROR
	if offerRuntime {
		flags |= 0x4 // MB_YESNO
	}
	r, _, _ := pMessageBoxW.Call(0, uintptr(unsafe.Pointer(u16(msg))), uintptr(unsafe.Pointer(u16("Lumen"))), flags)
	if offerRuntime && r == 6 { // IDYES
		pShellExecuteW.Call(0, uintptr(unsafe.Pointer(u16("open"))),
			uintptr(unsafe.Pointer(u16("https://developer.microsoft.com/microsoft-edge/webview2/"))), 0, 0, 1)
	}
	os.Exit(1)
}

func main() {
	runtime.LockOSThread()

	dir := dataDir()
	statePath := filepath.Join(dir, "state.json")

	// Already running? Hand the files over and exit — no second browser start-up.
	if singleInstanceEnabled(statePath) && forwardToRunning(os.Args[1:]) {
		return
	}

	srv, err := NewServer()
	if err != nil {
		fatal("Lumen could not start its local media service:\n"+err.Error(), false)
	}

	// Paint dark before the page loads, and let media start without a click.
	os.Setenv("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF0D0E11")
	// Lighter start-up: no background networking, translate/sync/first-run work, or
	// SmartScreen checks for our own loopback page.
	os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required "+
		"--enable-blink-features=AudioVideoTracks --disable-background-networking --disable-component-update --disable-sync --no-first-run "+
		"--disable-features=Translate,msSmartScreenProtection,msWebOOUI,msPdfOOUI,OptimizationHints")

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     os.Getenv("LUMEN_DEBUG") == "1",
		AutoFocus: true,
		DataPath:  filepath.Join(dir, "WebView2"),
		WindowOptions: webview2.WindowOptions{
			Title:  "Lumen",
			Width:  1100,
			Height: 680,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		fatal("Lumen needs the Microsoft Edge WebView2 Runtime, which wasn't found on this PC.\n\n"+
			"It's built into Windows 11 and most Windows 10 installs.\nOpen the download page now?", true)
	}
	defer w.Destroy()

	// Turn off browser behaviour that doesn't belong in a media player:
	// F5/Ctrl+R reload, Ctrl+P print, Ctrl+F find, browser zoom, swipe navigation.
	if c, ok := w.(interface{ Chromium() *edge.Chromium }); ok && c.Chromium() != nil {
		if st, err := c.Chromium().GetSettings(); err == nil && st != nil {
			st.PutAreBrowserAcceleratorKeysEnabled(os.Getenv("LUMEN_DEBUG") == "1")
			st.PutIsZoomControlEnabled(false)
			st.PutIsStatusBarEnabled(false)
			st.PutIsSwipeNavigationEnabled(false)
			// Pinch stays enabled: turning it off also stops touchpad pinches reaching the page.
			// The page cancels every Ctrl+wheel itself, so the interface never zooms — only the video does.
			st.PutIsPinchZoomEnabled(true)
		}
	}

	win := &window{hwnd: uintptr(w.Window())}
	darkTitleBar(win.hwnd)
	w.SetSize(480, 300, webview2.HintMin)

	// Keep the window in the video's shape while the user drags its edges.
	var aspect struct{ ratio, extraW, extraH float64 }
	frame := func() (ncW, ncH int32, scale float64, work rect) {
		var wr, cr rect
		pGetWindowRect.Call(win.hwnd, uintptr(unsafe.Pointer(&wr)))
		pGetClientRect.Call(win.hwnd, uintptr(unsafe.Pointer(&cr)))
		scale = 1
		if pGetDpiForWindow.Find() == nil {
			if d, _, _ := pGetDpiForWindow.Call(win.hwnd); d > 0 {
				scale = float64(d) / 96
			}
		}
		mon, _, _ := pMonitorFromWindow.Call(win.hwnd, 2)
		mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
		pGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi)))
		return (wr.R - wr.L) - (cr.R - cr.L), (wr.B - wr.T) - (cr.B - cr.T), scale, mi.Work
	}
	webview2.SizingHook = func(edge int, r *[4]int32) bool {
		if win.full || aspect.ratio <= 0 {
			return false
		}
		ncW, ncH, sc, wa := frame()
		return lockAspect(edge, r, ncW, ncH, int32(aspect.extraW*sc+.5), int32(aspect.extraH*sc+.5), aspect.ratio, wa.R-wa.L, wa.B-wa.T)
	}
	w.Bind("lumenAspect", func(ratio, extraW, extraH float64) { aspect.ratio, aspect.extraW, aspect.extraH = ratio, extraW, extraH })
	w.Bind("lumenFitWindow", func(ratio, extraW, extraH float64) bool {
		if z, _, _ := pIsZoomed.Call(win.hwnd); z != 0 || win.full || ratio <= 0 {
			return false
		}
		ncW, ncH, sc, wa := frame()
		var wr rect
		pGetWindowRect.Call(win.hwnd, uintptr(unsafe.Pointer(&wr)))
		n := fitRect([4]int32{wr.L, wr.T, wr.R, wr.B}, [4]int32{wa.L, wa.T, wa.R, wa.B}, ncW, ncH, int32(extraW*sc+.5), int32(extraH*sc+.5), ratio)
		pSetWindowPos.Call(win.hwnd, 0, uintptr(n[0]), uintptr(n[1]), uintptr(n[2]-n[0]), uintptr(n[3]-n[1]), swpNoZOrder|swpNoActivate)
		return true
	})

	// MPC-HC style video size presets (50 / 100 / 200 %): stage size in CSS px.
	w.Bind("lumenSetVideoSize", func(stageW, stageH, extraW, extraH float64) bool {
		if win.full || stageW <= 0 || stageH <= 0 {
			return false
		}
		if z, _, _ := pIsZoomed.Call(win.hwnd); z != 0 {
			pShowWindow.Call(win.hwnd, 9) // SW_RESTORE
		}
		ncW, ncH, sc, wa := frame()
		var wr rect
		pGetWindowRect.Call(win.hwnd, uintptr(unsafe.Pointer(&wr)))
		n := sizeRect([4]int32{wr.L, wr.T, wr.R, wr.B}, [4]int32{wa.L, wa.T, wa.R, wa.B}, ncW, ncH,
			int32(extraW*sc+.5), int32(extraH*sc+.5), int32(stageW*sc+.5), int32(stageH*sc+.5))
		pSetWindowPos.Call(win.hwnd, 0, uintptr(n[0]), uintptr(n[1]), uintptr(n[2]-n[0]), uintptr(n[3]-n[1]), swpNoZOrder|swpNoActivate)
		return true
	})

	// Files handed over by a second launch.
	if instanceMutex != 0 {
		srv.OnRemote = func(paths []string) {
			w.Dispatch(func() {
				b, _ := json.Marshal(srv.Expand(paths))
				bringToFront(win.hwnd)
				w.Eval("window.__lumenRemote && window.__lumenRemote(" + string(b) + ")")
			})
		}
		publishInstance(srv)
	}

	args := os.Args[1:]
	// Dialogs are modal loops. Running them from inside a WebView2 message
	// callback can stall the browser, so they're posted to the UI thread and
	// the result is handed back to the page afterwards.
	dialogBusy := false
	w.Bind("lumenDialog", func(kind string) {
		if dialogBusy {
			return
		}
		dialogBusy = true
		w.Dispatch(func() {
			finish := func(v any) {
				b, _ := json.Marshal(v)
				dialogBusy = false
				w.Eval("window.__lumenDialogDone(" + string(b) + ")")
				w.Dispatch(func() {}) // flush anything queued while the dialog's modal loop ran
			}
			if strings.HasPrefix(kind, "saveplaylist:") {
				finish(saveTextDialog(win.hwnd, strings.TrimPrefix(kind, "saveplaylist:"),
					"Playlist (*.m3u8)\x00*.m3u8\x00M3U playlist (*.m3u)\x00*.m3u\x00\x00", "Playlist.m3u8", "Save playlist", "m3u8"))
				return
			}
			if strings.HasPrefix(kind, "export:") {
				finish(exportDialog(win.hwnd, strings.TrimPrefix(kind, "export:")))
				return
			}
			if kind == "import" {
				finish(importDialog(win.hwnd))
				return
			}
			var paths []string
			switch kind {
			case "folder":
				if f := pickFolder(win.hwnd); f != "" {
					paths = []string{f}
				}
			case "subs":
				paths = openDialog(win.hwnd, true)
			default:
				paths = openDialog(win.hwnd, false)
			}
			finish(srv.Expand(paths))
		})
	})
	w.Bind("lumenArgs", func() []Item { a := srv.Expand(args); args = nil; return a })
	w.Bind("lumenSnapshot", func(dataURL, name string) (string, error) { return saveSnapshot(dataURL, name) })
	w.Bind("lumenOpenSnapshots", func() { d := snapshotDir(); os.MkdirAll(d, 0o755); shellOpen(d) })
	w.Bind("lumenQuit", func() { w.Dispatch(func() { w.Terminate() }) })
	w.Bind("lumenSubs", func(p string) []Item { return srv.Subs(p) })
	w.Bind("lumenExpand", func(paths []string) []Item { return srv.Expand(paths) })
	w.Bind("lumenChapters", func(p string) []Chapter { return srv.Chapters(p) })
	w.Bind("lumenNeighbor", func(p string, dir int) *Item { return srv.Neighbor(p, dir) })
	w.Bind("lumenPower", func(action string) error { return powerAction(action) })
	w.Bind("lumenTitle", func(t string) { w.SetTitle(t) })
	w.Bind("lumenFullscreen", func(on bool) { win.setFullscreen(on) })
	w.Bind("lumenOnTop", func(on bool) { win.setTopmost(on) })
	w.Bind("lumenLoadState", func() string { b, _ := os.ReadFile(statePath); return string(b) })
	w.Bind("lumenSaveState", func(s string) {
		if json.Valid([]byte(s)) && len(s) < 4<<20 {
			tmp := statePath + ".tmp"
			if os.WriteFile(tmp, []byte(s), 0o600) == nil {
				os.Rename(tmp, statePath)
			}
		}
	})

	w.Navigate(srv.AppURL())
	w.Run()
}

// powerAction runs an MPC-HC style "after playback" action.
func powerAction(action string) error {
	switch action {
	case "sleep", "hibernate":
		h := uintptr(0)
		if action == "hibernate" {
			h = 1
		}
		if r, _, err := windows.NewLazySystemDLL("powrprof.dll").NewProc("SetSuspendState").Call(h, 0, 0); r == 0 {
			return err
		}
		return nil
	case "shutdown":
		exe := filepath.Join(os.Getenv("SystemRoot"), "System32", "shutdown.exe")
		cmd := exec.Command(exe, "/s", "/t", "60", "/c", "Lumen: playback finished. Windows will shut down in 60 seconds (run \"shutdown /a\" to cancel).")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
		return cmd.Start()
	}
	return errors.New("unknown action")
}
