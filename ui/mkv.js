// Lumen — Matroska/WebM text-subtitle reader for files dropped into the window
// (files opened from disk are handled by mkv.go). Reads only element headers
// and subtitle blocks, skipping video/audio data.
"use strict";
/* ---- Matroska reader for dropped files (mirrors mkv.go) ---- */
window.scanMatroska = async function scanMatroska(file, h){
  const size = file.size; let win = null, winAt = 0, pos = 0;
  const need = async n => {
    n = Math.min(n, size - pos);
    if (!win || pos < winAt || pos + n > winAt + win.length) { win = new Uint8Array(await file.slice(pos, Math.min(size, pos + Math.max(n, 65536))).arrayBuffer()); winAt = pos; }
  };
  const vint = async keep => {
    await need(8); if (pos >= size) throw new Error("eof");
    const b = win[pos - winAt]; let l = 1, m = 0x80; while (l <= 8 && !(b & m)) { l++; m >>= 1; }
    if (l > 8) throw new Error("bad vint");
    let v = keep ? b : b & (0xFF >> l), ones = v === (0xFF >> l);
    for (let i = 1; i < l; i++) { const c = win[pos - winAt + i]; v = v * 256 + c; ones = ones && c === 0xFF; }
    pos += l; return { v, unknown: !keep && ones };
  };
  const read = async n => { if (n > 64 * 1048576) throw new Error("too big"); await need(n); const o = win.slice(pos - winAt, pos - winAt + n); pos += n; return o; };
  const header = async () => { const id = (await vint(true)).v; const s = await vint(false); return { id, size: s.v, unknown: s.unknown }; };
  const uint = b => b.reduce((a, c) => a * 256 + c, 0);
  const str = b => new TextDecoder().decode(b).replace(/\0+$/, "");
  const inflate = async b => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const SUP = /^(S_TEXT\/(UTF8|ASCII|SSA|ASS|WEBVTT)|D_WEBVTT\/(SUBTITLES|CAPTIONS))$/;

  let tc = 1e6, clusterTC = 0; const tracks = {}; let seenTracks = false;
  const first = await header(); if (first.id !== 0x1A45DFA3) throw new Error("not matroska"); pos += first.size;
  const end = size;
  const block = async (stop, dur) => {
    const tn = (await vint(false)).v; const t = tracks[tn]; if (!t) return;
    const hd = await read(3); if (hd[2] & 0x06) return;
    const rel = (hd[0] << 8 | hd[1]) << 16 >> 16;
    let data = await read(stop - pos);
    if (t.comp === 0) { try { data = await inflate(data); } catch { return; } }
    else if (t.comp === 3) { const d = new Uint8Array(t.compData.length + data.length); d.set(t.compData); d.set(data, t.compData.length); data = d; }
    let txt = str(data);
    if (t.codec.includes("SSA") || t.codec.includes("ASS")) { const p = txt.split(","); txt = p.length >= 9 ? p.slice(8).join(",") : txt; }
    const start = (clusterTC + rel) * tc / 1e9;
    h.cue(tn, start, dur == null ? null : start + dur * tc / 1e9, txt, /SSA|ASS/.test(t.codec) ? "ass" : "");
  };
  let n = 0;
  while (pos < end) {
    if (h.stale()) return;
    if (++n % 2000 === 0) await new Promise(r => setTimeout(r));   // keep the UI responsive
    let el; try { el = await header(); } catch { break; }
    const start = pos, next = el.unknown ? end : start + el.size;
    if (el.id === 0x18538067 || el.id === 0x1F43B675) {           // Segment / Cluster: descend
      if (el.id === 0x1F43B675 && seenTracks && !Object.keys(tracks).length) return;
      continue;
    }
    if (el.id === 0x1549A966) {                                   // Info
      while (pos < next) { const c = await header(); if (c.id === 0x2AD7B1) tc = uint(await read(c.size)) || 1e6; else pos += c.size; }
    } else if (el.id === 0x1654AE6B) {                            // Tracks
      const found = [];
      while (pos < next) {
        const te = await header(); const teEnd = pos + te.size;
        if (te.id !== 0xAE) { pos = teEnd; continue; }
        const t = { comp: -1, isDefault: true, forced: false, name: "", lang: "", codec: "", number: 0, type: 0, crypt: false };
        const walk = async stop => {
          while (pos < stop) {
            const c = await header(); const cEnd = pos + c.size;
            switch (c.id) {
              case 0xD7: t.number = uint(await read(c.size)); break;
              case 0x83: t.type = uint(await read(c.size)); break;
              case 0x88: t.isDefault = !!uint(await read(c.size)); break;
              case 0x55AA: t.forced = !!uint(await read(c.size)); break;
              case 0x86: t.codec = str(await read(c.size)); break;
              case 0x536E: t.name = str(await read(c.size)); break;
              case 0x22B59C: { const l = str(await read(c.size)); if (!t.lang || t.lang === "und") t.lang = l; break; }
              case 0x22B59D: t.lang = str(await read(c.size)); break;
              case 0x6D80: case 0x6240: await walk(cEnd); break;     // ContentEncodings / ContentEncoding
              case 0x5034: t.comp = 0; await walk(cEnd); break;     // ContentCompression (zlib by default)
              case 0x4254: t.comp = uint(await read(c.size)); break;
              case 0x4255: t.compData = await read(c.size); break;
              case 0x5035: t.crypt = true; break;
            }
            pos = cEnd;
          }
        };
        await walk(teEnd);
        if (t.type === 0x11 && SUP.test(t.codec) && !t.crypt) { if (!t.lang) t.lang = "eng"; tracks[t.number] = t; found.push(t); }
        pos = teEnd;
      }
      seenTracks = true;
      if (found.length) h.tracks(found);      // keep reading: chapters usually follow the tracks
    } else if (el.id === 0x1043A770) {        // Chapters (first edition, visible atoms)
      const chs = [];
      while (pos < next && !chs.length) {
        const ed = await header(); const edEnd = pos + ed.size;
        if (ed.id === 0x45B9) {
          while (pos < edEnd) {
            const at = await header(); const atEnd = pos + at.size;
            if (at.id === 0xB6) {
              const c = { start: 0, title: "" }; let hidden = false;
              while (pos < atEnd) {
                const ce = await header(); const ceEnd = pos + ce.size;
                if (ce.id === 0x91) c.start = uint(await read(ce.size)) / 1e9;
                else if (ce.id === 0x98) hidden = !!uint(await read(ce.size));
                else if (ce.id === 0x80) { while (pos < ceEnd) { const d = await header(); if (d.id === 0x85 && !c.title) c.title = str(await read(d.size)); else pos += d.size; } }
                pos = ceEnd;
              }
              if (!hidden) chs.push(c);
            }
            pos = atEnd;
          }
        }
        pos = edEnd;
      }
      if (chs.length && h.chapters) h.chapters(chs.sort((a, b) => a.start - b.start));
    } else if (el.id === 0xE7) {
      clusterTC = uint(await read(el.size));
    } else if (el.id === 0xA3) {
      await block(next, null);
    } else if (el.id === 0xA0) {
      let at = -1, stopAt = 0, dur = null;
      while (pos < next) {
        const c = await header();
        if (c.id === 0xA1) { at = pos; stopAt = pos + c.size; }
        else if (c.id === 0x9B) { dur = uint(await read(c.size)); continue; }
        pos += c.size;
      }
      if (at >= 0) { pos = at; await block(stopAt, dur); }
    }
    if (el.unknown) break;
    pos = next;
  }
}
