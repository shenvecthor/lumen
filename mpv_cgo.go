//go:build linux && cgo && lumenmpv

package main

// libmpv through cgo — only for the Linux development harness and tests.
// Windows uses mpv_windows.go, which needs no C compiler.

/*
#cgo pkg-config: mpv
#include <stdlib.h>
#include <string.h>
#include <mpv/client.h>
#include <mpv/render.h>

static int lumen_render_create_sw(mpv_render_context **ctx, mpv_handle *h) {
    mpv_render_param p[] = {
        {MPV_RENDER_PARAM_API_TYPE, MPV_RENDER_API_TYPE_SW},
        {0, NULL},
    };
    return mpv_render_context_create(ctx, h, p);
}
static int lumen_render_sw(mpv_render_context *ctx, int w, int h, size_t stride, void *buf) {
    int size[2] = {w, h};
    mpv_render_param p[] = {
        {MPV_RENDER_PARAM_SW_SIZE, size},
        {MPV_RENDER_PARAM_SW_FORMAT, "rgb0"},
        {MPV_RENDER_PARAM_SW_STRIDE, &stride},
        {MPV_RENDER_PARAM_SW_POINTER, buf},
        {0, NULL},
    };
    return mpv_render_context_render(ctx, p);
}
static int lumen_command(mpv_handle *h, char **args) { return mpv_command(h, (const char **)args); }
*/
import "C"

import "unsafe"

type cgoMPV struct{}

func loadMPV() (mpvAPI, error) { return cgoMPV{}, nil }

// handles travel as uintptr through the shared code; convert back without tripping vet
func cptr(u uintptr) unsafe.Pointer        { return *(*unsafe.Pointer)(unsafe.Pointer(&u)) }
func hnd(h uintptr) *C.mpv_handle          { return (*C.mpv_handle)(cptr(h)) }
func rctx(c uintptr) *C.mpv_render_context { return (*C.mpv_render_context)(cptr(c)) }

func (cgoMPV) Create() uintptr { return uintptr(unsafe.Pointer(C.mpv_create())) }
func (cgoMPV) Initialize(h uintptr) int {
	return int(C.mpv_initialize(hnd(h)))
}
func (cgoMPV) SetOption(h uintptr, name, val string) int {
	n, v := C.CString(name), C.CString(val)
	defer C.free(unsafe.Pointer(n))
	defer C.free(unsafe.Pointer(v))
	return int(C.mpv_set_option_string(hnd(h), n, v))
}
func (cgoMPV) Command(h uintptr, args []string) int {
	arr := (*[1 << 20]*C.char)(C.malloc(C.size_t(len(args)+1) * C.size_t(unsafe.Sizeof(uintptr(0)))))
	for i, a := range args {
		arr[i] = C.CString(a)
	}
	arr[len(args)] = nil
	r := C.lumen_command(hnd(h), &arr[0])
	for i := range args {
		C.free(unsafe.Pointer(arr[i]))
	}
	C.free(unsafe.Pointer(arr))
	return int(r)
}
func (cgoMPV) SetProperty(h uintptr, name, val string) int {
	n, v := C.CString(name), C.CString(val)
	defer C.free(unsafe.Pointer(n))
	defer C.free(unsafe.Pointer(v))
	return int(C.mpv_set_property_string(hnd(h), n, v))
}
func (cgoMPV) GetProperty(h uintptr, name string) (string, int) {
	n := C.CString(name)
	defer C.free(unsafe.Pointer(n))
	var out *C.char
	r := C.mpv_get_property(hnd(h), n, C.MPV_FORMAT_STRING, unsafe.Pointer(&out))
	if r < 0 || out == nil {
		return "", int(r)
	}
	s := C.GoString(out)
	C.mpv_free(unsafe.Pointer(out))
	return s, 0
}
func (cgoMPV) Observe(h uintptr, id uint64, name string, format int) int {
	n := C.CString(name)
	defer C.free(unsafe.Pointer(n))
	return int(C.mpv_observe_property(hnd(h), C.uint64_t(id), n, C.mpv_format(format)))
}
func (cgoMPV) WaitEvent(h uintptr, timeoutMs int) *mpvEvent {
	t := C.double(-1)
	if timeoutMs >= 0 {
		t = C.double(float64(timeoutMs) / 1000)
	}
	return (*mpvEvent)(unsafe.Pointer(C.mpv_wait_event(hnd(h), t)))
}
func (cgoMPV) Wakeup(h uintptr) { C.mpv_wakeup(hnd(h)) }
func (cgoMPV) RequestLog(h uintptr, level string) int {
	l := C.CString(level)
	defer C.free(unsafe.Pointer(l))
	return int(C.mpv_request_log_messages(hnd(h), l))
}
func (cgoMPV) ErrorString(code int) string { return C.GoString(C.mpv_error_string(C.int(code))) }
func (cgoMPV) Destroy(h uintptr)           { C.mpv_terminate_destroy(hnd(h)) }
func (cgoMPV) RenderCreateSW(h uintptr) (uintptr, int) {
	var ctx *C.mpv_render_context
	r := C.lumen_render_create_sw(&ctx, hnd(h))
	return uintptr(unsafe.Pointer(ctx)), int(r)
}
func (cgoMPV) RenderSW(ctx uintptr, w, h int) ([]byte, int, int) {
	stride := (w*4 + 63) &^ 63
	buf := C.malloc(C.size_t(stride*h + 64))
	defer C.free(buf)
	r := C.lumen_render_sw(rctx(ctx), C.int(w), C.int(h), C.size_t(stride), buf)
	return C.GoBytes(buf, C.int(stride*h)), stride, int(r)
}
func (cgoMPV) RenderUpdate(ctx uintptr) uint64 {
	return uint64(C.mpv_render_context_update(rctx(ctx)))
}
func (cgoMPV) RenderFree(ctx uintptr) {
	C.mpv_render_context_free(rctx(ctx))
}
