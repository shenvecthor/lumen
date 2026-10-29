//go:build windows

package edge

// Lumen patch: real file paths for files dropped on the page.
// The page sends them with chrome.webview.postMessageWithAdditionalObjects
// ("lumen-files:<tag>", files); WebView2 hands each one over as an
// ICoreWebView2File whose Path is the file on disk.

import (
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// FilesHook receives the tag and the dropped files' paths (called on the UI thread).
var FilesHook func(tag string, paths []string)

var iidICoreWebView2File = NewGUID("{f2c19559-6bc1-4583-a757-90021be9afec}")

func vtblFn(obj unsafe.Pointer, i int) uintptr {
	return (*[16]uintptr)(*(*unsafe.Pointer)(obj))[i]
}

func comCall(fn uintptr, args ...uintptr) uintptr {
	r, _, _ := syscall.SyscallN(fn, args...)
	return r
}

// handleLumenFiles returns true when the message was a Lumen file drop.
func handleLumenFiles(message string, args *iCoreWebView2WebMessageReceivedEventArgs) bool {
	if !strings.HasPrefix(message, "lumen-files:") {
		return false
	}
	tag := strings.TrimPrefix(message, "lumen-files:")
	var paths []string
	var coll unsafe.Pointer
	// ICoreWebView2WebMessageReceivedEventArgs2::get_AdditionalObjects (slot 6)
	if hr := comCall(vtblFn(unsafe.Pointer(args), 6), uintptr(unsafe.Pointer(args)), uintptr(unsafe.Pointer(&coll))); hr == 0 && coll != nil {
		var n uint32
		comCall(vtblFn(coll, 3), uintptr(coll), uintptr(unsafe.Pointer(&n))) // get_Count
		for i := uint32(0); i < n; i++ {
			var unk unsafe.Pointer
			if comCall(vtblFn(coll, 4), uintptr(coll), uintptr(i), uintptr(unsafe.Pointer(&unk))) != 0 || unk == nil {
				continue
			}
			file := unk
			var qi unsafe.Pointer
			if comCall(vtblFn(unk, 0), uintptr(unk), uintptr(unsafe.Pointer(iidICoreWebView2File)), uintptr(unsafe.Pointer(&qi))) == 0 && qi != nil {
				file = qi
			}
			var p *uint16
			if comCall(vtblFn(file, 3), uintptr(file), uintptr(unsafe.Pointer(&p))) == 0 && p != nil { // get_Path
				paths = append(paths, windows.UTF16PtrToString(p))
				windows.CoTaskMemFree(unsafe.Pointer(p))
			}
			if qi != nil {
				comCall(vtblFn(qi, 2), uintptr(qi))
			}
			comCall(vtblFn(unk, 2), uintptr(unk))
		}
		comCall(vtblFn(coll, 2), uintptr(coll))
	}
	if FilesHook != nil {
		FilesHook(tag, paths)
	}
	return true
}
