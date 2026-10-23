// Lumen — player UI
(() => {
"use strict";
const $ = id => document.getElementById(id);
const v = $("v"), stage = $("stage"), app = $("app");
const VERSION = "1.6.1";
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* =====================================================================
   Host bridge — Go via WebView2 bindings, with a browser fallback
   ===================================================================== */
const hasHost = typeof window.lumenDialog === "function";
let dialogWaiter = null;
window.__lumenDialogDone = r => { const w = dialogWaiter; dialogWaiter = null; w && w(r); };
const host = {
  dialog: kind => hasHost
    ? new Promise(res => { if (dialogWaiter) return res(null); dialogWaiter = res; window.lumenDialog(kind); })
    : browserDialog(kind),
  args:  () => hasHost ? window.lumenArgs() : Promise.resolve([]),
  subs:  p  => hasHost && p ? window.lumenSubs(p) : Promise.resolve([]),
  title: t  => hasHost ? window.lumenTitle(t) : (document.title = t),
  full:  on => hasHost ? window.lumenFullscreen(on) : (on ? document.documentElement.requestFullscreen?.().catch(()=>{}) : document.fullscreenElement && document.exitFullscreen()),
  onTop: on => hasHost ? window.lumenOnTop(on) : Promise.resolve(),
  load:  () => hasHost ? window.lumenLoadState() : Promise.resolve((() => { try { return localStorage.getItem("lumen") || ""; } catch { return ""; } })()),
  save:  s  => hasHost ? window.lumenSaveState(s) : (() => { try { localStorage.setItem("lumen", s); } catch {} })(),
  snapshot: (data, name) => hasHost ? window.lumenSnapshot(data, name) : download(data, name + ".png"),
  snapDir: () => hasHost ? window.lumenOpenSnapshots() : Promise.resolve(toast("Snapshots are downloaded by your browser")),
  quit:  () => { flushState(); return hasHost ? window.lumenQuit() : window.close(); },
  chapters: p => hasHost && window.lumenChapters && p ? window.lumenChapters(p) : Promise.resolve([]),
  neighbor: (p, d) => hasHost && window.lumenNeighbor && p ? window.lumenNeighbor(p, d) : Promise.resolve(null),
  expand: ps => hasHost && window.lumenExpand ? window.lumenExpand(ps) : Promise.resolve([]),
  setVideoSize: (w, h, ew, eh) => hasHost && window.lumenSetVideoSize ? window.lumenSetVideoSize(w, h, ew, eh) : Promise.resolve(false),
  power: a => hasHost && window.lumenPower ? window.lumenPower(a) : Promise.reject(new Error("Not available here")),
  aspect: (r, ew, eh) => hasHost && window.lumenAspect ? window.lumenAspect(r, ew, eh) : Promise.resolve(),
  fitWindow: (r, ew, eh) => hasHost && window.lumenFitWindow ? window.lumenFitWindow(r, ew, eh) : Promise.resolve(false),
};
function download(href, name){ const a = document.createElement("a"); a.href = href; a.download = name; a.click(); return Promise.resolve(name); }
function browserDialog(kind){
  if (kind.startsWith("export:")) return download(URL.createObjectURL(new Blob([kind.slice(7)], { type: "application/json" })), "Lumen settings.json");
  if (kind.startsWith("saveplaylist:")) return download(URL.createObjectURL(new Blob([kind.slice(13)], { type: "audio/x-mpegurl" })), "Playlist.m3u8");
  return new Promise(res => {
    const p = $("picker"); p.value = "";
    p.multiple = kind !== "import"; p.webkitdirectory = kind === "folder";
    p.accept = kind === "import" ? ".json" : kind === "subs" ? ".srt,.vtt,.ass,.ssa" : kind === "folder" ? "" : "video/*,audio/*,.mkv,.mka,.flac,.opus,.srt,.vtt,.ass,.ssa";
    p.onchange = async () => {
      if (kind === "import") return res(p.files[0] ? await p.files[0].text() : "");
      let files = [...p.files];
      if (kind === "folder") files = files.filter(f => f.webkitRelativePath.split("/").length === 2).sort((a, b) => natural(a.name, b.name));
      res(filesToItems(files));
    };
    p.click();
  });
}

/* =====================================================================
   Helpers
   ===================================================================== */
const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|weba|wma|mka)$/i;
const VIDEO = /\.(mp4|m4v|webm|mkv|mov|ogv|avi|wmv|3gp|ts|m2ts)$/i;
const SUBS  = /\.(srt|vtt|ass|ssa)$/i;
const MATROSKA = /\.(mkv|mka|webm)$/i;
const kindOf = n => AUDIO.test(n) ? "audio" : VIDEO.test(n) ? "video" : SUBS.test(n) ? "sub" : null;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
function filesToItems(files){
  return files.map(f => ({ name: f.name, path: null, url: kindOf(f.name) === "sub" ? null : URL.createObjectURL(f), kind: kindOf(f.name), file: f, size: f.size }))
              .filter(i => i.kind);
}
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = String(s%60).padStart(2,"0");
  return h ? `${h}:${String(m).padStart(2,"0")}:${x}` : `${m}:${x}`;
};
const base = n => n.replace(/\.[^.]+$/, "");
const bytes = n => !n ? "—" : n < 1024 ? n + " B" : n < 1048576 ? (n/1024).toFixed(1) + " KB" : n < 1073741824 ? (n/1048576).toFixed(1) + " MB" : (n/1073741824).toFixed(2) + " GB";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const isObj = x => x && typeof x === "object" && !Array.isArray(x);
function merge(def, val){            // deep merge that only keeps keys known in defaults (and same types)
  if (!isObj(def)) return val === undefined || typeof val !== typeof def || Array.isArray(def) !== Array.isArray(val) ||
    (Array.isArray(def) && (val.length !== def.length || !val.every(x => typeof x === "number"))) ? clone(def) : clone(val);
  const out = {};
  for (const k of Object.keys(def)) out[k] = isObj(val) ? merge(def[k], val[k]) : clone(def[k]);
  if (def === DEFAULTS && isObj(val) && isObj(val.keys)) out.keys = clone(val.keys);   // free-form map
  return out;
}
const clone = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
const getPath = (o, p) => p.split(".").reduce((a, k) => a && a[k], o);
function setPath(o, p, val){ const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = val; }
function hexA(hex, a){ const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function luminance(hex){ const n = parseInt(hex.slice(1), 16); const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126*c[0] + .7152*c[1] + .0722*c[2]; }
function hueShift(hex, deg){
  const n = parseInt(hex.slice(1), 16); let [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map(x => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60 + deg) % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r2, g2, b2] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r2, g2, b2].map(v2 => Math.round((v2 + m) * 255).toString(16).padStart(2, "0")).join("");
}
function shade(hex, f){ const n = parseInt(hex.slice(1), 16); const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(x => clamp(Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f), 0, 255)); return "#" + c.map(x => x.toString(16).padStart(2, "0")).join(""); }

/* =====================================================================
   Settings (persisted) vs. session state (reset every launch)
   ===================================================================== */
const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = {
  flat: ["Flat", [0,0,0,0,0,0,0,0,0,0]],
  bass: ["Bass boost", [7,6,4,2,0,0,0,0,0,0]],
  treble: ["Treble boost", [0,0,0,0,0,1,2,4,5,6]],
  vocal: ["Vocal / dialogue", [-3,-2,-1,1,3,4,3,1,0,-1]],
  movie: ["Movie night", [4,3,1,0,1,2,2,1,1,2]],
  rock: ["Rock", [4,3,2,0,-1,-1,1,2,3,4]],
  pop: ["Pop", [-1,1,3,4,3,0,-1,-1,1,2]],
  jazz: ["Jazz", [3,2,1,2,-1,-1,0,1,2,3]],
  classical: ["Classical", [4,3,2,1,-1,-1,0,2,3,4]],
  electronic: ["Electronic", [5,4,1,0,-2,2,1,2,4,5]],
  late: ["Late night (soft bass)", [-6,-4,-2,0,2,3,3,1,0,-1]],
};
const VIDEO_PRESETS = {
  normal: ["Normal", { brightness: 100, contrast: 100, saturation: 100, hue: 0, sepia: 0 }],
  vivid: ["Vivid", { brightness: 103, contrast: 112, saturation: 135, hue: 0, sepia: 0 }],
  cinema: ["Cinema", { brightness: 95, contrast: 118, saturation: 90, hue: 0, sepia: 12 }],
  warm: ["Warm", { brightness: 102, contrast: 104, saturation: 110, hue: -6, sepia: 22 }],
  cool: ["Cool", { brightness: 100, contrast: 104, saturation: 105, hue: 12, sepia: 0 }],
  bw: ["Black & white", { brightness: 100, contrast: 118, saturation: 0, hue: 0, sepia: 0 }],
  sepia: ["Sepia", { brightness: 100, contrast: 102, saturation: 80, hue: 0, sepia: 85 }],
  bright: ["Brighten dark scenes", { brightness: 124, contrast: 92, saturation: 105, hue: 0, sepia: 0 }],
};
const ACCENTS = {
  amber: ["Amber", "#ffb547", "#ff7a59"], ocean: ["Ocean", "#62c8ff", "#4f7dff"], mint: ["Mint", "#62e3a3", "#1fb487"],
  rose: ["Rose", "#ff93b4", "#ff5c8a"], violet: ["Violet", "#b9a0ff", "#7c5cff"], lime: ["Lime", "#d6f25c", "#8fcf2e"],
  crimson: ["Crimson", "#ff6b6b", "#d93a4a"], mono: ["Silver", "#e6e8ec", "#9aa1ad"],
};
const THEMES = { dark: ["Dark", "#0d0e11", "#1c1f26", "#eceef2"], midnight: ["Midnight (OLED)", "#000000", "#121216", "#eceef2"],
                 slate: ["Slate", "#1d2027", "#2d323b", "#eef0f4"], light: ["Light", "#eceef2", "#ffffff", "#16181d"] };
const FONTS = {
  sans: ["Segoe UI", `"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif`],
  bahn: ["Bahnschrift (condensed)", `Bahnschrift,"Segoe UI",sans-serif`],
  verdana: ["Verdana (wide)", `Verdana,"Segoe UI",sans-serif`],
  trebuchet: ["Trebuchet", `"Trebuchet MS","Segoe UI",sans-serif`],
  serif: ["Georgia (serif)", `Georgia,Cambria,"Times New Roman",serif`],
  mono: ["Cascadia (mono)", `"Cascadia Mono",Consolas,monospace`],
  comic: ["Comic", `"Comic Sans MS","Comic Neue",cursive`],
  impact: ["Impact (meme)", `Impact,"Arial Black",sans-serif`],
};
const UI_FONTS = { segoe: ["Segoe UI", `"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif`], bahn: ["Bahnschrift", `Bahnschrift,"Segoe UI",sans-serif`],
  mono: ["Cascadia Mono", `"Cascadia Mono",Consolas,monospace`], verdana: ["Verdana", `Verdana,"Segoe UI",sans-serif`], georgia: ["Georgia", `Georgia,Cambria,serif`] };
const SUB_LANGS = [["auto","Track marked as default"],["en","English"],["es","Spanish"],["fr","French"],["pt","Portuguese"],["de","German"],["it","Italian"],["nl","Dutch"],["hi","Hindi"],["zh","Chinese"],["ja","Japanese"],["ko","Korean"],["ar","Arabic"],["ru","Russian"]];

const DEFAULTS = {
  v: 3,
  rememberVolume: true, resume: false, autoNext: true, defaultSpeed: 1, preservePitch: true,
  speedStepMode: "preset", afterPlayback: "nothing", keepRecent: false, minimalView: false,
  lockAspect: true, fitOnOpen: false, singleInstance: true, explorerOpen: "play",
  theme: "dark", accent: "amber", accentCustom: "#ffb547", showTitle: true,
  glow: "off", landingFx: "full", landingStyle: "simple", neonColors: "accent", uiFont: "segoe", gpuFx: true, fxQuality: "auto",
  gestures: { pinch: true, pan: true, swipeSeek: true, maxZoom: 400 },
  ambient: false, ambientStrength: 70, vizStyle: "bars", seekPreview: true,
  seekStep: 5, skipStep: 10, hideDelay: 2.5,
  ctrl: { size: "normal", seekStyle: "thin", timeMode: "total", prevnext: true, skip: true, volume: true, time: true, shuffle: true, repeat: true, cc: true, speed: true, pin: true, adjust: true },
  mouse: { wheel: "volume", dbl: "fullscreen", click: "toggle" },
  subsAuto: true, subLang: "auto",
  sub: { font: "sans", size: 100, bold: true, color: "#ffffff", outline: 2, outlineColor: "#000000", shadow: true, bg: 0, bgColor: "#000000", margin: 7, position: "bottom", lift: true },
  video: { brightness: 100, contrast: 100, saturation: 100, hue: 0, sepia: 0 },
  eq: { on: false, preset: "flat", gains: [0,0,0,0,0,0,0,0,0,0], boost: 100, balance: 0, mono: false, normalize: false },
  keys: {},
};
let settings = clone(DEFAULTS);
let saved = { volume: 1, muted: false, positions: {}, favorites: [], recent: [] };

// session-only: a fresh start each time the app opens
let list = [], idx = -1, order = [];
const S = { speed: 1, repeat: "off", shuffle: false, listOpen: false, onTop: false };
let fullscreen = false, ab = { a: null, b: null };
let chapters = [], afterOnce = null, pendingSeek = null, statsOn = false, statsT = 0, statsPrev = null;   // MPC-HC style navigation state (session only)
const freshGeo = () => ({ aspect: "auto", zoom: 100, rotate: 0, flip: false, panX: 0, panY: 0 });
let geo = freshGeo();   // per-file picture geometry (zoom & pan included)

let saveTimer = 0;
function persist(){ clearTimeout(saveTimer); saveTimer = setTimeout(writeState, 300); }
function flushState(){ if (saveTimer) { clearTimeout(saveTimer); writeState(); } }
function writeState(){
  saveTimer = 0;
  {
    const keys = Object.keys(saved.positions);
    if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete saved.positions[k]);
    const out = { settings, volume: settings.rememberVolume ? saved.volume : 1, muted: settings.rememberVolume && saved.muted,
                  positions: settings.resume ? saved.positions : {},
                  favorites: saved.favorites, ...(settings.keepRecent ? { recent: saved.recent } : {}) };
    try { host.save(JSON.stringify(out)); } catch {}
  }
}

/* =====================================================================
   Appearance
   ===================================================================== */
function accentColors(){
  if (settings.accent === "custom") { const c = settings.accentCustom; return [c, shade(c, -.22)]; }
  const a = ACCENTS[settings.accent] || ACCENTS.amber; return [a[1], a[2]];
}
function applyAppearance(){
  const root = document.documentElement;
  root.dataset.theme = THEMES[settings.theme] ? settings.theme : "dark";
  const [a, b] = accentColors();
  root.style.setProperty("--accent", a); root.style.setProperty("--accent2", b);
  root.style.setProperty("--accentInk", luminance(a) > .35 ? "#1a1206" : "#ffffff");
  root.style.setProperty("--amb", settings.ambientStrength / 100);
  const g = { off: 0, soft: .55, neon: 1 }[settings.glow] ?? 1;
  root.style.setProperty("--gs", g);
  root.style.setProperty("--glow", hexA(a, .6 * g)); root.style.setProperty("--glow2", hexA(a, .3 * g)); root.style.setProperty("--glow3", hexA(a, .14 * g));
  document.body.classList.toggle("glow-off", g === 0);
  root.style.setProperty("--font", (UI_FONTS[settings.uiFont] || UI_FONTS.segoe)[1]);
  const neon = settings.landingStyle === "neon";
  document.body.classList.toggle("land-neon", neon); document.body.classList.toggle("land-orb", settings.landingStyle === "orb");
  document.body.classList.toggle("land-simple", !neon && settings.landingStyle !== "orb");
  document.body.classList.toggle("min-view", settings.minimalView);
  document.body.classList.toggle("neon-rainbow", neon && settings.neonColors === "rainbow");
  const [n1, n2, n3] = settings.neonColors === "synthwave" ? ["#ff2bd6", "#7b3cff", "#19e6ff"] : [a, b, hueShift(a, -55)];
  root.style.setProperty("--n1", n1); root.style.setProperty("--n2", n2); root.style.setProperty("--n3", n3);
  const fx = landingFxLevel();
  document.body.classList.toggle("fx-calm", fx === "calm"); document.body.classList.toggle("fx-off", fx === "off");
  stage.classList.toggle("no-title", !settings.showTitle);
  stage.classList.toggle("ambient", settings.ambient && list[idx]?.kind === "video");
  $("viz").classList.toggle("radial", settings.vizStyle === "radial");
  const c = settings.ctrl;
  stage.classList.toggle("ctrl-compact", c.size === "compact");
  stage.classList.toggle("ctrl-large", c.size === "large");
  stage.classList.toggle("seek-thick", c.seekStyle === "thick");
  for (const k of ["prevnext","skip","volume","time","shuffle","repeat","cc","speed","pin","adjust"]) stage.classList.toggle("hide-" + k, !c[k]);
  $("skipB").textContent = $("skipF").textContent = settings.skipStep;
  v.preservesPitch = settings.preservePitch;
  updateTitles(); updateTime(); ambientLoop(); landingLoop();
}
function applyAll(){ applyAppearance(); applyVideoFilter(); layout(); applyAudio(); renderSubs(); }

/* =====================================================================
   Toast / flash
   ===================================================================== */
let toastT = 0;
function toast(msg, err){
  const t = $("toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toastT); toastT = setTimeout(() => t.className = "toast", err ? 3800 : 1500);
}
function flash(icon){
  const f = $("flash"); f.querySelector("use").setAttribute("href", "#i-" + icon);
  f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}

/* =====================================================================
   Playlist
   ===================================================================== */
function add(items, playFirst){
  const subsIn = items.filter(i => i.kind === "sub");
  const media = items.filter(i => i.kind === "audio" || i.kind === "video");
  if (subsIn.length && !media.length) {
    if (idx < 0) return toast("Open a video first, then add subtitles", true);
    subsIn.forEach(s => loadSubFile(s, true)); return;
  }
  const start = list.length;
  for (const m of media) if (!m.path || !list.some(x => x.path === m.path)) list.push(m);
  rebuildOrder(); renderList();
  if (media.length && (playFirst || idx < 0)) {
    const target = media[0].path ? list.findIndex(x => x.path === media[0].path) : start;
    play(target >= 0 ? target : start);
  }
  if (subsIn.length) setTimeout(() => subsIn.forEach(s => loadSubFile(s, true)), 300);
  if (media.length > 1) toast(`Added ${media.length} items`);
}
function rebuildOrder(){
  order = list.map((_, i) => i);
  if (S.shuffle) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    if (idx >= 0) { order.splice(order.indexOf(idx), 1); order.unshift(idx); }
  }
}
function renderList(){
  const el = $("list");
  $("count").textContent = list.length ? `· ${list.length}` : "";
  if (!list.length) { el.innerHTML = '<div class="list-empty">Nothing queued yet.<br>Drop files here or use Add files.</div>'; return; }
  // one string, one DOM write — fast even for folders with thousands of files
  el.innerHTML = list.map((it, i) => `<div class="it${i === idx ? " cur" : ""}" draggable="true" data-i="${i}" title="${esc(it.path || it.name)}">
    <div class="ic"><svg><use href="#i-${i === idx && !v.paused ? "pause" : it.kind === "audio" ? "note" : "film"}"/></svg></div>
    <div class="tx"><div class="nm">${esc(base(it.name))}</div><div class="mt">${it.dur ? fmt(it.dur) : it.kind}</div></div>
    <button class="x" title="Remove"><svg><use href="#i-x"/></svg></button></div>`).join("");
}
{ // delegated playlist events (attached once)
  const el = $("list"), row = e => e.target.closest(".it");
  el.addEventListener("click", e => { const d = row(e); if (!d) return; const i = +d.dataset.i; if (e.target.closest(".x")) return remove(i); i === idx ? toggle() : play(i); });
  el.addEventListener("dragstart", e => { const d = row(e); if (d) { e.dataTransfer.setData("text/lumen", d.dataset.i); e.dataTransfer.effectAllowed = "move"; } });
  el.addEventListener("dragover", e => { const d = row(e); if (d && e.dataTransfer.types.includes("text/lumen")) { e.preventDefault(); d.classList.add("dragover"); } });
  el.addEventListener("dragleave", e => { const d = row(e); if (d) d.classList.remove("dragover"); });
  el.addEventListener("drop", e => {
    const d = row(e); if (!d) return; d.classList.remove("dragover");
    const from = +e.dataTransfer.getData("text/lumen"), i = +d.dataset.i;
    if (isNaN(from) || from === i) return; e.preventDefault(); e.stopPropagation();
    const cur = list[idx]; const [m] = list.splice(from, 1); list.splice(i, 0, m);
    idx = list.indexOf(cur); rebuildOrder(); renderList();
  });
}
function markCurrent(){
  const rows = $("list").children;
  if (rows.length !== list.length) return renderList();
  for (let i = 0; i < rows.length; i++) {
    const cur = i === idx; rows[i].classList.toggle("cur", cur);
    rows[i].querySelector(".ic use").setAttribute("href", "#i-" + (cur && !v.paused ? "pause" : list[i].kind === "audio" ? "note" : "film"));
  }
  rows[idx]?.scrollIntoView({ block: "nearest" });
}
function rowMeta(i){ const d = $("list").children[i]; if (d && list[i]) d.querySelector(".mt").textContent = list[i].dur ? fmt(list[i].dur) : list[i].kind; }
function remove(i){
  const wasCur = i === idx, it = list[i];
  if (it.file) URL.revokeObjectURL(it.url);
  list.splice(i, 1);
  if (wasCur) { if (list.length) play(Math.min(i, list.length - 1), !v.paused); else stop(); }
  else if (i < idx) idx--;
  rebuildOrder(); renderList();
}
function clearAll(){ saveResume(); list.forEach(i => i.file && i.url && URL.revokeObjectURL(i.url)); list = []; stop(); rebuildOrder(); renderList(); }
function stop(){
  saveResume();
  idx = -1; v.removeAttribute("src"); v.load(); clearSubs(); clearAB(); pv.removeAttribute("src"); pvFor = null;
  geo = freshGeo(); stage.classList.remove("zoomed"); aspectLock();
  $("empty").classList.remove("hidden"); stage.classList.remove("is-audio", "ambient"); stage.classList.add("no-media");
  $("title").textContent = ""; host.title("Lumen"); updatePlayIcon();
  $("cur").textContent = "0:00"; $("dur").textContent = "0:00"; $("prog").style.width = "0"; $("buf").style.width = "0";
  if (fullscreen) toggleFull(false);
  landingLoop();
}

