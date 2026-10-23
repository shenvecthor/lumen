package main

// Local media server. The UI and every media file are served from a
// loopback-only HTTP server so the WebView2 engine gets proper streaming
// (HTTP range requests) for large files. Access is locked down three ways:
//   1. bound to 127.0.0.1 on a random port,
//   2. every URL carries a random 256-bit session token,
//   3. only files the user explicitly opened are on the allow-list.

import (
	"crypto/rand"
	"embed"
	"encoding/json"
	"encoding/hex"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
)

//go:embed ui
var uiFS embed.FS

var mediaExt = map[string]string{
	".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/webm", ".mka": "audio/webm",
	".mov": "video/quicktime", ".ogv": "video/ogg", ".avi": "video/x-msvideo", ".wmv": "video/x-ms-wmv",
	".3gp": "video/3gpp", ".ts": "video/mp2t", ".m2ts": "video/mp2t",
	".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac",
	".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg",
	".weba": "audio/webm", ".wma": "audio/x-ms-wma",
}
var subExt = map[string]string{".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt; charset=utf-8", ".ass": "text/plain; charset=utf-8", ".ssa": "text/plain; charset=utf-8"}

type Item struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	URL      string `json:"url"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size,omitempty"`
	Label    string `json:"label,omitempty"`
	Lang     string `json:"lang,omitempty"`
	Default  bool   `json:"default,omitempty"`
	Forced   bool   `json:"forced,omitempty"`
	Embedded bool   `json:"embedded,omitempty"`
}

type Server struct {
	token   string
	addr    string
	prefix  string
	mu      sync.RWMutex
	allowed map[string]string // key(path) -> clean path

	// OnRemote receives files from a second Lumen launch (single-instance mode).
	OnRemote func(paths []string)
}

func (s *Server) Addr() string  { return s.addr }
func (s *Server) Token() string { return s.token }

func NewServer() (*Server, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := &Server{token: hex.EncodeToString(b), addr: ln.Addr().String(), allowed: map[string]string{}}
	s.prefix = "/s/" + s.token + "/"
	go http.Serve(ln, s)
	return s, nil
}

func (s *Server) AppURL() string { return "http://" + s.addr + s.prefix }

func key(p string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(p)
	}
	return p
}

func kindOf(p string) string {
	ext := strings.ToLower(filepath.Ext(p))
	if _, ok := subExt[ext]; ok {
		return "sub"
	}
	m, ok := mediaExt[ext]
	if !ok {
		return ""
	}
	return strings.SplitN(m, "/", 2)[0]
}

// Allow puts a file on the allow-list and returns its playlist item.
func (s *Server) Allow(p string) (Item, bool) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return Item{}, false
	}
	abs = filepath.Clean(abs)
	k := kindOf(abs)
	if k == "" {
		return Item{}, false
	}
	st, err := os.Stat(abs)
	if err != nil || st.IsDir() {
		return Item{}, false
	}
	s.mu.Lock()
	s.allowed[key(abs)] = abs
	s.mu.Unlock()
	return Item{
		Name: filepath.Base(abs),
		Path: abs,
		URL:  s.prefix + "f?p=" + url.QueryEscape(abs),
		Kind: k,
		Size: st.Size(),
	}, true
}

func isPlaylist(p string) bool {
	e := strings.ToLower(filepath.Ext(p))
	return e == ".m3u" || e == ".m3u8"
}

