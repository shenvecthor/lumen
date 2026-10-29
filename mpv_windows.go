//go:build windows

package main

// libmpv on Windows: libmpv-2.dll and its dependencies live in the "engine"
// folder next to Lumen.exe and are loaded at run time with plain syscalls, so
// Lumen still builds without a C compiler. lumen-mpv.dll (engine/shim.c) wraps
// mpv_wait_event, whose double argument Go can't pass on ARM64.

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type winMPV struct {
	create, initialize, setOptionString, command, setPropertyString, getProperty, free,
	observeProperty, wakeup, requestLog, errorString, terminateDestroy,
	renderCreate, renderRender, renderUpdate, renderFree, waitEvent uintptr
}

var (
	mpvOnce sync.Once
	mpvLib  *winMPV
	mpvErr0 error
)

func engineDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "engine"
	}
	return filepath.Join(filepath.Dir(exe), "engine")
}

func loadMPV() (mpvAPI, error) {
	mpvOnce.Do(func() {
		dir := engineDir()
		if _, err := os.Stat(filepath.Join(dir, "libmpv-2.dll")); err != nil {
			mpvErr0 = errors.New("the playback engine isn't installed (engine folder missing)")
			return
		}
		// dependencies resolve from the engine folder itself
		h, err := windows.LoadLibraryEx(filepath.Join(dir, "libmpv-2.dll"), 0, windows.LOAD_WITH_ALTERED_SEARCH_PATH)
		if err != nil {
			mpvErr0 = errors.New("couldn't load the playback engine: " + err.Error())
			return
		}
		hs, err := windows.LoadLibraryEx(filepath.Join(dir, "lumen-mpv.dll"), 0, windows.LOAD_WITH_ALTERED_SEARCH_PATH)
		if err != nil {
			mpvErr0 = errors.New("couldn't load lumen-mpv.dll: " + err.Error())
			return
		}
		l := &winMPV{}
		for _, f := range []struct {
			mod  windows.Handle
			name string
			dst  *uintptr
		}{
			{h, "mpv_create", &l.create}, {h, "mpv_initialize", &l.initialize}, {h, "mpv_set_option_string", &l.setOptionString},
			{h, "mpv_command", &l.command}, {h, "mpv_set_property_string", &l.setPropertyString}, {h, "mpv_get_property", &l.getProperty},
			{h, "mpv_free", &l.free}, {h, "mpv_observe_property", &l.observeProperty}, {h, "mpv_wakeup", &l.wakeup},
			{h, "mpv_request_log_messages", &l.requestLog}, {h, "mpv_error_string", &l.errorString},
			{h, "mpv_terminate_destroy", &l.terminateDestroy}, {h, "mpv_render_context_create", &l.renderCreate},
			{h, "mpv_render_context_render", &l.renderRender}, {h, "mpv_render_context_update", &l.renderUpdate},
			{h, "mpv_render_context_free", &l.renderFree}, {hs, "lumen_wait_event", &l.waitEvent},
		} {
			a, err := windows.GetProcAddress(f.mod, f.name)
			if err != nil {
				mpvErr0 = errors.New("playback engine is missing " + f.name)
				return
			}
			*f.dst = a
		}
		mpvLib = l
	})
	if mpvErr0 != nil {
		return nil, mpvErr0
	}
	return mpvLib, nil
}

// cptr turns a C pointer held as uintptr back into a pointer without tripping vet.
func cptr(u uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&u)) }

func cstr(s string) *byte { b := append([]byte(s), 0); return &b[0] }

func call(fn uintptr, args ...uintptr) uintptr {
	r, _, _ := syscall.SyscallN(fn, args...)
	return r
}

func i32(r uintptr) int { return int(int32(uint32(r))) }