/* =====================================================================
   Playback
   ===================================================================== */
let loadToken = 0;
function play(i, autoplay = true){
  if (i < 0 || i >= list.length) return;
  saveResume();
  idx = i; const it = list[i]; const token = ++loadToken;
  clearSubs(); clearAB(); setChapters([]);
  if (settings.keepRecent && it.path) { saved.recent = [it.path, ...saved.recent.filter(p => p !== it.path)].slice(0, 15); persist(); }
  geo = freshGeo();
  v.src = it.url; v.playbackRate = S.speed; v.preservesPitch = settings.preservePitch;
  $("empty").classList.add("hidden"); stage.classList.remove("no-media");
  stage.classList.toggle("is-audio", it.kind === "audio");
  $("title").textContent = base(it.name); $("aTitle").textContent = base(it.name);
  $("aSub").textContent = it.path ? it.path.replace(/[\\/][^\\/]+$/, "") : "";
  host.title(base(it.name) + " — Lumen");
  pv.removeAttribute("src"); pvFor = null; pvShown = -1;          // seek previews load lazily, on first hover
  if (autoplay) v.play().catch(() => {});
  markCurrent(); applyAppearance(); layout(); wake();
  if (it.kind === "video") findSubtitles(it, token);
  loadChapters(it, token);
  if (it.kind === "audio" || needsAudioGraph()) audioGraph();
  if (adjOpen()) renderAdj();
}
function toggle(){
  if (idx < 0) return list.length ? play(0) : openFiles();
  if (v.paused) { v.play().catch(()=>{}); flash("play"); } else { v.pause(); flash("pause"); }
}
function step(dir){
  if (!list.length) return;
  const pos = order.indexOf(idx);
  let n = pos + dir;
  if (n >= order.length) { if (S.repeat === "all") n = 0; else return; }
  if (n < 0) n = S.repeat === "all" ? order.length - 1 : 0;
  play(order[n]);
}
function prev(){ if (v.currentTime > 3) { v.currentTime = 0; return; } step(-1); }
function seekBy(s){ if (idx < 0 || !isFinite(v.duration)) return; v.currentTime = clamp(v.currentTime + s, 0, v.duration - .1); toast(`${s > 0 ? "+" : "−"}${Math.abs(s)}s  ·  ${fmt(v.currentTime)}`); }
function setVol(x, show){
  saved.volume = clamp(Math.round(x * 100) / 100, 0, 1); v.volume = saved.volume;
  if (saved.volume > 0 && saved.muted) setMute(false);
  $("volume").value = saved.volume; updateVolIcon(); persist();
  if (show) toast(`Volume ${Math.round(saved.volume * 100)}%${settings.eq.boost > 100 ? `  ·  boost ${settings.eq.boost}%` : ""}`);
}
function setMute(m){ saved.muted = m; v.muted = m; updateVolIcon(); persist(); }
const SPEEDS = [0.25, .5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const speedLabel = x => (x % 1 ? x : x.toFixed(0)) + "×";
function setSpeed(x, quiet){ S.speed = x; v.playbackRate = x; $("bSpeed").textContent = speedLabel(x); if (!quiet) toast(`Speed ${x}×`); }
function speedStep(d){
  const st = settings.speedStepMode;
  if (st !== "preset") return setSpeed(Math.round(clamp(S.speed + d * st, .25, 4) * 100) / 100);   // MPC-HC style fixed step
  const i = SPEEDS.indexOf(S.speed); setSpeed(SPEEDS[clamp((i < 0 ? 3 : i) + d, 0, SPEEDS.length - 1)]);
}
function setRepeat(r){ S.repeat = r; updateToggles(); toast({ off: "Repeat off", all: "Repeat playlist", one: "Repeat this track" }[r]); }
function setShuffle(on){ S.shuffle = on; rebuildOrder(); updateToggles(); toast(on ? "Shuffle on" : "Shuffle off"); }
function saveResume(){
  const it = list[idx];
  if (!settings.resume || !it || !it.path || !isFinite(v.duration) || v.duration < 120) return;
  const t = v.currentTime;
  if (t > 15 && t < v.duration - 20) saved.positions[it.path] = Math.floor(t); else delete saved.positions[it.path];
  persist();
}
function updatePlayIcon(){
  $("playIcon").setAttribute("href", v.paused ? "#i-play" : "#i-pause");
  const cur = $("list").querySelector(".it.cur use");
  if (cur) cur.setAttribute("href", v.paused ? (list[idx]?.kind === "audio" ? "#i-note" : "#i-film") : "#i-pause");
}
function updateVolIcon(){ $("volIcon").setAttribute("href", saved.muted || saved.volume === 0 ? "#i-mute" : saved.volume < .5 ? "#i-vol1" : "#i-vol"); }
function updateToggles(){
  $("bShuffle").classList.toggle("on", S.shuffle);
  $("bRepeat").classList.toggle("on", S.repeat !== "off");
  $("repBadge").hidden = S.repeat !== "one";
  $("bPin").classList.toggle("on", S.onTop);
  $("bList").classList.toggle("on", S.listOpen);
  $("bAdjust").classList.toggle("on", adjOpen());
  app.classList.toggle("list-open", S.listOpen);
}
function updateTime(){
  const d = v.duration;
  $("cur").textContent = fmt(v.currentTime);
  $("dur").textContent = settings.ctrl.timeMode === "remaining" && isFinite(d) ? "−" + fmt(d - v.currentTime) : fmt(d);
}

/* media events */
v.addEventListener("play", () => { updatePlayIcon(); wake(); ambientLoop(); if (AG && AG.ctx.state === "suspended") AG.ctx.resume(); });
v.addEventListener("pause", () => { updatePlayIcon(); saveResume(); wake(); });
v.addEventListener("loadedmetadata", () => {
  const it = list[idx]; if (!it) return;
  it.dur = v.duration; rowMeta(idx); updateTime(); layout();
  if (settings.fitOnOpen && it.kind === "video" && !fullscreen) setTimeout(fitWindow, 50);
  refreshAudioTracks();
  if (pendingSeek != null) { const t = pendingSeek; pendingSeek = null; if (t < v.duration - 1) { v.currentTime = t; toast(`Resumed at ${fmt(t)}`); return; } }
  const r = settings.resume && it.path && saved.positions[it.path];
  if (r && r < v.duration - 20) { v.currentTime = r; toast(`Resumed at ${fmt(r)}`); }
});
v.addEventListener("timeupdate", () => {
  if (ab.a !== null && ab.b !== null && v.currentTime >= ab.b) v.currentTime = ab.a;
  if (dragging) return;
  const d = v.duration || 0;
  updateTime();
  const p = d ? v.currentTime / d * 100 : 0;
  $("prog").style.width = p + "%"; $("knob").style.left = p + "%";
  if (v.buffered.length && d) $("buf").style.width = v.buffered.end(v.buffered.length - 1) / d * 100 + "%";
});
let lastSave = 0;
v.addEventListener("timeupdate", () => { const n = Date.now(); if (n - lastSave > 10000) { lastSave = n; saveResume(); } });
v.addEventListener("ended", () => {
  const it = list[idx]; if (it && it.path) { delete saved.positions[it.path]; persist(); }
  if (sleep.mode === "end") { sleepFire(); return; }
  if (S.repeat === "one") { v.currentTime = 0; v.play(); return; }
  if (!settings.autoNext) { updatePlayIcon(); wake(); afterPlayback(); return; }
  const pos = order.indexOf(idx);
  if (pos < order.length - 1 || S.repeat === "all") step(1); else { updatePlayIcon(); wake(); afterPlayback(); }
});
v.addEventListener("error", () => {
  const it = list[idx]; if (!it || !v.getAttribute("src")) return;
  const code = v.error && v.error.code;
  toast(code === 4 ? `Can't play "${it.name}" — this format or codec isn't supported` : `Couldn't open "${it.name}"`, true);
  it.bad = true;
  if (list.some(x => !x.bad)) setTimeout(() => step(1), 1500);
});
v.addEventListener("seeked", () => drawAmbient());

/* =====================================================================
   Picture layout: aspect, zoom, rotation, flip — and where subtitles go
   ===================================================================== */
const ASPECTS = [["auto","Original"],["16:9","16:9"],["4:3","4:3"],["21:9","21:9"],["1:1","1:1"],["fill","Fill (crop)"],["stretch","Stretch"]];
let pic = null;   // visible picture rectangle inside the stage
let box = null;   // full (possibly zoomed, larger than the stage) picture rectangle
function screenAspect(){
  const vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh) return 0;
  const a = /^\d+:\d+$/.test(geo.aspect) ? geo.aspect.split(":").reduce((x, y) => x / y) : vw / vh;
  const rot = ((geo.rotate % 360) + 360) % 360;
  return rot === 90 || rot === 270 ? 1 / a : a;
}
function layout(){
  const W = stage.clientWidth, H = stage.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
  if (!W || !H) return;
  if (!vw || !vh || list[idx]?.kind !== "video") {
    v.style.cssText = ""; applyVideoFilter(); pic = { x: 0, y: 0, w: W, h: H }; box = null;
    stage.classList.remove("zoomed"); placeSubs(); aspectLock(); return;
  }
  const sa = screenAspect(), rot = ((geo.rotate % 360) + 360) % 360, side = rot === 90 || rot === 270;
  let bw, bh;
  if (geo.aspect === "stretch") { bw = W; bh = H; }
  else if (geo.aspect === "fill") { if (W / H > sa) { bw = W; bh = W / sa; } else { bh = H; bw = H * sa; } }
  else { if (W / H > sa) { bh = H; bw = H * sa; } else { bw = W; bh = W / sa; } }
  bw *= geo.zoom / 100; bh *= geo.zoom / 100;
  const mx = Math.max(0, (bw - W) / 2), my = Math.max(0, (bh - H) / 2);
  geo.panX = clamp(geo.panX, -mx, mx); geo.panY = clamp(geo.panY, -my, my);
  const cx = W / 2 + geo.panX, cy = H / 2 + geo.panY;
  const ew = side ? bh : bw, eh = side ? bw : bh;
  Object.assign(v.style, { inset: "auto", left: cx - ew / 2 + "px", top: cy - eh / 2 + "px", width: ew + "px", height: eh + "px",
    objectFit: "fill", transform: `rotate(${rot}deg) scaleX(${geo.flip ? -1 : 1})` });
  box = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
  pic = { x: x0, y: y0, w: Math.min(W, box.x + bw) - x0, h: Math.min(H, box.y + bh) - y0 };
  stage.classList.toggle("zoomed", geo.zoom > 100.5);
  drawHud(); placeSubs(); aspectLock();
}
new ResizeObserver(() => { layout(); closeMenus(); }).observe(stage);
function setGeo(k, val){
  if (k === "zoom") { zoomAt(val); return; }
  geo[k] = val; layout();
  if (k === "aspect") toast(`Aspect: ${ASPECTS.find(a => a[0] === val)[1]}`);
  if (k === "zoom") toast(`Zoom ${val}%`);
  if (k === "rotate") toast(`Rotated ${((val % 360) + 360) % 360}°`);
  if (k === "flip") toast(val ? "Mirrored" : "Mirror off");
  if (adjOpen()) renderAdj();
}
/* ---- zoom & pan ---- */
const zoomed = () => geo.zoom > 100.5;
// soft: allow a little rubber-band past the limits while a gesture is in progress
function zoomAt(z, px, py, quiet, soft){
  if (list[idx]?.kind !== "video" || !v.videoWidth) return;
  const W = stage.clientWidth, H = stage.clientHeight, max = settings.gestures.maxZoom;
  z = soft ? clamp(z, 100 * .82, max * 1.15) : clamp(z, 100, max);
  if (px == null) { px = W / 2; py = H / 2; }
  const k = z / geo.zoom, cx = W / 2 + geo.panX, cy = H / 2 + geo.panY;
  geo.panX = px - (px - cx) * k - W / 2; geo.panY = py - (py - cy) * k - H / 2;   // keep the point under the fingers/cursor still
  geo.zoom = z;
  if (!soft && z <= 100.5) { geo.zoom = 100; geo.panX = geo.panY = 0; }
  layout(); wake();
  if (!quiet) toast(geo.zoom > 100 ? `Zoom ${Math.round(geo.zoom)}%` : "Zoom reset");
  const r = adjOpen() && $("adjBody").querySelector('[data-k="geo.zoom"]');
  if (r) { r.value = Math.round(geo.zoom); r.nextElementSibling.textContent = Math.round(geo.zoom) + "%"; }
}
// Past a limit the zoom resists, like pinching a web page beyond 100 %.
function rubber(z, lo, hi){
  if (z < lo) return lo - (lo - z) * .35 > lo * .82 ? lo - (lo - z) * .35 : lo * .82;
  if (z > hi) return Math.min(hi + (z - hi) * .3, hi * 1.15);
  return z;
}
/* touchpad pinch: Chromium delivers it as Ctrl+wheel; scale = e^(−deltaY/100), as browsers do */
let pinchQ = null, pinchEndT = 0, pinchRaw = 100, snapRaf = 0;
function queuePinch(k, x, y){
  cancelAnimationFrame(snapRaf);
  if (!pinchQ) { if (Date.now() - (queuePinch.last || 0) > 250) pinchRaw = geo.zoom; pinchQ = { k: 1, x, y }; requestAnimationFrame(applyPinch); }
  pinchQ.k *= k; pinchQ.x = x; pinchQ.y = y; queuePinch.last = Date.now();
  clearTimeout(pinchEndT); pinchEndT = setTimeout(() => settleZoom(x, y), 160);
}
function applyPinch(){                      // at most one layout per frame, however many events arrive
  const q = pinchQ; pinchQ = null; if (!q) return;
  pinchRaw *= q.k;
  zoomAt(rubber(pinchRaw, 100, settings.gestures.maxZoom), q.x, q.y, true, true);
}
function settleZoom(x, y){                  // spring back inside the limits when the fingers lift
  const max = settings.gestures.maxZoom, from = geo.zoom, to = clamp(from, 100, max);
  pinchRaw = to;
  if (Math.abs(to - from) < .5) { if (to === 100 && from !== 100) zoomAt(100); return; }
  const t0 = performance.now();
  const stepf = t => {
    const p = Math.min(1, (t - t0) / 240), e = 1 - Math.pow(1 - p, 3);
    zoomAt(from + (to - from) * e, x, y, true, p < 1);
    if (p < 1) snapRaf = requestAnimationFrame(stepf);
  };
  snapRaf = requestAnimationFrame(stepf);
}
function panBy(dx, dy){ if (!zoomed()) return; geo.panX += dx; geo.panY += dy; layout(); }
let mmT = 0;
function drawHud(){
  if (!zoomed() || !box) return;
  const W = stage.clientWidth, H = stage.clientHeight, mm = $("mm");
  mm.style.height = clamp(150 / (box.w / box.h), 40, 150) + "px";
  const vw = $("mmView");
  const l = clamp(-box.x / box.w, 0, 1), t = clamp(-box.y / box.h, 0, 1);
  Object.assign(vw.style, { left: l * 100 + "%", top: t * 100 + "%", width: Math.min(1 - l, W / box.w) * 100 + "%", height: Math.min(1 - t, H / box.h) * 100 + "%" });
  $("zoomReset").textContent = Math.round(geo.zoom) + "%";
  const now = Date.now();
  if (now - mmT > 400) { mmT = now; try { const c = $("mmCanvas"); c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); } catch {} }
}
function mmPan(e){
  const r = $("mm").getBoundingClientRect();
  const fx = clamp((e.clientX - r.left) / r.width, 0, 1), fy = clamp((e.clientY - r.top) / r.height, 0, 1);
  geo.panX = box.w / 2 - fx * box.w; geo.panY = box.h / 2 - fy * box.h; layout();
}
$("mm").addEventListener("pointerdown", e => { e.stopPropagation(); $("mm").setPointerCapture(e.pointerId); mmPan(e); });
$("mm").addEventListener("pointermove", e => { if (e.buttons) mmPan(e); });
$("zoomReset").onclick = e => { e.stopPropagation(); zoomAt(100); };

/* ---- window shape follows the video ---- */
let aspT = 0, lastAsp = "";
function aspectLock(){
  clearTimeout(aspT);
  aspT = setTimeout(() => {
    const on = settings.lockAspect && list[idx]?.kind === "video" && !fullscreen && v.videoWidth && !["fill", "stretch"].includes(geo.aspect);
    const r = on ? screenAspect() : 0, ew = innerWidth - stage.clientWidth, eh = innerHeight - stage.clientHeight;
    const key = `${r.toFixed(4)}|${ew}|${eh}`;
    if (key !== lastAsp) { lastAsp = key; host.aspect(r, ew, eh); }
  }, 150);
}
async function fitWindow(){
  if (list[idx]?.kind !== "video" || !v.videoWidth) return;
  if (fullscreen) return toast("Leave fullscreen first", true);
  const ok = await host.fitWindow(screenAspect(), innerWidth - stage.clientWidth, innerHeight - stage.clientHeight);
  if (ok === false && hasHost) toast("Restore the window (not maximized) to fit it to the video", true);
}

function applyVideoFilter(){
  const f = settings.video;
  const parts = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturation !== 100) parts.push(`saturate(${f.saturation}%)`);
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
  v.style.filter = parts.join(" ");
  return parts.join(" ") || "none";
}

/* =====================================================================
   Audio graph: 10-band EQ, boost, balance, mono, visualiser
   ===================================================================== */
let AG = null;
const needsAudioGraph = () => { const e = settings.eq; return e.on || e.boost !== 100 || e.balance !== 0 || e.mono || e.normalize; };
function audioGraph(){
  if (AG) return AG;
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(v);
    const mono = ctx.createGain();
    const bands = EQ_FREQS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking"; b.frequency.value = f; b.Q.value = 1.1; return b; });
    const boost = ctx.createGain(), pan = ctx.createStereoPanner(), an = ctx.createAnalyser();
    const comp = ctx.createDynamicsCompressor(), makeup = ctx.createGain();      // volume normalisation
    an.fftSize = 512; an.smoothingTimeConstant = .8;
    [src, mono, ...bands, comp, makeup, boost, pan, an, ctx.destination].reduce((a, b) => (a.connect(b), b));
    AG = { ctx, mono, bands, comp, makeup, boost, pan, an };
    applyAudio();
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) { console.warn("audio graph", e); }
  return AG;
}
function applyAudio(){
  if (!AG) { if (needsAudioGraph() && idx >= 0) audioGraph(); return; }
  const e = settings.eq, t = AG.ctx.currentTime;
  AG.bands.forEach((b, i) => b.gain.setTargetAtTime(e.on ? e.gains[i] : 0, t, .03));
  AG.boost.gain.setTargetAtTime(e.boost / 100, t, .03);
  AG.pan.pan.setTargetAtTime(e.balance / 100, t, .03);
  AG.mono.channelCountMode = e.mono ? "explicit" : "max"; AG.mono.channelCount = e.mono ? 1 : 2;
  const c = AG.comp;   // off = a transparent compressor (ratio 1)
  c.threshold.setTargetAtTime(e.normalize ? -30 : 0, t, .05); c.knee.setTargetAtTime(e.normalize ? 24 : 0, t, .05);
  c.ratio.setTargetAtTime(e.normalize ? 6 : 1, t, .05); c.attack.value = .004; c.release.value = .3;
  AG.makeup.gain.setTargetAtTime(e.normalize ? 1.7 : 1, t, .05);
}
let vizRunning = false;
function ensureViz(){ if (!vizRunning && stage.classList.contains("is-audio") && audioGraph()) { vizRunning = true; requestAnimationFrame(drawViz); } }
function drawViz(){
  const c = $("viz");
  if (!stage.classList.contains("is-audio") || !AG || v.paused || document.hidden) { vizRunning = false; return; }   // idle when nothing moves
  c.classList.toggle("radial", settings.vizStyle === "radial");
  const dpr = devicePixelRatio || 1, W = c.clientWidth * dpr, H = c.clientHeight * dpr;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext("2d"); g.clearRect(0, 0, W, H);
  const [a, b] = accentColors();
  if (settings.vizStyle === "none") { requestAnimationFrame(drawViz); return; }
  if (settings.vizStyle === "wave") {
    const data = new Uint8Array(AG.an.fftSize); AG.an.getByteTimeDomainData(data);
    g.lineWidth = 3 * dpr; g.lineJoin = "round"; g.strokeStyle = a; g.shadowColor = b; g.shadowBlur = 18 * dpr;
    g.beginPath();
    for (let i = 0; i < data.length; i++) { const x = i / (data.length - 1) * W, y = H / 2 + (data[i] - 128) / 128 * H * .45; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  } else if (settings.vizStyle === "radial") {
    const data = new Uint8Array(AG.an.frequencyBinCount); AG.an.getByteFrequencyData(data);
    const disc = document.querySelector(".disc").getBoundingClientRect(), cr = c.getBoundingClientRect();
    const cx = (disc.left + disc.width / 2 - cr.left) * dpr, cy = (disc.top + disc.height / 2 - cr.top) * dpr, r0 = disc.width * .62 * dpr;
    const n = 96; g.lineCap = "round"; g.lineWidth = Math.max(2, 3 * dpr);
    for (let i = 0; i < n; i++) {
      const val = data[Math.floor((i < n / 2 ? i : n - i) * data.length * .7 / (n / 2))] / 255;
      const ang = i / n * Math.PI * 2 - Math.PI / 2, len = 6 * dpr + Math.pow(val, 1.3) * r0 * .7;
      g.strokeStyle = i % 2 ? a : b; g.globalAlpha = .35 + val * .65;
      g.beginPath(); g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); g.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len)); g.stroke();
    }
    g.globalAlpha = 1;
  } else {
    const data = new Uint8Array(AG.an.frequencyBinCount); AG.an.getByteFrequencyData(data);
    const bars = 64, gap = 3 * dpr, bw = (W - gap * (bars - 1)) / bars;
    const grad = g.createLinearGradient(0, H, 0, 0); grad.addColorStop(0, b); grad.addColorStop(1, hexA(a, .15));
    g.fillStyle = grad;
    for (let i = 0; i < bars; i++) {
      const val = data[Math.floor(i * data.length * .7 / bars)] / 255;
      const h = Math.max(2 * dpr, Math.pow(val, 1.4) * H * .95);
      g.beginPath(); g.roundRect(i * (bw + gap), H - h, bw, h, [3 * dpr, 3 * dpr, 0, 0]); g.fill();
    }
  }
  requestAnimationFrame(drawViz);
}
v.addEventListener("playing", () => { if (stage.classList.contains("is-audio")) ensureViz(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && !v.paused && stage.classList.contains("is-audio")) ensureViz(); });

