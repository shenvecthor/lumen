//go:build !windows

package main

// Development harness: serves the UI in a normal browser so it can be tested
// without Windows, exposing the same calls the Windows build binds into the
// page. The real app is main_windows.go.

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
)

func main() {
	srv, err := NewServer()
	if err != nil {
		panic(err)
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	j := func(w http.ResponseWriter, v any) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(v)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/args", func(w http.ResponseWriter, r *http.Request) { j(w, srv.Expand(os.Args[1:])) })
	mux.HandleFunc("/expand", func(w http.ResponseWriter, r *http.Request) { j(w, srv.Expand(r.URL.Query()["p"])) })
	mux.HandleFunc("/chapters", func(w http.ResponseWriter, r *http.Request) { j(w, srv.Chapters(r.URL.Query().Get("p"))) })
	mux.HandleFunc("/neighbor", func(w http.ResponseWriter, r *http.Request) {
		d := 1
		if r.URL.Query().Get("d") == "-1" {
			d = -1
		}
		j(w, srv.Neighbor(r.URL.Query().Get("p"), d))
	})
	mux.HandleFunc("/subs", func(w http.ResponseWriter, r *http.Request) { j(w, srv.Subs(r.URL.Query().Get("p"))) })
	devEngine(mux, j)
	go http.Serve(ln, mux)
	srv.OnRemote = func(p []string) { fmt.Println("REMOTE", p) }
	os.WriteFile(os.TempDir()+"/lumen-dev-token", []byte(srv.Token()+" "+srv.Addr()), 0o600)
	fmt.Println("DEV", "http://"+ln.Addr().String())
	fmt.Println(srv.AppURL())
	select {}
}

// devEngine mirrors the Windows engine bindings over HTTP (tests call them from
// the page) and streams engine events with server-sent events. Built with
// -tags lumenmpv it drives real libmpv (no video output); otherwise it reports
// the engine as unavailable.
func devEngine(mux *http.ServeMux, j func(http.ResponseWriter, any)) {
	var mu sync.Mutex
	var player *Player
	var grab *Grabber
	var subscribers []chan string
	rect := map[string]any{}
	emit := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		for _, c := range subscribers {
			select {
			case c <- s:
			default:
			}
		}
	}
	start := func() (*Player, error) {
		mu.Lock()
		defer mu.Unlock()
		if player != nil {
			return player, nil
		}
		api, err := loadMPV()
		if err != nil {
			return nil, err
		}
		p, err := NewPlayer(api, playerOptions(""), func(s string) { go emit(s) })
		player = p
		return p, err
	}
	errJ := func(w http.ResponseWriter, err error) {
		if err != nil {
			j(w, map[string]string{"error": err.Error()})
			return
		}
		j(w, map[string]string{})
	}
	body := func(r *http.Request, v any) { json.NewDecoder(r.Body).Decode(v) }
	mux.HandleFunc("/engine", func(w http.ResponseWriter, r *http.Request) {
		_, err := loadMPV()
		out := map[string]any{"ok": err == nil}
		if err != nil {
			out["error"] = err.Error()
		}
		j(w, out)
	})
	mux.HandleFunc("/probe", func(w http.ResponseWriter, r *http.Request) { j(w, probeFile(r.URL.Query().Get("p"))) })
	mux.HandleFunc("/mpv/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		c := make(chan string, 1024)
		mu.Lock()
		subscribers = append(subscribers, c)
		mu.Unlock()
		fl, _ := w.(http.Flusher)
		fmt.Fprint(w, ": hi\n\n")
		fl.Flush()
		for {
			select {
			case s := <-c:
				fmt.Fprintf(w, "data: %s\n\n", s)
				fl.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})
	mux.HandleFunc("/mpv/open", func(w http.ResponseWriter, r *http.Request) {
		var a struct {
			Path   string
			Start  float64
			Paused bool
		}
		body(r, &a)
		p, err := start()
		if err == nil {
			st := "none"
			if a.Start > 0 {
				st = strconv.FormatFloat(a.Start, 'f', 3, 64)
			}
			p.Set("start", st)
			p.Set("pause", map[bool]string{true: "yes", false: "no"}[a.Paused])
			err = p.Command("loadfile", a.Path, "replace")
		}
		errJ(w, err)
	})
	mux.HandleFunc("/mpv/cmd", func(w http.ResponseWriter, r *http.Request) {
		var args []string
		body(r, &args)
		if player == nil {
			errJ(w, fmt.Errorf("engine not started"))
			return
		}
		errJ(w, player.Command(args...))
	})
	mux.HandleFunc("/mpv/set", func(w http.ResponseWriter, r *http.Request) {
		var a struct{ Name, Val string }
		body(r, &a)
		if player == nil {
			errJ(w, fmt.Errorf("engine not started"))
			return
		}
		errJ(w, player.Set(a.Name, a.Val))
	})
	mux.HandleFunc("/mpv/get", func(w http.ResponseWriter, r *http.Request) {
		if player == nil {
			errJ(w, fmt.Errorf("engine not started"))
			return
		}
		s, err := player.Get(r.URL.Query().Get("n"))
		if err != nil {
			errJ(w, err)
			return
		}
		j(w, map[string]string{"value": s})
	})
	mux.HandleFunc("/mpv/stop", func(w http.ResponseWriter, r *http.Request) {
		if player != nil {
			player.Command("stop")
		}
		mu.Lock()
		rect = map[string]any{"show": false}
		mu.Unlock()
		j(w, map[string]string{})
	})
	mux.HandleFunc("/mpv/rect", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			var a map[string]any
			body(r, &a)
			mu.Lock()
			rect = a
			mu.Unlock()
		}
		mu.Lock()
		defer mu.Unlock()
		j(w, rect)
	})
	mux.HandleFunc("/mpv/frame", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		mu.Lock()
		if grab == nil {
			if api, err := loadMPV(); err == nil {
				grab, _ = NewGrabber(api)
			}
		}
		g := grab
		mu.Unlock()
		if g == nil {
			errJ(w, fmt.Errorf("no engine"))
			return
		}
		t, _ := strconv.ParseFloat(q.Get("t"), 64)
		mw, _ := strconv.Atoi(q.Get("w"))
		url, err := g.Frame(q.Get("p"), t, mw, q.Get("exact") == "1")
		if err != nil {
			errJ(w, err)
			return
		}
		j(w, map[string]string{"value": url})
	})
	mux.HandleFunc("/mpv/shot", func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(os.TempDir(), "lumen-shot-"+r.URL.Query().Get("name")+".png")
		if player == nil {
			errJ(w, fmt.Errorf("engine not started"))
			return
		}
		if err := player.Command("screenshot-to-file", p, "video"); err != nil {
			errJ(w, err)
			return
		}
		j(w, map[string]string{"value": p})
	})
}
