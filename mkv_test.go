package main

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// ---- tiny EBML writer for synthetic files ----

func ebmlID(id uint64) []byte {
	var b []byte
	for id > 0 {
		b = append([]byte{byte(id)}, b...)
		id >>= 8
	}
	return b
}
func ebmlSize(n int) []byte { // always 8-byte size, valid EBML
	b := []byte{0x01, 0, 0, 0, 0, 0, 0, 0}
	for i := 7; i > 0 && n > 0; i-- {
		b[i] = byte(n)
		n >>= 8
	}
	return b
}
func el(id uint64, parts ...[]byte) []byte {
	body := bytes.Join(parts, nil)
	return append(append(ebmlID(id), ebmlSize(len(body))...), body...)
}
func u(v uint64) []byte {
	b := []byte{}
	for v > 0 {
		b = append([]byte{byte(v)}, b...)
		v >>= 8
	}
	if len(b) == 0 {
		b = []byte{0}
	}
	return b
}
func block(track byte, rel int16, data []byte) []byte {
	return append([]byte{0x80 | track, byte(uint16(rel) >> 8), byte(rel), 0x80}, data...)
}

func zl(s string) []byte {
	var b bytes.Buffer
	w := zlib.NewWriter(&b)
	w.Write([]byte(s))
	w.Close()
	return b.Bytes()
}

func TestSyntheticCompressedTracks(t *testing.T) {
	file := bytes.Join([][]byte{
		el(idEBML, el(0x4282, []byte("matroska"))),
		// Segment with unknown size (as written by live muxers)
		append(ebmlID(idSegment), 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF),
		el(idInfo, el(idTimecodeScale, u(1000000))),
		el(idTracks,
			el(idTrackEntry, el(idTrackNumber, u(1)), el(idTrackType, u(1)), el(idCodecID, []byte("V_VP9"))),
			el(idTrackEntry, el(idTrackNumber, u(2)), el(idTrackType, u(0x11)), el(idCodecID, []byte("S_TEXT/UTF8")),
				el(idLanguage, []byte("fre")), el(idFlagDefault, u(0)),
				el(idContentEncs, el(idContentEnc, el(idContentComp)))), // zlib (default algo)
			el(idTrackEntry, el(idTrackNumber, u(3)), el(idTrackType, u(0x11)), el(idCodecID, []byte("S_TEXT/UTF8")),
				el(idName, []byte("Stripped")),
				el(idContentEncs, el(idContentEnc, el(idContentComp, el(idCompAlgo, u(3)), el(idCompSettings, []byte("Bon")))))),
			el(idTrackEntry, el(idTrackNumber, u(4)), el(idTrackType, u(0x11)), el(idCodecID, []byte("S_HDMV/PGS"))),
		),
		el(idCluster, el(idTimecode, u(1000)),
			el(idSimpleBlock, block(1, 0, make([]byte, 5000))),
			el(idBlockGroup, el(idBlock, block(2, 500, zl("Bonjour <b>tout</b> le monde"))), el(idBlockDuration, u(2000))),
			el(idSimpleBlock, block(3, 250, []byte("soir"))),
		),
		el(idCluster, el(idTimecode, u(10000)),
			el(idBlockGroup, el(idBlock, block(2, -100, zl("Deuxième"))), el(idBlockDuration, u(1000))),
		),
	}, nil)
	p := filepath.Join(t.TempDir(), "x.mkv")
	os.WriteFile(p, file, 0o644)

	h, err := parseMKV(p, false)
	if err != nil || len(h.order) != 2 {
		t.Fatalf("header parse: %v %+v", err, h)
	}
	m, err := parseMKV(p, true)
	if err != nil {
		t.Fatal(err)
	}
	if m.tracks[2].Lang != "fre" || m.tracks[2].Default || !m.tracks[3].Default || m.tracks[3].Name != "Stripped" {
		t.Fatalf("track meta wrong: %+v %+v", m.tracks[2], m.tracks[3])
	}
	v2, v3 := m.tracks[2].VTT(), m.tracks[3].VTT()
	want2 := "WEBVTT\n\n00:00:01.500 --> 00:00:03.500\nBonjour <b>tout</b> le monde\n\n00:00:09.900 --> 00:00:10.900\nDeuxième\n\n"
	if v2 != want2 {
		t.Errorf("zlib track:\n%q\nwant\n%q", v2, want2)
	}
	if !strings.Contains(v3, "00:00:01.250 --> 00:00:05.250\nBonsoir") {
		t.Errorf("header-strip track (no duration → 4s):\n%q", v3)
	}
}