/* =====================================================================
   Ambient light — a soft glow of the picture's colours around it
   ===================================================================== */
let ambT = 0;
function drawAmbient(){
  if (!stage.classList.contains("ambient") || !v.videoWidth) return;
  try { $("amb").getContext("2d").drawImage(v, 0, 0, 32, 18); } catch {}
}
function ambientLoop(){
  clearInterval(ambT);
  if (stage.classList.contains("ambient")) { drawAmbient(); ambT = setInterval(() => { if (!v.paused && !document.hidden) drawAmbient(); }, 120); }
}

/* =====================================================================
   Seek bar, thumbnails, A–B loop
   ===================================================================== */
const seek = $("seek"); let dragging = false;
const pv = document.createElement("video"); pv.muted = true; pv.preload = "auto";
let pvBusy = false, pvNext = null, pvShown = -1, pvFor = null;
function thumbAt(t){
  if (!settings.seekPreview || list[idx]?.kind !== "video") return $("tip").classList.remove("thumb");
  if (pvFor !== list[idx]) { pvFor = list[idx]; pv.src = list[idx].url; pvBusy = false; }   // first hover: start the preview stream
  t = Math.round(t);
  if (t === pvShown) return;
  if (pvBusy) { pvNext = t; return; }
  pvBusy = true; pvNext = null;
  const done = () => {
    pv.removeEventListener("seeked", done);
    try { const c = $("thumb"); c.getContext("2d").drawImage(pv, 0, 0, c.width, c.height); $("tip").classList.add("thumb"); pvShown = t; } catch {}
    pvBusy = false; if (pvNext !== null && pvNext !== t) thumbAt(pvNext);
  };
  pv.addEventListener("seeked", done);
  try { pv.currentTime = t; } catch { pvBusy = false; }
  setTimeout(() => { if (pvBusy) { pv.removeEventListener("seeked", done); pvBusy = false; } }, 1500);
}
function seekPos(e){ const r = seek.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); }
seek.addEventListener("pointermove", e => {
  const p = seekPos(e), tip = $("tip"), t = p * (v.duration || 0);
  const ch = chapterAt(t);
  $("tipTime").textContent = fmt(t) + (ch ? `  ·  ${ch.title || "Chapter " + (chapters.indexOf(ch) + 1)}` : "");
  if (isFinite(v.duration)) thumbAt(t);
  const w = seek.clientWidth, half = tip.offsetWidth / 2;
  tip.style.left = clamp(p * w, half, w - half) + "px";
  if (dragging) { $("prog").style.width = p * 100 + "%"; $("knob").style.left = p * 100 + "%"; $("cur").textContent = fmt(t); }
});
seek.addEventListener("pointerleave", () => { pvShown = -1; });
seek.addEventListener("pointerdown", e => { if (!isFinite(v.duration)) return; dragging = true; seek.classList.add("drag"); seek.setPointerCapture(e.pointerId); seek.dispatchEvent(new PointerEvent("pointermove", e)); });
seek.addEventListener("pointerup", e => { if (!dragging) return; dragging = false; seek.classList.remove("drag"); v.currentTime = seekPos(e) * v.duration; });

function abStep(){
  if (idx < 0 || !isFinite(v.duration)) return;
  if (ab.a === null) { ab.a = v.currentTime; toast(`Loop start set at ${fmt(ab.a)} — press again for the end`); }
  else if (ab.b === null) {
    if (v.currentTime <= ab.a + .5) return toast("Loop end must be after the start", true);
    ab.b = v.currentTime; v.currentTime = ab.a; toast(`Looping ${fmt(ab.a)} – ${fmt(ab.b)}`);
  } else { clearAB(); toast("A–B loop cleared"); }
  drawAB();
}
function clearAB(){ ab = { a: null, b: null }; drawAB(); }
function drawAB(){
  const el = $("ab"), d = v.duration;
  if (ab.a === null || !isFinite(d)) { el.style.display = "none"; return; }
  el.style.display = "block"; el.style.left = ab.a / d * 100 + "%";
  el.style.width = ((ab.b ?? ab.a) - ab.a) / d * 100 + "%";
}

/* =====================================================================
   Controls auto-hide (always hides in fullscreen)
   ===================================================================== */
let idleT = 0, lastPt = { x: -1, y: -1 }, overCtrl = false;
function busy(){ return menuOpen() || modalOpen() || dragging || $("ccPop").classList.contains("open") || (adjOpen() && overPanel); }
function hideNow(){ if (idx < 0 && !fullscreen) return; stage.classList.add("idle", "hide-cursor"); placeSubs(); }
function wake(){
  const was = stage.classList.contains("idle");
  stage.classList.remove("idle", "hide-cursor"); clearTimeout(idleT);
  idleT = setTimeout(maybeHide, settings.hideDelay * 1000);
  if (was) placeSubs();
}
function maybeHide(){
  if (busy()) return wake();
  if (fullscreen) return hideNow();
  if (idx >= 0 && !v.paused && !stage.matches(".is-audio") && !overCtrl) hideNow();
}
let overPanel = false;
stage.addEventListener("pointermove", e => {
  if (Math.abs(e.clientX - lastPt.x) < 2 && Math.abs(e.clientY - lastPt.y) < 2) return;  // ignore synthetic moves
  lastPt = { x: e.clientX, y: e.clientY }; wake();
});
stage.addEventListener("pointerdown", wake);
$("ctrl").addEventListener("pointerenter", () => overCtrl = true);
$("ctrl").addEventListener("pointerleave", () => overCtrl = false);
$("adjPanel").addEventListener("pointerenter", () => overPanel = true);
$("adjPanel").addEventListener("pointerleave", () => overPanel = false);
stage.addEventListener("pointerleave", () => { overCtrl = false; if (!busy() && (fullscreen || (!v.paused && idx >= 0 && !stage.matches(".is-audio")))) hideNow(); });

/* mouse actions on the picture */
let clickT = 0, suppressClick = false;
v.addEventListener("click", () => {
  if (suppressClick || settings.mouse.click === "none") return;
  clearTimeout(clickT); clickT = setTimeout(toggle, settings.mouse.dbl === "none" ? 0 : 220);
});
v.addEventListener("dblclick", e => {
  clearTimeout(clickT); if (suppressClick) return;
  const d = settings.mouse.dbl;
  if (d === "sides") {
    const r = stage.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
    if (f < .3) { seekBy(-settings.skipStep); flash("prev"); return; }
    if (f > .7) { seekBy(settings.skipStep); flash("next"); return; }
    toggleFull();
  } else if (d === "fullscreen") toggleFull(); else if (d === "toggle") toggle();
});

/* wheel: touchpad pinch (arrives as Ctrl+wheel) zooms, two-finger scroll pans when zoomed or swipes to seek */
let wheelAcc = 0, swipeAcc = 0, wheelT = 0;
stage.addEventListener("wheel", e => {
  if (e.target.closest(".ctrl,.pop,.fpanel,.zoomhud,.empty") || idx < 0) return;
  e.preventDefault();
  const vid = list[idx].kind === "video", g = settings.gestures;
  const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1, dx = e.deltaX * unit, dy = e.deltaY * unit;
  if (e.ctrlKey) {
    if (vid && g.pinch) {
      const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const mouseNotch = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
      if (mouseNotch) zoomAt(geo.zoom * (dy < 0 ? 1.18 : 1 / 1.18), x, y, true);      // Ctrl + mouse wheel: one step per notch
      else queuePinch(Math.exp(-dy / 100), x, y);                                       // touchpad pinch: follows the fingers
    }
    return;
  }
  const touchpad = e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(dy) < 50;
  if (vid && zoomed() && g.pan && (touchpad || e.shiftKey)) { panBy(-dx || (e.shiftKey ? -dy : 0), e.shiftKey && !touchpad ? 0 : -dy); return; }
  clearTimeout(wheelT); wheelT = setTimeout(() => { wheelAcc = swipeAcc = 0; }, 260);
  if (touchpad && g.swipeSeek && Math.abs(dx) > Math.abs(dy)) {
    swipeAcc += dx;
    if (Math.abs(swipeAcc) >= 110) { seekBy(swipeAcc > 0 ? settings.seekStep : -settings.seekStep); swipeAcc = 0; }
    return;
  }
  let stepDir = Math.sign(dy);
  if (touchpad) { wheelAcc += dy; if (Math.abs(wheelAcc) < 60) return; stepDir = Math.sign(wheelAcc); wheelAcc = 0; }
  if (!stepDir) return;
  const up = stepDir < 0;
  if (settings.mouse.wheel === "seek") seekBy(up ? settings.seekStep : -settings.seekStep);
  else if (settings.mouse.wheel === "volume") setVol(saved.volume + (up ? .05 : -.05), true);
}, { passive: false });

window.addEventListener("wheel", e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false, capture: true });
document.addEventListener("gesturestart", e => e.preventDefault());

/* touch: pinch to zoom, one or two fingers to move; mouse: drag the zoomed picture */
const touches = new Map(); let pinch = null, drag = null;
const onPicture = e => !e.target.closest(".ctrl,.top,.pop,.fpanel,.zoomhud,.empty") && list[idx]?.kind === "video";
const mid = () => { const [a, b] = [...touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
stage.addEventListener("pointerdown", e => {
  if (!onPicture(e)) return;
  if (e.pointerType === "touch") {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && settings.gestures.pinch) { const m = mid(); pinch = { d0: Math.max(m.d, 1), z0: geo.zoom, x: m.x, y: m.y }; drag = null; }
    else if (touches.size === 1 && zoomed() && settings.gestures.pan) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    return;
  }
  if ((e.button === 0 || e.button === 1) && zoomed() && settings.gestures.pan) {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    stage.setPointerCapture(e.pointerId); if (e.button === 1) e.preventDefault();
  }
});
stage.addEventListener("pointermove", e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size >= 2) {
    const m = mid(), r = stage.getBoundingClientRect();
    zoomAt(rubber(pinch.z0 * m.d / pinch.d0, 100, settings.gestures.maxZoom), m.x - r.left, m.y - r.top, true, true);
    pinch.lx = m.x - r.left; pinch.ly = m.y - r.top;
    if (settings.gestures.pan) panBy(m.x - pinch.x, m.y - pinch.y);
    pinch.x = m.x; pinch.y = m.y; suppressClick = true;
    return;
  }
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 4) { stage.classList.add("panning"); suppressClick = true; }
    panBy(dx, dy);
  }
});
const endPointer = e => {
  touches.delete(e.pointerId);
  if (touches.size < 2 && pinch) { settleZoom(pinch.lx, pinch.ly); pinch = null; }
  if (drag && drag.id === e.pointerId) { drag = null; stage.classList.remove("panning"); }
  if (suppressClick) setTimeout(() => { suppressClick = false; }, 60);
};
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);

/* fullscreen / on top */
function toggleFull(force){
  const on = force ?? !fullscreen;
  if (on && idx < 0) return;
  fullscreen = on;
  host.full(on);
  document.body.classList.toggle("fs", on);
  $("fullIcon").setAttribute("href", on ? "#i-unfull" : "#i-full");
  closeMenus(); $("ccPop").classList.remove("open");
  if (on) { clearTimeout(idleT); setTimeout(hideNow, 60); } else wake();
  aspectLock();
}
document.addEventListener("fullscreenchange", () => { if (!hasHost && !document.fullscreenElement && fullscreen) toggleFull(false); });
function setOnTop(on){ S.onTop = on; host.onTop(on); updateToggles(); toast(on ? "Keeping window on top" : "Always on top off"); }

/* =====================================================================
   Subtitles: loading, choosing, and drawing them ourselves
   ===================================================================== */
// Tracks come from a pool because HTML has no way to delete a TextTrack.
// They stay "hidden" (no native rendering); Lumen draws the active cues
// inside the real picture area with a safe margin from the edge.
const trackPool = [];
let subs = [], activeSub = -1, userPickedSub = false, subDelay = 0;
const LANG2 = { eng:"en", spa:"es", fre:"fr", fra:"fr", ger:"de", deu:"de", por:"pt", ita:"it", jpn:"ja", chi:"zh", zho:"zh", kor:"ko",
  rus:"ru", ara:"ar", hin:"hi", dut:"nl", nld:"nl", pol:"pl", tur:"tr", swe:"sv", nor:"no", dan:"da", fin:"fi", gre:"el", ell:"el",
  heb:"he", hun:"hu", cze:"cs", ces:"cs", rum:"ro", ron:"ro", ukr:"uk", vie:"vi", tha:"th", ind:"id", may:"ms", msa:"ms", fil:"fil", tam:"ta", ben:"bn", per:"fa", fas:"fa" };
const lang2 = l => { if (!l) return ""; l = l.toLowerCase().split(/[-_]/)[0]; return LANG2[l] || (l.length === 2 ? l : l === "und" ? "" : l); };
let langNames; try { langNames = new Intl.DisplayNames(["en"], { type: "language" }); } catch {}
const langName = l => { const c = lang2(l); if (!c) return ""; try { return langNames ? langNames.of(c) : c; } catch { return c; } };

function getTrack(){
  let t = trackPool.find(t => t.free);
  if (!t) {
    t = { tt: v.addTextTrack("subtitles"), free: true }; trackPool.push(t);
    t.tt.addEventListener("cuechange", () => { if (subs[activeSub]?.slot === t) renderSubs(); });
  }
  t.free = false; t.tt.mode = "hidden"; return t;
}
function newSub(meta){ const s = { ...meta, slot: getTrack(), cues: [] }; subs.push(s); return s; }
function addCue(s, start, end, text){
  if (!text || !(end > start)) return;
  try { const c = new VTTCue(start + subDelay, end + subDelay, text); s.slot.tt.addCue(c); s.cues.push({ start, end, c }); } catch {}
}
function clearSubs(){
  for (const s of subs) { for (const x of s.cues) try { s.slot.tt.removeCue(x.c); } catch {} s.slot.tt.mode = "disabled"; s.slot.free = true; }
  subs = []; activeSub = -1; userPickedSub = false; subDelay = 0; $("bCC").classList.remove("on"); renderSubs();
}
function setSub(i, how){
  activeSub = i;
  $("bCC").classList.toggle("on", i >= 0);
  if (how === "user") { userPickedSub = true; toast(i >= 0 ? `Subtitles: ${subs[i].label}` : "Subtitles off"); }
  renderSubs();
}
function autoPick(){
  if (userPickedSub || !subs.length) return;
  if (!settings.subsAuto) { if (activeSub !== -1) setSub(-1, "auto"); return; }
  let pick = -1;
  const want = settings.subLang !== "auto" ? settings.subLang : "";
  if (want) pick = subs.findIndex(s => lang2(s.lang) === want && !s.forced);
  if (pick < 0) pick = subs.findIndex(s => s.source === "sidecar");
  if (pick < 0) pick = subs.findIndex(s => s.isDefault && !s.forced);
  if (pick < 0) pick = subs.findIndex(s => !s.forced);
  if (pick < 0) pick = 0;
  if (pick !== activeSub) {
    setSub(pick, "auto");
    toast(`Subtitles: ${subs[pick].label}${subs.length > 1 ? `  ·  ${subs.length} tracks (${keyLabel("cycleSub") || "C"} to switch)` : ""}`);
  }
}
function shiftSubs(d){
  if (!subs.length) return toast("No subtitles loaded");
  subDelay = Math.round((subDelay + d) * 10) / 10;
  for (const s of subs) for (const x of s.cues) { x.c.startTime = x.start + subDelay; x.c.endTime = x.end + subDelay; }
  toast(`Subtitle delay ${subDelay > 0 ? "+" : ""}${subDelay.toFixed(1)} s`);
}
function resetSubDelay(){ shiftSubs(-subDelay); }

/* ---- drawing ---- */
function subTextShadow(st, px){
  const out = [];
  const w = st.outline * Math.max(.6, px / 36);
  if (w > 0) {
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; out.push(`${(Math.cos(a) * w).toFixed(2)}px ${(Math.sin(a) * w).toFixed(2)}px 0 ${st.outlineColor}`); }
    out.push(`0 0 ${(w * 1.5).toFixed(1)}px ${st.outlineColor}`);
  }
  if (st.shadow) out.push(`0 ${(px * .07).toFixed(1)}px ${(px * .22).toFixed(1)}px rgba(0,0,0,.85)`);
  return out.join(",") || "none";
}
function styleCues(layer, px){
  const st = settings.sub;
  layer.style.fontFamily = (FONTS[st.font] || FONTS.sans)[1];
  layer.style.fontSize = px + "px";
  layer.style.fontWeight = st.bold ? 600 : 400;
  layer.style.color = st.color;
  layer.querySelectorAll(".cue>span").forEach(sp => {
    sp.style.textShadow = subTextShadow(st, px);
    sp.style.background = st.bg ? hexA(st.bgColor, st.bg / 100) : "transparent";
  });
}
function subFontPx(h){ return clamp(h * .047 * settings.sub.size / 100, 12, 140); }
function renderSubs(){
  const layer = $("subLayer"); layer.innerHTML = "";
  const s = subs[activeSub];
  if (s && list[idx]?.kind === "video") {
    const cues = [...(s.slot.tt.activeCues || [])].sort((a, b) => a.startTime - b.startTime);
    for (const c of cues) {
      const d = document.createElement("div"); d.className = "cue";
      const sp = document.createElement("span");
      try { sp.appendChild(c.getCueAsHTML()); } catch { sp.textContent = c.text; }
      d.appendChild(sp); layer.appendChild(d);
    }
  }
  placeSubs();
}
function placeSubs(){
  const layer = $("subLayer"); if (!pic) return;
  const st = settings.sub, H = stage.clientHeight, px = subFontPx(pic.h);
  styleCues(layer, px);
  const margin = Math.max(st.margin / 100 * pic.h, 8);                       // safe gap from the picture edge
  const controls = !stage.classList.contains("idle") && !stage.classList.contains("no-media") && st.lift;
  layer.style.left = pic.x + "px"; layer.style.width = pic.w + "px";
  if (st.position === "top") {
    const topBar = controls ? $("top").offsetHeight : 0;
    layer.style.bottom = "auto"; layer.style.top = Math.max(pic.y + margin, topBar) + "px";
  } else {
    const ctrlH = controls ? $("ctrl").offsetHeight + 6 : 0;
    layer.style.top = "auto"; layer.style.bottom = Math.max(H - (pic.y + pic.h) + margin, ctrlH) + "px";
  }
}

/* ---- text cleanup & parsing ---- */
function cleanCue(s, codec){
  s = s.replace(/\r/g, "");
  if (codec === "ass") {
    if (/\{[^}]*\\p[1-9]/.test(s)) return "";
    s = s.replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ");
  }
  s = s.replace(/<\/?([a-zA-Z]+)[^>]*>/g, (t, n) => { n = n.toLowerCase(); return /^[biu]$/.test(n) ? (t[1] === "/" ? `\x01/${n}\x02` : `\x01${n}\x02`) : ""; });
  s = s.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
       .replace(/\x01/g, "<").replace(/\x02/g, ">");
  return s.split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim()).join("\n");
}
const tsec = t => { const p = t.trim().replace(",", ".").split(":").map(Number); return p.length === 3 ? p[0]*3600 + p[1]*60 + p[2] : p.length === 2 ? p[0]*60 + p[1] : NaN; };
function parseSubText(text, name){
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const out = [];
  if (/\.(ass|ssa)$/i.test(name) || /^\[Script Info\]/m.test(text)) {
    let fields = null;
    for (const line of text.split("\n")) {
      const fm = line.match(/^Format:\s*(.*)$/i);
      if (fm && /text/i.test(fm[1])) fields = fm[1].split(",").map(s => s.trim().toLowerCase());
      const m = line.match(/^Dialogue:\s*(.*)$/i);
      if (!m) continue;
      const f = fields || ["layer","start","end","style","name","marginl","marginr","marginv","effect","text"];
      const parts = m[1].split(","), ti = f.indexOf("text");
      out.push({ start: tsec(parts[f.indexOf("start")]), end: tsec(parts[f.indexOf("end")]), text: cleanCue(parts.slice(ti).join(","), "ass") });
    }
  } else {
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split("\n"); const k = lines.findIndex(l => l.includes("-->"));
      if (k < 0) continue;
      const [a, b] = lines[k].split("-->");
      out.push({ start: tsec(a), end: tsec(b.trim().split(/\s+/)[0]), text: cleanCue(lines.slice(k + 1).join("\n")) });
    }
  }
  return out.filter(c => isFinite(c.start) && isFinite(c.end) && c.text).sort((a, b) => a.start - b.start);
}
function sidecarLabel(name, videoName){
  const stem = base(videoName || "").toLowerCase(), b = base(name);
  const tail = b.toLowerCase().startsWith(stem + ".") ? b.slice(stem.length + 1) : "";
  const ln = tail && langName(tail.split(".")[0]);
  return { label: (ln || (tail || b)) + " (file)", lang: ln ? tail.split(".")[0] : "" };
}
function trackLabel(name, lang, n, forced){
  const ln = langName(lang);
  const l = name && ln && !name.toLowerCase().includes(ln.toLowerCase()) ? `${name} (${ln})` : name || ln || `Track ${n + 1}`;
  return forced && !/forced/i.test(l) ? l + " [forced]" : l;
}

