package main

// libmpv engine: the shared part. The raw C calls live in mpv_windows.go (the
// DLLs are loaded from the "engine" folder next to Lumen.exe, no C compiler
// involved) and mpv_cgo.go (Linux, for development and tests).

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"math"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

const (
	mpvEvShutdown      = 1
	mpvEvLog           = 2
	mpvEvStartFile     = 6
	mpvEvEndFile       = 7
	mpvEvFileLoaded    = 8
	mpvEvVideoReconfig = 17
	mpvEvAudioReconfig = 18
	mpvEvSeek          = 20
	mpvEvRestart       = 21
	mpvEvProp          = 22

	mpvFmtString = 1
	mpvFmtFlag   = 3
	mpvFmtInt64  = 4
	mpvFmtDouble = 5

	mpvRenderUpdateFrame = 1
)

// C struct mirrors (identical layout on Windows and Linux, 64-bit).
type mpvEvent struct {
	ID    int32
	Error int32
	Reply uint64
	Data  unsafe.Pointer
}
type mpvEventProperty struct {
	Name   *byte
	Format int32
	_      int32
	Data   unsafe.Pointer
}
type mpvEventEndFile struct {
	Reason int32
	Error  int32
}
type mpvEventLog struct {
	Prefix, Level, Text *byte
	LogLevel            int32
}

// mpvAPI is the handful of libmpv functions Lumen uses.
type mpvAPI interface {
	Create() uintptr
	Initialize(h uintptr) int
	SetOption(h uintptr, name, val string) int
	Command(h uintptr, args []string) int
	SetProperty(h uintptr, name, val string) int
	GetProperty(h uintptr, name string) (string, int)
	Observe(h uintptr, id uint64, name string, format int) int
	WaitEvent(h uintptr, timeoutMs int) *mpvEvent
	Wakeup(h uintptr)
	RequestLog(h uintptr, level string) int
	ErrorString(code int) string
	Destroy(h uintptr)
	RenderCreateSW(h uintptr) (uintptr, int)
	RenderSW(ctx uintptr, w, h int) ([]byte, int, int) // pixels (rgb0), stride, error
	RenderUpdate(ctx uintptr) uint64
	RenderFree(ctx uintptr)
}

func goStr(p *byte) string {
	if p == nil {
		return ""
	}
	n := 0
	for *(*byte)(unsafe.Add(unsafe.Pointer(p), n)) != 0 {
		n++
	}
	return string(unsafe.Slice(p, n))
}

func mpvErr(api mpvAPI, code int) error {
	if code >= 0 {
		return nil
	}
	return errors.New(api.ErrorString(code))
}

// ---------------------------------------------------------------- player

// Player is the main playback instance, drawing into a window Lumen provides.
type Player struct {
	api    mpvAPI
	h      uintptr
	emit   func(string) // one JSON event for the interface
	closed atomic.Bool

	mu       sync.Mutex
	timePos  float64
	timeSent float64
	timeDirt bool
}

var observed = []struct {
	name   string
	format int
}{
	{"time-pos", mpvFmtDouble}, {"duration", mpvFmtDouble}, {"pause", mpvFmtFlag}, {"eof-reached", mpvFmtFlag},
	{"seeking", mpvFmtFlag}, {"paused-for-cache", mpvFmtFlag}, {"idle-active", mpvFmtFlag},
	{"volume", mpvFmtDouble}, {"mute", mpvFmtFlag}, {"speed", mpvFmtDouble},
	{"video-params/dw", mpvFmtInt64}, {"video-params/dh", mpvFmtInt64},
	{"track-list", mpvFmtString}, {"chapter-list", mpvFmtString}, {"demuxer-cache-time", mpvFmtDouble},
	{"aid", mpvFmtString}, {"sid", mpvFmtString}, {"chapter", mpvFmtInt64},
}

