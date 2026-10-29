package main

import (
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Engine choice. Edge WebView2 plays the common formats with hardware decoding
// and every Lumen feature; anything it can't play (or would play badly, such as
// an MKV whose AC-3 audio would be silent) goes to the bundled libmpv engine.

type Probe struct {
	Engine string `json:"engine"`        // "web" or "mpv"
	Why    string `json:"why,omitempty"` // human-readable reason when "mpv"
}

// Containers WebView2 can't open at all.
var mpvOnlyExt = map[string]string{
	".avi": "AVI", ".divx": "DivX", ".xvid": "Xvid", ".wmv": "WMV", ".asf": "ASF", ".wtv": "WTV", ".dvr-ms": "DVR-MS",
	".flv": "FLV", ".f4v": "F4V", ".mpg": "MPEG", ".mpeg": "MPEG", ".mpe": "MPEG", ".m1v": "MPEG-1", ".m2v": "MPEG-2",
	".vob": "DVD VOB", ".ts": "MPEG-TS", ".m2ts": "Blu-ray M2TS", ".mts": "AVCHD", ".tp": "MPEG-TS", ".trp": "MPEG-TS",
	".3g2": "3GPP2", ".rm": "RealMedia", ".rmvb": "RealMedia", ".ogm": "OGM", ".dv": "DV", ".y4m": "Y4M", ".mxf": "MXF",
	".nut": "NUT", ".amv": "AMV", ".ivf": "IVF", ".h264": "raw H.264", ".264": "raw H.264", ".h265": "raw HEVC", ".hevc": "raw HEVC",
	".ac3": "AC-3", ".eac3": "E-AC-3", ".dts": "DTS", ".dtshd": "DTS-HD", ".thd": "TrueHD", ".mlp": "MLP", ".ape": "APE",
	".wma": "WMA", ".wv": "WavPack", ".tak": "TAK", ".tta": "TTA", ".mpc": "Musepack", ".aif": "AIFF", ".aiff": "AIFF",
	".aifc": "AIFF", ".au": "AU", ".snd": "AU", ".amr": "AMR", ".awb": "AMR", ".caf": "CAF", ".dsf": "DSD", ".dff": "DSD",
	".spx": "Speex", ".ra": "RealAudio", ".mod": "tracker module", ".xm": "tracker module", ".s3m": "tracker module", ".it": "tracker module",
	".mp2": "MPEG audio layer II", ".mpa": "MPEG audio", ".m2a": "MPEG audio", ".voc": "VOC", ".w64": "Wave64", ".rf64": "RF64",
}

// MediaExt lists every extension Lumen opens (web formats plus the engine's).
var webExt = []string{".mp4", ".m4v", ".webm", ".mkv", ".mov", ".ogv", ".3gp", ".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".oga", ".opus", ".weba", ".mka"}

func probeFile(path string) Probe {
	ext := strings.ToLower(filepath.Ext(path))
	if name, ok := mpvOnlyExt[ext]; ok {
		return Probe{"mpv", name + " file"}
	}
	switch ext {
	case ".mkv", ".mka", ".webm":
		m, err := parseMKV(path, false)
		if err != nil {
			return Probe{"mpv", "unusual Matroska file"}
		}
		return probeCodecs(mkvCodecNames(m.codecs))
	case ".mp4", ".m4v", ".mov", ".m4a", ".3gp", ".m4b", ".qt":
		return probeCodecs(mp4Codecs(path))
	}
	return Probe{Engine: "web"}
}

// codec labels: "v:avc", "a:ac3", "s:pgs" …
func mkvCodecNames(cs []trackCodec) []string {
	var out []string
	for _, c := range cs {
		id := strings.ToUpper(c.Codec)
		switch c.Type {
		case 1:
			switch {
			case strings.HasPrefix(id, "V_MPEG4/ISO/AVC"):
				out = append(out, "v:avc")
			case id == "V_VP8":
				out = append(out, "v:vp8")
			case id == "V_VP9":
				out = append(out, "v:vp9")
			case id == "V_AV1":
				out = append(out, "v:av1")
			case strings.HasPrefix(id, "V_MPEGH/ISO/HEVC"):
				out = append(out, "v:hevc")
			case strings.HasPrefix(id, "V_MPEG4/ISO/"), strings.HasPrefix(id, "V_MS/VFW"):
				out = append(out, "v:mpeg4")
			case strings.HasPrefix(id, "V_MPEG1"), strings.HasPrefix(id, "V_MPEG2"):
				out = append(out, "v:mpeg2")
			default:
				out = append(out, "v:"+strings.ToLower(strings.TrimPrefix(id, "V_")))
			}
		case 2:
			switch {
			case strings.HasPrefix(id, "A_AAC"):
				out = append(out, "a:aac")
			case id == "A_OPUS":
				out = append(out, "a:opus")
			case id == "A_VORBIS":
				out = append(out, "a:vorbis")
			case id == "A_FLAC":
				out = append(out, "a:flac")
			case id == "A_MPEG/L3":
				out = append(out, "a:mp3")
			case id == "A_AC3", id == "A_EAC3":
				out = append(out, "a:"+strings.ToLower(id[2:]))
			case strings.HasPrefix(id, "A_DTS"):
				out = append(out, "a:dts")
			case id == "A_TRUEHD", id == "A_MLP":
				out = append(out, "a:truehd")
			default:
				out = append(out, "a:"+strings.ToLower(strings.TrimPrefix(id, "A_")))
			}
		case 0x11:
			switch {
			case id == "S_HDMV/PGS":
				out = append(out, "s:pgs")
			case id == "S_VOBSUB":
				out = append(out, "s:vobsub")
			case id == "S_DVBSUB":
				out = append(out, "s:dvbsub")
			default:
				out = append(out, "s:text")
			}
		}
	}
	return out
}

var codecLabel = map[string]string{
	"v:hevc": "HEVC (H.265) video", "v:mpeg4": "MPEG-4 Part 2 (DivX/Xvid) video", "v:mpeg2": "MPEG-2 video",
	"a:ac3": "Dolby Digital (AC-3) audio", "a:eac3": "Dolby Digital Plus (E-AC-3) audio", "a:dts": "DTS audio",
	"a:truehd": "Dolby TrueHD audio", "a:alac": "Apple Lossless audio", "a:pcm": "PCM audio",
	"s:pgs": "Blu-ray (PGS) subtitles", "s:vobsub": "DVD subtitles", "s:dvbsub": "DVB subtitles",
}

// Everything WebView2 plays well; anything else needs the engine.
var webCodecs = map[string]bool{
	"v:avc": true, "v:vp8": true, "v:vp9": true, "v:av1": true,
	"a:aac": true, "a:opus": true, "a:vorbis": true, "a:flac": true, "a:mp3": true,
	"s:text": true,
}

func probeCodecs(cs []string) Probe {
	for _, c := range cs {
		if !webCodecs[c] {
			why := codecLabel[c]
			if why == "" {
				kind := map[byte]string{'v': "video", 'a': "audio", 's': "subtitles"}[c[0]]
				why = strings.ToUpper(c[2:]) + " " + kind
			}
			return Probe{"mpv", why}
		}
	}
	return Probe{Engine: "web"}
}

// mp4Codecs returns the first sample-entry type of every track in an MP4/MOV
// file (moov > trak > mdia > minf > stbl > stsd), mapped to codec labels.
func mp4Codecs(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	st, _ := f.Stat()
	var out []string
	var walk func(start, end int64, depth int)
	walk = func(start, end int64, depth int) {
		pos := start
		hdr := make([]byte, 16)
		for pos+8 <= end && depth < 8 {
			if _, err := f.ReadAt(hdr[:8], pos); err != nil {
				return
			}
			size := int64(binary.BigEndian.Uint32(hdr[:4]))
			typ := string(hdr[4:8])
			hl := int64(8)
			if size == 1 {
				if _, err := f.ReadAt(hdr[8:16], pos+8); err != nil {
					return
				}
				size = int64(binary.BigEndian.Uint64(hdr[8:16]))
				hl = 16
			} else if size == 0 {
				size = end - pos
			}
			if size < hl || pos+size > end {
				return
			}
			switch typ {
			case "moov", "trak", "mdia", "minf", "stbl":
				walk(pos+hl, pos+size, depth+1)
			case "stsd":
				b := make([]byte, 16)
				if _, err := f.ReadAt(b, pos+hl); err == nil || err == io.EOF {
					out = append(out, mp4Label(string(b[12:16])))
				}
			}
			pos += size
		}
	}
	walk(0, st.Size(), 0)
	return out
}

func mp4Label(fourcc string) string {
	switch fourcc {
	case "avc1", "avc3":
		return "v:avc"
	case "vp08":
		return "v:vp8"
	case "vp09":
		return "v:vp9"
	case "av01":
		return "v:av1"
	case "hvc1", "hev1", "dvh1", "dvhe":
		return "v:hevc"
	case "mp4v", "xvid", "divx", "DIVX", "XVID":
		return "v:mpeg4"
	case "mp4a":
		return "a:aac"
	case "Opus":
		return "a:opus"
	case "fLaC":
		return "a:flac"
	case ".mp3":
		return "a:mp3"
	case "ac-3":
		return "a:ac3"
	case "ec-3":
		return "a:eac3"
	case "dtsc", "dtsh", "dtsl", "dtse":
		return "a:dts"
	case "mlpa":
		return "a:truehd"
	case "alac":
		return "a:alac"
	case "lpcm", "sowt", "twos", "in24", "in32", "fl32", "fl64", "raw ":
		return "a:pcm"
	case "tx3g", "text", "wvtt", "c608", "stpp":
		return "s:text"
	case "tmcd", "rtp ", "hint", "mebx":
		return "s:text" // timecode/metadata tracks don't affect playback
	}
	return "v:" + strings.ToLower(strings.TrimSpace(fourcc))
}

// Engine-only formats that are audio (the rest of mpvOnlyExt are video).
var engineAudioExt = map[string]bool{
	".ac3": true, ".eac3": true, ".dts": true, ".dtshd": true, ".thd": true, ".mlp": true, ".ape": true, ".wma": true,
	".wv": true, ".tak": true, ".tta": true, ".mpc": true, ".aif": true, ".aiff": true, ".aifc": true, ".au": true,
	".snd": true, ".amr": true, ".awb": true, ".caf": true, ".dsf": true, ".dff": true, ".spx": true, ".ra": true,
	".mod": true, ".xm": true, ".s3m": true, ".it": true, ".mp2": true, ".mpa": true, ".m2a": true, ".voc": true,
	".w64": true, ".rf64": true,
}

func init() {
	for ext := range mpvOnlyExt {
		if _, ok := mediaExt[ext]; ok {
			continue
		}
		if engineAudioExt[ext] {
			mediaExt[ext] = "audio/x-lumen-engine"
		} else {
			mediaExt[ext] = "video/x-lumen-engine"
		}
	}
}

// mediaPatterns lists "*.ext" patterns for the open dialog, by kind ("" = all media).
func mediaPatterns(kind string) string {
	var out []string
	for ext, m := range mediaExt {
		if kind == "" || strings.HasPrefix(m, kind+"/") {
			out = append(out, "*"+ext)
		}
	}
	sort.Strings(out)
	return strings.Join(out, ";")
}