/* ---- loading ---- */
async function loadSubFile(it, select){
  const token = loadToken;
  try {
    const txt = it.file ? await it.file.text() : await (await fetch(it.url)).text();
    if (token !== loadToken) return;
    const cues = parseSubText(txt, it.name);
    if (!cues.length) return toast(`No subtitles found in "${it.name}"`, true);
    const meta = sidecarLabel(it.name, list[idx]?.name);
    const s = newSub({ label: select ? base(it.name) : meta.label, lang: meta.lang, source: select ? "file" : "sidecar" });
    cues.forEach(c => addCue(s, c.start, c.end, c.text));
    if (select) setSub(subs.indexOf(s), "user"); else autoPick();
  } catch { toast(`Couldn't read subtitle "${it.name}"`, true); }
}
// Let the video's first frames load before reading subtitles, so the two don't compete for the disk.
const firstFrame = () => new Promise(res => {
  if (v.readyState >= 2) return res();
  const done = () => { v.removeEventListener("loadeddata", done); v.removeEventListener("error", done); clearTimeout(t); res(); };
  v.addEventListener("loadeddata", done); v.addEventListener("error", done);
  const t = setTimeout(done, 1500);
});
async function findSubtitles(it, token){
  if (it.path) {                       // opened from disk: Go lists embedded tracks + sibling files
    let found = [];
    try { found = await host.subs(it.path) || []; } catch {}
    if (token !== loadToken) return;
    const embedded = found.filter(f => f.embedded), files = found.filter(f => !f.embedded);
    files.forEach(f => loadSubFile(f, false));
    if (embedded.length) {
      const slots = embedded.map((e, n) => newSub({ label: trackLabel(e.label, e.lang, n, e.forced), lang: e.lang, source: "embedded", isDefault: e.default, forced: e.forced }));
      await firstFrame(); if (token !== loadToken) return;
      await Promise.all(embedded.map(async (e, n) => {
        try {
          const txt = await (await fetch(e.url)).text();
          if (token !== loadToken) return;
          parseSubText(txt, "x.vtt").forEach(c => addCue(slots[n], c.start, c.end, c.text));
        } catch {}
      }));
      if (token === loadToken) { autoPick(); renderSubs(); }
    }
    return;
  }
  if (it.file && MATROSKA.test(it.name)) {   // dropped file: read the Matroska file in the page
    const slots = {};
    await firstFrame(); if (token !== loadToken) return;
    try {
      await window.scanMatroska(it.file, {
        stale: () => token !== loadToken,
        chapters: chs => { if (token === loadToken) setChapters(chs); },
        tracks: ts => { ts.forEach((t, n) => { slots[t.number] = newSub({ label: trackLabel(t.name, t.lang, n, t.forced), lang: t.lang, source: "embedded", isDefault: t.isDefault, forced: t.forced }); }); autoPick(); },
        cue: (num, start, end, text, codec) => {
          const s = slots[num]; if (!s) return;
          const txt = cleanCue(text, codec); if (!txt) return;
          const open = end == null; if (open) end = start + 4;
          const last = s.cues[s.cues.length - 1];
          if (last && last.open && last.end > start && last.start < start) { last.end = start; last.c.endTime = start + subDelay; }
          const before = s.cues.length;
          addCue(s, start, end, txt);
          if (s.cues.length > before) s.cues[s.cues.length - 1].open = open;
        },
      });
    } catch (e) { console.warn("mkv scan", e); }
  }
}

/* subtitle popover */
function ccPop(){
  const m = $("ccPop");
  if (m.classList.contains("open")) return m.classList.remove("open");
  closeMenus();
  m.innerHTML = "<h6>Subtitles</h6>";
  const mk = (label, i) => { const b = document.createElement("button"); b.textContent = label; if (i === activeSub) b.className = "sel"; b.onclick = () => { setSub(i, "user"); m.classList.remove("open"); }; m.appendChild(b); };
  mk("Off", -1); subs.forEach((s, i) => mk(s.label, i));
  const add = document.createElement("button"); add.innerHTML = `Load subtitle file…<span class="sm">${esc(keyLabel("loadSubs"))}</span>`;
  add.onclick = () => { m.classList.remove("open"); loadSubsDialog(); };
  const sty = document.createElement("button"); sty.innerHTML = "Subtitle style…";
  sty.onclick = () => { m.classList.remove("open"); settingsModal("subtitles"); };
  m.append(add, sty); m.classList.add("open");
}
function cycleSub(){ if (!subs.length) return toast("No subtitles for this video"); setSub(activeSub + 1 < subs.length ? activeSub + 1 : -1, "user"); }
document.addEventListener("pointerdown", e => { if (!e.target.closest("#ccPop,#bCC")) $("ccPop").classList.remove("open"); });

/* =====================================================================
   Open / drop
   ===================================================================== */
