package main

import "math"

// Window-shape maths for "keep the video's shape while resizing".
// Rectangles are {left, top, right, bottom} in physical pixels.
// ncW/ncH is the window frame (borders + title bar); extraW/extraH is the
// part of the client area that isn't the video stage (menu bar, playlist).

const (
	wmszLeft = 1 + iota
	wmszRight
	wmszTop
	wmszTopLeft
	wmszTopRight
	wmszBottom
	wmszBottomLeft
	wmszBottomRight
)

// lockAspect adjusts a rectangle being dragged on edge so the stage keeps
// ratio (width/height). maxW/maxH (0 = unlimited) keep it on screen.
func lockAspect(edge int, r *[4]int32, ncW, ncH, extraW, extraH int32, ratio float64, maxW, maxH int32) bool {
	if ratio <= 0 || edge < wmszLeft || edge > wmszBottomRight {
		return false
	}
	fw, fh := ncW+extraW, ncH+extraH
	w, h := r[2]-r[0], r[3]-r[1]
	sw := math.Max(float64(w-fw), 80)
	sh := math.Max(float64(h-fh), 60)

	aw, ah := w, int32(math.Round(sw/ratio))+fh // width drives height
	bw, bh := int32(math.Round(sh*ratio))+fw, h // height drives width
	var nw, nh int32
	switch edge {
	case wmszLeft, wmszRight:
		nw, nh = aw, ah
	case wmszTop, wmszBottom:
		nw, nh = bw, bh
	default: // corners: follow whichever direction the user pulled further
		if int64(aw)*int64(ah) >= int64(bw)*int64(bh) {
			nw, nh = aw, ah
		} else {
			nw, nh = bw, bh
		}
	}
	if maxH > 0 && nh > maxH {
		nh = maxH
		nw = int32(math.Round(float64(nh-fh)*ratio)) + fw
	}
	if maxW > 0 && nw > maxW {
		nw = maxW
		nh = int32(math.Round(float64(nw-fw)/ratio)) + fh
	}
	// keep the side opposite the dragged edge where it is
	switch edge {
	case wmszLeft, wmszTopLeft, wmszBottomLeft:
		r[0] = r[2] - nw
	default:
		r[2] = r[0] + nw
	}
	switch edge {
	case wmszTop, wmszTopLeft, wmszTopRight:
		r[1] = r[3] - nh
	default:
		r[3] = r[1] + nh
	}
	return true
}

// fitRect resizes window rectangle r so its stage matches ratio, keeping the
// width (or shrinking to fit the work area wa) and the same centre.
func fitRect(r, wa [4]int32, ncW, ncH, extraW, extraH int32, ratio float64) [4]int32 {
	fw, fh := ncW+extraW, ncH+extraH
	w := r[2] - r[0]
	h := int32(math.Round(float64(w-fw)/ratio)) + fh
	maxW, maxH := wa[2]-wa[0], int32(float64(wa[3]-wa[1])*0.94)
	if h > maxH {
		h = maxH
		w = int32(math.Round(float64(h-fh)*ratio)) + fw
	}
	if w > maxW {
		w = maxW
		h = int32(math.Round(float64(w-fw)/ratio)) + fh
	}
	cx, cy := (r[0]+r[2])/2, (r[1]+r[3])/2
	out := [4]int32{cx - w/2, cy - h/2, cx - w/2 + w, cy - h/2 + h}
	// slide back inside the work area
	if out[0] < wa[0] {
		out[2] += wa[0] - out[0]
		out[0] = wa[0]
	}
	if out[2] > wa[2] {
		out[0] -= out[2] - wa[2]
		out[2] = wa[2]
	}
	if out[1] < wa[1] {
		out[3] += wa[1] - out[1]
		out[1] = wa[1]
	}
	if out[3] > wa[3] {
		out[1] -= out[3] - wa[3]
		out[3] = wa[3]
	}
	return out
}

// sizeRect makes the stage stageW×stageH (physical px) — e.g. the video at 50/100/200 % —
// keeping the window centred, shrinking proportionally to fit the work area.
func sizeRect(r, wa [4]int32, ncW, ncH, extraW, extraH, stageW, stageH int32) [4]int32 {
	fw, fh := ncW+extraW, ncH+extraH
	maxW, maxH := wa[2]-wa[0], wa[3]-wa[1]
	sw, sh := float64(stageW), float64(stageH)
	if k := math.Min(float64(maxW-fw)/sw, float64(maxH-fh)/sh); k < 1 {
		sw, sh = sw*k, sh*k
	}
	w, h := int32(math.Round(sw))+fw, int32(math.Round(sh))+fh
	cx, cy := (r[0]+r[2])/2, (r[1]+r[3])/2
	out := [4]int32{cx - w/2, cy - h/2, cx - w/2 + w, cy - h/2 + h}
	if out[0] < wa[0] {
		out[2] += wa[0] - out[0]
		out[0] = wa[0]
	}
	if out[2] > wa[2] {
		out[0] -= out[2] - wa[2]
		out[2] = wa[2]
	}
	if out[1] < wa[1] {
		out[3] += wa[1] - out[1]
		out[1] = wa[1]
	}
	if out[3] > wa[3] {
		out[1] -= out[3] - wa[3]
		out[3] = wa[3]
	}
	return out
}
