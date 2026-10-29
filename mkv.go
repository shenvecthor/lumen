package main

// Minimal Matroska/WebM reader that pulls text subtitle tracks
// (SRT "S_TEXT/UTF8", SSA/ASS, WebVTT) out of an .mkv and converts them to
// WebVTT, which the browser engine can display. Video/audio data is skipped
// without being read, so a pass over a multi-GB file touches only block
// headers.

import (
	"bytes"
	"compress/zlib"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const (
	idEBML          = 0x1A45DFA3
	idSegment       = 0x18538067
	idInfo          = 0x1549A966
	idTimecodeScale = 0x2AD7B1
	idTracks        = 0x1654AE6B
	idTrackEntry    = 0xAE
	idTrackNumber   = 0xD7
	idTrackType     = 0x83
	idCodecID       = 0x86
	idCodecPrivate  = 0x63A2
	idName          = 0x536E
	idLanguage      = 0x22B59C
	idLanguageIETF  = 0x22B59D
	idFlagDefault   = 0x88
	idFlagForced    = 0x55AA
	idContentEncs   = 0x6D80
	idContentEnc    = 0x6240
	idContentComp   = 0x5034
	idCompAlgo      = 0x4254
	idCompSettings  = 0x4255
	idContentCrypt  = 0x5035
	idCluster       = 0x1F43B675
	idTimecode      = 0xE7
	idSimpleBlock   = 0xA3
	idBlockGroup    = 0xA0
	idBlock         = 0xA1
	idBlockDuration = 0x9B
	idSeekHead      = 0x114D9B74
	idSeek          = 0x4DBB
	idSeekID        = 0x53AB
	idSeekPosition  = 0x53AC
	idChapters      = 0x1043A770
	idEditionEntry  = 0x45B9
	idChapterAtom   = 0xB6
	idChapterStart  = 0x91
	idChapterHidden = 0x98
	idChapterDisp   = 0x80
	idChapString    = 0x85
)

// Chapter is one entry of an MKV chapter list (seconds from the start).
type Chapter struct {
	Start float64 `json:"start"`
	Title string  `json:"title"`
}

type SubTrack struct {
	Number   uint64 `json:"number"`
	Codec    string `json:"codec"`
	Name     string `json:"name"`
	Lang     string `json:"lang"`
	Default  bool   `json:"default"`
	Forced   bool   `json:"forced"`
	compAlgo int    // -1 none, 0 zlib, 3 header strip
	compData []byte
	crypt    bool
	cues     []cue
}

type cue struct {
	start, end int64 // nanoseconds; end < 0 = unknown
	text       string
}

func supportedSubCodec(c string) bool {
	return c == "S_TEXT/UTF8" || c == "S_TEXT/ASCII" || c == "S_TEXT/SSA" || c == "S_TEXT/ASS" || c == "S_TEXT/WEBVTT" ||
		c == "D_WEBVTT/SUBTITLES" || c == "D_WEBVTT/CAPTIONS"
}

// ---------- buffered random-access reader ----------

type ebmlReader struct {
	f      io.ReaderAt
	size   int64
	pos    int64
	buf    []byte
	bufAt  int64
	bufLen int
}

func (r *ebmlReader) byteAt(p int64) (byte, error) {
	if p < r.bufAt || p >= r.bufAt+int64(r.bufLen) {
		n, err := r.f.ReadAt(r.buf, p)
		if n == 0 {
			if err == nil {
				err = io.EOF
			}
			return 0, err
		}
		r.bufAt, r.bufLen = p, n
	}
	return r.buf[p-r.bufAt], nil
}

func (r *ebmlReader) read(n int64) ([]byte, error) {
	if n < 0 || n > 64<<20 {
		return nil, errors.New("element too large")
	}
	out := make([]byte, n)
	if r.pos >= r.bufAt && r.pos+n <= r.bufAt+int64(r.bufLen) {
		copy(out, r.buf[r.pos-r.bufAt:])
	} else if _, err := r.f.ReadAt(out, r.pos); err != nil && !(err == io.EOF && r.pos+n <= r.size) {
		return nil, err
	}
	r.pos += n
	return out, nil
}

// vint reads an EBML variable-length integer. keepMarker is true for IDs.
func (r *ebmlReader) vint(keepMarker bool) (val uint64, unknown bool, err error) {
	b, err := r.byteAt(r.pos)
	if err != nil {
		return 0, false, err
	}
	l := 1
	for mask := byte(0x80); l <= 8 && b&mask == 0; mask >>= 1 {
		l++
	}
	if l > 8 {
		return 0, false, errors.New("bad vint")
	}
	val = uint64(b)
	if !keepMarker {
		val &= uint64(0xFF >> l)
	}
	allOnes := val == uint64(0xFF>>l)
	for i := 1; i < l; i++ {
		c, err := r.byteAt(r.pos + int64(i))
		if err != nil {
			return 0, false, err
		}
		val = val<<8 | uint64(c)
		allOnes = allOnes && c == 0xFF
	}
	r.pos += int64(l)
	return val, !keepMarker && allOnes, nil
}

func (r *ebmlReader) header() (id uint64, size int64, unknown bool, err error) {
	if id, _, err = r.vint(true); err != nil {
		return
	}
	s, unk, err := r.vint(false)
	return id, int64(s), unk, err
}

func beUint(b []byte) uint64 {
	var v uint64
	for _, c := range b {
		v = v<<8 | uint64(c)
	}
	return v
}

// ---------- parsing ----------

type mkvFile struct {
	tcScale  int64
	tracks   map[uint64]*SubTrack
	order    []uint64
	chapters []Chapter
	chapPos  int64        // where the SeekHead says Chapters live (they may follow the clusters)
	codecs   []trackCodec // every track's type and codec, for choosing a playback engine
}

type trackCodec struct {
	Type  uint64 // 1 video, 2 audio, 0x11 subtitles
	Codec string
}

func (m *mkvFile) parseSeekHead(r *ebmlReader, end, segStart int64) {
	for r.pos < end {
		id, size, _, err := r.header()
		if err != nil {
			return
		}
		next := r.pos + size
		if id == idSeek {
			var sid []byte
			var spos int64 = -1
			for r.pos < next {
				cid, csz, _, err := r.header()
				if err != nil {
					return
				}
				b, _ := r.read(csz)
				if cid == idSeekID {
					sid = b
				} else if cid == idSeekPosition {
					spos = int64(beUint(b))
				}
			}
			if beUint(sid) == idChapters && spos >= 0 {
				m.chapPos = segStart + spos
			}
		}
		r.pos = next
	}
}

func (m *mkvFile) parseChapters(r *ebmlReader, end int64) {
	for r.pos < end && len(m.chapters) == 0 { // first edition with entries
		id, size, _, err := r.header()
		if err != nil {
			return
		}
		next := r.pos + size
		if id == idEditionEntry {
			for r.pos < next {
				aid, asz, _, err := r.header()
				if err != nil {
					return
				}
				anext := r.pos + asz
				if aid == idChapterAtom {
					c, hidden := Chapter{}, false
					for r.pos < anext {
						cid, csz, _, err := r.header()
						if err != nil {
							return
						}
						cnext := r.pos + csz
						switch cid {
						case idChapterStart:
							b, _ := r.read(csz)
							c.Start = float64(beUint(b)) / 1e9
						case idChapterHidden:
							b, _ := r.read(csz)
							hidden = beUint(b) != 0
						case idChapterDisp:
							for r.pos < cnext {
								did, dsz, _, err := r.header()
								if err != nil {
									return
								}
								if did == idChapString && c.Title == "" {
									b, _ := r.read(dsz)
									c.Title = strings.TrimRight(string(b), "\x00")
									continue
								}
								r.pos += dsz
							}
						}
						r.pos = cnext
					}
					if !hidden {
						m.chapters = append(m.chapters, c)
					}
				}
				r.pos = anext
			}
		}
		r.pos = next
	}
	sort.SliceStable(m.chapters, func(i, j int) bool { return m.chapters[i].Start < m.chapters[j].Start })
}

// lateChapters reads a Chapters element placed after the clusters, via the SeekHead.
func (m *mkvFile) lateChapters(r *ebmlReader) {
	if len(m.chapters) > 0 || m.chapPos <= 0 || m.chapPos >= r.size {
		return
	}
	r.pos = m.chapPos
	if id, size, _, err := r.header(); err == nil && id == idChapters {
		m.parseChapters(r, r.pos+size)
	}
}

func (m *mkvFile) parseTracks(r *ebmlReader, end int64) error {
	for r.pos < end {
		id, size, _, err := r.header()
		if err != nil {
			return err
		}
		next := r.pos + size
		if id == idTrackEntry {
			t := &SubTrack{compAlgo: -1, Default: true} // FlagDefault defaults to 1 when absent
			var ttype uint64
			for r.pos < next {
				cid, csz, _, err := r.header()
				if err != nil {
					return err
				}
				cnext := r.pos + csz
				switch cid {
				case idTrackNumber, idTrackType, idFlagDefault, idFlagForced:
					b, err := r.read(csz)
					if err != nil {
						return err
					}
					v := beUint(b)
					switch cid {
					case idTrackNumber:
						t.Number = v
					case idTrackType:
						ttype = v
					case idFlagDefault:
						t.Default = v != 0
					case idFlagForced:
						t.Forced = v != 0
					}
				case idCodecID, idName, idLanguage, idLanguageIETF:
					b, err := r.read(csz)
					if err != nil {
						return err
					}
					s := strings.TrimRight(string(b), "\x00")
					switch cid {
					case idCodecID:
						t.Codec = s
					case idName:
						t.Name = s
					case idLanguage:
						if t.Lang == "" || t.Lang == "und" {
							t.Lang = s
						}
					case idLanguageIETF:
						t.Lang = s
					}
				case idContentEncs:
					if err := m.parseEncodings(r, cnext, t); err != nil {
						return err
					}
				}
				r.pos = cnext
			}
			m.codecs = append(m.codecs, trackCodec{ttype, t.Codec})
			if ttype == 0x11 && supportedSubCodec(t.Codec) && !t.crypt {
				if t.Lang == "" {
					t.Lang = "eng" // Matroska default
				}
				m.tracks[t.Number] = t
				m.order = append(m.order, t.Number)
			}
		}
		r.pos = next
	}
	return nil
}

func (m *mkvFile) parseEncodings(r *ebmlReader, end int64, t *SubTrack) error {
	for r.pos < end { // walk ContentEncoding > ContentCompression/ContentEncryption
		id, size, _, err := r.header()
		if err != nil {
			return err
		}
		switch id {
		case idContentEnc:
			continue // descend
		case idContentComp:
			t.compAlgo = 0 // zlib is the default when ContentCompAlgo is absent
			continue
		case idCompAlgo:
			b, err := r.read(size)
			if err != nil {
				return err
			}
			t.compAlgo = int(beUint(b))
			continue
		case idCompSettings:
			b, err := r.read(size)
			if err != nil {
				return err
			}
			t.compData = b
			continue
		case idContentCrypt:
			t.crypt = true
		}
		r.pos += size
	}
	return nil
}

func (m *mkvFile) addBlock(r *ebmlReader, end int64, clusterTC int64, dur int64) error {
	track, _, err := r.vint(false)
	if err != nil {
		return err
	}
	t := m.tracks[track]
	if t == nil {
		return nil
	}
	h, err := r.read(3)
	if err != nil {
		return err
	}
	if h[2]&0x06 != 0 { // laced: not used for subtitles in practice
		return nil
	}
	rel := int64(int16(uint16(h[0])<<8 | uint16(h[1])))
	data, err := r.read(end - r.pos)
	if err != nil {
		return err
	}
	switch t.compAlgo {
	case 0:
		zr, err := zlib.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil
		}
		data, err = io.ReadAll(io.LimitReader(zr, 1<<20))
		if err != nil {
			return nil
		}
	case 3:
		data = append(append([]byte{}, t.compData...), data...)
	}
	start := (clusterTC + rel) * m.tcScale
	end2 := int64(-1)
	if dur >= 0 {
		end2 = start + dur*m.tcScale
	}
	t.cues = append(t.cues, cue{start, end2, string(data)})
	return nil
}