async function openFiles(){ const items = await host.dialog("files") || []; if (items.length) { if (items.some(i => i.kind !== "sub")) clearAll(); add(items, true); } }
async function openFolder(){
  const items = await host.dialog("folder") || [];
  const media = items.filter(i => i.kind !== "sub");
  if (!media.length) return items.length === 0 ? null : toast("No playable files in that folder", true);
  clearAll(); add(media, true);
}
async function addFiles(){ const items = await host.dialog("files") || []; if (items.length) add(items, false); }
async function loadSubsDialog(){
  if (idx < 0) return toast("Open a video first, then add subtitles", true);
  ((await host.dialog("subs")) || []).filter(i => i.kind === "sub").forEach(i => loadSubFile(i, true));
}
let dragDepth = 0;
const isExternal = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
window.addEventListener("dragenter", e => { if (!isExternal(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); });
window.addEventListener("dragleave", e => { if (!isExternal(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
window.addEventListener("dragover", e => { if (isExternal(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
window.addEventListener("drop", async e => {
  if (!isExternal(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  const files = await collectDropped(e.dataTransfer);
  files.sort((a, b) => natural(a.name, b.name));
  if (files.length === 1 && /\.json$/i.test(files[0].name)) return importSettingsText(await files[0].text());
  const items = filesToItems(files);
  if (!items.length) return toast("No playable files in that drop", true);
  add(items, idx < 0);
});
async function collectDropped(dt){
  const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (en, depth) => {
    if (en.isFile) { out.push(await new Promise((r, j) => en.file(r, j))); return; }
    if (en.isDirectory && depth < 4) {
      const rd = en.createReader(); let batch;
      do { batch = await new Promise((r, j) => rd.readEntries(r, j)); for (const c of batch) await walk(c, depth + 1); } while (batch.length);
    }
  };
  for (const en of entries) { try { await walk(en, 0); } catch {} }
  return out;
}

/* =====================================================================
   Tools: snapshot, media info, sleep timer
   ===================================================================== */
async function snapshot(){
  const it = list[idx];
  if (!it || it.kind !== "video" || !v.videoWidth) return toast("Snapshots need a video to be playing", true);
  const rot = ((geo.rotate % 360) + 360) % 360, side = rot === 90 || rot === 270;
  const c = document.createElement("canvas"); c.width = side ? v.videoHeight : v.videoWidth; c.height = side ? v.videoWidth : v.videoHeight;
  const g = c.getContext("2d");
  g.filter = applyVideoFilter();                 // snapshots include your colour adjustments
  g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180); if (geo.flip) g.scale(-1, 1);
  g.drawImage(v, -v.videoWidth / 2, -v.videoHeight / 2);
  const name = `${base(it.name)} ${fmt(v.currentTime).replace(/:/g, "-")}`;
  try { const p = await host.snapshot(c.toDataURL("image/png"), name); flash("plus"); toast(`Snapshot saved: ${p}`); }
  catch { toast("Couldn't save the snapshot", true); }
}
function mediaInfo(){
  const it = list[idx];
  if (!it) return openModal("Media information", `<p style="color:var(--dim);padding:16px 0">Nothing is playing.</p>`);
  const ext = (it.name.match(/\.([^.]+)$/) || [, ""])[1].toUpperCase();
  const rows = [
    ["Title", base(it.name)], ["Location", it.path ? it.path : "Dropped into the window"],
    ["Type", `${it.kind === "audio" ? "Audio" : "Video"} · ${ext}`], ["Size", bytes(it.size)],
    ["Duration", isFinite(v.duration) ? fmt(v.duration) : "—"],
  ];
  if (it.kind === "video") rows.push(["Resolution", v.videoWidth ? `${v.videoWidth} × ${v.videoHeight}` : "—"]);
  rows.push(["Subtitles", subs.length ? subs.map((s, i) => (i === activeSub ? "● " : "") + s.label).join(", ") : "None"]);
  rows.push(["Playback", `${speedLabel(S.speed)} speed · position ${fmt(v.currentTime)}`]);
  const fx = [];
  if (applyVideoFilter() !== "none") fx.push("colour adjusted");
  if (geo.aspect !== "auto" || geo.zoom !== 100 || geo.rotate % 360 || geo.flip) fx.push("geometry changed");
  if (settings.eq.on) fx.push(`EQ: ${EQ_PRESETS[settings.eq.preset]?.[0] || "Custom"}`);
  if (fx.length) rows.push(["Adjustments", fx.join(" · ")]);
  openModal("Media information", `<table class="info">${rows.map(([k, x]) => `<tr><td>${k}</td><td>${esc(x)}</td></tr>`).join("")}</table>`);
}
const sleep = { mode: null, end: 0, t: 0 };
function setSleep(min){
  clearInterval(sleep.t); sleep.mode = null;
  const b = $("sleepBadge"); b.classList.remove("on");
  if (min === null) return toast("Sleep timer off");
  if (min === "end") { sleep.mode = "end"; b.textContent = "☾ end of file"; b.classList.add("on"); return toast("Will pause at the end of this file"); }
  sleep.mode = "time"; sleep.end = Date.now() + min * 60000; b.classList.add("on");
  const tick = () => { const left = sleep.end - Date.now(); if (left <= 0) return sleepFire(); b.textContent = "☾ " + fmt(left / 1000); };
  tick(); sleep.t = setInterval(tick, 1000);
  toast(`Sleep timer: ${min} min`);
}
function sleepFire(){ clearInterval(sleep.t); sleep.mode = null; $("sleepBadge").classList.remove("on"); v.pause(); if (fullscreen) toggleFull(false); toast("Sleep timer — playback paused"); }

/* =====================================================================
   Adjustments panel (video colour/geometry, audio EQ) — live, non-blocking
   ===================================================================== */
const adjOpen = () => $("adjPanel").classList.contains("open");
let adjTab = "video";
function toggleAdj(tab){
  const p = $("adjPanel");
  if (adjOpen() && (!tab || tab === adjTab)) { p.classList.remove("open"); overPanel = false; updateToggles(); return; }
  if (tab) adjTab = tab;
  $("ccPop").classList.remove("open"); closeMenus();
  p.classList.add("open"); renderAdj(); updateToggles(); wake();
}
$("adjClose").onclick = () => toggleAdj();
$("adjTabs").onclick = e => { const b = e.target.closest("button"); if (b) { adjTab = b.dataset.t; renderAdj(); } };
function slider(key, label, min, max, stepv, unit, val){
  return `<label class="sl"><span>${label}</span><input class="rng" type="range" data-k="${key}" min="${min}" max="${max}" step="${stepv}" value="${val}"><output>${val}${unit}</output></label>`;
}
function renderAdj(){
  $("adjTabs").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.t === adjTab));
  const body = $("adjBody"), f = settings.video, e = settings.eq;
  if (adjTab === "video") {
    const curPreset = Object.keys(VIDEO_PRESETS).find(k => Object.entries(VIDEO_PRESETS[k][1]).every(([kk, vv]) => f[kk] === vv));
    body.innerHTML = `
      <div class="sec">Look</div>
      <div class="chips">${Object.entries(VIDEO_PRESETS).map(([k, [l]]) => `<button data-vp="${k}" class="${k === curPreset ? "on" : ""}">${l}</button>`).join("")}</div>
      ${slider("video.brightness", "Brightness", 50, 160, 1, "%", f.brightness)}
      ${slider("video.contrast", "Contrast", 50, 160, 1, "%", f.contrast)}
      ${slider("video.saturation", "Saturation", 0, 200, 1, "%", f.saturation)}
      ${slider("video.hue", "Hue", -180, 180, 1, "°", f.hue)}
      ${slider("video.sepia", "Warmth", 0, 100, 1, "%", f.sepia)}
      <div class="sec">Picture</div>
      <div class="chips">${ASPECTS.map(([k, l]) => `<button data-asp="${k}" class="${geo.aspect === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${slider("geo.zoom", "Zoom", 100, settings.gestures.maxZoom, 5, "%", Math.round(geo.zoom))}
      <div class="row2"><button class="btn ghost sm" data-rot="-90">↺ Rotate</button><button class="btn ghost sm" data-rot="90">↻ Rotate</button>
        <button class="btn ghost sm" data-flip>${geo.flip ? "✓ " : ""}Mirror</button><span class="sp"></span><button class="btn ghost sm" data-vreset>Reset</button></div>
      <div class="note">Colour settings are remembered. Aspect, zoom, rotation and mirror reset for each new file. Pinch or Ctrl + wheel to zoom where you point; drag or two-finger scroll to move around.</div>`;
  } else {
    body.innerHTML = `
      <div class="set" style="border:0;padding-bottom:4px"><div class="d"><b>Equalizer</b></div><button class="sw ${e.on ? "on" : ""}" data-eqon role="switch" aria-label="Equalizer"></button></div>
      <select data-eqp style="width:100%;max-width:none">${Object.entries(EQ_PRESETS).map(([k, [l]]) => `<option value="${k}" ${e.preset === k ? "selected" : ""}>${l}</option>`).join("")}<option value="custom" ${e.preset === "custom" ? "selected" : ""}>Custom</option></select>
      <div class="eq" style="${e.on ? "" : "opacity:.45"}">${EQ_FREQS.map((fq, i) => `<label><output>${e.gains[i] > 0 ? "+" : ""}${e.gains[i]}</output><input class="rng" type="range" data-band="${i}" min="-12" max="12" step="1" value="${e.gains[i]}" aria-label="${fq} Hz">${fq >= 1000 ? fq / 1000 + "k" : fq}</label>`).join("")}</div>
      <div class="sec">Sound</div>
      ${slider("eq.boost", "Volume boost", 100, 250, 5, "%", e.boost)}
      ${slider("eq.balance", "Balance", -100, 100, 5, "", e.balance)}
      <div class="set" style="border:0"><div class="d"><b>Mono</b><small>Mix both channels — handy with one earbud</small></div><button class="sw ${e.mono ? "on" : ""}" data-mono role="switch" aria-label="Mono"></button></div>
      <div class="set" style="border:0"><div class="d"><b>Normalize volume</b><small>Evens out quiet dialogue and loud scenes</small></div><button class="sw ${e.normalize ? "on" : ""}" data-norm role="switch" aria-label="Normalize volume"></button></div>
      <div class="row2"><span class="sp"></span><button class="btn ghost sm" data-areset>Reset audio</button></div>`;
  }
  body.querySelectorAll("input[type=range]").forEach(r => r.oninput = () => {
    const val = +r.value; const out = r.nextElementSibling || r.previousElementSibling;
    if (r.dataset.band !== undefined) {
      e.gains[+r.dataset.band] = val; e.preset = "custom"; if (!e.on) e.on = true;
      r.previousElementSibling.textContent = (val > 0 ? "+" : "") + val;
      body.querySelector("[data-eqp]").value = "custom"; body.querySelector(".eq").style.opacity = ""; body.querySelector("[data-eqon]").classList.add("on");
      applyAudio(); persist(); return;
    }
    const k = r.dataset.k;
    if (k.startsWith("geo.")) { zoomAt(val, null, null, true); return; }
    else { setPath(settings, k, val); applyVideoFilter(); applyAudio(); persist(); }
    if (out && out.tagName === "OUTPUT") out.textContent = val + (k.includes("hue") ? "°" : k.includes("balance") ? "" : "%");
    if (k === "eq.balance") out.textContent = val === 0 ? "C" : val < 0 ? "L" + -val : "R" + val;
    if (k.startsWith("video.")) body.querySelectorAll("[data-vp]").forEach(b => b.classList.remove("on"));
  });
  body.querySelectorAll("[data-vp]").forEach(b => b.onclick = () => { Object.assign(settings.video, VIDEO_PRESETS[b.dataset.vp][1]); applyVideoFilter(); persist(); renderAdj(); });
  body.querySelectorAll("[data-asp]").forEach(b => b.onclick = () => setGeo("aspect", b.dataset.asp));
  body.querySelectorAll("[data-rot]").forEach(b => b.onclick = () => setGeo("rotate", geo.rotate + +b.dataset.rot));
  const q = s => body.querySelector(s);
  if (q("[data-flip]")) q("[data-flip]").onclick = () => setGeo("flip", !geo.flip);
  if (q("[data-vreset]")) q("[data-vreset]").onclick = () => { settings.video = clone(DEFAULTS.video); geo = freshGeo(); applyVideoFilter(); layout(); persist(); renderAdj(); toast("Picture reset"); };
  if (q("[data-eqon]")) q("[data-eqon]").onclick = () => { e.on = !e.on; applyAudio(); persist(); renderAdj(); toast(e.on ? "Equalizer on" : "Equalizer off"); };
  if (q("[data-eqp]")) q("[data-eqp]").onchange = ev => { const k = ev.target.value; e.preset = k; if (EQ_PRESETS[k]) e.gains = [...EQ_PRESETS[k][1]]; e.on = true; applyAudio(); persist(); renderAdj(); };
  if (q("[data-mono]")) q("[data-mono]").onclick = () => { e.mono = !e.mono; applyAudio(); persist(); renderAdj(); };
  if (q("[data-norm]")) q("[data-norm]").onclick = () => toggleNormalize();
  if (q("[data-areset]")) q("[data-areset]").onclick = () => { settings.eq = clone(DEFAULTS.eq); applyAudio(); persist(); renderAdj(); toast("Audio reset"); };
  const bal = body.querySelector('[data-k="eq.balance"]'); if (bal) { const o = bal.nextElementSibling, x = +bal.value; o.textContent = x === 0 ? "C" : x < 0 ? "L" + -x : "R" + x; }
}

/* =====================================================================
   Actions & remappable keyboard shortcuts
   ===================================================================== */
const ACTIONS = [
  ["Playback", "toggle", "Play / pause", ["Space", "K"], toggle],
  ["Playback", "back", "Seek back (step)", ["ArrowLeft"], () => seekBy(-settings.seekStep)],
  ["Playback", "fwd", "Seek forward (step)", ["ArrowRight"], () => seekBy(settings.seekStep)],
  ["Playback", "backBig", "Seek back 30 s", ["Shift+ArrowLeft"], () => seekBy(-30)],
  ["Playback", "fwdBig", "Seek forward 30 s", ["Shift+ArrowRight"], () => seekBy(30)],
  ["Playback", "skipBack", "Skip back (button)", ["J"], () => seekBy(-settings.skipStep)],
  ["Playback", "skipFwd", "Skip forward (button)", ["L"], () => seekBy(settings.skipStep)],
  ["Playback", "prev", "Previous", ["P"], prev],
  ["Playback", "next", "Next", ["N"], () => step(1)],
  ["Playback", "slower", "Slower", ["["], () => speedStep(-1)],
  ["Playback", "faster", "Faster", ["]"], () => speedStep(1)],
  ["Playback", "speedReset", "Normal speed", ["\\", "Backspace"], () => setSpeed(1)],
  ["Playback", "frameBack", "Previous frame", [","], () => { if (v.paused && idx >= 0) v.currentTime -= 1/30; }],
  ["Playback", "frameFwd", "Next frame", ["."], () => { if (v.paused && idx >= 0) v.currentTime += 1/30; }],
  ["Playback", "start", "Go to start", ["Home"], () => { if (idx >= 0) v.currentTime = 0; }],
  ["Playback", "shuffle", "Shuffle", ["S"], () => setShuffle(!S.shuffle)],
  ["Playback", "repeat", "Repeat", ["R"], () => $("bRepeat").click()],
  ["Playback", "ab", "A–B loop", ["B"], abStep],
  ["Sound", "volUp", "Volume up", ["ArrowUp"], () => setVol(saved.volume + .05, true)],
  ["Sound", "volDown", "Volume down", ["ArrowDown"], () => setVol(saved.volume - .05, true)],
  ["Sound", "mute", "Mute", ["M"], () => { setMute(!saved.muted); toast(saved.muted ? "Muted" : "Unmuted"); }],
  ["Sound", "eq", "Equalizer on / off", ["E"], () => { settings.eq.on = !settings.eq.on; applyAudio(); persist(); toast(settings.eq.on ? "Equalizer on" : "Equalizer off"); if (adjOpen()) renderAdj(); }],
  ["View", "full", "Fullscreen", ["F", "Enter"], () => toggleFull()],
  ["View", "playlist", "Playlist", ["Q"], () => $("bList").click()],
  ["View", "onTop", "Always on top", ["T"], () => setOnTop(!S.onTop)],
  ["View", "adjust", "Adjustments panel", ["Ctrl+E"], () => toggleAdj()],
  ["View", "ambient", "Ambient light", ["A"], () => { settings.ambient = !settings.ambient; applyAppearance(); persist(); toast(settings.ambient ? "Ambient light on" : "Ambient light off"); }],
  ["View", "aspect", "Cycle aspect ratio", ["Shift+A"], () => { const i = ASPECTS.findIndex(a => a[0] === geo.aspect); setGeo("aspect", ASPECTS[(i + 1) % ASPECTS.length][0]); }],
  ["View", "zoomIn", "Zoom in", ["Shift+=", "Ctrl+="], () => zoomAt(geo.zoom * 1.2)],
  ["View", "zoomOut", "Zoom out", ["-", "Ctrl+-"], () => zoomAt(geo.zoom / 1.2)],
  ["View", "zoomReset", "Reset zoom", ["Z", "Ctrl+0"], () => zoomAt(100)],
  ["View", "panLeft", "Move zoomed picture left", ["Ctrl+ArrowLeft"], () => panBy(80, 0)],
  ["View", "panRight", "Move zoomed picture right", ["Ctrl+ArrowRight"], () => panBy(-80, 0)],
  ["View", "panUp", "Move zoomed picture up", ["Ctrl+ArrowUp"], () => panBy(0, 80)],
  ["View", "panDown", "Move zoomed picture down", ["Ctrl+ArrowDown"], () => panBy(0, -80)],
  ["View", "fitWindow", "Fit window to video", ["Shift+F"], fitWindow],
  ["View", "glow", "Cycle neon glow", ["Shift+G"], () => { const o = ["off", "soft", "neon"]; settings.glow = o[(o.indexOf(settings.glow) + 1) % 3]; applyAll(); persist(); toast(`Glow: ${settings.glow}`); }],
  ["View", "rotate", "Rotate 90°", ["Shift+R"], () => setGeo("rotate", geo.rotate + 90)],
  ["View", "theme", "Next theme", ["Shift+T"], () => { const k = Object.keys(THEMES); settings.theme = k[(k.indexOf(settings.theme) + 1) % k.length]; applyAppearance(); persist(); toast(`Theme: ${THEMES[settings.theme][0]}`); }],
  ["Subtitles", "cycleSub", "Cycle subtitles", ["C"], cycleSub],
  ["Subtitles", "subEarlier", "Subtitles earlier", ["G"], () => shiftSubs(-.1)],
  ["Subtitles", "subLater", "Subtitles later", ["H"], () => shiftSubs(.1)],
  ["Subtitles", "subBigger", "Subtitles bigger", ["Shift+]"], () => { settings.sub.size = clamp(settings.sub.size + 10, 60, 220); placeSubs(); persist(); toast(`Subtitle size ${settings.sub.size}%`); }],
  ["Subtitles", "subSmaller", "Subtitles smaller", ["Shift+["], () => { settings.sub.size = clamp(settings.sub.size - 10, 60, 220); placeSubs(); persist(); toast(`Subtitle size ${settings.sub.size}%`); }],
  ["Subtitles", "subUp", "Move subtitles up", ["Shift+ArrowUp"], () => { settings.sub.margin = clamp(settings.sub.margin + 1, 0, 40); placeSubs(); persist(); toast(`Subtitle margin ${settings.sub.margin}%`); }],
  ["Subtitles", "subDown", "Move subtitles down", ["Shift+ArrowDown"], () => { settings.sub.margin = clamp(settings.sub.margin - 1, 0, 40); placeSubs(); persist(); toast(`Subtitle margin ${settings.sub.margin}%`); }],
  ["Tools", "snapshot", "Snapshot", ["Shift+S"], snapshot],
  ["Tools", "thumbs", "Save thumbnails", ["Ctrl+T"], () => thumbsModal()],
  ["Tools", "stats", "Statistics", ["Ctrl+J"], () => toggleStats()],
  ["Tools", "ctxMenu", "Quick menu", ["ContextMenu", "Shift+F10"], () => { const r = stage.getBoundingClientRect(); openCtx(r.left + r.width / 2 - 120, r.top + 80); }],
  ["Navigate", "nextSmart", "Next chapter / file", ["PageDown"], () => navNext()],
  ["Navigate", "prevSmart", "Previous chapter / file", ["PageUp"], () => navPrev()],
  ["Navigate", "nextFolder", "Next file in folder", ["Ctrl+PageDown"], () => playNeighbor(1)],
  ["Navigate", "prevFolder", "Previous file in folder", ["Ctrl+PageUp"], () => playNeighbor(-1)],
  ["Navigate", "goTo", "Go to…", ["Ctrl+G"], () => goToModal()],
  ["Sound", "audioCycle", "Next audio track", ["Ctrl+A"], () => cycleAudio()],
  ["Sound", "normalize", "Normalize volume", [], () => toggleNormalize()],
  ["View", "size50", "Video size 50 %", ["Alt+1"], () => videoSize(.5)],
  ["View", "size100", "Video size 100 %", ["Alt+2"], () => videoSize(1)],
  ["View", "size200", "Video size 200 %", ["Alt+3"], () => videoSize(2)],
  ["View", "minimal", "Minimal view (hide menu bar)", ["Ctrl+1"], () => { settings.minimalView = !settings.minimalView; applyAppearance(); persist(); toast(settings.minimalView ? "Minimal view — right-click or Alt for menus" : "Menu bar shown"); }],
  ["File", "favAdd", "Add to favorites", ["Ctrl+D"], () => addFavorite()],
  ["File", "savePlaylist", "Save playlist", ["Ctrl+S"], () => savePlaylist()],
  ["Tools", "info", "Media information", ["Ctrl+I"], mediaInfo],
  ["Tools", "settings", "Settings", ["Ctrl+,"], () => settingsModal()],
  ["Tools", "shortcuts", "Shortcut list", ["F1", "?"], shortcutsModal],
  ["File", "open", "Open file", ["Ctrl+O"], openFiles],
  ["File", "openFolder", "Open folder", ["Ctrl+Shift+O"], openFolder],
  ["File", "loadSubs", "Load subtitles", ["Ctrl+L"], loadSubsDialog],
  ["File", "close", "Close", ["Ctrl+W"], () => list.length && clearAll()],
  ["File", "quit", "Exit", ["Ctrl+Q"], () => host.quit()],
].map(([group, id, label, keys, fn]) => ({ group, id, label, keys, fn }));
const ACT = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
const bindingsOf = id => settings.keys[id] ?? ACT[id].keys;
let keyMap = {};
function rebuildKeys(){ keyMap = {}; for (const a of ACTIONS) for (const k of bindingsOf(a.id)) if (!keyMap[k]) keyMap[k] = a.id; updateTitles(); }
function comboOf(e){
  let k = e.key;
  if (["Control","Shift","Alt","Meta"].includes(k)) return null;
  if (k === " ") k = "Space";
  if (k.length === 1) k = k.toUpperCase();
  const shiftMatters = k.length > 1 || /[A-Z]/.test(k);
  let named = k;
  if (!shiftMatters && e.shiftKey && e.code) {            // e.g. Shift+= arrives as "+": keep the physical key name
    const m = { Equal: "=", Minus: "-", BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`" }[e.code];
    if (m && m !== "/") return [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", "Shift", m].filter(Boolean).join("+");
  }
  return [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey && shiftMatters ? "Shift" : "", named].filter(Boolean).join("+");
}
const PRETTY = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "Space", Backspace: "⌫", Enter: "Enter" };
const prettyKey = k => k.split("+").map(p => PRETTY[p] || p).join("+");
const keyLabel = id => { const b = bindingsOf(id); return b.length ? prettyKey(b[0]) : ""; };
function updateTitles(){
  const t = (id, label, act) => { const k = keyLabel(act); $(id).title = k ? `${label} (${k})` : label; };
  t("bPlay", "Play / pause", "toggle"); t("bPrev", "Previous", "prev"); t("bNext", "Next", "next");
  t("bBack", `Back ${settings.skipStep}s`, "skipBack"); t("bFwd", `Forward ${settings.skipStep}s`, "skipFwd");
  t("bMute", "Mute", "mute"); t("bShuffle", "Shuffle", "shuffle"); t("bRepeat", "Repeat", "repeat");
  t("bCC", "Subtitles", "cycleSub"); t("bFull", "Fullscreen", "full"); t("bPin", "Keep on top", "onTop");
  t("bList", "Playlist", "playlist"); t("bAdjust", "Video & audio adjustments", "adjust");
  $("emptyKeys").innerHTML = [["toggle","Play/pause"],["full","Fullscreen"],["open","Open"],["settings","Settings"],["adjust","Adjust"],["shortcuts","All shortcuts"]]
    .map(([id, l]) => `<span>${keyLabel(id).split("+").map(p => `<kbd>${esc(p)}</kbd>`).join("")}${l}</span>`).join("");
}

/* =====================================================================
   Modals
   ===================================================================== */
const modalOpen = () => $("scrim").classList.contains("open");
let modalOnClose = null, recording = null;
function openModal(title, html, foot, opts = {}){
  closeMenus(); $("ccPop").classList.remove("open");
  $("modal").classList.toggle("wide", !!opts.wide);
  $("mTitle").textContent = title; $("mBody").innerHTML = html;
  $("mFoot").innerHTML = foot || '<button class="btn" data-close>Done</button>';
  $("scrim").classList.add("open"); modalOnClose = opts.onClose || null;
  placeModal();
  $("mFoot").querySelectorAll("[data-close]").forEach(b => b.onclick = closeModal);
  setTimeout(() => ($("mFoot").querySelector(".btn:last-child") || $("mClose")).focus(), 0);
}
function closeModal(){ recording = null; $("scrim").classList.remove("open"); modalOnClose && modalOnClose(); modalOnClose = null; wake(); }
$("mClose").onclick = closeModal;
$("scrim").addEventListener("pointerdown", e => { if (e.target === $("scrim")) closeModal(); });

/* ---- settings ---- */
const TABS = [
  ["general", "General", "gear"], ["appearance", "Appearance", "palette"], ["subtitles", "Subtitles", "text"],
  ["controls", "Controls & mouse", "mouse"], ["shortcuts", "Keyboard shortcuts", "keyboard"], ["backup", "Backup & reset", "box"],
];
const SETTINGS_UI = {
  general: [
    ["Session"],
    ["rememberVolume", "toggle", "Remember volume", "Keep the volume level between sessions"],
    ["resume", "toggle", "Resume where I left off", "Reopening the same long video continues from the last position. Lumen always starts with an empty playlist."],
    ["autoNext", "toggle", "Play next item automatically", "Continue through the playlist when a file ends"],
    ["Playback"],
    ["defaultSpeed", "seg", "Starting speed", "Speed used when Lumen opens", [[0.75,"0.75×"],[1,"1×"],[1.25,"1.25×"],[1.5,"1.5×"],[2,"2×"]]],
    ["preservePitch", "toggle", "Keep voice pitch at other speeds", "Off gives the classic chipmunk / slow-motion sound"],
    ["seekStep", "seg", "Arrow-key seek step", "How far ← and → jump", [[3,"3 s"],[5,"5 s"],[10,"10 s"],[30,"30 s"]]],
    ["skipStep", "seg", "Skip buttons", "Jump size of the ⟲ ⟳ buttons and J / L", [[5,"5 s"],[10,"10 s"],[15,"15 s"],[30,"30 s"]]],
    ["speedStepMode", "seg", "Speed step", "How [ and ] change the speed", [["preset","Presets"],[.05,"±0.05"],[.1,"±0.1"],[.25,"±0.25"]]],
    ["afterPlayback", "select", "After playback", "What happens when the playlist ends (Playback → After playback can override it once)", [["nothing","Do nothing"],["nextInFolder","Play the next file in the folder"],["close","Close the file"],["exit","Exit Lumen"]]],
    ["History"],
    ["keepRecent", "toggle", "Keep a list of recent files", "Off keeps Lumen history-free. Lumen still never reopens a file by itself."],
    ["Window"],
    ["lockAspect", "toggle", "Keep the video's shape when resizing", "Dragging the window edges keeps the picture free of black bars"],
    ["fitOnOpen", "toggle", "Fit the window to each video", "Resize the window to the video's shape when a file opens"],
    ["singleInstance", "toggle", "Open files in the existing window", "Much faster: double-clicking another file reuses the open Lumen window"],
    ["explorerOpen", "seg", "Files opened from Explorer", "", [["play","Play now"],["queue","Add to playlist"]]],
  ],
  appearance: [
    ["Theme"], ["@themes"],
    ["Accent colour"], ["@accent"],
    ["glow", "seg", "Neon glow", "Light-up effect around buttons, sliders, panels and the seek bar", [["off","Off"],["soft","Soft"],["neon","Neon"]]],
    ["uiFont", "select", "Interface font", "", Object.entries(UI_FONTS).map(([k, [l]]) => [k, l])],
    ["Start screen"],
    ["landingStyle", "seg", "Style", "Simple is the lightest", [["simple","Simple"],["neon","Neon sign"],["orb","Light orb"]]],
    ["neonColors", "seg", "Neon colours", "For the neon sign", [["accent","Accent"],["synthwave","Synthwave"],["rainbow","Colour cycle"]]],
    ["landingFx", "seg", "Animation", "Self-drawing tubes, flicker, moving grid, light beams and sparks", [["full","Full"],["calm","Calm"],["off","Still"]]],
    ["gpuFx", "toggle", "GPU effects", "Real bloom, a wet reflective floor, thousands of spark trails and light that follows your cursor (Full animation, neon sign)"],
    ["fxQuality", "seg", "Effects quality", "Auto lowers detail if your graphics can't keep up", [["auto","Auto"],["high","High"],["balanced","Balanced"],["low","Low"]]],
    ["Video"],
    ["ambient", "toggle", "Ambient light", "A soft glow of the picture's colours fills the black bars around the video"],
    ["ambientStrength", "range", "Glow strength", "", { min: 20, max: 100, step: 5, unit: "%" }],
    ["showTitle", "toggle", "Show title over video", "File name in the top-left while controls are visible"],
    ["minimalView", "toggle", "Minimal view", "Hide the menu bar — menus stay on right-click and Alt (Ctrl+1)"],
    ["seekPreview", "toggle", "Seek bar previews", "Show a thumbnail of the frame when hovering the seek bar"],
    ["Music"],
    ["vizStyle", "seg", "Visualizer", "Shown while playing audio files", [["bars","Bars"],["wave","Wave"],["radial","Halo"],["none","Off"]]],
  ],
  subtitles: [
    ["@subpreview"],
    ["Text"],
    ["sub.font", "select", "Font", "", Object.entries(FONTS).map(([k, [l]]) => [k, l])],
    ["sub.size", "range", "Size", "Scales with the video, so it stays readable in fullscreen", { min: 60, max: 220, step: 5, unit: "%" }],
    ["sub.bold", "toggle", "Bold", ""],
    ["sub.color", "colors", "Text colour", "", ["#ffffff", "#ffe066", "#a8f0ff", "#b8ffb0", "#ffc2e0"]],
    ["Readability"],
    ["sub.outline", "range", "Outline", "Edge around the letters", { min: 0, max: 5, step: .5, unit: "" }],
    ["sub.outlineColor", "colors", "Outline colour", "", ["#000000", "#1a1a2e", "#3b2a00", "#ffffff"]],
    ["sub.shadow", "toggle", "Drop shadow", ""],
    ["sub.bg", "range", "Background box", "Opacity of a box behind the text (0 = no box)", { min: 0, max: 100, step: 5, unit: "%" }],
    ["sub.bgColor", "colors", "Box colour", "", ["#000000", "#1e2433", "#2b1a3a", "#ffffff"]],
    ["Position"],
    ["sub.position", "seg", "Placement", "", [["bottom","Bottom"],["top","Top"]]],
    ["sub.margin", "range", "Distance from edge", "Gap between the subtitles and the edge of the picture", { min: 0, max: 30, step: 1, unit: "%" }],
    ["sub.lift", "toggle", "Move up when controls show", "Keeps subtitles clear of the control bar"],
    ["Tracks"],
    ["subsAuto", "toggle", "Turn on subtitles automatically", "Show embedded or matching subtitle files when a video opens"],
    ["subLang", "select", "Preferred language", "Used when a video has several subtitle tracks", SUB_LANGS],
  ],
  controls: [
    ["Control bar"],
    ["ctrl.size", "seg", "Size", "", [["compact","Compact"],["normal","Normal"],["large","Large"]]],
    ["ctrl.seekStyle", "seg", "Seek bar", "", [["thin","Thin"],["thick","Thick"]]],
    ["ctrl.timeMode", "seg", "Time display", "Click the time to switch too", [["total","Total"],["remaining","Remaining"]]],
    ["hideDelay", "seg", "Hide controls after", "Controls also hide in fullscreen, even when paused", [[1.5,"1.5 s"],[2.5,"2.5 s"],[4,"4 s"],[8,"8 s"]]],
    ["Buttons to show"],
    ["@buttons"],
    ["Touch & touchpad"],
    ["gestures.pinch", "toggle", "Pinch to zoom", "Touchpad or touchscreen pinch — or Ctrl + mouse wheel — zooms where you point"],
    ["gestures.pan", "toggle", "Move the zoomed picture", "Two-finger scroll on a touchpad, or drag with a finger or the mouse"],
    ["gestures.swipeSeek", "toggle", "Two-finger swipe to seek", "Swipe left / right on the touchpad when not zoomed"],
    ["gestures.maxZoom", "seg", "Maximum zoom", "", [[200,"200%"],[300,"300%"],[400,"400%"],[600,"600%"]]],
    ["Mouse"],
    ["mouse.click", "seg", "Click on video", "", [["toggle","Play / pause"],["none","Nothing"]]],
    ["mouse.dbl", "seg", "Double-click", "Seek by side: left / right third skips back / forward, middle goes fullscreen", [["fullscreen","Fullscreen"],["sides","Seek by side"],["toggle","Play / pause"],["none","Nothing"]]],
    ["mouse.wheel", "seg", "Mouse wheel", "", [["volume","Volume"],["seek","Seek"],["none","Nothing"]]],
  ],
};
const BUTTONS = [["prevnext","Previous / next"],["skip","Skip back / forward"],["volume","Volume"],["time","Time"],["shuffle","Shuffle"],["repeat","Repeat"],["cc","Subtitles"],["speed","Speed"],["pin","Keep on top"],["adjust","Adjustments"]];
let settingsTab = "general";
function settingsModal(tab){
  if (tab) settingsTab = tab;
  openModal("Settings", `<nav class="stabs">${TABS.map(([k, l, ic]) => `<button data-tab="${k}"><svg><use href="#i-${ic}"/></svg>${l}</button>`).join("")}</nav><div class="spane scroll" id="spane"></div>`,
    '<button class="btn ghost" id="openAdj">Video &amp; audio adjustments…</button><span class="sp"></span><button class="btn" data-close>Done</button>', { wide: true });
  $("mBody").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { settingsTab = b.dataset.tab; renderSettings(); });
  $("openAdj").onclick = () => { closeModal(); toggleAdj("video"); };
  renderSettings();
}
function renderSettings(){
  $("mBody").querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === settingsTab));
  const pane = $("spane"); pane.scrollTop = 0;
  if (settingsTab === "shortcuts") return renderShortcuts(pane);
  if (settingsTab === "backup") return renderBackup(pane);
  pane.innerHTML = SETTINGS_UI[settingsTab].map(settingRow).join("");
  wireSettings(pane);
  if (settingsTab === "subtitles") renderSubPreview();
}
function settingRow([key, type, label, hint, opts]){
  if (key === "@themes") return `<div class="themes">${Object.entries(THEMES).map(([k, [l, bg, pn, tx]]) => `<button data-theme="${k}" class="${settings.theme === k ? "on" : ""}"><div class="sw4" style="background:${bg}"><i style="top:10px;background:${pn};width:60%"></i><i style="top:24px;background:${pn}"></i><i style="top:38px;background:var(--accent);width:35%"></i></div>${l}</button>`).join("")}</div>`;
  if (key === "@accent") return `<div class="set"><div class="d"><b>Highlight colour</b><small>Buttons, progress bar, glow and visualizer</small></div><div class="ctl sws">${Object.entries(ACCENTS).map(([k, [l, a, b]]) => `<button data-accent="${k}" title="${l}" class="${settings.accent === k ? "on" : ""}" style="background:linear-gradient(145deg,${a},${b})"></button>`).join("")}<input type="color" id="accCustom" value="${settings.accentCustom}" title="Custom colour" class="${settings.accent === "custom" ? "on" : ""}"></div></div>`;
  if (key === "@buttons") return BUTTONS.map(([k, l]) => `<div class="set"><div class="d"><b>${l}</b></div><button class="sw ${settings.ctrl[k] ? "on" : ""}" role="switch" data-k="ctrl.${k}" aria-label="${l}"></button></div>`).join("");
  if (key === "@subpreview") return `<div class="subprev" id="subPrev"><span class="lbl">Preview</span><div class="sublayer" id="prevLayer"><div class="cue"><span>The quick brown fox jumps\nover the lazy dog.</span></div></div></div>`;
  if (!type) return `<div class="sec">${key}</div>`;
  const val = getPath(settings, key);
  let ctl = "";
  if (type === "toggle") ctl = `<button class="sw ${val ? "on" : ""}" role="switch" aria-checked="${!!val}" data-k="${key}" aria-label="${esc(label)}"></button>`;
  if (type === "seg") ctl = `<div class="seg">${opts.map(([v2, l]) => `<button data-k="${key}" data-v="${v2}" class="${String(val) === String(v2) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  if (type === "select") ctl = `<select data-k="${key}">${opts.map(([v2, l]) => `<option value="${v2}" ${val === v2 ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  if (type === "range") ctl = `<input class="rng" type="range" data-k="${key}" min="${opts.min}" max="${opts.max}" step="${opts.step}" value="${val}"><output>${val}${opts.unit}</output>`;
  if (type === "colors") ctl = `<div class="sws">${opts.map(c => `<button data-k="${key}" data-v="${c}" title="${c}" class="${val === c ? "on" : ""}" style="background:${c}"></button>`).join("")}<input type="color" data-k="${key}" value="${val}" title="Custom colour"></div>`;
  return `<div class="set"><div class="d"><b>${label}</b>${hint ? `<small>${hint}</small>` : ""}</div><div class="ctl">${ctl}</div></div>`;
}
function changeSetting(k, val){
  setPath(settings, k, val); persist();
  if (k === "subsAuto" || k === "subLang") { userPickedSub = false; autoPick(); }
  if (k === "resume" && !val) saved.positions = {};
  if (k === "keepRecent" && !val) saved.recent = [];
  if (k === "defaultSpeed") setSpeed(val, true);
  if (k === "gestures.maxZoom" && geo.zoom > val) zoomAt(val, null, null, true);
  if (k === "lockAspect") { lastAsp = ""; aspectLock(); }
  applyAll();
  if (settingsTab === "subtitles") renderSubPreview();
}
function wireSettings(pane){
  pane.querySelectorAll(".sw[data-k]").forEach(b => b.onclick = () => { const on = !b.classList.contains("on"); b.classList.toggle("on", on); b.setAttribute("aria-checked", on); changeSetting(b.dataset.k, on); });
  pane.querySelectorAll(".seg button, .sws button[data-k]").forEach(b => b.onclick = () => {
    b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    const raw = b.dataset.v; changeSetting(b.dataset.k, raw.startsWith("#") || isNaN(+raw) ? raw : +raw);
  });
  pane.querySelectorAll("select[data-k]").forEach(s => s.onchange = () => changeSetting(s.dataset.k, s.value));
  pane.querySelectorAll("input.rng[data-k]").forEach(r => r.oninput = () => {
    const def = Object.values(SETTINGS_UI).flat().find(x => x[0] === r.dataset.k);
    r.nextElementSibling.textContent = r.value + (def?.[4]?.unit ?? ""); changeSetting(r.dataset.k, +r.value);
  });
  pane.querySelectorAll("input[type=color][data-k]").forEach(c => c.oninput = () => { c.parentElement.querySelectorAll("button").forEach(x => x.classList.remove("on")); changeSetting(c.dataset.k, c.value); });
  pane.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => { settings.theme = b.dataset.theme; applyAppearance(); persist(); renderSettings(); });
  pane.querySelectorAll("[data-accent]").forEach(b => b.onclick = () => { settings.accent = b.dataset.accent; applyAll(); persist(); renderSettings(); });
  const cc = pane.querySelector("#accCustom");
  if (cc) cc.oninput = () => { settings.accent = "custom"; settings.accentCustom = cc.value; applyAll(); persist(); pane.querySelectorAll("[data-accent]").forEach(x => x.classList.remove("on")); };
}
function renderSubPreview(){
  const box = $("subPrev"), layer = $("prevLayer"); if (!box) return;
  const h = box.clientHeight, px = subFontPx(h * 3.2) * .55;   // preview of a ~550px-tall picture, scaled down
  styleCues(layer, px);
  const margin = settings.sub.margin / 100 * h;
  if (settings.sub.position === "top") { layer.style.top = Math.max(margin, 4) + "px"; layer.style.bottom = "auto"; }
  else { layer.style.bottom = Math.max(margin, 4) + "px"; layer.style.top = "auto"; }
  layer.style.left = "0"; layer.style.width = "100%";
}
function renderShortcuts(pane){
  let html = `<div class="note" style="margin-top:14px">Click a key to change it, then press the new key or combination. <b>Esc</b> cancels, <b>Delete</b> removes it. Alt+letter menu keys, 0–9 jumps and Esc are fixed.</div><table class="keys-t">`;
  let g = "";
  for (const a of ACTIONS) {
    if (a.group !== g) { g = a.group; html += `<tr class="grp"><td colspan="2">${g}</td></tr>`; }
    const b = bindingsOf(a.id);
    html += `<tr><td>${a.label}</td><td>${b.map((k, i) => `<button class="kc" data-act="${a.id}" data-i="${i}">${esc(prettyKey(k))}</button>`).join("")}<button class="kc ${b.length ? "" : "none"}" data-act="${a.id}" data-i="${b.length}" title="Add a key">${b.length ? "+" : "none"}</button></td></tr>`;
  }
  pane.innerHTML = html + `</table><div class="row2"><span class="sp"></span><button class="btn ghost sm" id="kReset">Reset all shortcuts</button></div>`;
  pane.querySelectorAll(".kc").forEach(b => b.onclick = () => { pane.querySelectorAll(".kc.rec").forEach(x => { x.classList.remove("rec"); x.textContent = x.dataset.old; }); b.dataset.old = b.textContent; b.textContent = "Press a key…"; b.classList.add("rec"); recording = { id: b.dataset.act, i: +b.dataset.i }; });
  $("kReset").onclick = () => { settings.keys = {}; rebuildKeys(); persist(); renderSettings(); toast("Shortcuts reset"); };
}
function recordKey(e){
  e.preventDefault(); e.stopPropagation();
  const { id, i } = recording;
  if (e.key === "Escape") { recording = null; return renderSettings(); }
  let list2 = [...bindingsOf(id)];
  if (e.key === "Delete") { list2.splice(i, 1); }
  else {
    const combo = comboOf(e); if (!combo) return;
    if (/^Alt\+/.test(combo) || /^\d$/.test(combo)) { toast("That key is reserved", true); return; }
    for (const a of ACTIONS) if (a.id !== id) {                       // steal it from any other action
      const b = bindingsOf(a.id); if (b.includes(combo)) { settings.keys[a.id] = b.filter(x => x !== combo); toast(`${prettyKey(combo)} moved from “${a.label}”`); }
    }
    list2[i] = combo; list2 = [...new Set(list2)];
  }
  settings.keys[id] = list2; recording = null; rebuildKeys(); persist(); renderSettings();
}
function renderBackup(pane){
  pane.innerHTML = `<div class="sec">Share your setup</div>
    <div class="set"><div class="d"><b>Export settings</b><small>Theme, colours, subtitle style, EQ, shortcuts and everything else — as a small .json file</small></div><button class="btn ghost sm" id="bExport">Export…</button></div>
    <div class="set"><div class="d"><b>Import settings</b><small>Load a file exported from Lumen (you can also drop it on the window)</small></div><button class="btn ghost sm" id="bImport">Import…</button></div>
    <div class="sec">Reset</div>
    <div class="set"><div class="d"><b>Reset all settings</b><small>Back to how Lumen looked the first time it opened</small></div><button class="btn ghost sm" id="bResetAll">Reset…</button></div>`;
  $("bExport").onclick = async () => {
    const r = await host.dialog("export:" + JSON.stringify({ app: "Lumen", version: VERSION, settings }, null, 2));
    if (r) toast(`Settings exported${typeof r === "string" ? `: ${r}` : ""}`);
  };
  $("bImport").onclick = async () => { const t = await host.dialog("import"); if (t) importSettingsText(t); };
  $("bResetAll").onclick = () => {
    const b = $("bResetAll");
    if (b.dataset.sure) { settings = clone(DEFAULTS); rebuildKeys(); setSpeed(1, true); applyAll(); persist(); renderSettings(); toast("All settings reset"); }
    else { b.dataset.sure = 1; b.textContent = "Click again to confirm"; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = "Reset…"; } }, 3000); }
  };
}
function importSettingsText(t){
  try {
    const j = JSON.parse(t);
    if (j.app !== "Lumen" || !isObj(j.settings)) throw 0;
    settings = merge(DEFAULTS, j.settings); rebuildKeys(); applyAll(); persist();
    if (modalOpen() && $("spane")) renderSettings();
    toast("Settings imported");
  } catch { toast("That file isn't a Lumen settings export", true); }
}
function shortcutsModal(){
  const rows = ACTIONS.filter(a => bindingsOf(a.id).length).map(a => `<div><span>${a.label}</span><kbd>${esc(bindingsOf(a.id).map(prettyKey).join(" · "))}</kbd></div>`).join("");
  openModal("Keyboard shortcuts", `<div class="kgrid">${rows}<div><span>Jump to 0–90 %</span><kbd>0 – 9</kbd></div><div><span>Menus</span><kbd>Alt + F/P/V/S/T/H</kbd></div><div><span>Zoom where you point</span><kbd>Pinch · Ctrl + wheel</kbd></div><div><span>Move zoomed picture</span><kbd>Drag · two-finger scroll</kbd></div></div>`,
    '<button class="btn ghost" id="kCustom">Customize…</button><span class="sp"></span><button class="btn" data-close>Done</button>');
  $("kCustom").onclick = () => settingsModal("shortcuts");
}
const aboutModal = () => openModal("About Lumen", `<div class="about"><div class="logo"><i><svg><use href="#i-play"/></svg></i>Lumen</div>
  <p>Version ${VERSION}</p><p>A lightweight, very customizable media player for Windows.</p>
  <p class="madeby">Made with <span class="heart" aria-label="love">♥</span> by <b>Shane Sahadeo</b></p>
  <p style="font-size:12.5px;color:var(--faint)">Publisher: Shane Sahadeo · © 2026</p>
  <p style="font-size:12.5px;color:var(--faint)">Built with Go and the open-source go-webview2 bindings (MIT),<br>playing media through Microsoft Edge WebView2.</p></div>`);

/* =====================================================================
   Menu bar
   ===================================================================== */
function menus(){
  const has = idx >= 0, vid = has && list[idx].kind === "video";
  const k = keyLabel;
  const abLabel = ab.a === null ? "Set loop start (A)" : ab.b === null ? "Set loop end (B)" : "Clear A–B loop";
  return [
    { id: "file", label: "File", key: "f", items: [
      { label: "Open file…", k: k("open"), act: openFiles },
      { label: "Open folder…", k: k("openFolder"), act: openFolder },
      { label: "Add to playlist…", act: addFiles },
      { label: "Load subtitle file…", k: k("loadSubs"), act: loadSubsDialog, off: !vid },
      { label: "Save playlist…", k: k("savePlaylist"), act: savePlaylist, off: !list.some(i => i.path) },
      "-",
      ...(settings.keepRecent ? [{ label: "Recent files", sub: recentItems() }] : []),
      { label: "Favorites", sub: favoriteItems() },
      "-",
      { label: "Close", k: k("close"), act: clearAll, off: !list.length },
      "-",
      { label: "Exit", k: k("quit"), act: () => host.quit() },
    ]},
    { id: "play", label: "Playback", key: "p", items: [
      { label: has && !v.paused ? "Pause" : "Play", k: k("toggle"), act: toggle, off: !list.length },
      { label: "Stop", act: () => { v.pause(); v.currentTime = 0; }, off: !has },
      "-",
      { label: "Previous", k: k("prev"), act: prev, off: !has },
      { label: "Next", k: k("next"), act: () => step(1), off: !has },
      { label: `Jump back ${settings.skipStep} s`, k: k("skipBack"), act: () => seekBy(-settings.skipStep), off: !has },
      { label: `Jump forward ${settings.skipStep} s`, k: k("skipFwd"), act: () => seekBy(settings.skipStep), off: !has },
      "-",
      { label: "Speed", sub: SPEEDS.map(x => ({ label: x === 1 ? "Normal" : speedLabel(x), radio: S.speed === x, act: () => setSpeed(x) })) },
      { label: "Shuffle", k: k("shuffle"), check: S.shuffle, act: () => setShuffle(!S.shuffle) },
      { label: "Repeat", sub: [["off","Off"],["all","Playlist"],["one","Current item"]].map(([r, l]) => ({ label: l, radio: S.repeat === r, act: () => setRepeat(r) })) },
      { label: abLabel, k: k("ab"), act: abStep, off: !has },
      "-",
      { label: "Audio track", sub: audioTrackItems(), off: !has },
      { label: "Normalize volume", check: settings.eq.normalize, act: toggleNormalize },
      "-",
      { label: "After playback", sub: afterItems() },
      { label: "Sleep timer", sub: [[null,"Off"],[15,"15 minutes"],[30,"30 minutes"],[45,"45 minutes"],[60,"1 hour"],[90,"1.5 hours"],["end","End of current file"]].map(([m, l]) => ({ label: l, radio: m === null ? !sleep.mode : sleep.mode === "end" ? m === "end" : false, act: () => setSleep(m) })) },
    ]},
    { id: "view", label: "View", key: "v", items: [
      { label: "Fullscreen", k: k("full"), act: () => toggleFull(), off: !has },
      { label: "Fit window to video", k: k("fitWindow"), act: fitWindow, off: !vid },
      { label: "Video size", sub: [[.5, "50 %", "size50"], [1, "100 %", "size100"], [2, "200 %", "size200"]].map(([z, l, a]) => ({ label: l, k: k(a), act: () => videoSize(z) })), off: !vid },
      { label: "Minimal view", k: k("minimal"), check: settings.minimalView, act: ACT.minimal.fn },
      { label: "Statistics", k: k("stats"), check: statsOn, act: () => toggleStats() },
      { label: "Keep window in video shape", check: settings.lockAspect, act: () => { settings.lockAspect = !settings.lockAspect; lastAsp = ""; aspectLock(); persist(); toast(settings.lockAspect ? "Window keeps the video's shape" : "Free window resizing"); } },
      { label: "Always on top", k: k("onTop"), check: S.onTop, act: () => setOnTop(!S.onTop) },
      { label: "Playlist", k: k("playlist"), check: S.listOpen, act: () => $("bList").click() },
      "-",
      { label: "Theme", sub: Object.entries(THEMES).map(([t, [l]]) => ({ label: l, radio: settings.theme === t, act: () => { settings.theme = t; applyAppearance(); persist(); } })) },
      { label: "Accent colour", sub: [...Object.entries(ACCENTS).map(([a, [l, c]]) => ({ label: l, swatch: c, radio: settings.accent === a, act: () => { settings.accent = a; applyAll(); persist(); } })), ...(settings.accent === "custom" ? [{ label: "Custom", swatch: settings.accentCustom, radio: true, act: () => {} }] : []), "-", { label: "More colours…", act: () => settingsModal("appearance") }] },
      { label: "Neon glow", sub: [["off","Off"],["soft","Soft"],["neon","Neon"]].map(([g2, l]) => ({ label: l, radio: settings.glow === g2, act: () => { settings.glow = g2; applyAll(); persist(); } })) },
      { label: "Ambient light", k: k("ambient"), check: settings.ambient, act: ACT.ambient.fn },
      { label: "Aspect ratio", sub: ASPECTS.map(([a, l]) => ({ label: l, radio: geo.aspect === a, act: () => setGeo("aspect", a) })), off: !vid },
      { label: "Zoom", sub: [{ label: "Zoom in", k: k("zoomIn"), act: () => zoomAt(geo.zoom * 1.2) }, { label: "Zoom out", k: k("zoomOut"), act: () => zoomAt(geo.zoom / 1.2), off: !zoomed() }, { label: "Reset zoom", k: k("zoomReset"), act: () => zoomAt(100), off: !zoomed() }], off: !vid },
      { label: "Rotate & mirror", sub: [{ label: "Rotate right", k: k("rotate"), act: () => setGeo("rotate", geo.rotate + 90) }, { label: "Rotate left", act: () => setGeo("rotate", geo.rotate - 90) }, { label: "Mirror", check: geo.flip, act: () => setGeo("flip", !geo.flip) }], off: !vid },
      { label: "Control bar", sub: [["compact","Compact"],["normal","Normal"],["large","Large"]].map(([c, l]) => ({ label: l, radio: settings.ctrl.size === c, act: () => { settings.ctrl.size = c; applyAll(); persist(); } })) },
      { label: "Visualizer", sub: [["bars","Bars"],["wave","Wave"],["radial","Halo"],["none","Off"]].map(([s2, l]) => ({ label: l, radio: settings.vizStyle === s2, act: () => { settings.vizStyle = s2; applyAppearance(); persist(); } })) },
    ]},
    { id: "nav", label: "Navigate", key: "n", items: navItems() },
    { id: "subs", label: "Subtitles", key: "s", items: [
      { label: "Off", radio: activeSub === -1, act: () => setSub(-1, "user"), off: !subs.length },
      ...subs.map((s, i) => ({ label: s.label, radio: activeSub === i, act: () => setSub(i, "user") })),
      ...(subs.length ? [] : [{ label: vid ? "No subtitles for this video" : "Open a video to see subtitles", off: true }]),
      "-",
      { label: "Load subtitle file…", k: k("loadSubs"), act: loadSubsDialog, off: !vid },
      { label: "Delay −0.1 s", k: k("subEarlier"), act: () => shiftSubs(-.1), off: !subs.length },
      { label: "Delay +0.1 s", k: k("subLater"), act: () => shiftSubs(.1), off: !subs.length },
      { label: `Reset delay${subDelay ? ` (${subDelay > 0 ? "+" : ""}${subDelay.toFixed(1)} s)` : ""}`, act: resetSubDelay, off: !subDelay },
      "-",
      { label: "Position", sub: [["bottom","Bottom"],["top","Top"]].map(([p, l]) => ({ label: l, radio: settings.sub.position === p, act: () => { settings.sub.position = p; placeSubs(); persist(); } })) },
      { label: "Subtitle style…", act: () => settingsModal("subtitles") },
    ]},
    { id: "tools", label: "Tools", key: "t", items: [
      { label: "Settings…", k: k("settings"), act: () => settingsModal() },
      { label: "Video & audio adjustments…", k: k("adjust"), act: () => toggleAdj() },
      { label: "Equalizer…", act: () => toggleAdj("audio") },
      { label: "Media information…", k: k("info"), act: mediaInfo },
      "-",
      { label: "Take snapshot", k: k("snapshot"), act: snapshot, off: !vid },
      { label: "Save thumbnails…", k: k("thumbs"), act: () => thumbsModal(), off: !vid },
      { label: "Open snapshots folder", act: () => host.snapDir() },
    ]},
    { id: "help", label: "Help", key: "h", items: [
      { label: "Keyboard shortcuts", k: k("shortcuts"), act: shortcutsModal },
      { label: "Customize shortcuts…", act: () => settingsModal("shortcuts") },
      { label: "About Lumen", act: aboutModal },
    ]},
  ];
}
const mbar = $("menubar"); let openMenu = null, ddStack = [];
const menuOpen = () => !!openMenu;
for (const m of menus()) {
  const b = document.createElement("button"); b.className = "mb"; b.dataset.id = m.id;
  b.innerHTML = `<u>${m.label[0]}</u>${m.label.slice(1)}`;
  b.onpointerdown = e => { e.preventDefault(); openMenu === m.id ? closeMenus() : showMenu(m.id); };
  b.onpointerenter = () => { if (openMenu && openMenu !== m.id) showMenu(m.id); };
  mbar.insertBefore(b, $("sleepBadge"));
}
function showMenu(id, highlightFirst){
  closeMenus(); $("ccPop").classList.remove("open");
  const m = menus().find(x => x.id === id); const btn = mbar.querySelector(`[data-id="${id}"]`);
  openMenu = id; btn.classList.add("open");
  const r = btn.getBoundingClientRect();
  const dd = buildDD(m.items, 0); dd.style.left = Math.min(r.left, innerWidth - dd.offsetWidth - 8) + "px"; dd.style.top = r.bottom + 2 + "px";
  if (highlightFirst) moveHL(dd, 1);
  wake();
}
function buildDD(items, level){
  const dd = document.createElement("div"); dd.className = "dd"; dd.dataset.level = level;
  items.forEach(it => {
    if (it === "-") { dd.appendChild(document.createElement("hr")); return; }
    const r = document.createElement("button"); r.className = "r";
    if (it.off) r.setAttribute("disabled", "");
    r.innerHTML = `<span class="ck">${it.check ? "✓" : it.radio ? "●" : ""}</span>${it.swatch ? `<span class="sw8" style="background:${it.swatch}"></span>` : ""}<span class="lb"></span>${it.k ? `<span class="k">${esc(it.k)}</span>` : ""}${it.sub ? '<span class="ar">›</span>' : ""}`;
    r.querySelector(".lb").textContent = it.label;
    r._it = it;
    r.onpointerenter = () => { setHL(dd, r); if (it.sub && !it.off) openSub(dd, r); else closeFrom(level + 1); };
    r.onclick = () => activate(dd, r);
    dd.appendChild(r);
  });
  document.body.appendChild(dd); ddStack[level] = dd;
  const rr = dd.getBoundingClientRect(); if (rr.bottom > innerHeight - 6) dd.style.maxHeight = innerHeight - 12 + "px";
  return dd;
}
function openSub(dd, r){
  const lvl = +dd.dataset.level + 1;
  if (ddStack[lvl] && ddStack[lvl]._from === r) return ddStack[lvl];
  closeFrom(lvl);
  const sub = buildDD(r._it.sub, lvl); sub._from = r;
  const rr = r.getBoundingClientRect(), w = sub.offsetWidth;
  sub.style.left = (rr.right + w + 4 > innerWidth ? rr.left - w - 4 : rr.right + 2) + "px";
  sub.style.top = clamp(rr.top - 5, 4, innerHeight - sub.offsetHeight - 8) + "px";
  return sub;
}
function closeFrom(level){ while (ddStack.length > level) { const d = ddStack.pop(); d && d.remove(); } }
function closeMenus(){ closeFrom(0); openMenu = null; mbar.querySelectorAll(".mb.open").forEach(b => b.classList.remove("open")); }
function setHL(dd, r){ dd.querySelectorAll(".r.hl").forEach(x => x.classList.remove("hl")); r && r.classList.add("hl"); }
function moveHL(dd, d){
  const rows = [...dd.querySelectorAll(".r:not([disabled])")]; if (!rows.length) return;
  const cur = rows.indexOf(dd.querySelector(".r.hl"));
  setHL(dd, rows[(cur + d + rows.length) % rows.length] || rows[0]);
}
function activate(dd, r){
  const it = r._it; if (!it || it.off) return;
  if (it.sub) { moveHL(openSub(dd, r), 1); return; }
  closeMenus(); it.act && it.act();
}
document.addEventListener("pointerdown", e => { if (openMenu && !e.target.closest(".dd,.mb")) closeMenus(); });
window.addEventListener("blur", closeMenus);
function menuKey(e){
  const dd = ddStack[ddStack.length - 1]; const ids = menus().map(m => m.id);
  const switchMenu = d => { if (openMenu !== "ctx") showMenu(ids[(ids.indexOf(openMenu) + d + ids.length) % ids.length], true); };
  switch (e.key) {
    case "Escape": ddStack.length > 1 ? closeFrom(ddStack.length - 1) : closeMenus(); break;
    case "ArrowDown": moveHL(dd, 1); break;
    case "ArrowUp": moveHL(dd, -1); break;
    case "ArrowRight": { const r = dd.querySelector(".r.hl"); if (r && r._it.sub) moveHL(openSub(dd, r), 1); else switchMenu(1); break; }
    case "ArrowLeft": ddStack.length > 1 ? closeFrom(ddStack.length - 1) : switchMenu(-1); break;
    case "Enter": case " ": { const r = dd.querySelector(".r.hl"); r && activate(dd, r); break; }
    default: return false;
  }
  e.preventDefault(); return true;
}

/* =====================================================================
   Buttons
   ===================================================================== */
$("bPlay").onclick = toggle; $("bPrev").onclick = prev; $("bNext").onclick = () => step(1);
$("bBack").onclick = () => seekBy(-settings.skipStep); $("bFwd").onclick = () => seekBy(settings.skipStep);
$("bMute").onclick = () => setMute(!saved.muted);
$("volume").oninput = e => setVol(+e.target.value);
$("bFull").onclick = () => toggleFull();
$("bList").onclick = $("bCloseList").onclick = () => { S.listOpen = !S.listOpen; updateToggles(); };
$("bPin").onclick = () => setOnTop(!S.onTop);
$("bAdjust").onclick = () => toggleAdj();
$("bShuffle").onclick = () => setShuffle(!S.shuffle);
$("bRepeat").onclick = () => setRepeat({ off: "all", all: "one", one: "off" }[S.repeat]);
$("bCC").onclick = ccPop;
$("bSpeed").onclick = e => { const i = SPEEDS.indexOf(S.speed); setSpeed(e.shiftKey ? 1 : SPEEDS[(i + 1) % SPEEDS.length]); };
$("bSpeed").oncontextmenu = e => { e.preventDefault(); setSpeed(1); };
$("time").onclick = () => { settings.ctrl.timeMode = settings.ctrl.timeMode === "total" ? "remaining" : "total"; updateTime(); persist(); };
$("emptyOpen").onclick = openFiles; $("emptyFolder").onclick = openFolder;
$("emblem").onclick = () => { if (NeonGL.running) NeonGL.surge(); const e2 = $("emblem"); e2.classList.remove("surge"); void e2.offsetWidth; e2.classList.add("surge"); setTimeout(() => e2.classList.remove("surge"), 600); setTimeout(openFiles, 160); };
$("smark").onclick = () => openFiles();
$("orb").onclick = () => { const o = $("orb"); o.classList.remove("burst"); void o.offsetWidth; o.classList.add("burst"); setTimeout(() => o.classList.remove("burst"), 1100); setTimeout(openFiles, 180); };
$("bAdd").onclick = addFiles;
$("bClear").onclick = () => list.length && clearAll();

/* =====================================================================
   Keyboard
   ===================================================================== */
window.addEventListener("keydown", e => {
  if (recording) return recordKey(e);
  const k = e.key, c = e.ctrlKey || e.metaKey, lk = k.length === 1 ? k.toLowerCase() : k;
  document.body.classList.toggle("alt", e.altKey && !c);
  if (openMenu && menuKey(e)) return;
  if (modalOpen()) { if (k === "Escape") { e.preventDefault(); closeModal(); } return; }
  if ((e.target.tagName === "INPUT" && e.target.type !== "range") || e.target.tagName === "SELECT") return;
  if (e.altKey && !c) {
    const m = menus().find(m => m.key === lk);
    if (m) { e.preventDefault(); if (fullscreen) toggleFull(false); showMenu(m.id, true); return; }
    if (!/^[0-9]$/.test(k)) return;                 // Alt+1/2/3: video size presets
  }
  if (k === "Escape") {
    if (adjOpen()) toggleAdj(); else if (fullscreen) toggleFull(false);
    $("ccPop").classList.remove("open"); return;
  }
  if (!c && !e.shiftKey && !e.altKey && /^[0-9]$/.test(k) && isFinite(v.duration)) { v.currentTime = v.duration * (+k / 10); return; }
  const combo = comboOf(e); const id = combo && keyMap[combo];
  if (id) {
    if (e.target.type === "range" && /Arrow/.test(combo)) return;   // let sliders use the arrow keys
    e.preventDefault(); ACT[id].fn(); if (!fullscreen) wake();
  } else if (c) e.preventDefault();
});
window.addEventListener("keyup", e => { if (e.key === "Alt") document.body.classList.remove("alt"); });
window.addEventListener("beforeunload", () => { saveResume(); flushState(); });
window.addEventListener("pagehide", flushState);

/* =====================================================================
   Boot — always a clean start: no playlist or previous file is restored
   ===================================================================== */
(async () => {
  const argsP = host.args().catch(() => []);            // ask for start-up files while settings load
  try {
    const raw = await host.load();
    if (raw) {
      const st = JSON.parse(raw);
      if (isObj(st.settings)) {
        const old = st.settings;
        if (old.subSize && !old.sub) old.sub = { size: { s: 80, m: 100, l: 125, xl: 155 }[old.subSize] || 100, bg: old.subBg ? 60 : 0 };   // 1.1 → 1.2
        if (!old.v || old.v < 2) { old.landingStyle = "simple"; old.v = 2; }                                                           // 1.6: lighter start screen
        if (old.v < 3) { old.glow = "off"; old.v = 3; }                                                                                  // 1.6.1: neon glow off by default
        settings = merge(DEFAULTS, old);
      }
      if (settings.rememberVolume && typeof st.volume === "number") { saved.volume = st.volume; saved.muted = !!st.muted; }
      if (settings.resume && isObj(st.positions)) saved.positions = st.positions;
      if (Array.isArray(st.favorites)) saved.favorites = st.favorites.filter(f => f && typeof f.path === "string").slice(0, 200);
      if (settings.keepRecent && Array.isArray(st.recent)) saved.recent = st.recent.filter(r => typeof r === "string").slice(0, 15);
    }
  } catch {}
  rebuildKeys();
  setSpeed(settings.defaultSpeed, true);
  v.volume = saved.volume; v.muted = saved.muted; $("volume").value = saved.volume; updateVolIcon();
  applyAll(); updateToggles(); renderList();
  const args = await argsP || [];
  if (args.length) add(args, true);
  persist();      // rewrites state without any old playlist data
  window.__lumenReady = true;
})();

// test hooks (harmless in the app)
/* =====================================================================
   MPC-HC style features: chapters, folder navigation, audio tracks, Go To,
   statistics, favorites, recent files, thumbnails, after playback, sizes
   ===================================================================== */
// ---- chapters ----
function setChapters(chs){
  chapters = (chs || []).filter(c => isFinite(c.start));
  const host2 = $("chapMarks"); host2.innerHTML = "";
  const d = v.duration;
  if (!chapters.length || !isFinite(d)) return;
  for (const c of chapters) if (c.start > .5 && c.start < d - .5) { const m = document.createElement("i"); m.style.left = c.start / d * 100 + "%"; host2.appendChild(m); }
}
async function loadChapters(it, token){
  if (!it.path || !MATROSKA.test(it.name)) return;
  await firstFrame(); if (token !== loadToken) return;
  try { const chs = await host.chapters(it.path); if (token === loadToken) setChapters(chs); } catch {}
}
v.addEventListener("durationchange", () => setChapters(chapters));
function chapterAt(t){ let c = null; for (const x of chapters) if (x.start <= t + .05) c = x; return c; }
function chapterName(c){ return c.title || `Chapter ${chapters.indexOf(c) + 1}`; }
function seekChapter(c){ v.currentTime = c.start; toast(`${chapterName(c)}  ·  ${chapters.indexOf(c) + 1}/${chapters.length}`); }

// ---- next / previous: chapter → playlist → folder (like MPC-HC's PageDown / PageUp) ----
function navNext(){
  if (idx < 0) return;
  const t = v.currentTime, nx = chapters.find(c => c.start > t + .5);
  if (nx) return seekChapter(nx);
  const pos = order.indexOf(idx);
  if (pos < order.length - 1 || S.repeat === "all") return step(1);
  playNeighbor(1);
}
function navPrev(){
  if (idx < 0) return;
  const t = v.currentTime, cur = chapterAt(t);
  if (cur) {
    if (t - cur.start > 3) return seekChapter(cur);
    const i = chapters.indexOf(cur); if (i > 0) return seekChapter(chapters[i - 1]);
  }
  if (t > 3 && !cur) { v.currentTime = 0; return; }
  if (order.indexOf(idx) > 0 || S.repeat === "all") return step(-1);
  playNeighbor(-1);
}
async function playNeighbor(dir){
  const it = list[idx];
  if (!it) return;
  if (!it.path) return toast("Folder navigation needs a file opened from disk", true);
  const n = await host.neighbor(it.path, dir);
  if (!n) return toast(dir > 0 ? "That was the last file in this folder" : "That was the first file in this folder");
  let j = list.findIndex(x => x.path === n.path);
  if (j < 0) { list.splice(dir > 0 ? idx + 1 : idx, 0, n); j = dir > 0 ? idx + 1 : idx; if (dir < 0) idx++; rebuildOrder(); renderList(); }
  play(j);
}

// ---- audio tracks (needs Chromium's AudioVideoTracks feature, enabled by Lumen) ----
function aTracks(){ return v.audioTracks ? [...v.audioTracks] : []; }
function aLabel(t, i){ return t.label || langName(t.language) || `Track ${i + 1}`; }
function refreshAudioTracks(){ if (aTracks().length > 1) toast(`${aTracks().length} audio tracks · ${keyLabel("audioCycle") || "Ctrl+A"} to switch`); }
function setAudioTrack(i){ aTracks().forEach((t, k) => t.enabled = k === i); toast(`Audio: ${aLabel(aTracks()[i], i)}`); }
function cycleAudio(){
  const ts = aTracks(); if (ts.length < 2) return toast(ts.length ? "This file has one audio track" : "No audio tracks");
  setAudioTrack((ts.findIndex(t => t.enabled) + 1) % ts.length);
}
function audioTrackItems(){
  const ts = aTracks();
  if (!ts.length) return [{ label: "No audio tracks", off: true }];
  return ts.map((t, i) => ({ label: aLabel(t, i), radio: t.enabled, act: () => setAudioTrack(i) }));
}
function toggleNormalize(){ settings.eq.normalize = !settings.eq.normalize; applyAudio(); persist(); if (adjOpen()) renderAdj(); toast(settings.eq.normalize ? "Volume normalization on" : "Volume normalization off"); }

// ---- video size presets (MPC-HC Alt+1/2/3) ----
async function videoSize(z){
  if (list[idx]?.kind !== "video" || !v.videoWidth) return;
  if (fullscreen) toggleFull(false);
  const sa = screenAspect(), rot = ((geo.rotate % 360) + 360) % 360, h0 = rot === 90 || rot === 270 ? v.videoWidth : v.videoHeight;
  const h = h0 * z, w = h * sa;
  const ok2 = await host.setVideoSize(w, h, innerWidth - stage.clientWidth, innerHeight - stage.clientHeight);
  toast(ok2 === false && hasHost ? "Couldn't resize the window" : `Video size ${z * 100} %`);
}

// ---- Go To (Ctrl+G) ----
function parseTime(str, dur){
  str = String(str).trim().replace(",", ".");
  if (/^\d+(\.\d+)?%$/.test(str)) return dur * parseFloat(str) / 100;
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const m = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN;
}
function goToModal(){
  if (idx < 0 || !isFinite(v.duration)) return toast("Nothing is playing");
  openModal("Go to", `<p style="color:var(--dim);margin:6px 0 12px">Type a time like <b>1:23:45</b>, <b>12:30</b> or <b>90</b> (seconds), or a percentage like <b>50%</b>. Now at ${fmt(v.currentTime)} of ${fmt(v.duration)}.</p>
    <input id="goIn" class="txt" autocomplete="off" spellcheck="false" value="${fmt(v.currentTime)}" aria-label="Time">
    <div id="goErr" class="err-note"></div>
    ${chapters.length ? `<div class="sec">Chapters</div><div class="chips">${chapters.map((c, i) => `<button data-ch="${i}">${esc(fmt(c.start))} · ${esc(chapterName(c))}</button>`).join("")}</div>` : ""}`,
    '<button class="btn ghost" data-close>Cancel</button><button class="btn" id="goBtn">Go</button>');
  const inp = $("goIn"); setTimeout(() => { inp.focus(); inp.select(); }, 30);
  const go = () => {
    const t = parseTime(inp.value, v.duration);
    if (!isFinite(t) || t < 0 || t > v.duration) { $("goErr").textContent = "That isn't a time inside this file."; return; }
    v.currentTime = t; closeModal(); toast(`Jumped to ${fmt(t)}`);
  };
  $("goBtn").onclick = go;
  inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  $("mBody").querySelectorAll("[data-ch]").forEach(b => b.onclick = () => { closeModal(); seekChapter(chapters[+b.dataset.ch]); });
}

// ---- statistics overlay (Ctrl+J) ----
function toggleStats(force){
  statsOn = force ?? !statsOn;
  $("statsBox").hidden = !statsOn; clearInterval(statsT); statsPrev = null;
  if (statsOn) { renderStats(); statsT = setInterval(renderStats, 500); }
}
function renderStats(){
  const it = list[idx], q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null, now = performance.now();
  let fps = "—";
  if (q && statsPrev && !v.paused) fps = ((q.totalVideoFrames - statsPrev.f) / ((now - statsPrev.t) / 1000)).toFixed(1);
  if (q) statsPrev = { f: q.totalVideoFrames, t: now };
  const ahead = (() => { for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) return v.buffered.end(i) - v.currentTime; return 0; })();
  const ts = aTracks(), at = ts.findIndex(t => t.enabled);
  const rows = !it ? [["", "Nothing is playing"]] : [
    ["File", it.name],
    ["Type", `${it.kind === "audio" ? "Audio" : "Video"} · ${(it.name.match(/\.([^.]+)$/) || [, ""])[1].toUpperCase()}`],
    ...(it.kind === "video" ? [["Video", v.videoWidth ? `${v.videoWidth}×${v.videoHeight} → ${Math.round(pic?.w || 0)}×${Math.round(pic?.h || 0)} on screen` : "—"],
                               ["Frame rate", fps === "—" ? "—" : `${fps} fps`],
                               ["Frames", q ? `${q.totalVideoFrames} shown · ${q.droppedVideoFrames} dropped${q.corruptedVideoFrames ? ` · ${q.corruptedVideoFrames} corrupted` : ""}` : "—"]] : []),
    ["Bitrate", it.size && isFinite(v.duration) && v.duration ? `≈ ${(it.size * 8 / v.duration / 1e6).toFixed(2)} Mb/s (average)` : "—"],
    ["Position", `${fmt(v.currentTime)} / ${fmt(v.duration)} · buffered ${ahead.toFixed(1)} s ahead`],
    ...(chapters.length ? [["Chapter", (c => c ? `${chapters.indexOf(c) + 1}/${chapters.length} · ${chapterName(c)}` : "—")(chapterAt(v.currentTime))]] : []),
    ["Speed", `${speedLabel(S.speed)}${settings.preservePitch ? "" : " (pitch follows)"}`],
    ["Audio", `${ts.length ? `track ${at + 1}/${ts.length} · ` : ""}volume ${Math.round(saved.volume * 100)}%${settings.eq.boost > 100 ? ` · boost ${settings.eq.boost}%` : ""}${settings.eq.on ? " · EQ" : ""}${settings.eq.normalize ? " · normalized" : ""}`],
    ["Subtitles", activeSub >= 0 ? subs[activeSub].label + (subDelay ? ` · ${subDelay > 0 ? "+" : ""}${subDelay.toFixed(1)} s` : "") : "off"],
    ...(geo.zoom > 100.5 || geo.aspect !== "auto" ? [["Picture", `${geo.aspect === "auto" ? "original aspect" : geo.aspect} · zoom ${Math.round(geo.zoom)}%`]] : []),
    ["Engine", "Microsoft Edge WebView2 · hardware decoding"],
  ];
  $("statsBody").innerHTML = rows.map(([k2, x]) => `<div><span>${esc(k2)}</span><b>${esc(x)}</b></div>`).join("");
}
$("statsClose").onclick = () => toggleStats(false);