func (l *winMPV) Create() uintptr          { return call(l.create) }
func (l *winMPV) Initialize(h uintptr) int { return i32(call(l.initialize, h)) }
func (l *winMPV) SetOption(h uintptr, name, val string) int {
	n, v := cstr(name), cstr(val)
	return i32(call(l.setOptionString, h, uintptr(unsafe.Pointer(n)), uintptr(unsafe.Pointer(v))))
}
func (l *winMPV) Command(h uintptr, args []string) int {
	arr := make([]*byte, len(args)+1)
	for i, a := range args {
		arr[i] = cstr(a)
	}
	return i32(call(l.command, h, uintptr(unsafe.Pointer(&arr[0]))))
}
func (l *winMPV) SetProperty(h uintptr, name, val string) int {
	n, v := cstr(name), cstr(val)
	return i32(call(l.setPropertyString, h, uintptr(unsafe.Pointer(n)), uintptr(unsafe.Pointer(v))))
}
func (l *winMPV) GetProperty(h uintptr, name string) (string, int) {
	var out uintptr
	n := cstr(name)
	r := i32(call(l.getProperty, h, uintptr(unsafe.Pointer(n)), mpvFmtString, uintptr(unsafe.Pointer(&out))))
	if r < 0 || out == 0 {
		return "", r
	}
	s := goStr((*byte)(cptr(out)))
	call(l.free, out)
	return s, 0
}
func (l *winMPV) Observe(h uintptr, id uint64, name string, format int) int {
	n := cstr(name)
	return i32(call(l.observeProperty, h, uintptr(id), uintptr(unsafe.Pointer(n)), uintptr(format)))
}
func (l *winMPV) WaitEvent(h uintptr, timeoutMs int) *mpvEvent {
	return (*mpvEvent)(cptr(call(l.waitEvent, h, uintptr(int32(timeoutMs)))))
}
func (l *winMPV) Wakeup(h uintptr) { call(l.wakeup, h) }
func (l *winMPV) RequestLog(h uintptr, level string) int {
	v := cstr(level)
	return i32(call(l.requestLog, h, uintptr(unsafe.Pointer(v))))
}
func (l *winMPV) ErrorString(code int) string {
	return goStr((*byte)(cptr(call(l.errorString, uintptr(code)))))
}
func (l *winMPV) Destroy(h uintptr) { call(l.terminateDestroy, h) }

type renderParam struct {
	typ  int32
	_    int32
	data unsafe.Pointer
}

func (l *winMPV) RenderCreateSW(h uintptr) (uintptr, int) {
	var ctx uintptr
	params := []renderParam{{typ: 1, data: unsafe.Pointer(cstr("sw"))}, {}}
	r := i32(call(l.renderCreate, uintptr(unsafe.Pointer(&ctx)), h, uintptr(unsafe.Pointer(&params[0]))))
	return ctx, r
}
func (l *winMPV) RenderSW(ctx uintptr, w, h int) ([]byte, int, int) {
	stride := (w*4 + 63) &^ 63
	raw := make([]byte, stride*h+128)
	off := (64 - int(uintptr(unsafe.Pointer(&raw[0]))&63)) & 63 // 64-byte aligned, as the renderer prefers
	buf := raw[off : off+stride*h]
	size := [2]int32{int32(w), int32(h)}
	st := uintptr(stride)
	params := []renderParam{
		{typ: 17, data: unsafe.Pointer(&size[0])},
		{typ: 18, data: unsafe.Pointer(cstr("rgb0"))},
		{typ: 19, data: unsafe.Pointer(&st)},
		{typ: 20, data: unsafe.Pointer(&buf[0])},
		{},
	}
	r := i32(call(l.renderRender, ctx, uintptr(unsafe.Pointer(&params[0]))))
	return buf, stride, r
}
func (l *winMPV) RenderUpdate(ctx uintptr) uint64 { return uint64(call(l.renderUpdate, ctx)) }
func (l *winMPV) RenderFree(ctx uintptr)          { call(l.renderFree, ctx) }