// playerOptions: no config files, scripts, on-screen display or input of mpv's
// own — Lumen's interface does all of that. wid "" means no video output (tests).
func playerOptions(wid string) [][2]string {
	o := [][2]string{
		{"config", "no"}, {"terminal", "no"}, {"load-scripts", "no"}, {"ytdl", "no"},
		{"idle", "yes"}, {"keep-open", "yes"}, {"force-window", "no"},
		{"input-default-bindings", "no"}, {"input-vo-keyboard", "no"}, {"input-cursor", "no"}, {"cursor-autohide", "no"},
		{"osc", "no"}, {"osd-level", "0"}, {"osd-bar", "no"},
		{"hwdec", "auto-safe"}, {"volume-max", "250"}, {"audio-client-name", "Lumen"},
		{"sub-auto", "fuzzy"}, {"sid", "no"}, {"audio-file-auto", "no"}, {"keepaspect-window", "no"},
		{"screenshot-format", "png"}, {"screenshot-tag-colorspace", "yes"},
	}
	if wid != "" {
		o = append(o, [2]string{"wid", wid}, [2]string{"vo", "gpu-next,gpu"})
	} else {
		o = append(o, [2]string{"vo", "null"}, [2]string{"ao", "null"})
	}
	return o
}

func NewPlayer(api mpvAPI, opts [][2]string, emit func(string)) (*Player, error) {
	h := api.Create()
	if h == 0 {
		return nil, errors.New("mpv_create failed")
	}
	for _, o := range opts {
		api.SetOption(h, o[0], o[1]) // unknown options are skipped, not fatal
	}
	if r := api.Initialize(h); r < 0 {
		api.Destroy(h)
		return nil, fmt.Errorf("mpv: %v", mpvErr(api, r))
	}
	api.RequestLog(h, "error")
	for i, o := range observed {
		api.Observe(h, uint64(i+1), o.name, o.format)
	}
	p := &Player{api: api, h: h, emit: emit, timePos: math.NaN(), timeSent: math.NaN()}
	go p.loop()
	go p.ticker()
	return p, nil
}

func (p *Player) Command(args ...string) error {
	if p.closed.Load() {
		return errors.New("engine closed")
	}
	return mpvErr(p.api, p.api.Command(p.h, args))
}
func (p *Player) Set(name, val string) error {
	if p.closed.Load() {
		return errors.New("engine closed")
	}
	return mpvErr(p.api, p.api.SetProperty(p.h, name, val))
}
func (p *Player) Get(name string) (string, error) {
	if p.closed.Load() {
		return "", errors.New("engine closed")
	}
	s, r := p.api.GetProperty(p.h, name)
	return s, mpvErr(p.api, r)
}

// Close asks mpv to shut down; the event loop then destroys the handle.
func (p *Player) Close() {
	if p.closed.CompareAndSwap(false, true) {
		p.api.Command(p.h, []string{"quit"})
	}
}

// time-pos changes every frame; the interface gets it at most ~10 times a second.
func (p *Player) ticker() {
	for !p.closed.Load() {
		time.Sleep(100 * time.Millisecond)
		p.flushTime()
	}
}
func (p *Player) flushTime() {
	p.mu.Lock()
	t, dirty := p.timePos, p.timeDirt
	p.timeDirt = false
	p.mu.Unlock()
	if dirty {
		p.emit(`{"e":"prop","n":"time-pos","v":` + jnum(t) + `}`)
	}
}