// ---- favorites & recent files ----
async function openPaths(paths, at){
  const items = await host.expand(paths);
  if (!items || !items.length) return toast("That file isn't available any more", true);
  clearAll(); if (at) pendingSeek = at; add(items, true);
}
function addFavorite(){
  const it = list[idx];
  if (!it) return toast("Open a file first");
  if (!it.path) return toast("Favorites need a file opened from disk", true);
  const pos = isFinite(v.currentTime) && v.currentTime > 5 ? Math.floor(v.currentTime) : 0;
  saved.favorites = [{ path: it.path, name: base(it.name), pos }, ...saved.favorites.filter(f => f.path !== it.path)].slice(0, 200);
  persist(); toast(`Added to favorites${pos ? ` at ${fmt(pos)}` : ""}`);
}
function favoriteItems(){
  const it = list[idx];
  return [
    { label: "Add current file", k: keyLabel("favAdd"), act: addFavorite, off: !it || !it.path },
    { label: "Organize favorites…", act: favoritesModal, off: !saved.favorites.length },
    ...(saved.favorites.length ? ["-"] : []),
    ...saved.favorites.slice(0, 20).map(f => ({ label: f.name + (f.pos ? `  (${fmt(f.pos)})` : ""), act: () => openPaths([f.path], f.pos) })),
  ];
}
function favoritesModal(){
  const draw = () => {
    $("mBody").innerHTML = saved.favorites.length ? `<table class="info">${saved.favorites.map((f, i) => `<tr><td style="width:auto;color:var(--text)">${esc(f.name)}<br><small style="color:var(--faint)">${esc(f.path)}</small></td><td style="width:70px;color:var(--dim)">${f.pos ? fmt(f.pos) : "start"}</td><td style="width:90px;text-align:right"><button class="btn ghost sm" data-open="${i}">Open</button></td><td style="width:40px"><button class="ib" data-del="${i}" title="Remove"><svg><use href="#i-trash"/></svg></button></td></tr>`).join("")}</table>`
      : `<p style="color:var(--dim);padding:16px 0">No favorites yet. Use File → Favorites → Add current file (${esc(keyLabel("favAdd"))}).</p>`;
    $("mBody").querySelectorAll("[data-del]").forEach(b => b.onclick = () => { saved.favorites.splice(+b.dataset.del, 1); persist(); draw(); });
    $("mBody").querySelectorAll("[data-open]").forEach(b => b.onclick = () => { const f = saved.favorites[+b.dataset.open]; closeModal(); openPaths([f.path], f.pos); });
  };
  openModal("Favorites", "", '<button class="btn ghost" id="favClear">Clear all</button><span class="sp"></span><button class="btn" data-close>Done</button>');
  $("favClear").onclick = () => { saved.favorites = []; persist(); draw(); };
  draw();
}
function recentItems(){
  if (!saved.recent.length) return [{ label: "No recent files", off: true }];
  return [...saved.recent.map(p2 => ({ label: p2.split(/[\\/]/).pop(), act: () => openPaths([p2]) })), "-", { label: "Clear list", act: () => { saved.recent = []; persist(); toast("Recent files cleared"); } }];
}

