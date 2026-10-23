//go:build windows

package main

// Single-instance mode: double-clicking another file while Lumen is open
// hands it to the running window instead of starting a second WebView2
// browser — opening becomes near-instant.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows"
)

var (
	pAllowSetForegroundWindow = user32.NewProc("AllowSetForegroundWindow")
	pSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	pShowWindow               = user32.NewProc("ShowWindow")
	pIsIconic                 = user32.NewProc("IsIconic")
	instanceMutex             windows.Handle
)

type instanceInfo struct {
	Addr  string `json:"addr"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
}

func instancePath() string { return filepath.Join(dataDir(), "instance.json") }

// singleInstanceEnabled reads the user's setting (default on).
func singleInstanceEnabled(statePath string) bool {
	var st struct {
		Settings struct {
			SingleInstance *bool `json:"singleInstance"`
		} `json:"settings"`
	}
	if b, err := os.ReadFile(statePath); err == nil && json.Unmarshal(b, &st) == nil && st.Settings.SingleInstance != nil {
		return *st.Settings.SingleInstance
	}
	return true
}

// forwardToRunning returns true if another Lumen took the files.
// Otherwise this process becomes the primary instance.
func forwardToRunning(args []string) bool {
	h, err := windows.CreateMutex(nil, false, u16("Local\\LumenMediaPlayer.Instance"))
	if err != windows.ERROR_ALREADY_EXISTS {
		instanceMutex = h // we're first; keep the handle for the life of the process
		return false
	}
	windows.CloseHandle(h)
	paths := make([]string, 0, len(args))
	for _, a := range args {
		if abs, err := filepath.Abs(a); err == nil {
			paths = append(paths, abs)
		}
	}
	body, _ := json.Marshal(paths)
	pAllowSetForegroundWindow.Call(uintptr(0xFFFFFFFF)) // ASFW_ANY: let the running window come to the front
	client := &http.Client{Timeout: 2 * time.Second}
	// The first instance may still be starting (e.g. several files opened at once): wait a little.
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(120 * time.Millisecond) {
		b, err := os.ReadFile(instancePath())
		if err != nil {
			continue
		}
		var info instanceInfo
		if json.Unmarshal(b, &info) != nil || info.Addr == "" {
			continue
		}
		resp, err := client.Post("http://"+info.Addr+"/s/"+info.Token+"/remote", "application/json", bytes.NewReader(body))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusNoContent {
				return true
			}
		}
	}
	return false
}

func publishInstance(srv *Server) {
	b, _ := json.Marshal(instanceInfo{Addr: srv.Addr(), Token: srv.Token(), PID: os.Getpid()})
	tmp := instancePath() + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		os.Rename(tmp, instancePath())
	}
}

func bringToFront(hwnd uintptr) {
	if r, _, _ := pIsIconic.Call(hwnd); r != 0 {
		pShowWindow.Call(hwnd, 9) // SW_RESTORE
	}
	pSetForegroundWindow.Call(hwnd)
}