// parseMKV reads track headers; if full is set it also collects all subtitle cues.
func parseMKV(path string, full bool) (*mkvFile, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	r := &ebmlReader{f: f, size: st.Size(), buf: make([]byte, 8192), bufAt: -1}
	m := &mkvFile{tcScale: 1000000, tracks: map[uint64]*SubTrack{}}
	id, size, _, err := r.header()
	if err != nil || id != idEBML {
		return nil, errors.New("not a Matroska file")
	}
	r.pos += size

	end := r.size
	var clusterTC, segStart int64
	seenTracks := false
	for r.pos < end {
		id, size, unknown, err := r.header()
		if err != nil {
			break
		}
		dataStart := r.pos
		next := dataStart + size
		if unknown {
			next = end
		}
		switch id {
		case idSegment, idCluster:
			if id == idSegment {
				segStart = dataStart
			}
			if id == idCluster {
				if !full || (seenTracks && len(m.tracks) == 0) {
					m.lateChapters(r)
					return m, nil
				}
			}
			continue // descend; children are read in this same loop
		case idSeekHead:
			m.parseSeekHead(r, next, segStart)
		case idChapters:
			m.parseChapters(r, next)
		case idInfo:
			for r.pos < next {
				cid, csz, _, err := r.header()
				if err != nil {
					break
				}
				if cid == idTimecodeScale {
					b, _ := r.read(csz)
					if v := int64(beUint(b)); v > 0 {
						m.tcScale = v
					}
				} else {
					r.pos += csz
				}
			}
		case idTracks:
			if err := m.parseTracks(r, next); err != nil {
				return nil, err
			}
			seenTracks = true
		case idTimecode:
			b, _ := r.read(size)
			clusterTC = int64(beUint(b))
		case idSimpleBlock:
			m.addBlock(r, next, clusterTC, -1)
		case idBlockGroup:
			var blockAt, blockEnd int64 = -1, 0
			dur := int64(-1)
			for r.pos < next {
				cid, csz, _, err := r.header()
				if err != nil {
					break
				}
				if cid == idBlock {
					blockAt, blockEnd = r.pos, r.pos+csz
				} else if cid == idBlockDuration {
					b, _ := r.read(csz)
					dur = int64(beUint(b))
					continue
				}
				r.pos += csz
			}
			if blockAt >= 0 {
				r.pos = blockAt
				m.addBlock(r, blockEnd, clusterTC, dur)
			}
		}
		if unknown {
			break
		}
		r.pos = next
	}
	return m, nil
}

