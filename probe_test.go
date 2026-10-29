package main

import (
	"os/exec"
	"path/filepath"
	"testing"
)

// Generates tiny sample files with ffmpeg (skipped when ffmpeg isn't installed)
// and checks which engine each one gets.
func TestProbe(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	v := []string{"-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-t", "1"}
	a := []string{"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1"}
	cases := []struct {
		name, engine string
		args         []string
	}{
		{"h264-aac.mp4", "web", append(append(append([]string{}, v...), a...), "-c:v", "libx264", "-c:a", "aac")},
		{"h264-ac3.mkv", "mpv", append(append(append([]string{}, v...), a...), "-c:v", "libx264", "-c:a", "ac3")},
		{"vp9-opus.webm", "web", append(append(append([]string{}, v...), a...), "-c:v", "libvpx-vp9", "-deadline", "realtime", "-c:a", "libopus")},
		{"hevc.mp4", "mpv", append(append([]string{}, v...), "-c:v", "libx265", "-tag:v", "hvc1")},
		{"mpeg4.mp4", "mpv", append(append([]string{}, v...), "-c:v", "mpeg4")},
		{"h264-eac3.mp4", "mpv", append(append(append([]string{}, v...), a...), "-c:v", "libx264", "-c:a", "eac3")},
		{"alac.m4a", "mpv", append(append([]string{}, a...), "-c:a", "alac")},
		{"aac.m4a", "web", append(append([]string{}, a...), "-c:a", "aac")},
		{"clip.avi", "mpv", append(append([]string{}, v...), "-c:v", "mpeg4")},
		{"song.mp3", "web", append(append([]string{}, a...), "-c:a", "libmp3lame")},
	}
	for _, c := range cases {
		p := filepath.Join(dir, c.name)
		args := append([]string{"-hide_banner", "-loglevel", "error", "-y"}, c.args...)
		if out, err := exec.Command("ffmpeg", append(args, p)...).CombinedOutput(); err != nil {
			t.Logf("%s: can't generate (%v) %s", c.name, err, out)
			continue
		}
		got := probeFile(p)
		if got.Engine != c.engine {
			t.Errorf("%s: engine %q (%s), want %q", c.name, got.Engine, got.Why, c.engine)
		} else {
			t.Logf("%s → %s %s", c.name, got.Engine, got.Why)
		}
	}
}
