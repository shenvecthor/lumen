# Changelog

All notable changes to Lumen. Downloads for each version are on the [Releases page](../../releases).

## 1.7.0 — plays practically anything

- **Extended engine:** formats Windows' built-in player can't handle now play automatically through a bundled libmpv + FFmpeg engine (LGPL builds, x64 and ARM64): AVI/DivX/Xvid, WMV, MPEG, VOB, TS/M2TS, FLV, HEVC, Dolby Digital, DTS and TrueHD audio, APE, WMA and more, plus Blu-ray and DVD subtitles and full ASS styling. Lumen reads each file's header to pick the engine and says why when it switches.
- Every feature works on both engines: seek previews, chapters, audio and subtitle tracks, subtitle styling, adjustments, EQ, zoom, rotation, ambient light, statistics, snapshots and thumbnails.
- Settings → General → *Playback engine*: Automatic, Always extended, or Built-in only.
- **Installer** (per-user, no admin prompt; Start menu, Open with and Default Apps registration) and **portable zips**, for x64 and ARM64.
- Dropped files now open with their real paths, so they can use the extended engine and folder features.

## 1.6.1

- Fixed a brief flash of the old neon start screen before the simple one appeared.
- The neon glow around buttons, sliders and panels is now off by default (Settings → Appearance, or Shift+G).
- Publisher: Shane Sahadeo, shown in About and in the exe's Properties → Details.

## 1.6 — lighter, and borrowed from MPC-HC

- **Simpler start screen** by default: the logo, the name and the open buttons, with one soft breathing glow and nothing running in the background. The neon sign and light orb remain available in Settings → Appearance.
- **Right-click quick menu** anywhere in the window (also the Menu key / Shift+F10).
- **Movable windows:** drag the adjustments panel, subtitle popup, statistics box and dialogs by their title; double-click the title to put them back.
- **Chapters** in MKV/WebM: seek-bar ticks, names in the seek tooltip, Navigate → Chapters.
- **Smart Next / Previous** (PageDown / PageUp) through chapters, then the playlist, then the folder.
- **Next / previous file in folder** (Ctrl+PageDown / Ctrl+PageUp).
- **Audio track switching** (Ctrl+A).
- **Go to** a time or percentage (Ctrl+G).
- **Statistics** overlay (Ctrl+J).
- **Volume normalization.**
- **Video size 50 / 100 / 200 %** (Alt+1 / 2 / 3).
- **After playback** actions, including sleep, hibernate and shutdown with a cancellable countdown.
- **Favorites** that remember the position (Ctrl+D).
- **Recent files**, opt-in only.
- **M3U / M3U8 playlists**: open and save (Ctrl+S).
- **Save thumbnails** contact sheet (Ctrl+T).
- **Minimal view** (Ctrl+1).
- Configurable speed step.

## 1.5 — GPU neon

- The neon start screen is rendered with WebGL2: real HDR bloom, a wet reflective floor, thousands of GPU spark trails and light that follows the cursor. Quality steps down automatically and falls back to CSS when needed.
- Optimizations: the visualizer stops while paused or minimized; no background blur behind panels and dialogs; lighter ambient light; a much faster playlist for large folders.

## 1.4

- Touchpad pinch-to-zoom now behaves exactly like pinching a web page, anchored under your fingers, with a rubber-band at the limits. The interface itself never zooms.
- No outlines on menus, panels, buttons and dialogs; focus shows as a soft fill or glow.
- New neon-sign start screen.

## 1.3 — light it up

- Pinch to zoom (touchpad, touchscreen, Ctrl+wheel) and moving around when zoomed, with a minimap.
- The window keeps the video's shape while resizing; Shift+F fits the window to the video.
- Faster opening: files opened while Lumen is running go to the existing window; subtitles and previews wait for the first frame.
- Neon look for controls (Off / Soft / Neon).
- New start screen with a breathing orb of light.
- More customization: interface font, seek-by-side double-click, swipe to seek, maximum zoom, and more.

## 1.2 — make it yours

- Subtitles drawn by Lumen inside the picture with a safe edge gap, and a subtitle studio with live preview.
- Themes (Dark, Midnight, Slate, Light) and accent colours.
- Ambient light, video adjustments with presets, aspect, zoom, rotate and mirror.
- 10-band equalizer, volume boost, balance, mono.
- Remappable keyboard shortcuts, configurable control bar and mouse.
- Seek-bar thumbnails, visualizer styles, sleep timer, starting speed and pitch, settings export/import.

## 1.1

- Embedded MKV subtitles (SRT, SSA/ASS, WebVTT).
- Lumen always starts with an empty player.
- Menu bar, Settings, Tools (media information, snapshots, A–B loop, subtitle delay).
- Fullscreen hides the controls, seek bar and cursor.

## 1.0

- First release: a lightweight Windows media player built on Go and Edge WebView2.