// ---- playlists (.m3u8) ----
async function savePlaylist(){
  const items = list.filter(i => i.path);
  if (!items.length) return toast("Only files opened from disk can go in a saved playlist", true);
  const text = "#EXTM3U\n" + items.map(i => `#EXTINF:${Math.round(i.dur || -1)},${base(i.name)}\n${i.path}`).join("\n") + "\n";
  const r = await host.dialog("saveplaylist:" + text);
  if (r) toast(`Playlist saved${typeof r === "string" ? `: ${r}` : ""}`);
}

// ---- after playback (MPC-HC: Play → After Playback) ----
function afterList(){ return [["nothing", "Do nothing"], ["nextInFolder", "Play next file in folder"], ["repeat", "Play again"], ["close", "Close the file"], ["exit", "Exit Lumen"], ["sleep", "Sleep"], ["hibernate", "Hibernate"], ["shutdown", "Shut down"]]; }
function afterItems(){
  const cur = afterOnce ?? settings.afterPlayback;
  return [...afterList().map(([k2, l]) => ({ label: l, radio: cur === k2, act: () => { afterOnce = k2 === settings.afterPlayback ? null : k2; toast(`After playback: ${l}${afterOnce ? " (this time)" : ""}`); } })),
    "-", { label: "Set the default in Settings…", act: () => settingsModal("general") }];
}
async function afterPlayback(){
  const a = afterOnce ?? settings.afterPlayback; afterOnce = null;
  if (a === "nothing") return;
  if (a === "nextInFolder") return playNeighbor(1);
  if (a === "repeat") { v.currentTime = 0; v.play(); return; }
  if (a === "close") return clearAll();
  if (a === "exit") return host.quit();
  // power actions: a visible countdown with a cancel button
  const label = { sleep: "Going to sleep", hibernate: "Hibernating", shutdown: "Shutting down" }[a];
  let left = 15;
  openModal(label, `<p style="font-size:15px;padding:10px 0">${label} in <b id="pwLeft">${left}</b> seconds…</p>${a === "shutdown" ? `<p class="note">Windows will also show its own 60-second warning.</p>` : ""}`,
    '<button class="btn" id="pwCancel">Cancel</button>');
  const timer = setInterval(async () => {
    left--; const el = $("pwLeft"); if (el) el.textContent = left;
    if (left > 0) return;
    clearInterval(timer); closeModal();
    try { await host.power(a); } catch (e) { toast(`Couldn't ${a === "shutdown" ? "shut down" : a}: ${e.message || e}`, true); }
  }, 1000);
  $("pwCancel").onclick = () => { clearInterval(timer); closeModal(); toast("Cancelled"); };
  modalOnClose = () => clearInterval(timer);
}

