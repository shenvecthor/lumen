package main

import (
	"math"
	"testing"
)

const nc, ncH, menu = 16, 39, 35 // typical Windows 11 frame + Lumen menu bar at 100 %

func stageRatio(r [4]int32, extraW int32) float64 {
	return float64(r[2]-r[0]-nc-extraW) / float64(r[3]-r[1]-ncH-menu)
}

func TestLockAspectEdges(t *testing.T) {
	ratio := 16.0 / 9
	for _, tc := range []struct {
		name string
		edge int
		in   [4]int32
		keep [2]int // indices that must not move
	}{
		{"right edge drags width", wmszRight, [4]int32{100, 100, 1300, 700}, [2]int{0, 1}},
		{"left edge keeps right side", wmszLeft, [4]int32{50, 100, 1300, 700}, [2]int{2, 1}},
		{"bottom edge drags height", wmszBottom, [4]int32{100, 100, 1000, 900}, [2]int{0, 1}},
		{"top edge keeps bottom", wmszTop, [4]int32{100, 50, 1000, 800}, [2]int{0, 3}},
		{"bottom-right corner", wmszBottomRight, [4]int32{100, 100, 1500, 800}, [2]int{0, 1}},
		{"top-left corner keeps bottom-right", wmszTopLeft, [4]int32{40, 30, 1100, 800}, [2]int{2, 3}},
	} {
		r := tc.in
		if !lockAspect(tc.edge, &r, nc, ncH, 0, menu, ratio, 0, 0) {
			t.Fatalf("%s: not handled", tc.name)
		}
		if got := stageRatio(r, 0); math.Abs(got-ratio) > 0.01 {
			t.Errorf("%s: stage ratio %.3f, want %.3f (rect %v)", tc.name, got, ratio, r)
		}
		for _, k := range tc.keep {
			if r[k] != tc.in[k] {
				t.Errorf("%s: side %d moved from %d to %d", tc.name, k, tc.in[k], r[k])
			}
		}
	}
}

func TestLockAspectWithPlaylistAndLimits(t *testing.T) {
	r := [4]int32{0, 0, 1400, 600}
	lockAspect(wmszRight, &r, nc, ncH, 320, menu, 2.39, 0, 0) // scope film, playlist open
	if got := stageRatio(r, 320); math.Abs(got-2.39) > 0.01 {
		t.Errorf("playlist open: ratio %.3f", got)
	}
	// a vertical phone video dragged wide must stay on a 1080-high screen
	r = [4]int32{0, 0, 1600, 900}
	lockAspect(wmszRight, &r, nc, ncH, 0, menu, 9.0/16, 1920, 1040)
	if r[3]-r[1] > 1040 {
		t.Errorf("taller than the screen: %v", r)
	}
	if got := stageRatio(r, 0); math.Abs(got-9.0/16) > 0.01 {
		t.Errorf("clamped ratio %.3f", got)
	}
	if lockAspect(wmszRight, &r, nc, ncH, 0, menu, 0, 0, 0) {
		t.Error("ratio 0 must leave the window alone")
	}
}

func TestFitRect(t *testing.T) {
	wa := [4]int32{0, 0, 1920, 1040}
	out := fitRect([4]int32{300, 200, 1400, 900}, wa, nc, ncH, 0, menu, 16.0/9)
	if got := stageRatio(out, 0); math.Abs(got-16.0/9) > 0.01 {
		t.Errorf("fit ratio %.3f %v", got, out)
	}
	out = fitRect([4]int32{300, 50, 1900, 900}, wa, nc, ncH, 0, menu, 9.0/16)
	if out[3]-out[1] > 1040 || out[0] < 0 || out[1] < 0 || out[2] > 1920 {
		t.Errorf("fit left the screen: %v", out)
	}
	if got := stageRatio(out, 0); math.Abs(got-9.0/16) > 0.01 {
		t.Errorf("tall fit ratio %.3f", got)
	}
}

func TestSizeRect(t *testing.T) {
	wa := [4]int32{0, 0, 1920, 1040}
	out := sizeRect([4]int32{400, 200, 1400, 800}, wa, nc, ncH, 0, menu, 640, 360) // 50 % of 720p
	if out[2]-out[0] != 640+nc || out[3]-out[1] != 360+ncH+menu {
		t.Errorf("50%%: %v", out)
	}
	out = sizeRect([4]int32{400, 200, 1400, 800}, wa, nc, ncH, 0, menu, 3840, 2160) // 200 % of 1080p: too big
	if out[2]-out[0] > 1920 || out[3]-out[1] > 1040 || out[0] < 0 || out[1] < 0 {
		t.Errorf("oversize not clamped: %v", out)
	}
	if got := stageRatio(out, 0); math.Abs(got-16.0/9) > 0.01 {
		t.Errorf("shrunk ratio %.3f", got)
	}
}
