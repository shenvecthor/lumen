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
)

func main() {
	srv, err := NewServer()
	if err != nil {
		panic(err)
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	j := func(w http.ResponseWriter, v any) { w.Header().Set("Access-Control-Allow-Origin", "*"); json.NewEncoder(w).Encode(v) }
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
	go http.Serve(ln, mux)
	srv.OnRemote = func(p []string) { fmt.Println("REMOTE", p) }
	os.WriteFile(os.TempDir()+"/lumen-dev-token", []byte(srv.Token()+" "+srv.Addr()), 0o600)
	fmt.Println("DEV", "http://"+ln.Addr().String())
	fmt.Println(srv.AppURL())
	select {}
}