// ---- Navigate menu ----
function navItems(){
  const has = idx >= 0, it = list[idx], k = keyLabel, t = v.currentTime, cur = chapterAt(t);
  return [
    { label: "Next (chapter, then file)", k: k("nextSmart"), act: navNext, off: !has },
    { label: "Previous (chapter, then file)", k: k("prevSmart"), act: navPrev, off: !has },
    { label: "Next file in folder", k: k("nextFolder"), act: () => playNeighbor(1), off: !it?.path },
    { label: "Previous file in folder", k: k("prevFolder"), act: () => playNeighbor(-1), off: !it?.path },
    "-",
    { label: "Chapters", sub: chapters.length ? chapters.map((c, i) => ({ label: `${fmt(c.start)}   ${chapterName(c)}`, radio: c === cur, act: () => seekChapter(c) })) : [{ label: "No chapters in this file", off: true }], off: !has },
    { label: "Go to…", k: k("goTo"), act: goToModal, off: !has },
  ];
}

// ---- save thumbnails (contact sheet) ----
function thumbsModal(){
  const it = list[idx];
  if (!it || it.kind !== "video" || !v.videoWidth) return toast("Open a video first");
  openModal("Save thumbnails", `<p style="color:var(--dim);margin:6px 0 4px">Makes one image with evenly spaced frames from “${esc(base(it.name))}”, saved next to your snapshots.</p>
    <div class="set"><div class="d"><b>Columns</b></div><div class="seg" data-g="cols">${[3, 4, 5, 6].map(n => `<button data-v="${n}" class="${n === 4 ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="set"><div class="d"><b>Rows</b></div><div class="seg" data-g="rows">${[3, 4, 5, 6, 8].map(n => `<button data-v="${n}" class="${n === 4 ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="set"><div class="d"><b>Image width</b></div><div class="seg" data-g="width">${[1024, 1600, 2048].map(n => `<button data-v="${n}" class="${n === 1600 ? "on" : ""}">${n}px</button>`).join("")}</div></div>
    <div id="thProg" class="note" hidden></div>`,
    '<button class="btn ghost" data-close>Cancel</button><button class="btn" id="thGo">Create</button>');
  const opt = { cols: 4, rows: 4, width: 1600 };
  $("mBody").querySelectorAll(".seg").forEach(g => g.querySelectorAll("button").forEach(b => b.onclick = () => { g.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); opt[g.dataset.g] = +b.dataset.v; }));
  $("thGo").onclick = async () => {
    $("thGo").disabled = true; const prog = $("thProg"); prog.hidden = false;
    try {
      const url = await buildThumbs(it, opt, (i, n) => { prog.textContent = `Capturing frame ${i} of ${n}…`; });
      prog.textContent = "Saving…";
      const p2 = await host.snapshot(url, `${base(it.name)} thumbnails`);
      closeModal(); toast(`Thumbnails saved: ${p2}`);
    } catch (e) { prog.textContent = "Couldn't create thumbnails: " + (e.message || e); $("thGo").disabled = false; }
  };
}
function buildThumbs(it, { cols, rows, width }, onProgress){
  return new Promise((resolve, reject) => {
    const tv = document.createElement("video"); tv.muted = true; tv.preload = "auto"; tv.src = it.url;
    const n = cols * rows, pad = Math.round(width * .008), head = Math.round(width * .055);
    let c, g, tw, th, i = 0;
    const fail = () => { tv.removeAttribute("src"); reject(new Error("the video couldn't be read")); };
    tv.onerror = fail;
    tv.onloadedmetadata = () => {
      const ar = tv.videoWidth / tv.videoHeight;
      tw = Math.floor((width - pad * (cols + 1)) / cols); th = Math.round(tw / ar);
      c = document.createElement("canvas"); c.width = width; c.height = head + rows * (th + pad) + pad;
      g = c.getContext("2d");
      g.fillStyle = "#0d0e11"; g.fillRect(0, 0, c.width, c.height);
      const [a] = accentColors();
      g.fillStyle = a; g.fillRect(pad, pad, 6, head - pad * 2);
      g.fillStyle = "#eceef2"; g.font = `600 ${Math.round(head * .32)}px "Segoe UI",system-ui,sans-serif`; g.textBaseline = "top";
      g.fillText(it.name, pad * 2 + 6, pad + head * .08, width - pad * 4);
      g.fillStyle = "#9298a5"; g.font = `${Math.round(head * .24)}px "Segoe UI",system-ui,sans-serif`;
      g.fillText(`${tv.videoWidth}×${tv.videoHeight} · ${fmt(tv.duration)}${it.size ? ` · ${bytes(it.size)}` : ""} · Lumen`, pad * 2 + 6, pad + head * .5, width - pad * 4);
      next();
    };
    const next = () => {
      if (i >= n) { tv.removeAttribute("src"); return resolve(c.toDataURL("image/png")); }
      onProgress(i + 1, n);
      tv.currentTime = tv.duration * (i + 1) / (n + 1);
    };
    tv.onseeked = () => {
      const x = pad + (i % cols) * (tw + pad), y = head + pad + Math.floor(i / cols) * (th + pad);
      g.drawImage(tv, x, y, tw, th);
      const label = fmt(tv.currentTime); g.font = `600 ${Math.max(11, Math.round(th * .09))}px "Cascadia Mono",Consolas,monospace`;
      const lw = g.measureText(label).width + 10, lh = Math.max(15, Math.round(th * .13));
      g.fillStyle = "rgba(0,0,0,.65)"; g.fillRect(x + tw - lw - 4, y + th - lh - 4, lw, lh);
      g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(label, x + tw - lw + 1, y + th - lh / 2 - 4);
      i++; next();
    };
    setTimeout(() => { if (i < n) fail(); }, 120000);
  });
}

// ---- right-click quick menu ----
function ctxItems(){
  const has = idx >= 0, it = list[idx], vid = has && it.kind === "video", k = keyLabel;
  const playing = has ? [
    "-",
    { label: "Audio track", sub: audioTrackItems() },
    ...(vid ? [{ label: "Subtitles", sub: [{ label: "Off", radio: activeSub === -1, act: () => setSub(-1, "user") }, ...subs.map((s2, i) => ({ label: s2.label, radio: activeSub === i, act: () => setSub(i, "user") })), "-", { label: "Load subtitle file…", k: k("loadSubs"), act: loadSubsDialog }, { label: "Subtitle style…", act: () => settingsModal("subtitles") }] }] : []),
    ...(chapters.length ? [{ label: "Chapters", sub: chapters.map(c => ({ label: `${fmt(c.start)}   ${chapterName(c)}`, radio: c === chapterAt(v.currentTime), act: () => seekChapter(c) })) }] : []),
    { label: "Speed", sub: SPEEDS.map(x => ({ label: x === 1 ? "Normal" : speedLabel(x), radio: S.speed === x, act: () => setSpeed(x) })) },
    ...(vid ? [{ label: "Picture", sub: [
      ...ASPECTS.map(([a, l]) => ({ label: l, radio: geo.aspect === a, act: () => setGeo("aspect", a) })), "-",
      { label: "Zoom in", k: k("zoomIn"), act: ACT.zoomIn.fn }, { label: "Zoom out", k: k("zoomOut"), act: ACT.zoomOut.fn, off: !zoomed() }, { label: "Reset zoom", k: k("zoomReset"), act: ACT.zoomReset.fn, off: !zoomed() }, "-",
      { label: "Rotate 90°", k: k("rotate"), act: ACT.rotate.fn }] },
      { label: "Video size", sub: [[.5, "50 %", "size50"], [1, "100 %", "size100"], [2, "200 %", "size200"]].map(([z, l, a]) => ({ label: l, k: k(a), act: () => videoSize(z) })) }] : []),
  ] : [];
  return [
    { label: has && !v.paused ? "Pause" : "Play", k: k("toggle"), act: toggle, off: !list.length },
    ...(has ? [{ label: "Previous", k: k("prevSmart"), act: navPrev }, { label: "Next", k: k("nextSmart"), act: navNext }, "-"] : []),
    { label: "Open file…", k: k("open"), act: openFiles },
    { label: "Open folder…", k: k("openFolder"), act: openFolder },
    ...(settings.keepRecent ? [{ label: "Recent files", sub: recentItems() }] : []),
    { label: "Favorites", sub: favoriteItems() },
    ...playing,
    "-",
    { label: "Fullscreen", k: k("full"), check: fullscreen, act: () => toggleFull(), off: !has },
    { label: "Always on top", k: k("onTop"), check: S.onTop, act: () => setOnTop(!S.onTop) },
    { label: "Playlist", k: k("playlist"), check: S.listOpen, act: () => $("bList").click() },
    { label: "Minimal view", k: k("minimal"), check: settings.minimalView, act: ACT.minimal.fn },
    "-",
    ...(has ? [{ label: "Adjustments…", k: k("adjust"), act: () => toggleAdj() }] : []),
    { label: "More", sub: [
      { label: "Statistics", k: k("stats"), check: statsOn, act: () => toggleStats() },
      { label: "Go to…", k: k("goTo"), act: goToModal, off: !has },
      { label: "Take snapshot", k: k("snapshot"), act: snapshot, off: !vid },
      { label: "Save thumbnails…", k: k("thumbs"), act: thumbsModal, off: !vid },
      { label: "Media information…", k: k("info"), act: mediaInfo, off: !has },
      "-",
      { label: "After playback", sub: afterItems() },
    ] },
    { label: "Settings…", k: k("settings"), act: () => settingsModal() },
    { label: "Exit", k: k("quit"), act: () => host.quit() },
  ];
}
function openCtx(x, y){
  closeMenus(); $("ccPop").classList.remove("open");
  openMenu = "ctx";
  const dd = buildDD(ctxItems(), 0); dd.classList.add("ctx");
  dd.style.maxHeight = ""; const w = dd.offsetWidth, h = dd.offsetHeight;
  dd.style.left = clamp(x, 4, innerWidth - w - 4) + "px";
  dd.style.top = (y + h + 4 <= innerHeight ? y : y - h >= 4 ? y - h : clamp(y, 4, Math.max(4, innerHeight - h - 4))) + "px";
  if (h > innerHeight - 8) { dd.style.maxHeight = innerHeight - 8 + "px"; dd.style.overflowY = "auto"; }
  wake();
}
document.addEventListener("contextmenu", e => {
  if (e.defaultPrevented) return;                                // a control used the right-click itself (e.g. speed chip → 1×)
  if (e.target.closest("input[type=text],input:not([type]),textarea")) return;   // keep copy/paste on text fields
  e.preventDefault();                                            // our menu replaces the browser's everywhere else
  if (modalOpen() || e.target.closest("select,.dd")) return;
  openCtx(e.clientX, e.clientY);
});

// ---- movable windows: drag panels and dialogs by their title area ----
const dragPos = {};
function makeDraggable(win, handleSel, key, bounds){
  win.addEventListener("pointerdown", e => {
    const h = e.target.closest(handleSel);
    if (!h || !win.contains(h) || e.button !== 0 || e.target.closest(".ib,input,select,textarea,a")) return;
    const start = { x: e.clientX, y: e.clientY }, p0 = dragPos[key] || { x: 0, y: 0 };
    let b = null, r0 = null, moved = false;
    const move = ev => {
      if (!moved) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;   // a click on a tab stays a click
        moved = true; b = bounds(); r0 = win.getBoundingClientRect();
        win.classList.add("moving"); try { h.setPointerCapture(ev.pointerId); } catch {}
      }
      // keep the whole window inside its area
      const dx = clamp(ev.clientX - start.x, b.left - r0.left, b.right - r0.right), dy = clamp(ev.clientY - start.y, b.top - r0.top, b.bottom - r0.bottom);
      dragPos[key] = { x: p0.x + dx, y: p0.y + dy }; win.style.translate = `${dragPos[key].x}px ${dragPos[key].y}px`;
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (!moved) return;
      win.classList.remove("moving");
      const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };   // the click that ends a drag isn't a click on a tab
      addEventListener("click", swallow, true); setTimeout(() => removeEventListener("click", swallow, true), 0);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  });
  win.addEventListener("dblclick", e => { if (e.target.closest(handleSel) && !e.target.closest("button,input")) { delete dragPos[key]; win.style.translate = ""; } });   // double-click: back to its place
}
// dialogs reopen where they were last dragged, kept fully on screen whatever their size
function placeModal(){
  const m = $("modal"); m.style.translate = "";
  if (!dragPos.modal) return;
  const r = m.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  const bx = r.left + r.width / 2 - w / 2, by = r.top + r.height / 2 - h / 2;   // untransformed spot (ignores the pop-in scale)
  dragPos.modal = { x: clamp(dragPos.modal.x, -bx, innerWidth - w - bx), y: clamp(dragPos.modal.y, -by, innerHeight - h - by) };
  m.style.translate = `${dragPos.modal.x}px ${dragPos.modal.y}px`;
}
const stageBounds = () => stage.getBoundingClientRect();
const viewBounds = () => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
makeDraggable($("adjPanel"), "header", "adj", stageBounds);
makeDraggable($("ccPop"), "h6", "cc", stageBounds);
makeDraggable($("statsBox"), ".stats-h", "stats", stageBounds);
makeDraggable($("modal"), "header", "modal", viewBounds);

/* =====================================================================
   Files handed over from a second launch (double-click while open)
   ===================================================================== */
let lastRemote = 0;
window.__lumenRemote = items => {
  if (!items || !items.length) return;
  const batch = Date.now() - lastRemote < 2500; lastRemote = Date.now();   // several files opened at once
  if (modalOpen()) closeModal();
  const media = items.filter(i => i.kind !== "sub");
  if (!batch && settings.explorerOpen === "play" && media.length) { clearAll(); add(items, true); }
  else { add(items, idx < 0); if (media.length) toast(`Added ${media.length > 1 ? media.length + " items" : "“" + base(media[0].name) + "”"} to the playlist`); }
};

/* =====================================================================
   Start screen: floating motes of light + a spotlight that follows the cursor
   ===================================================================== */
let landRaf = 0, motes = [], moteSprite = null, moteColor = "", landLast = 0;
function landingFxLevel(){
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduce && settings.landingFx === "full" ? "calm" : settings.landingFx;
}
// one soft glowing dot, pre-rendered in the sign's colour (read back resolved, so colour-cycle works)
const probe = document.createElement("i"); probe.style.cssText = "position:absolute;width:0;height:0;color:var(--n1)"; $("empty").appendChild(probe);
function buildMote(){
  const col = settings.landingStyle === "orb" ? accentColors()[0] : getComputedStyle(probe).color;
  if (moteColor === col && moteSprite) return;
  moteColor = col; moteSprite = document.createElement("canvas"); moteSprite.width = moteSprite.height = 32;
  const g = moteSprite.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  const clear = col.startsWith("#") ? hexA(col, 0) : col.replace(/^rgba?\(([^,]+),([^,]+),([^,)]+).*$/, "rgba($1,$2,$3,0)");
  gr.addColorStop(0, "#fff"); gr.addColorStop(.25, col); gr.addColorStop(1, clear);
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
}
// The neon floor's horizon sits just under the sign's reflection, wherever the layout puts it.
function placeHorizon(){
  const sign = $("sign"), hero = sign.parentElement;
  $("empty").style.setProperty("--hz", hero.offsetTop + sign.offsetTop + sign.offsetHeight + 10 + "px");
}
new ResizeObserver(placeHorizon).observe($("empty"));
/* ---- GPU neon sign ---- */
let glFailed = false, glColorT = 0;
const neonProbes = ["--n1", "--n2", "--n3"].map(v2 => { const i = document.createElement("i"); i.style.cssText = `position:absolute;width:0;height:0;color:var(${v2})`; $("empty").appendChild(i); return i; });
const measureCtx = document.createElement("canvas").getContext("2d");
function readNeonColors(){
  NeonGL.setColors(neonProbes.map(i => (getComputedStyle(i).color.match(/[\d.]+/g) || [255, 180, 80]).slice(0, 3).map(x => x / 255)));
}
function glLayout(){
  const empty = $("empty"), sign = $("sign"), hero = sign.parentElement, em = $("emblem"), word = sign.querySelector(".word");
  const hx = hero.offsetLeft, hy = hero.offsetTop;
  const cs = getComputedStyle(word), fs = parseFloat(cs.fontSize), font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
  measureCtx.font = font; const mt = measureCtx.measureText("LUMEN");
  const asc = mt.fontBoundingBoxAscent ?? fs * .9, desc = mt.fontBoundingBoxDescent ?? fs * .25;
  const letters = [...word.children].map(sp => ({ ch: sp.textContent.toUpperCase(), x: hx + sp.offsetLeft, y: hy + sp.offsetTop + (sp.offsetHeight - asc - desc) / 2 + asc, r: hx + sp.offsetLeft + sp.offsetWidth, b: hy + sp.offsetTop + sp.offsetHeight }));
  const ex = hx + em.offsetLeft, ey = hy + em.offsetTop, ew = em.offsetWidth;
  const x0 = Math.min(ex, ...letters.map(l => l.x)) - 30, y0 = ey - 20;
  const x1 = Math.max(ex + ew, ...letters.map(l => l.r)) + 30, y1 = Math.max(...letters.map(l => l.b)) + 16;
  return {
    w: empty.clientWidth, h: empty.clientHeight, hz: hy + sign.offsetTop + sign.offsetHeight + 10,
    sign: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, split: (ey + ew + 4 - y0) / (y1 - y0),
    emb: { cx: ex + ew / 2, cy: ey + em.offsetHeight / 2, u: ew / 248 },
    letters, font, fs, texScale: Math.min(devicePixelRatio || 1, 2), calm: false,
  };
}
function glWanted(){
  return settings.gpuFx && !glFailed && settings.landingStyle === "neon" && landingFxLevel() === "full"
    && !$("empty").classList.contains("hidden") && !document.hidden;
}
function startGL(){
  if (!NeonGL.ok && !NeonGL.init($("neongl"), $("empty"))) { glFailed = true; return false; }
  readNeonColors();
  if (!NeonGL.start(glLayout(), { quality: settings.fxQuality })) return false;
  clearInterval(glColorT); glColorT = setInterval(readNeonColors, 250);      // follows colour changes / colour cycle
  return true;
}
function stopGL(){ if (NeonGL.running) NeonGL.stop(); clearInterval(glColorT); document.body.classList.remove("gl-sign"); }
NeonGL.onlost = () => { glFailed = true; stopGL(); landingLoop(); };
NeonGL.onslow = () => { glFailed = true; stopGL(); landingLoop(); };      // too slow even on Low → CSS version for this session
{ const ro = new ResizeObserver(() => { if (NeonGL.running) NeonGL.relayout(glLayout()); });
  ro.observe($("empty")); ro.observe($("sign").parentElement); ro.observe($("sign")); }   // the hero re-centres when its text changes
document.fonts?.ready.then(() => { if (NeonGL.running) NeonGL.relayout(glLayout()); });
$("emblem").addEventListener("pointerenter", () => NeonGL.hover(true));
$("emblem").addEventListener("pointerleave", () => NeonGL.hover(false));

function landingLoop(){
  placeHorizon();
  cancelAnimationFrame(landRaf);
  const c = $("motes"), visible = !$("empty").classList.contains("hidden") && !document.hidden;
  if (glWanted() && startGL()) {
    document.body.classList.add("gl-sign"); NeonGL.setQuality(settings.fxQuality);
    c.getContext("2d").clearRect(0, 0, c.width, c.height); return;
  }
  stopGL();                                         // hidden, Calm/Still, orb style or no WebGL2 → CSS version, GPU memory freed
  if (!visible || landingFxLevel() !== "full" || settings.landingStyle === "simple") { c.getContext("2d").clearRect(0, 0, c.width, c.height); return; }
  buildMote();
  if (!motes.length) motes = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), r: 2 + Math.random() * 5, s: .00025 + Math.random() * .0007, p: Math.random() * 6.28, w: .3 + Math.random() * .7 }));
  const frame = t => {
    landRaf = requestAnimationFrame(frame);
    if (t - landLast < 33) return; landLast = t;               // ~30 fps is plenty
    if (!moteColor) buildMote();
    const dpr = devicePixelRatio || 1, W = c.clientWidth * dpr, H = c.clientHeight * dpr;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext("2d"); g.clearRect(0, 0, W, H);
    const neonSign = settings.landingStyle !== "orb";
    g.globalCompositeOperation = !neonSign && document.documentElement.dataset.theme === "light" ? "source-over" : "lighter";
    for (const m of motes) {
      m.y -= m.s; m.x += Math.sin(t / 2400 + m.p) * .00018;
      if (m.y < -.05) { m.y = 1.05; m.x = Math.random(); }
      const tw = .35 + .65 * Math.abs(Math.sin(t / 900 * m.w + m.p));
      g.globalAlpha = tw * .8; const sz = m.r * (neonSign ? 2.3 : 4) * dpr;
      g.drawImage(moteSprite, m.x * W - sz / 2, m.y * H - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;
  };
  landRaf = requestAnimationFrame(frame);
}
$("empty").addEventListener("pointermove", e => {
  const r = $("empty").getBoundingClientRect();
  $("empty").style.setProperty("--mx", e.clientX - r.left + "px"); $("empty").style.setProperty("--my", e.clientY - r.top + "px");
});
document.addEventListener("visibilitychange", landingLoop);
$("ver").textContent = "v" + VERSION;
// Rainbow mode recolours the motes each frame from the animated CSS colour
setInterval(() => { if (document.body.classList.contains("neon-rainbow") && !document.body.classList.contains("gl-sign") && !$("empty").classList.contains("hidden")) moteColor = ""; }, 400);

window.__lumen = { gl: () => NeonGL.stats(), glOn: () => NeonGL.running, get settings(){ return settings; }, get geo(){ return geo; }, get pic(){ return pic; }, get box(){ return box; }, zoomAt: (...a) => zoomAt(...a), get subs(){ return subs; }, get AG(){ return AG; }, keyMap: () => keyMap, get chapters(){ return chapters; }, get saved(){ return saved; }, get list(){ return list; }, get idx(){ return idx; }, afterPlayback: () => afterPlayback(), dragPos };
})();