func jnum(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return "null"
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

var endReasons = map[int32]string{0: "eof", 2: "stop", 3: "quit", 4: "error", 5: "redirect"}

func (p *Player) loop() {
	for {
		ev := p.api.WaitEvent(p.h, -1)
		if ev == nil {
			continue
		}
		switch ev.ID {
		case mpvEvShutdown:
			p.closed.Store(true)
			p.api.Destroy(p.h)
			p.emit(`{"e":"shutdown"}`)
			return
		case mpvEvProp:
			pr := (*mpvEventProperty)(ev.Data)
			name := goStr(pr.Name)
			val := "null"
			if pr.Data != nil {
				switch pr.Format {
				case mpvFmtDouble:
					val = jnum(*(*float64)(pr.Data))
				case mpvFmtFlag:
					val = strconv.FormatBool(*(*int32)(pr.Data) != 0)
				case mpvFmtInt64:
					val = strconv.FormatInt(*(*int64)(pr.Data), 10)
				case mpvFmtString:
					s := goStr(*(**byte)(pr.Data))
					if name == "track-list" || name == "chapter-list" {
						if json.Valid([]byte(s)) {
							val = s
						} else {
							val = "[]"
						}
					} else {
						b, _ := json.Marshal(s)
						val = string(b)
					}
				}
			}
			if name == "time-pos" {
				t := math.NaN()
				if pr.Format == mpvFmtDouble && pr.Data != nil {
					t = *(*float64)(pr.Data)
				}
				p.mu.Lock()
				p.timePos, p.timeDirt = t, true
				p.mu.Unlock()
				continue
			}
			if name == "pause" || name == "seeking" {
				p.flushTime()
			}
			p.emit(`{"e":"prop","n":` + strconv.Quote(name) + `,"v":` + val + `}`)
		case mpvEvEndFile:
			ef := (*mpvEventEndFile)(ev.Data)
			msg := ""
			if ef.Error < 0 {
				msg = p.api.ErrorString(int(ef.Error))
			}
			b, _ := json.Marshal(map[string]any{"e": "end-file", "reason": endReasons[ef.Reason], "error": msg})
			p.emit(string(b))
		case mpvEvLog:
			lm := (*mpvEventLog)(ev.Data)
			b, _ := json.Marshal(map[string]any{"e": "log", "level": goStr(lm.Level), "prefix": goStr(lm.Prefix), "text": goStr(lm.Text)})
			p.emit(string(b))
		case mpvEvStartFile:
			p.emit(`{"e":"start-file"}`)
		case mpvEvFileLoaded:
			p.emit(`{"e":"file-loaded"}`)
		case mpvEvVideoReconfig:
			p.emit(`{"e":"video-reconfig"}`)
		case mpvEvSeek:
			p.emit(`{"e":"seek"}`)
		case mpvEvRestart:
			p.flushTime()
			p.emit(`{"e":"playback-restart"}`)
		}
	}
}

// ---------------------------------------------------------------- frames

// Grabber is a second, hidden mpv instance that decodes single frames on the
// CPU (libmpv's software renderer) for seek-bar previews, the thumbnail sheet,
// ambient light and the zoom minimap while the engine is playing.
type Grabber struct {
	api       mpvAPI
	h, rctx   uintptr
	mu        sync.Mutex
	path      string
	dw, dh    int
	duration  float64
	failUntil time.Time
}

func NewGrabber(api mpvAPI) (*Grabber, error) {
	h := api.Create()
	if h == 0 {
		return nil, errors.New("mpv_create failed")
	}
	for _, o := range [][2]string{
		{"config", "no"}, {"terminal", "no"}, {"load-scripts", "no"}, {"ytdl", "no"},
		{"vo", "libmpv"}, {"hwdec", "no"}, {"aid", "no"}, {"sid", "no"}, {"sub-auto", "no"}, {"audio-file-auto", "no"},
		{"pause", "yes"}, {"idle", "yes"}, {"keep-open", "always"}, {"cache", "no"}, {"demuxer-readahead-secs", "0"},
		{"vd-lavc-threads", "2"}, {"vd-lavc-skiploopfilter", "all"}, {"vd-lavc-fast", "yes"}, {"osd-level", "0"},
	} {
		api.SetOption(h, o[0], o[1])
	}
	if r := api.Initialize(h); r < 0 {
		api.Destroy(h)
		return nil, mpvErr(api, r)
	}
	rctx, r := api.RenderCreateSW(h)
	if r < 0 {
		api.Destroy(h)
		return nil, fmt.Errorf("software renderer: %v", mpvErr(api, r))
	}
	return &Grabber{api: api, h: h, rctx: rctx}, nil
}

// wait pumps the grabber's events until one of ids arrives (or an error ends the file).
func (g *Grabber) wait(timeout time.Duration, ids ...int32) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ev := g.api.WaitEvent(g.h, 50)
		if ev == nil || ev.ID == 0 {
			continue
		}
		if ev.ID == mpvEvEndFile {
			ef := (*mpvEventEndFile)(ev.Data)
			if ef.Reason == 4 {
				return errors.New("can't decode: " + g.api.ErrorString(int(ef.Error)))
			}
		}
		for _, id := range ids {
			if ev.ID == id {
				return nil
			}
		}
	}
	return errors.New("timed out")
}