// Compare against ffmpeg's own extraction on real files, when available.
func TestAgainstFFmpeg(t *testing.T) {
	dir := os.Getenv("LUMEN_MEDIA")
	if dir == "" {
		t.Skip("LUMEN_MEDIA not set")
	}
	cueTimes := regexp.MustCompile(`(?m)^(\d\d:)?\d\d:\d\d\.\d{3} --> (\d\d:)?\d\d:\d\d\.\d{3}`)
	norm := func(s string) []string {
		out := []string{}
		for _, m := range cueTimes.FindAllString(s, -1) {
			if !strings.HasPrefix(m, "00:") || strings.Count(m, ":") == 2 {
				m = strings.ReplaceAll("00:"+m, " --> ", " --> 00:")
			}
			out = append(out, m)
		}
		return out
	}
	for _, name := range []string{"Movie Embedded.mkv", "Clip vtt.webm"} {
		p := filepath.Join(dir, name)
		m, err := parseMKV(p, true)
		if err != nil {
			t.Fatal(name, err)
		}
		for i, n := range m.order {
			got := m.tracks[n].VTT()
			ref, err := exec.Command("ffmpeg", "-v", "error", "-i", p, "-map", "0:s:"+string(rune('0'+i)), "-f", "webvtt", "-").Output()
			if err != nil {
				t.Fatal(err)
			}
			g, r := norm(got), norm(string(ref))
			if m.tracks[n].Codec == "S_TEXT/ASS" && len(r) == len(g)+1 {
				r = r[:len(g)] // ffmpeg keeps the {\p1} vector-drawing line; we drop it on purpose
			}
			// ffmpeg shifts everything by the file's start offset (audio priming); compare relative times
			shift := func(xs []string) []string {
				out := []string{}
				for _, x := range xs {
					out = append(out, x[6:9]+x[23:26]) // seconds.millis are enough at this offset
				}
				return out
			}
			_ = shift
			if len(g) != len(r) || len(g) == 0 || !sameShape(g, r) {
				t.Errorf("%s track %d timing mismatch\n got %v\nwant %v", name, n, g, r)
			}
			t.Logf("%s track %d (%s, %s, default=%v):\n%s", name, n, m.tracks[n].Codec, m.tracks[n].Lang, m.tracks[n].Default, got)
		}
	}
}

// sameShape: equal cue count and every cue offset by the same small amount.
func sameShape(a, b []string) bool {
	ms := func(s string) int64 {
		var h, m, sec, milli int64
		fmtSscanf(s, &h, &m, &sec, &milli)
		return ((h*60+m)*60+sec)*1000 + milli
	}
	var off int64 = -1 << 62
	for i := range a {
		for _, pair := range [][2]string{{a[i][:12], b[i][:12]}, {a[i][17:], b[i][17:]}} {
			d := ms(pair[1]) - ms(pair[0])
			if off == -1<<62 {
				off = d
			}
			if d != off || d < 0 || d > 100 {
				return false
			}
		}
	}
	return true
}

func fmtSscanf(s string, h, m, sec, milli *int64) { fmt.Sscanf(s, "%d:%d:%d.%d", h, m, sec, milli) }

func TestChaptersAfterClusters(t *testing.T) {
	chap := el(idChapters, el(idEditionEntry,
		el(idChapterAtom, el(idChapterStart, u(0)), el(idChapterDisp, el(idChapString, []byte("Intro")))),
		el(idChapterAtom, el(idChapterStart, u(90_500_000_000)), el(idChapterDisp, el(idChapString, []byte("Credits")))),
		el(idChapterAtom, el(idChapterStart, u(30_000_000_000)), el(idChapterHidden, u(1)), el(idChapterDisp, el(idChapString, []byte("Hidden")))),
	))
	info := el(idInfo, el(idTimecodeScale, u(1000000)))
	cluster := el(idCluster, el(idTimecode, u(0)), el(idSimpleBlock, block(1, 0, make([]byte, 3000))))
	// SeekHead points at the Chapters element that comes after the cluster
	mkSeek := func(pos int) []byte {
		return el(idSeekHead, el(idSeek, el(idSeekID, ebmlID(idChapters)), el(idSeekPosition, []byte{0, 0, 0, byte(pos >> 16), byte(pos >> 8), byte(pos)})))
	}
	seekLen := len(mkSeek(0))
	pos := seekLen + len(info) + len(cluster)
	segBody := bytes.Join([][]byte{mkSeek(pos), info, cluster, chap}, nil)
	file := append(el(idEBML, el(0x4282, []byte("matroska"))), el(idSegment, segBody)...)
	p := filepath.Join(t.TempDir(), "late.mkv")
	os.WriteFile(p, file, 0o644)
	m, err := parseMKV(p, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.chapters) != 2 || m.chapters[0].Title != "Intro" || m.chapters[1].Title != "Credits" || m.chapters[1].Start != 90.5 {
		t.Fatalf("late chapters: %+v", m.chapters)
	}
}