// ---------- conversion to WebVTT ----------

var (
	assTag     = regexp.MustCompile(`\{[^}]*\}`)
	assDrawing = regexp.MustCompile(`\{[^}]*\\p[1-9][^}]*\}`)
	htmlTag    = regexp.MustCompile(`</?([a-zA-Z]+)[^>]*>`)
	entity     = regexp.MustCompile(`&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);`)
)

func vttTime(ns int64) string {
	if ns < 0 {
		ns = 0
	}
	ms := ns / 1e6
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3600000, ms/60000%60, ms/1000%60, ms%1000)
}

func cueText(codec, s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	switch codec {
	case "S_TEXT/SSA", "S_TEXT/ASS":
		// ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
		parts := strings.SplitN(s, ",", 9)
		if len(parts) == 9 {
			s = parts[8]
		}
		if assDrawing.MatchString(s) {
			return ""
		}
		s = assTag.ReplaceAllString(s, "")
		s = strings.NewReplacer(`\N`, "\n", `\n`, "\n", `\h`, " ").Replace(s)
	case "S_TEXT/WEBVTT", "D_WEBVTT/SUBTITLES", "D_WEBVTT/CAPTIONS":
		return strings.TrimSpace(s)
	}
	// keep <b>/<i>/<u> (as placeholders), drop other tags such as <font>,
	// then escape what's left so it can't break the VTT markup.
	s = htmlTag.ReplaceAllStringFunc(s, func(t string) string {
		n := strings.ToLower(htmlTag.FindStringSubmatch(t)[1])
		if n == "b" || n == "i" || n == "u" {
			if strings.HasPrefix(t, "</") {
				return "\x01/" + n + "\x02"
			}
			return "\x01" + n + "\x02"
		}
		return ""
	})
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '&':
			if loc := entity.FindStringIndex(s[i:]); loc != nil && loc[0] == 0 {
				b.WriteByte('&')
			} else {
				b.WriteString("&amp;")
			}
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case 1:
			b.WriteByte('<')
		case 2:
			b.WriteByte('>')
		default:
			b.WriteByte(s[i])
		}
	}
	s = b.String()
	// collapse blank lines, which would end the cue early
	lines := []string{}
	for _, l := range strings.Split(s, "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, strings.TrimRight(l, " "))
		}
	}
	return strings.Join(lines, "\n")
}