// readPlaylist returns the local file entries of an .m3u/.m3u8 playlist
// (relative entries are resolved against the playlist's folder; URLs are skipped).
func readPlaylist(p string) []string {
	b, err := os.ReadFile(p)
	if err != nil || len(b) > 8<<20 {
		return nil
	}
	dir, out := filepath.Dir(p), []string{}
	for _, line := range strings.Split(strings.TrimPrefix(string(b), "\ufeff"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.Contains(line, "://") {
			continue
		}
		line = filepath.FromSlash(strings.ReplaceAll(line, "\\", "/"))
		if !filepath.IsAbs(line) {
			line = filepath.Join(dir, line)
		}
		out = append(out, line)
	}
	return out
}

// Chapters returns the chapter list of an opened Matroska file.
func (s *Server) Chapters(p string) []Chapter {
	s.mu.RLock()
	clean, ok := s.allowed[key(filepath.Clean(p))]
	s.mu.RUnlock()
	out := []Chapter{}
	if !ok {
		return out
	}
	if e := strings.ToLower(filepath.Ext(clean)); e != ".mkv" && e != ".mka" && e != ".webm" {
		return out
	}
	if m, err := parseMKV(clean, false); err == nil && m.chapters != nil {
		return m.chapters
	}
	return out
}

// Neighbor returns the next (dir > 0) or previous media file in the same folder,
// in natural order, like MPC-HC's PageDown / PageUp.
func (s *Server) Neighbor(p string, dir int) *Item {
	s.mu.RLock()
	clean, ok := s.allowed[key(filepath.Clean(p))]
	s.mu.RUnlock()
	if !ok {
		return nil
	}
	folder, name := filepath.Dir(clean), filepath.Base(clean)
	entries, _ := os.ReadDir(folder)
	names := []string{}
	for _, e := range entries {
		if k := kindOf(e.Name()); !e.IsDir() && k != "" && k != "sub" {
			names = append(names, e.Name())
		}
	}
	sort.Slice(names, func(i, j int) bool { return naturalLess(names[i], names[j]) })
	for i, n := range names {
		if key(n) == key(name) {
			if j := i + dir; j >= 0 && j < len(names) {
				if it, ok := s.Allow(filepath.Join(folder, names[j])); ok {
					return &it
				}
			}
			return nil
		}
	}
	return nil
}

// Expand turns a mix of files and folders into playlist items (folders are
// scanned one level deep, sorted naturally by name).
func (s *Server) Expand(paths []string) []Item {
	out := []Item{}
	for _, p := range paths {
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		if st.IsDir() {
			entries, _ := os.ReadDir(p)
			names := []string{}
			for _, e := range entries {
				if !e.IsDir() && kindOf(e.Name()) != "" && kindOf(e.Name()) != "sub" {
					names = append(names, e.Name())
				}
			}
			sort.Slice(names, func(i, j int) bool { return naturalLess(names[i], names[j]) })
			for _, n := range names {
				if it, ok := s.Allow(filepath.Join(p, n)); ok {
					out = append(out, it)
				}
			}
			continue
		}
		if isPlaylist(p) {
			for _, e := range readPlaylist(p) {
				if st, err := os.Stat(e); err == nil && !st.IsDir() && !isPlaylist(e) { // no nesting, no loops
					if it, ok := s.Allow(e); ok {
						out = append(out, it)
					}
				}
			}
			continue
		}
		if it, ok := s.Allow(p); ok {
			out = append(out, it)
		}
	}
	return out
}

// Subs finds subtitles for a video: text tracks embedded in an .mkv/.webm,
// plus files sitting next to it ("Movie.srt", "Movie.en.srt", …).
func (s *Server) Subs(video string) []Item {
	s.mu.RLock()
	clean, ok := s.allowed[key(filepath.Clean(video))]
	s.mu.RUnlock()
	out := []Item{}
	if !ok {
		return out
	}
	video = clean
	if ext := strings.ToLower(filepath.Ext(video)); ext == ".mkv" || ext == ".webm" || ext == ".mka" {
		if m, err := parseMKV(video, false); err == nil {
			for _, n := range m.order {
				t := m.tracks[n]
				out = append(out, Item{
					Name: filepath.Base(video), Path: video, Kind: "sub", Embedded: true,
					URL:   s.prefix + "mkvsub?p=" + url.QueryEscape(video) + "&t=" + strconv.FormatUint(n, 10),
					Label: t.Name, Lang: t.Lang, Default: t.Default, Forced: t.Forced,
				})
			}
		}
	}
	dir, stem := filepath.Dir(video), strings.TrimSuffix(filepath.Base(video), filepath.Ext(video))
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || kindOf(n) != "sub" {
			continue
		}
		if b := strings.ToLower(n); strings.HasPrefix(b, strings.ToLower(stem)+".") {
			if it, ok := s.Allow(filepath.Join(dir, n)); ok {
				out = append(out, it)
			}
		}
	}
	return out
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Reject DNS-rebinding and anything not addressed to us exactly.
	isRemote := r.URL.Path == s.prefix+"remote"
	if r.Host != s.addr || (r.Method != http.MethodGet && r.Method != http.MethodHead && !(isRemote && r.Method == http.MethodPost)) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if !strings.HasPrefix(r.URL.Path, s.prefix) {
		http.NotFound(w, r)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, s.prefix)
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cache-Control", "no-store")

	switch rest {
	case "", "index.html":
		b, _ := fs.ReadFile(uiFS, "ui/index.html")
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' blob:")
		w.Write(b)
	case "f":
		p := r.URL.Query().Get("p")
		s.mu.RLock()
		clean, ok := s.allowed[key(filepath.Clean(p))]
		s.mu.RUnlock()
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		f, err := os.Open(clean)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ext := strings.ToLower(filepath.Ext(clean))
		ct := mediaExt[ext]
		if ct == "" {
			ct = subExt[ext]
		}
		if ct == "" {
			ct = mime.TypeByExtension(ext)
		}
		h.Set("Content-Type", ct)
		// Cacheable for this session (URLs carry a per-launch token), so the
		// seek-preview stream and replays reuse what was already read.
		h.Set("Cache-Control", "private, max-age=86400")
		http.ServeContent(w, r, "", st.ModTime(), f) // handles Range requests
	case "remote":
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var paths []string
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&paths); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if s.OnRemote != nil {
			s.OnRemote(paths)
		}
		w.WriteHeader(http.StatusNoContent)
	case "mkvsub":
		p := r.URL.Query().Get("p")
		s.mu.RLock()
		clean, ok := s.allowed[key(filepath.Clean(p))]
		s.mu.RUnlock()
		n, err := strconv.ParseUint(r.URL.Query().Get("t"), 10, 64)
		if !ok || err != nil {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		m, err := extractMKV(clean)
		if err != nil || m.tracks[n] == nil {
			http.NotFound(w, r)
			return
		}
		h.Set("Content-Type", "text/vtt; charset=utf-8")
		io.WriteString(w, m.tracks[n].VTT())
	default:
		// other UI assets (app.js, app.css, …) embedded next to index.html
		if ct, ok := map[string]string{".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}[filepath.Ext(rest)]; ok && !strings.Contains(rest, "/") {
			if b, err := fs.ReadFile(uiFS, "ui/"+rest); err == nil {
				h.Set("Content-Type", ct)
				w.Write(b)
				return
			}
		}
		http.NotFound(w, r)
	}
}

// naturalLess sorts "Ep 2" before "Ep 10".
func naturalLess(a, b string) bool {
	a, b = strings.ToLower(a), strings.ToLower(b)
	for a != "" && b != "" {
		ca, cb := a[0], b[0]
		if isDigit(ca) && isDigit(cb) {
			na, ra := splitNum(a)
			nb, rb := splitNum(b)
			na, nb = strings.TrimLeft(na, "0"), strings.TrimLeft(nb, "0")
			if len(na) != len(nb) {
				return len(na) < len(nb)
			}
			if na != nb {
				return na < nb
			}
			a, b = ra, rb
			continue
		}
		if ca != cb {
			return ca < cb
		}
		a, b = a[1:], b[1:]
	}
	return len(a) < len(b)
}
func isDigit(c byte) bool { return c >= '0' && c <= '9' }
func splitNum(s string) (string, string) {
	i := 0
	for i < len(s) && isDigit(s[i]) {
		i++
	}
	return s[:i], s[i:]
}