func (g *Grabber) drain() {
	for {
		ev := g.api.WaitEvent(g.h, 0)
		if ev == nil || ev.ID == 0 {
			return
		}
	}
}

// Frame returns the picture at time t, at most maxW pixels wide, as a JPEG data URL.
func (g *Grabber) Frame(path string, t float64, maxW int, exact bool) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if time.Now().Before(g.failUntil) && g.path == path {
		return "", errors.New("no picture")
	}
	if path != g.path {
		g.drain()
		g.path, g.dw, g.dh = "", 0, 0
		if err := mpvErr(g.api, g.api.Command(g.h, []string{"loadfile", path, "replace"})); err != nil {
			return "", err
		}
		if err := g.wait(10*time.Second, mpvEvFileLoaded); err != nil {
			g.path, g.failUntil = path, time.Now().Add(30*time.Second)
			return "", err
		}
		g.path = path
		g.duration, _ = strconv.ParseFloat(g.prop("duration"), 64)
	}
	if g.duration > 0 {
		t = math.Max(0, math.Min(t, g.duration-0.05))
	}
	g.drain()
	mode := "absolute+keyframes"
	if exact {
		mode = "absolute+exact"
	}
	if err := mpvErr(g.api, g.api.Command(g.h, []string{"seek", strconv.FormatFloat(t, 'f', 3, 64), mode})); err != nil {
		return "", err
	}
	if err := g.wait(8*time.Second, mpvEvRestart); err != nil {
		return "", err
	}
	if g.dw == 0 {
		g.dw, _ = strconv.Atoi(g.prop("video-params/dw"))
		g.dh, _ = strconv.Atoi(g.prop("video-params/dh"))
		if g.dw <= 0 || g.dh <= 0 {
			g.failUntil = time.Now().Add(30 * time.Second)
			return "", errors.New("no video")
		}
	}
	w := g.dw
	if maxW > 0 && w > maxW {
		w = maxW
	}
	w &^= 1
	h := int(math.Round(float64(w) * float64(g.dh) / float64(g.dw)))
	if w < 2 || h < 2 {
		return "", errors.New("too small")
	}
	// wait until the decoded frame has reached the renderer
	for i := 0; i < 200 && g.api.RenderUpdate(g.rctx)&mpvRenderUpdateFrame == 0; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	px, stride, r := g.api.RenderSW(g.rctx, w, h)
	if r < 0 {
		return "", mpvErr(g.api, r)
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		src, dst := px[y*stride:y*stride+w*4], img.Pix[y*img.Stride:y*img.Stride+w*4]
		copy(dst, src)
		for x := 3; x < len(dst); x += 4 {
			dst[x] = 255
		}
	}
	var buf bytes.Buffer
	q := 82
	if maxW <= 64 {
		q = 70
	}
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: q}); err != nil {
		return "", err
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func (g *Grabber) prop(name string) string { s, _ := g.api.GetProperty(g.h, name); return s }

// Forget releases the open file (e.g. when playback stops) so it isn't kept locked.
func (g *Grabber) Forget() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.path != "" {
		g.api.Command(g.h, []string{"stop"})
		g.path, g.dw, g.dh, g.failUntil = "", 0, 0, time.Time{}
	}
}