func (t *SubTrack) VTT() string {
	cs := append([]cue{}, t.cues...)
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].start < cs[j].start })
	var b strings.Builder
	b.WriteString("WEBVTT\n\n")
	for i, c := range cs {
		end := c.end
		if end <= c.start {
			end = c.start + 4e9
			if i+1 < len(cs) && cs[i+1].start > c.start && cs[i+1].start < end {
				end = cs[i+1].start
			}
		}
		txt := cueText(t.Codec, c.text)
		if txt == "" {
			continue
		}
		fmt.Fprintf(&b, "%s --> %s\n%s\n\n", vttTime(c.start), vttTime(end), txt)
	}
	return b.String()
}

// ---------- cache so each file is scanned once ----------

type mkvJob struct {
	once sync.Once
	m    *mkvFile
	err  error
}

var (
	mkvMu   sync.Mutex
	mkvJobs = map[string]*mkvJob{}
	mkvLRU  []string
)

func extractMKV(path string) (*mkvFile, error) {
	mkvMu.Lock()
	j := mkvJobs[path]
	if j == nil {
		j = &mkvJob{}
		mkvJobs[path] = j
		mkvLRU = append(mkvLRU, path)
		if len(mkvLRU) > 6 {
			delete(mkvJobs, mkvLRU[0])
			mkvLRU = mkvLRU[1:]
		}
	}
	mkvMu.Unlock()
	j.once.Do(func() { j.m, j.err = parseMKV(path, true) })
	return j.m, j.err
}
