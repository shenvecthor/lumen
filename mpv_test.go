//go:build linux && cgo && lumenmpv

package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Real libmpv: plays a generated MKV with AC-3 audio and chapters (no video
// output), checks the events Lumen relies on, then grabs preview frames.
func TestEngine(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "clip ac3.mkv")
	meta := filepath.Join(dir, "chap.txt")
	writeFile(t, meta, ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2000\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2000\nEND=4000\ntitle=Two\n")
	if out, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
		"-f", "lavfi", "-i", "sine=frequency=440", "-i", meta, "-map_metadata", "2", "-map", "0", "-map", "1", "-t", "4",
		"-c:v", "libx264", "-c:a", "ac3", p).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, out)
	}
	api, err := loadMPV()
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var evs []map[string]any
	pl, err := NewPlayer(api, playerOptions(""), func(s string) {
		var m map[string]any
		if err := json.Unmarshal([]byte(s), &m); err != nil {
			t.Errorf("bad event JSON %q: %v", s, err)
		}
		mu.Lock()
		evs = append(evs, m)
		mu.Unlock()
	})
	if err != nil {
		t.Fatal(err)
	}
	defer pl.Close()
	if err := pl.Command("loadfile", p); err != nil {
		t.Fatal(err)
	}
	waitFor := func(what string, ok func(m map[string]any) bool) map[string]any {
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			mu.Lock()
			for _, m := range evs {
				if ok(m) {
					mu.Unlock()
					return m
				}
			}
			mu.Unlock()
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatalf("no %s event", what)
		return nil
	}
	prop := func(n string) func(m map[string]any) bool {
		return func(m map[string]any) bool { return m["e"] == "prop" && m["n"] == n && m["v"] != nil }
	}
	waitFor("file-loaded", func(m map[string]any) bool { return m["e"] == "file-loaded" })
	d := waitFor("duration", prop("duration"))["v"].(float64)
	if d < 3.9 || d > 4.1 {
		t.Errorf("duration %v", d)
	}
	tl := waitFor("track-list", func(m map[string]any) bool {
		a, ok := m["v"].([]any)
		return m["n"] == "track-list" && ok && len(a) >= 2
	})["v"].([]any)
	var kinds []string
	for _, x := range tl {
		tr := x.(map[string]any)
		kinds = append(kinds, tr["type"].(string)+":"+tr["codec"].(string))
	}
	if !strings.Contains(strings.Join(kinds, " "), "audio:ac3") {
		t.Errorf("track-list %v", kinds)
	}
	cl := waitFor("chapter-list", func(m map[string]any) bool {
		a, ok := m["v"].([]any)
		return m["n"] == "chapter-list" && ok && len(a) == 2
	})["v"].([]any)
	if cl[1].(map[string]any)["title"] != "Two" {
		t.Errorf("chapters %v", cl)
	}
	w := waitFor("video width", prop("video-params/dw"))["v"].(float64)
	if w != 320 {
		t.Errorf("dw %v", w)
	}
	waitFor("time-pos", func(m map[string]any) bool { v, ok := m["v"].(float64); return m["n"] == "time-pos" && ok && v > 0.5 })
	if err := pl.Set("pause", "yes"); err != nil {
		t.Fatal(err)
	}
	waitFor("pause", func(m map[string]any) bool { return m["n"] == "pause" && m["v"] == true })
	if err := pl.Command("seek", "3", "absolute"); err != nil {
		t.Fatal(err)
	}
	waitFor("seek restart", func(m map[string]any) bool {
		v, ok := m["v"].(float64)
		return m["n"] == "time-pos" && ok && v > 2.9 && v < 3.1
	})
	if s, err := pl.Get("chapter"); err != nil || s != "1" {
		t.Errorf("chapter %q %v", s, err)
	}
	pl.Set("pause", "no")
	waitFor("eof", func(m map[string]any) bool { return m["n"] == "eof-reached" && m["v"] == true })

	g, err := NewGrabber(api)
	if err != nil {
		t.Fatal(err)
	}
	for _, at := range []float64{1, 2.5, 0.2} {
		t0 := time.Now()
		url, err := g.Frame(p, at, 160, true)
		if err != nil || !strings.HasPrefix(url, "data:image/jpeg;base64,") || len(url) < 1000 {
			t.Fatalf("frame at %v: %v (%d bytes)", at, err, len(url))
		}
		t.Logf("frame at %.1fs: %d bytes in %v", at, len(url), time.Since(t0))
		if dump := os.Getenv("LUMEN_DUMP"); dump != "" {
			b, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(url, "data:image/jpeg;base64,"))
			os.WriteFile(filepath.Join(dump, fmt.Sprintf("frame-%.1f.jpg", at)), b, 0o644)
		}
	}
	if _, err := g.Frame(filepath.Join(dir, "missing.mkv"), 1, 160, false); err == nil {
		t.Error("missing file should fail")
	}
}

func writeFile(t *testing.T, p, s string) {
	t.Helper()
	if err := exec.Command("sh", "-c", "cat > \""+p+"\" <<'EOF'\n"+s+"EOF").Run(); err != nil {
		t.Fatal(err)
	}
}
