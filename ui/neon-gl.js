// Lumen — GPU-rendered neon home screen (WebGL2).
//
//   scene pass (HDR)  : sky + haze + beams follow the cursor, wet perspective grid with a
//                       rippling reflection of the sign, horizon, the sign itself (emissive),
//                       a spark racing round the ring, and thousands of spark trails (instanced)
//   bloom             : soft-threshold prefilter → 13-tap downsample chain → tent upsample
//   composite         : scene + bloom, ACES tone map, vignette, dither
//
// The sign's shapes come from a small 2D canvas (tube body in G, white-hot core in R) that is
// only re-uploaded when the intro / flicker state changes; colour flow is done in the shader.
// app.js falls back to the CSS version whenever this returns false or the context is lost.
"use strict";
window.NeonGL = (() => {
  const QUALITY = {
    high:     { scale: 1.0,  sparks: 4200, levels: 6, maxDpr: 1.5 },
    balanced: { scale: .8,   sparks: 2200, levels: 5, maxDpr: 1.25 },
    low:      { scale: .6,   sparks: 900,  levels: 4, maxDpr: 1 },
  };
  const ORDER = ["high", "balanced", "low"];
  let canvas, host, gl, ok = false, hdr = false, P = {}, quadBuf, sparkVAO, quadVAO, fbos = null;
  let signTex, sCanvas, sctx, signKey = "", layout = null, colors = [[1, .7, .3], [1, .5, .35], [1, .3, .6]];
  let running = false, raf = 0, t0 = 0, lastFrame = 0, quality = "high", auto = true, frameTimes = [], surgeAt = -10, hover = false;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, on: 0, target: 0 };
  let stats = { frames: 0, fps: 0, uploads: 0, quality: "high", sparks: 0, hdr: false };

  /* ---------------- shaders ---------------- */
  const VS_QUAD = `#version 300 es
in vec2 a; out vec2 uv; void main(){ uv = a * .5 + .5; gl_Position = vec4(a, 0., 1.); }`;

  const COMMON = `#version 300 es
precision highp float;
uniform vec3 uC1, uC2, uC3;
vec3 palette(float f){ f = fract(f) * 3.; return f < 1. ? mix(uC1, uC2, f) : f < 2. ? mix(uC2, uC3, f - 1.) : mix(uC3, uC1, f - 2.); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
`;

  const FS_SCENE = COMMON + `
in vec2 uv; out vec4 o;
uniform vec2 uRes; uniform float uTime, uHz, uMouseOn, uIntensity, uSpark, uCalm;
uniform vec2 uMouse; uniform vec4 uSignRect; uniform vec3 uEmb; uniform float uSplit; uniform sampler2D uSign;
vec3 signEmit(vec2 p){
  vec2 st = (p - uSignRect.xy) / uSignRect.zw;
  if (st.x < 0. || st.y < 0. || st.x > 1. || st.y > 1.) return vec3(0);
  vec4 s = texture(uSign, st);
  vec3 col = st.y < uSplit ? palette(atan(p.y - uEmb.y, p.x - uEmb.x) / 6.2832 + uTime * .11)
                           : palette(st.x * .85 + uTime * .05 + .15);
  return (col * s.g * 2.6 + mix(col, vec3(1), .42) * s.r * 2.1) * uIntensity;   // saturated tube, hot but still coloured core
}
float gridLine(float x, float th){
  float w = fwidth(x), d = abs(fract(x + .5) - .5);
  return (1. - smoothstep(th, th + w * 1.5, d)) * clamp(1. - (w - .08) * 2.6, 0., 1.);   // lines finer than ~2px fade out: no moiré
}
void main(){
  vec2 R = uRes, p = vec2(uv.x * R.x, (1. - uv.y) * R.y);
  vec2 sc = vec2(uEmb.x, uEmb.y);
  // where the light "looks": drifts toward the cursor
  vec2 m = mix(vec2(R.x * .5, uHz * .6), uMouse, .35 * uMouseOn);
  float above = step(p.y, uHz);
  // sky
  float gy = clamp(p.y / max(uHz, 1.), 0., 1.);
  vec3 col = mix(vec3(.016, .016, .04), vec3(.04, .022, .085) + uC2 * .05, gy) * above;
  // haze behind the sign, pulled toward the cursor
  vec2 hc = mix(sc, uMouse, .22 * uMouseOn);
  float hd = length((p - hc) / vec2(R.x * .42, R.y * .36));
  col += uC2 * .2 * exp(-hd * hd * 1.8) + uC3 * .05 * exp(-pow(length((p - vec2(R.x * .5, 0.)) / R), 2.) * 3.);
  col += uC1 * .07 * exp(-dot(p - uMouse, p - uMouse) / (190. * 190.)) * uMouseOn;      // cursor light
  // beams from the horizon, swinging with time and with the cursor
  vec2 pv = vec2(R.x * .5 + (uMouse.x - R.x * .5) * .12 * uMouseOn, uHz);
  vec2 v = p - pv;
  if (v.y < 0.) {
    float ang = atan(v.x, -v.y), len = length(v);
    float mx = (uMouse.x / R.x - .5) * uMouseOn, my = 1. - uMouse.y / R.y * uMouseOn;
    for (int i = 0; i < 2; i++) {
      float side = i == 0 ? -1. : 1.;
      float a0 = side * (.5 + .18 * sin(uTime * .33 * (1. - .7 * uCalm) + float(i) * 2.7)) + mx * .7;
      float b = exp(-pow((ang - a0) / (.075 + len / R.y * .05), 2.)) * smoothstep(0., 80., len) * exp(-len / (R.y * 1.15));
      col += (i == 0 ? uC1 : uC3) * b * (.13 + .07 * my);
    }
  }
  // wet floor
  if (p.y > uHz) {
    float d = p.y - uHz, H = R.y - uHz;
    float z = 2400. / (d + 2.);
    float gu = (p.x - R.x * .5) / (d + 2.) * 3.6, gv = z + uTime * 1.25 * (1. - .75 * uCalm);
    float fade = smoothstep(2., 70., d);
    vec2 pc = vec2(R.x * .5, uHz + .22 * H);
    float pool = mix(.06, 1., smoothstep(.38, 1., length((p - pc) / vec2(R.x * .36, H * .7))));
    float g = max(gridLine(gu, .012), gridLine(gv, .02)) * fade * pool * smoothstep(0., 40., d);
    vec3 base = vec3(.014, .01, .026);
    float wet = .5 + .5 * noise(vec2(gu * .35, z * .02));                                     // puddles
    vec2 rip = vec2(sin(p.y * .11 - uTime * 2.1 + sin(p.x * .021) * 2.) * 2.2,
                    sin(p.x * .047 + uTime * 1.5) * 1.3) * (.35 + d * .018) * (.6 + wet * .6);
    vec3 refl = signEmit(vec2(p.x, 2. * uHz - p.y) + rip) * .5 * exp(-d * .013) * (.5 + wet * .6);
    refl += col * .22 * exp(-d * .012);                                                        // sky & beams reflect too
    float streakW = 26. + d * .28;
    refl += uC1 * .32 * exp(-pow((p.x - uMouse.x) / streakW, 2.)) * exp(-d / 240.) * uMouseOn * wet; // wet streak under the cursor
    refl += vec3(1, .95, .9) * .12 * exp(-pow((p.x - sc.x) / (18. + d * .2), 2.)) * exp(-d / 160.);
    col = base + refl * mix(.45, 1., pool) + mix(uC2, uC1, smoothstep(0., H, d) * .5) * g * (.42 + .3 * wet) + mix(uC2, vec3(1), .5) * g * .12;
  }
  // horizon
  float hl = exp(-pow((p.y - uHz) / 1.3, 2.)) * smoothstep(0., .25, uv.x) * smoothstep(1., .75, uv.x);
  col += mix(mix(uC1, vec3(1), smoothstep(.2, .5, uv.x)), uC3, smoothstep(.5, .8, uv.x)) * hl * 2.6;
  // the sign
  col += signEmit(p);
  // a spark racing round the ring, with a tail
  if (uSpark > 0.) {
    float ah = -1.5708 + fract(uTime / 3.4) * 6.2832;
    vec2 head = sc + uEmb.z * vec2(cos(ah), sin(ah));
    float ap = atan(p.y - sc.y, p.x - sc.x);
    float da = mod(ah - ap, 6.2832);
    float rd = abs(length(p - sc) - uEmb.z);
    float s = exp(-dot(p - head, p - head) / 16.) * 5. + exp(-da * 6.) * exp(-rd * rd / 5.) * 1.6;
    col += mix(uC1, vec3(1), .7) * s * uSpark;
  }
  o = vec4(col, 1.);
}`;

  const VS_SPARK = `#version 300 es
precision highp float;
in vec2 aCorner; in vec4 aSeed;
uniform vec2 uRes, uMouse; uniform float uTime, uHz, uMouseOn, uCalm; uniform vec3 uC1, uC3;
out float vAlong, vAcross, vFade; out vec3 vCol;
vec2 pos(vec4 s, float age){
  float W = uRes.x, H = uRes.y;
  float sx = W * (.5 + (s.x - .5) * mix(.45, 1.15, s.y));
  float sy = uHz + (H - uHz) * pow(s.z, 1.4) * .95 + 6.;
  float rise = mix(18., 70., s.y) * (1. - .55 * uCalm);
  float y = sy - rise * age - 3. * age * age;
  float x = sx + sin(age * mix(.7, 2.1, s.w) + s.x * 40.) * mix(5., 28., s.z) + (s.w - .5) * 22. * age;
  vec2 p = vec2(x, y), dm = p - uMouse; float dl = length(dm);
  p += dm / max(dl, 1.) * uMouseOn * 110. * exp(-dl * dl / (160. * 160.));    // sparks swirl away from the cursor
  return p;
}
void main(){
  float life = mix(3.2, 8.5, fract(aSeed.w * 7.31));
  float age = mod(uTime + aSeed.x * life * 13.7, life), lf = age / life;
  vec2 head = pos(aSeed, age), tail = pos(aSeed, max(age - .11, 0.));
  vec2 d = head - tail; float len = max(length(d), .5); vec2 dir = d / len, nrm = vec2(-dir.y, dir.x);
  float w = mix(.35, 1.05, pow(fract(aSeed.y * 5.31), 2.));
  vec2 p = mix(tail - dir * w, head + dir * w, aCorner.x) + nrm * aCorner.y * w * 1.7;
  vAlong = aCorner.x; vAcross = aCorner.y;
  vFade = sin(3.14159 * lf) * smoothstep(0., uRes.y * .25, head.y) * mix(.25, 1., pow(fract(aSeed.z * 9.1), 3.));
  vCol = mix(uC1, uC3, step(.55, fract(aSeed.z * 3.71)));
  gl_Position = vec4(p.x / uRes.x * 2. - 1., 1. - p.y / uRes.y * 2., 0., 1.);
}`;
  const FS_SPARK = `#version 300 es
precision highp float;
in float vAlong, vAcross, vFade; in vec3 vCol; out vec4 o;
void main(){
  float a = pow(vAlong, 1.7) * exp(-vAcross * vAcross * 3.2);
  o = vec4(mix(vCol, vec3(1), .5 * vAlong * vAlong) * a * vFade * .9, 1.);
}`;

  const FS_PREFILTER = COMMON + `
in vec2 uv; out vec4 o; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThr;
vec3 tap(vec2 o2){ return texture(uTex, uv + o2 * uTexel).rgb; }
void main(){
  vec3 c = tap(vec2(0)) * .5 + (tap(vec2(-1, -1)) + tap(vec2(1, -1)) + tap(vec2(-1, 1)) + tap(vec2(1, 1))) * .125;
  float br = max(c.r, max(c.g, c.b)), knee = uThr * .6;
  float soft = clamp(br - uThr + knee, 0., 2. * knee); soft = soft * soft / (4. * knee + 1e-4);
  o = vec4(c * max(soft, br - uThr) / max(br, 1e-4), 1.);
}`;
  const FS_DOWN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uTex; uniform vec2 uTexel;
vec3 t(float x, float y){ return texture(uTex, uv + vec2(x, y) * uTexel).rgb; }
void main(){                                          // 13-tap (Jimenez 2014)
  vec3 a = t(-2.,-2.), b = t(0.,-2.), c = t(2.,-2.), d = t(-1.,-1.), e = t(1.,-1.), f = t(-2.,0.), g = t(0.,0.),
       h = t(2.,0.), i = t(-1.,1.), j = t(1.,1.), k = t(-2.,2.), l = t(0.,2.), m = t(2.,2.);
  vec3 r = (d + e + i + j) * .125 + (a + b + f + g) * .03125 + (b + c + g + h) * .03125 + (f + g + k + l) * .03125 + (g + h + l + m) * .03125;
  o = vec4(r, 1.);
}`;
  const FS_UP = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uRadius;
vec3 t(float x, float y){ return texture(uTex, uv + vec2(x, y) * uTexel * uRadius).rgb; }
void main(){                                          // 9-tap tent
  vec3 r = t(0.,0.) * 4. + (t(-1.,0.) + t(1.,0.) + t(0.,-1.) + t(0.,1.)) * 2. + t(-1.,-1.) + t(1.,-1.) + t(-1.,1.) + t(1.,1.);
  o = vec4(r / 16., 1.);
}`;
  const FS_COMPOSITE = COMMON + `
in vec2 uv; out vec4 o; uniform sampler2D uScene, uBloom; uniform float uBloomK, uExposure;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
void main(){
  vec3 c = texture(uScene, uv).rgb + texture(uBloom, uv).rgb * uBloomK;
  c = aces(c * uExposure);
  c = max(mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, 1.22), 0.);                     // keep neon colourful after bloom
  vec2 q = uv - .5; c *= 1. - dot(q, q) * .55;                                              // vignette
  c += (hash(gl_FragCoord.xy + fract(uExposure * 91.)) - .5) / 255.;                       // dither: no banding
  o = vec4(c, 1.);
}`;

  /* ---------------- GL plumbing ---------------- */
  function compile(vs, fs){
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "a"); gl.bindAttribLocation(p, 0, "aCorner"); gl.bindAttribLocation(p, 1, "aSeed");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  function tex(w, h, filter){
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h){ const t = tex(w, h); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f, w, h }; }
  function freeTargets(){
    if (!fbos || !gl) return;
    for (const r of [fbos.scene, ...fbos.mips]) { gl.deleteTexture(r.t); gl.deleteFramebuffer(r.f); }
    fbos = null;
  }
  function buildTargets(){
    freeTargets();
    const q = QUALITY[quality], dpr = Math.min(devicePixelRatio || 1, q.maxDpr);
    const W = Math.max(2, Math.round(canvas.clientWidth * dpr * q.scale)), H = Math.max(2, Math.round(canvas.clientHeight * dpr * q.scale));
    canvas.width = W; canvas.height = H;
    const mips = []; let w = W >> 1, h = H >> 1;
    for (let i = 0; i < q.levels && w >= 4 && h >= 4; i++) { mips.push(target(w, h)); w >>= 1; h >>= 1; }
    fbos = { scene: target(W, H), mips, W, H };
  }

  function init(c, hostEl){
    canvas = c; host = hostEl;
    try {
      gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "high-performance", desynchronized: true });
      if (!gl) return (ok = false);
      // A software rasteriser (no working GPU driver) would burn the CPU: use the CSS version instead.
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      stats.renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      if (/swiftshader|llvmpipe|softpipe|basic render|software/i.test(stats.renderer) && !window.__lumenAllowSoftwareGL) { stats.software = true; return (ok = false); }
      hdr = !!gl.getExtension("EXT_color_buffer_float");
      P.scene = compile(VS_QUAD, FS_SCENE); P.spark = compile(VS_SPARK, FS_SPARK);
      P.pre = compile(VS_QUAD, FS_PREFILTER); P.down = compile(VS_QUAD, FS_DOWN); P.up = compile(VS_QUAD, FS_UP); P.comp = compile(VS_QUAD, FS_COMPOSITE);
      quadVAO = gl.createVertexArray(); gl.bindVertexArray(quadVAO);
      quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      sparkVAO = gl.createVertexArray(); gl.bindVertexArray(sparkVAO);
      const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const n = QUALITY.high.sparks, seeds = new Float32Array(n * 4);
      for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
      const sb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sb); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
      gl.bindVertexArray(null);
      signTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, signTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      sCanvas = document.createElement("canvas"); sctx = sCanvas.getContext("2d");
      canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); ok = false; stop(); NeonGL.onlost && NeonGL.onlost(); });
      host.addEventListener("pointermove", e => { const r = host.getBoundingClientRect(); mouse.tx = e.clientX - r.left; mouse.ty = e.clientY - r.top; mouse.target = 1; });
      host.addEventListener("pointerleave", () => { mouse.target = 0; });
      stats.hdr = hdr;
      return (ok = true);
    } catch (e) { console.warn("NeonGL unavailable:", e); return (ok = false); }
  }

  /* ---------------- the sign (shapes only; colour is applied in the shader) ---------------- */
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const keys = (t, d, frames) => {            // piecewise-linear opacity keyframes like the CSS ones
    if (t < 0) return frames[0][1]; const p = t / d; if (p >= 1) return frames[frames.length - 1][1];
    for (let i = 1; i < frames.length; i++) if (p <= frames[i][0]) { const [a, va] = frames[i - 1], [b, vb] = frames[i]; return va + (vb - va) * (p - a) / (b - a); }
    return 1;
  };
  const IGNITE = [[0, .06], [.06, 1], [.09, .25], [.13, 1], [.17, .45], [.22, 1], [1, 1]];
  const FLICK = [[0, 1], [.08, .2], [.12, 1], [.26, .45], [.3, 1], [1, 1]];
  const BUZZ = [[0, 1], [.91, 1], [.92, .2], [.93, 1], [.95, .35], [.965, 1], [1, 1]];
  function signState(t, calm){
    const draw = ease(Math.min(1, Math.max(0, (t - .2) / 1.7)));
    const emb = keys(t - 1.9, .9, FLICK);
    const letters = [0, 1, 2, 3, 4].map(i => {
      let a = t < 1.95 + .12 * i ? 0 : keys(t - 1.95 - .12 * i, 1.3, IGNITE);
      if (i === 3 && !calm && t > 6) a *= keys((t - 6) % 7, 7, BUZZ);
      return Math.round(a * 20) / 20;
    });
    return { draw: Math.round(draw * 200) / 200, emb: Math.round(emb * 20) / 20, letters };
  }
  function drawSign(st){
    const L = layout, k = L.texScale;
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, sCanvas.width, sCanvas.height);
    sctx.setTransform(k, 0, 0, k, -L.sign.x * k, -L.sign.y * k);
    sctx.lineCap = "round"; sctx.lineJoin = "round";
    const { cx, cy, u } = L.emb, p = st.draw;
    const shapes = () => {
      sctx.beginPath(); sctx.arc(cx, cy, 82 * u, 0, Math.PI * 2 * p); sctx.stroke();
      const r20 = -20 * Math.PI / 180;
      sctx.beginPath(); sctx.arc(cx, cy, 70 * u, -Math.PI / 2 + r20, -Math.PI / 2 + r20 + Math.PI / 2 * p); sctx.stroke();
      sctx.beginPath(); sctx.arc(cx, cy, 70 * u, Math.PI / 2 + r20, Math.PI / 2 + r20 + Math.PI / 2 * p); sctx.stroke();
      const pts = [[-16, -36], [40, 0], [-16, 36], [-16, -36]].map(([x, y]) => [cx + x * u, cy + y * u]);
      const segs = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1])), total = segs.reduce((a, b) => a + b);
      let left = total * p; sctx.beginPath(); sctx.moveTo(...pts[0]);
      for (let i = 0; i < segs.length && left > 0; i++) { const f = Math.min(1, left / segs[i]); sctx.lineTo(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f); left -= segs[i]; }
      sctx.stroke();
    };
    if (p > 0) {
      sctx.globalAlpha = st.emb;
      sctx.strokeStyle = "rgb(0,255,0)"; sctx.lineWidth = 7 * u; shapes();      // tube body → G
      sctx.strokeStyle = "rgb(255,255,0)"; sctx.lineWidth = 2.3 * u; shapes();  // hot core → R
    }
    sctx.font = L.font; sctx.textBaseline = "alphabetic";
    L.letters.forEach((g, i) => {
      const a = st.letters[i]; if (!a) return;
      sctx.globalAlpha = a;
      sctx.lineWidth = L.fs * .085; sctx.strokeStyle = "rgb(0,255,0)"; sctx.strokeText(g.ch, g.x, g.y);
      sctx.fillStyle = "rgb(255,255,0)"; sctx.fillText(g.ch, g.x, g.y);
    });
    sctx.globalAlpha = 1;
    gl.bindTexture(gl.TEXTURE_2D, signTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, sCanvas);
    stats.uploads++;
  }

  /* ---------------- frame ---------------- */
  function setQuality(q){
    auto = q === "auto";
    const next = auto ? (quality || "high") : q;
    if (next !== quality) { quality = next; if (running) buildTargets(); }
    stats.quality = quality;
  }
  function relayout(L){
    const w = Math.ceil(L.sign.w * L.texScale), h = Math.ceil(L.sign.h * L.texScale);
    if (w !== sCanvas.width || h !== sCanvas.height) { sCanvas.width = w; sCanvas.height = h; }
    layout = L; signKey = "";                      // the frame loop resizes render targets itself if needed
  }
  function setColors(c){ colors = c; }
  function surge(){ surgeAt = (performance.now() - t0) / 1000; }
  function start(L, opt = {}){
    if (!ok) return false;
    if (opt.quality) setQuality(opt.quality);
    relayout(L);
    if (running) return true;
    running = true; t0 = performance.now(); lastFrame = 0; frameTimes = []; signKey = "";
    buildTargets();
    raf = requestAnimationFrame(frame);
    return true;
  }
  function stop(){ running = false; cancelAnimationFrame(raf); freeTargets(); }   // GPU memory is released while hidden

  function drawQuad(prog, fbo, w, h, setup){
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p); setup && setup(prog.u);
    gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function frame(now){
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const minDt = quality === "low" ? 31 : 15.5;                 // cap: 60 fps (30 on low) even on 144 Hz screens
    if (lastFrame && now - lastFrame < minDt) return;
    const dt = lastFrame ? now - lastFrame : 16; lastFrame = now;
    frameTimes.push(dt); if (frameTimes.length > 30) frameTimes.shift();
    if (auto && frameTimes.length === 30) {                       // watchdog: step down quickly if the GPU can't keep up
      const avg = frameTimes.reduce((a, b) => a + b, 0) / 30;
      if (avg > 28 && quality !== "low") { quality = ORDER[Math.min(2, ORDER.indexOf(quality) + (avg > 60 ? 2 : 1))]; stats.quality = quality; frameTimes = []; buildTargets(); }
      else if (avg > 50 && quality === "low") { stop(); stats.gaveUp = true; NeonGL.onslow && NeonGL.onslow(); return; }
    }
    if (canvas.width !== Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, QUALITY[quality].maxDpr) * QUALITY[quality].scale)) buildTargets();
    const t = (now - t0) / 1000, L = layout, calm = L.calm ? 1 : 0;
    // smooth cursor
    mouse.on += (mouse.target - mouse.on) * .06; mouse.x += (mouse.tx - mouse.x) * .1; mouse.y += (mouse.ty - mouse.y) * .1;
    if (!mouse.x && !mouse.y) { mouse.x = mouse.tx = L.w / 2; mouse.y = mouse.ty = L.hz * .5; }
    const st = signState(t, L.calm), key = JSON.stringify(st);
    if (key !== signKey) { signKey = key; drawSign(st); }
    const hum = t > 2.8 ? 1 + .22 * (.5 - .5 * Math.cos((t - 2.8) / (hover ? 1.2 : 4.2) * 2 * Math.PI)) : 1;
    const surgeK = 1 + 1.6 * Math.exp(-Math.max(0, t - surgeAt) * 6) * (t >= surgeAt ? 1 : 0);
    const q = QUALITY[quality], W = fbos.W, H = fbos.H;
    const [c1, c2, c3] = colors;
    const common = u => { gl.uniform3fv(u.uC1, c1); gl.uniform3fv(u.uC2, c2); gl.uniform3fv(u.uC3, c3); };
    gl.disable(gl.BLEND);
    // 1. scene
    drawQuad(P.scene, fbos.scene.f, W, H, u => {
      common(u);
      gl.uniform2f(u.uRes, L.w, L.h); gl.uniform1f(u.uTime, t); gl.uniform1f(u.uHz, L.hz);
      gl.uniform2f(u.uMouse, mouse.x, mouse.y); gl.uniform1f(u.uMouseOn, mouse.on);
      gl.uniform1f(u.uIntensity, hum * surgeK * (hdr ? 1 : .5)); gl.uniform1f(u.uSpark, Math.min(1, Math.max(0, (t - 2.4) / .5)) * (hdr ? 1 : .5));
      gl.uniform1f(u.uCalm, calm);
      gl.uniform4f(u.uSignRect, L.sign.x, L.sign.y, L.sign.w, L.sign.h); gl.uniform3f(u.uEmb, L.emb.cx, L.emb.cy, 82 * L.emb.u);
      gl.uniform1f(u.uSplit, L.split);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, signTex); gl.uniform1i(u.uSign, 0);
    });
    // 2. sparks, additive, into the scene so they bloom too
    const n = Math.round(q.sparks * (calm ? .45 : 1) * Math.min(1, Math.max(0, (t - .6) / 1.5)));
    stats.sparks = n;
    if (n > 0) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.spark.p); const u = P.spark.u;
      gl.uniform2f(u.uRes, L.w, L.h); gl.uniform2f(u.uMouse, mouse.x, mouse.y); gl.uniform1f(u.uTime, t); gl.uniform1f(u.uHz, L.hz);
      gl.uniform1f(u.uMouseOn, mouse.on); gl.uniform1f(u.uCalm, calm); gl.uniform3fv(u.uC1, c1); gl.uniform3fv(u.uC3, c3);
      gl.bindVertexArray(sparkVAO); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
    }
    // 3. bloom: prefilter + downsample chain, then tent upsample back up (additive)
    const m = fbos.mips;
    drawQuad(P.pre, m[0].f, m[0].w, m[0].h, u => { common(u); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.scene.t); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uTexel, 1 / W, 1 / H); gl.uniform1f(u.uThr, hdr ? .75 : .38); });
    for (let i = 1; i < m.length; i++) drawQuad(P.down, m[i].f, m[i].w, m[i].h, u => { gl.bindTexture(gl.TEXTURE_2D, m[i - 1].t); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uTexel, 1 / m[i - 1].w, 1 / m[i - 1].h); });
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = m.length - 1; i > 0; i--) drawQuad(P.up, m[i - 1].f, m[i - 1].w, m[i - 1].h, u => { gl.bindTexture(gl.TEXTURE_2D, m[i].t); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uTexel, 1 / m[i].w, 1 / m[i].h); gl.uniform1f(u.uRadius, 1); });
    gl.disable(gl.BLEND);
    // 4. composite to screen
    drawQuad(P.comp, null, W, H, u => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.scene.t); gl.uniform1i(u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, m[0].t); gl.uniform1i(u.uBloom, 1); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(u.uBloomK, (hdr ? .62 : 1.24) * (L.bloom ?? 1)); gl.uniform1f(u.uExposure, hdr ? 1.05 : 2.1);
    });
    stats.frames++;
    if (stats.frames % 15 === 0 && frameTimes.length) stats.fps = Math.round(1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length));
  }

  return {
    get supported(){ try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } },
    get ok(){ return ok; }, get running(){ return running; },
    init, start, stop, relayout, setColors, setQuality, surge,
    hover(on){ hover = on; },
    stats: () => ({ ...stats }),
    debug: () => ({ layout, sw: sCanvas.width, sh: sCanvas.height, cw: canvas.width, ch: canvas.height, url: sCanvas.toDataURL() }),
  };
})();
