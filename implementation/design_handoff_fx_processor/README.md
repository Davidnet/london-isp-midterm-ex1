# Handoff: Web Audio FX Processor (Direction A — Hardware)

## Overview
A single-screen web app that loads or imports a sound, runs it through a fixed effects
chain (low-pass → waveshaper → compressor → reverb → master), visualizes the original
and processed spectra in real time, and lets the user save effect presets and record
output to WAV. Saved sounds + their effect configs live in a library panel for
playback, editing, clearing, or deletion.

This handoff describes **Direction A — the "signal-chain dashboard"**: the signal flow
is shown as a tappable left-to-right chain across the top, and only the *selected*
stage's controls are open in a "NOW EDITING" module, so the screen never feels cramped
and it's always obvious which stage you're editing.

## About the design files
The files in this bundle are a **design reference created in HTML** — a prototype that
shows the intended look and behavior. **It is not production code to copy.** The task is
to **recreate this design as a real application** using the project's required
environment.

> ⚠️ **Hard constraint from the client: the app must be built in [p5.js](https://p5js.org/)
> + the [p5.sound](https://p5js.org/reference/#/libraries/p5.sound) library.** All audio
> (graph, effects, FFT, recording) and all UI (knobs, faders, meters, spectra) must be
> achievable in p5 — canvas drawing + p5.dom elements. Keep that in mind: every control
> in the mock was chosen to be p5-buildable.

`FX Processor A - Hardware.dc.html` is written in a small in-house "Design Component"
runtime (`support.js`) purely so it can be previewed in a browser. **Neither file is part
of the target app.** `support.js` is included only so you can open the `.dc.html` locally
to study look/behavior. Rebuild everything natively in p5.

## Fidelity
**High-fidelity VISUAL mock. Audio is NOT wired up.** Treat colors, type, spacing, layout
and the interaction model as the spec to match. The only behaviors actually implemented
in the mock are *visual state toggles* (selecting a chain stage, toggling a stage's
bypass, toggling the two record states). **You are building 100% of the audio engine.**
The hardware/skeuomorphic look (brushed panels, knurled knobs, screws, glowing LCDs) is
the visual target — reproduce it on the p5 canvas if feasible; if time-constrained,
prioritize the **layout + behavior** and approximate the finish.

---

## Signal flow (the audio graph)
Fixed order, matching the chain strip in the UI:

```
SOURCE → LOW-PASS → WAVESHAPER → COMPRESSOR → REVERB → MASTER → OUTPUT (device)
              │           │            │          │         │
         (each stage: bypass on/off, Dry/Wet mix, Output level)
```

- **SOURCE** = a `p5.SoundFile` (library sound, loaded with `loadSound`) **or** a
  `p5.AudioIn` (microphone, for the "record new source" flow).
- Connect stages with each effect's `.input` / `.connect()`:
  ```js
  src.disconnect();              // remove default route to main out
  src.connect(lowpass.input);
  lowpass.connect(waveshaper.input);
  waveshaper.connect(compressor.input);
  compressor.connect(reverb.input);
  reverb.connect(masterGain);    // p5.Gain
  masterGain.connect();          // → main output
  ```
- **Bypass** a stage by routing dry around it (or set its `drywet(0)` and `amp(1)`).
- Keep references to **pre-FX** (source) and **post-FX** (masterGain) nodes — the two
  spectrum analyzers tap those two points.

### Effect → p5.sound mapping & parameter ranges
Defaults below are the values shown in the mock; use them as the initial preset.

**Low-pass filter** — `p5.LowPass` (a `p5.Filter('lowpass')`)
- `Cutoff` → `.freq(hz)`, range ~20–20000 Hz (log). Mock default **1.24 kHz**.
- `Resonance` → `.res(q)`, range ~0–30. Mock default **4.0**.
- `Dry/Wet` → `.drywet(0..1)` (**0.60**) · `Output level` → `.amp(0..1)` (**0.50**).
- Stage **on** by default.

**Waveshaper distortion** — `p5.Distortion`
- `Distortion amount` → constructor arg / `.set(amount, oversample)`, 0–1. Mock **≈0.55 (+18 dB)**.
- `Oversample` → `'none' | '2x' | '4x'` (segmented control). Mock default **2×**.
- `Dry/Wet` **0.72** · `Output level` **0.50**. Stage **on**.

**Dynamic compressor** — `p5.Compressor`
- `Threshold` → `.threshold(dB)`, −100–0. Mock **−24 dB**.
- `Ratio` → `.ratio(1..20)`. Mock **4.0 : 1**.
- `Attack` → `.attack(s)`, 0–1 s. Mock **12 ms**.
- `Knee` → `.knee(dB)`, 0–40. Mock **6 dB**.
- `Release` → `.release(s)`, 0–1 s. Mock **180 ms**.
- `Dry/Wet` **1.00** · `Output level` **0.50**. Stage **OFF (bypassed)** by default in mock.

**Reverb** — `p5.Reverb`
- `Duration` → reverbTime via `.set(seconds, decay, reverse)`, ~0–10 s. Mock **2.4 s**.
- `Decay rate` → decay arg, 0–100. Mock **3.0**.
- `Reverse` → boolean (toggle). Mock **off**.
- `Dry/Wet` → `.drywet()` **0.70** · `Output level` → `.amp()` **0.55**. Stage **on**.
- (If `p5.Reverb` quality is insufficient, `p5.Convolver` with an impulse response is the alternative.)

**Master volume** — `p5.Gain` (the `masterGain` node above)
- `Volume` → `.amp(0..1)`. Mock **≈0.80 (−3 dB)**. This is the only always-relevant control
  and is reachable by selecting the **MASTER** chain node.

---

## Spectrum analyzers (the two LCD screens)
Two independent `p5.FFT` instances, drawn as glowing teal bar graphs:
- **Spectrum In (original):** `fftIn = new p5.FFT(); fftIn.setInput(src)` — taps the source, pre-FX.
- **Spectrum Out (processed):** `fftOut = new p5.FFT(); fftOut.setInput(masterGain)` — taps post-FX.
- Each frame: `const spec = fft.analyze();` (returns 0–255 array) → draw ~26–40 bars,
  bar height = `map(spec[i], 0, 255, 0, screenHeight)`. A thin animated vertical
  scan-line sweeps left→right (purely decorative). Frequency axis ticks: 50 / 200 / 1k / 5k / 20k.
- Both screens must be **always animating** while audio plays. The "Out" screen also
  hosts the **bounce-recording** overlay (see below).

---

## Transport controls
A `p5.SoundFile` provides everything:
- **Play / Pause** → `play()` / `pause()`.
- **Stop** → `stop()` (return playhead to 0).
- **Loop** → `setLoop(true/false)` (or `loop()`).
- **Skip to start** → `jump(0)`.
- **Output VU meter** (top-right): `p5.Amplitude` on `masterGain` → `getLevel()` mapped to
  a 14-segment meter (teal `#2ad4c8` for the low segments, amber `#e8b54d`, red `#e85d5d`
  near the top). Label reads `OUT -3 dB`.

---

## Adding sounds & recording ⭐
Two distinct ways audio enters the library: **importing a file** (a new dry source) and
**bouncing the processed output** to WAV. Bounce is the only real record operation and lights
the **Spectrum OUT** screen red while it runs.

### 1. ADD SOUND → import an audio file (new dry source)
Triggered by the dashed **+ ADD SOUND** card in the library. (This replaces the earlier
mic-capture idea — sources are pre-recorded files, so adding one is a **file import, not a
recording**.)
- Use a file picker / drag-drop: p5's `createFileInput(cb)` (gives a `p5.File`), or a hidden
  `<input type="file" accept="audio/*">` + drag-drop on the unit. Accept WAV / MP3 / AAC / OGG / FLAC.
- Decode to a playable buffer: `loadSound(file.data)` (the data-URL from `createFileInput`), or
  `loadSound(URL.createObjectURL(file))`.
- **No effects are applied** — the imported clip becomes a new *dry source*.
- Opens the **library dialog** (below) in *add* mode with a file preview + editable name; on
  confirm, add a library entry of type `file` with **no effect config** (dry).

### 2. ● REC (header) → **bounce** the processed output to WAV
Triggered by the header **● REC** button (`PROCESSED → WAV`).
- Plays the selected sound through the full chain and records the **master bus (post-FX)**.
- `recorder.setInput(masterGain)` (or, since the chain routes to main out, a default-input
  `p5.SoundRecorder` records everything post-FX). Start playback, `recorder.record(buf)`,
  then `recorder.stop()`.
- UI while recording: header button becomes `■ STOP / BOUNCING…`; the **Spectrum OUT**
  screen tints red with badge `● BOUNCE 00:08 · WAV`.
- On stop → prompt for a name → `save(buf, name + '.wav')`, and add a new library entry of
  type `bounce` with the **current effect config attached** (so it can be re-loaded/edited).

### Library dialog (one modal, two modes)
A hardware-styled modal overlays the unit (dim backdrop). It opens **on Add-sound (import)**
and **when a bounce stops**, and adapts:
- **Header:** add → `ADD A SOUND / IMPORT TO LIBRARY` (teal LED); bounce → `RECORDING CAPTURED
  / SAVE TO LIBRARY` (red LED). Close (✕).
- **Context badge:** add → teal `＋ NEW SOURCE · IMPORTED FILE · 0:04 · WAV`; bounce → teal
  `● BOUNCE · PROCESSED OUTPUT · 00:08 · WAV`.
- **Add mode — file zone:** a dashed drop zone with ▶ preview + waveform + `⤓ BROWSE`, and a
  selected-file row (`♪ drum-loop.wav · 0:04 · 320 kbps`, “drop a file to replace”). This is the
  file input / drag-drop target.
- **Bounce mode — preview:** an LCD strip with ▶, the captured waveform, and `WAV·48k`.
- **File name:** editable field with a default (`drum-loop` for add, `bounce-01` for bounce)
  and a fixed `.wav` suffix.
- **Add variant:** a note — *“Added as a dry source — no effects applied. Load it into the
  chain to add effects.”*
- **Bounce variant:** `EFFECTS BAKED IN` — chips for LOW-PASS / WAVESHAPER / COMPRESSOR /
  REVERB, lit (accent) if that stage was on, dimmed if bypassed — so it's explicit what got
  printed into the file.
- **Actions:** add → `CANCEL` + `＋ ADD TO LIBRARY`; bounce → `DISCARD`, `↻ RE-RECORD` (discard +
  re-arm the bounce), `⤓ SAVE TO LIBRARY`.
- **Implementation:** persist the audio (imported File blob, or the bounce's recorded buffer via
  `save(buf, name + '.wav')`); for `bounce`, store the current effect-config JSON alongside; for
  an imported `file`, store an empty/dry config.

---

## Sounds Library (panel + persistence)
A horizontal dock of cards; the active/loaded sound has an accent ring; each card has a
small LED (lit if it has an effect config), an `fx` summary line, and a **2×2 action grid**:

```
▶  EDIT
CLR DEL
```

- **▶ Play / load** — load this sound into the chain and play it.
- **EDIT** — load this sound's saved config into the editor for tweaking.
- **CLR** — clear effects (reset all stages to defaults / bypass) for this sound.
- **DEL** — delete the sound (and its audio + config).

### Data model
```js
LibraryItem = {
  id: string,
  name: string,
  type: 'file' | 'bounce',               // file = pre-recorded OR imported, bounce = processed output
  audio: <ref>,                          // see persistence
  config: {                              // null/empty for dry sources
    selected: 'reverb',
    master: { volume: 0.80 },
    lowpass:    { on:true,  cutoff:1240, res:4.0,  dw:0.60, ol:0.50 },
    waveshaper: { on:true,  amount:0.55, oversample:'2x', dw:0.72, ol:0.50 },
    compressor: { on:false, threshold:-24, ratio:4, attack:0.012, knee:6, release:0.18, dw:1.0, ol:0.50 },
    reverb:     { on:true,  duration:2.4, decay:3.0, reverse:false, dw:0.70, ol:0.55 }
  }
}
```

### Persistence
- **Pre-recorded "file" sounds**: loaded at startup "from the stored location" — i.e. an
  assets folder shipped with the app (the mock shows Sound 1–6). Load with `loadSound()` in
  `preload()`.
- **Effect configs + library index**: small JSON → `localStorage`.
- **Imported & bounced audio**: file/WAV blobs are too big for localStorage — store them in
  **IndexedDB** (Blob per item) and reference by `id`. (Persist position/last-loaded too if
  desired.)

---

## Interaction & state model
Global UI state (mirrors the mock's logic):
- `selected` — which chain stage is open in the editor (`'source' | 'lowpass' | 'waveshaper'
  | 'compressor' | 'reverb' | 'master' | 'out'`). Clicking a chain node sets this.
- `effects[*].on` — per-stage bypass. The chain-node micro-switch and the editor's
  title-strip toggle both flip this; LED + `ON`/`BYP` label reflect it; a bypassed stage's
  editor shows a `BYPASSED` tag.
- `recMode` — `'idle' | 'bounce'` (bounce recording); `modal` — `null | 'add' | 'bounce'`
  (the library dialog: import a file, or save a bounce).
- **Active-stage affordance:** the selected chain node gets a 2px accent ring + glow; the
  editor header reads `NOW EDITING / <STAGE NAME>`. This is the core UX win of Direction A —
  keep it unmistakable.

---

## Design tokens
**Accent (LEDs, indicators, active state, spectra):** `#2ad4c8` (teal, default).
Alternates offered as a cosmetic tweak: `#ff7a3d`, `#9b8cff`, `#e84d6b`.

**Panel finish (cosmetic tweak — default "Graphite"):**
- Graphite: plate `#3a3f47`→`#2b2f35`, engraving ink `#b3b9c1`
- Cream: plate `#e9e3d6`→`#d9d2c2`, ink `#4d473c`
- Black: plate `#282b30`→`#1a1c20`, ink `#c4c9d0`

**Desk backdrop:** radial `#24282f` → `#15171b` (52%) → `#0c0d10`.
**LCD screen:** `#08130f`→`#040b09` + 1px scanlines + inset shadow `inset 0 2px 10px rgba(0,0,0,.85)`; teal hairline border `rgba(42,212,200,.10)`.
**Record red:** active `#ff4d4d` (glow `0 0 9px`), idle dot `#5a2a2c`, badge bg `rgba(40,8,8,.8)`, text `#ffb3b3` / dim `#c98e8e`.
**VU colors:** teal `#2ad4c8`, amber `#e8b54d`, red `#e85d5d`.
**Metal (knobs/screws):** knurl `repeating-conic-gradient(#464c55 0 6deg, #2a2e34 6deg 12deg)`; cap `radial-gradient(circle at 38% 30%, #474c54, #20232a 74%)`; screw `radial-gradient(circle at 35% 30%, #7a8088, #34383e 72%)` with a rotated slot.

**Typography:**
- `Hanken Grotesk` (Google Fonts, weights 400–800) — all labels/engraving. Uppercase,
  letter-spacing ~.08–.22em for silkscreen feel.
- `Spline Sans Mono` (Google Fonts, 400–600) — all numeric readouts, screen text, captions.

**Geometry:** knobs Ø60px, knurled ring + dark cap + teal indicator; **indicator angle =
`-135° + value × 270°`** (value 0–1). Faders: recessed track (`inset 0 2px 4px rgba(0,0,0,.8)`)
with a chunky cap (`#5b616b`→`#2b2f35`) and a teal center line. Card radius 9–12px, button
radius 6–8px, panel radius 16px. Corner **screws** on the unit and on the editor module
(cosmetic tweak: on/off).

---

## Screens / states to build
1. **Main dashboard — idle** (a stage selected, audio paused/playing).
2. **Editing a stage** — selected node glows; editor populated with that stage's controls.
3. **Stage bypassed** — LED off, `BYP` label, editor shows `BYPASSED`.
4. **Add sound (import)** — `+ ADD SOUND` opens the library dialog with a file drop zone /
   browse + name; imported as a dry source.
5. **Bouncing processed output** — OUT screen red, header = STOP/BOUNCING, master capture.
6. **Library dialog** — overlays the unit; **add** mode (file zone + dry note) or **bounce**
   mode (waveform + baked-in effect chips). Add: Cancel / Add to library. Bounce: Discard /
   Re-record / Save.
7. **Empty library** — *(optional)* prompt to load a file or record one.

## Cosmetic tweaks (not required for function)
The mock exposes three look-only options you may ignore or surface as settings:
`accent` color, `finish` (Graphite/Cream/Black), and `screws` (on/off).

## Files in this bundle
- `FX Processor A - Hardware.dc.html` — the design reference (in-house preview format).
- `support.js` — preview runtime; **only** so the `.dc.html` opens in a browser. Not part of
  the target app. Open the `.dc.html` from this folder to study the design.

> To recreate the look/behavior, open the `.dc.html`, click each chain stage to see the
> editor change, toggle a stage's bypass switch, hit `+ ADD SOUND` for the import dialog, and
> the header `● REC` to bounce (OUT screen turns red → save dialog). Then build it natively in
> p5.js + p5.sound per the sections above.
