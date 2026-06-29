/*
 * sketch.js — Slice 1 main sketch: layout, render orchestration, input.
 *
 * Draws the whole unit in a fixed 1320-wide DESIGN SPACE that is scaled to fit
 * the window; mouse coords are inverted through that transform for hit-testing.
 * Clickable regions are collected each frame into `hot[]` (immediate-mode), so
 * adding interactions later is just pushing rects.
 *
 * Slice 1 wires: stage selection, per-stage bypass, transport, live spectra +
 * VU, REC→bounce. Knob/fader EDITING and the library/modal come in later slices.
 */

// ---- design-space geometry ----
const DW = 1320;
const RACK_H = 840;
const CL = 32,
  CR = 1288,
  CW = CR - CL; // inner content margins

let samples = []; // p5.SoundFile[] for sample1..6
const SAMPLE_NAMES = ['sample1', 'sample2', 'sample3', 'sample4', 'sample5', 'sample6'];

let gScale = 1,
  gOX = 0,
  gOY = 0; // design→screen transform
let hot = []; // immediate-mode click regions
let started = false; // audio powered on?
let drag = null; // active knob/fader drag (persists across frames)
let savedFlash = -10000; // millis() of last SAVE PRESET, for the "SAVED" flash

function preload() {
  for (const n of SAMPLE_NAMES) samples.push(loadSound('assets/' + n + '.wav'));
  // Fonts (canvas text). Keyed by weight to match the mock's type ramp.
  THEME.fonts.hank[400] = loadFont('fonts/hanken-grotesk/HankenGrotesk-Regular.ttf');
  THEME.fonts.hank[600] = loadFont('fonts/hanken-grotesk/HankenGrotesk-SemiBold.ttf');
  THEME.fonts.hank[700] = loadFont('fonts/hanken-grotesk/HankenGrotesk-Bold.ttf');
  THEME.fonts.hank[800] = loadFont('fonts/hanken-grotesk/HankenGrotesk-ExtraBold.ttf');
  THEME.fonts.mono[400] = loadFont('fonts/spline-sans-mono/SplineSansMono-Regular.ttf');
  THEME.fonts.mono[500] = loadFont('fonts/spline-sans-mono/SplineSansMono-Medium.ttf');
  THEME.fonts.mono[600] = loadFont('fonts/spline-sans-mono/SplineSansMono-SemiBold.ttf');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  initLibrary();
  // Guarded: if ui/modal.js failed to load, the rest of the unit still boots.
  if (typeof setupModalDnD === 'function') setupModalDnD();
}

// Seed the library with the bundled samples as dry sources (no effect config).
function seedLibrary() {
  if (AppState.library.length) return;
  for (let i = 0; i < samples.length; i++) {
    AppState.library.push(
      makeLibraryItem({
        id: 'sample' + (i + 1),
        name: 'Sound ' + (i + 1),
        type: 'file',
        audio: samples[i],
        config: null,
      })
    );
  }
}

// Map a sample id ('sample3') back to its preloaded p5.SoundFile.
function sampleAudioById(id) {
  const m = /^sample(\d+)$/.exec(id);
  return m ? samples[Number(m[1]) - 1] || null : null;
}

// Boot the library: seed defaults, then overlay any persisted library (Slice 3d).
// Default samples re-link to /assets by id; imported/bounce items reload their
// blobs from IndexedDB asynchronously (cards show immediately, audio fills in).
function initLibrary() {
  seedLibrary();
  if (typeof Store === 'undefined') return;
  const saved = Store.loadLibrary();
  if (!saved || !Array.isArray(saved.items)) return; // first run → keep defaults

  const rebuilt = [];
  for (const e of saved.items) {
    const item = makeLibraryItem({ id: e.id, name: e.name, type: e.type, config: e.config || null, audio: null });
    const sample = sampleAudioById(e.id);
    if (sample) {
      item.audio = sample;
    } else {
      Store.getBlob(e.id)
        .then((blob) => {
          if (!blob) return;
          loadSound(
            URL.createObjectURL(blob),
            (snd) => {
              item.audio = snd;
            },
            (err) => console.warn('[restore] load failed', e.id, err)
          );
        })
        .catch(() => {});
    }
    rebuilt.push(item);
  }
  AppState.library = rebuilt;
  if (saved.activeId) AppState.activeId = saved.activeId;
}

// Persist the current library index (metadata + active selection).
function persistLibrary() {
  if (typeof Store !== 'undefined') Store.saveLibrary(AppState.library, AppState.activeId);
}

// Empty-state action: wipe the library, re-add the bundled defaults, drop the
// persisted index so the fresh defaults are what reloads.
function restoreLibrary() {
  AppState.library = [];
  seedLibrary();
  AppState.activeId = null;
  if (typeof Store !== 'undefined') Store.clearLibrary();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  hot = [];
  drawDesk();

  // design→screen transform: fit BOTH width and height so nothing runs off-screen
  gScale = Math.min(1, (width - 40) / DW, (height - 40) / RACK_H);
  gOX = (width - DW * gScale) / 2;
  gOY = Math.max(20, (height - RACK_H * gScale) / 2);

  push();
  translate(gOX, gOY);
  scale(gScale);
  drawRack();
  pop();

  if (AppState.modal) drawModalLayer();
  if (!started) drawPowerHint();
}

/* ---------------- backdrop + rack frame ---------------- */

function drawDesk() {
  const ctx = drawingContext;
  const g = ctx.createRadialGradient(width / 2, -height * 0.12, 0, width / 2, height * 0.4, height * 1.1);
  g.addColorStop(0, THEME.desk[0]);
  g.addColorStop(0.52, THEME.desk[1]);
  g.addColorStop(1, THEME.desk[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

function drawRack() {
  panel(0, 0, DW, RACK_H, 16, THEME.plateA, THEME.plateB, { dropShadow: true, topHighlight: true });
  // corner screws
  screw(13, 13, 13, 0.66);
  screw(DW - 13, 13, 13, -0.38);
  screw(13, RACK_H - 13, 13, 0.21);
  screw(DW - 13, RACK_H - 13, 13, 0.87);

  drawHeader();
  drawRoutingStrip();
  drawMainRow();
  drawLibrary();
}

/* ---------------- header ---------------- */

function drawHeader() {
  const y = 22,
    h = 56;
  // brand
  led(CL + 12, y + 18, 12, THEME.accent, true);
  label('FERRIC · FX', CL + 26, y + 14, { weight: 800, size: 23, spacing: 0.16, baseline: 'middle' });
  label('SIGNAL PROCESSOR / MK-A', CL + 26, y + 34, {
    role: 'mono',
    weight: 500,
    size: 10,
    spacing: 0.22,
    color: THEME.ink,
    baseline: 'middle',
  });

  // right cluster (laid out from the right edge)
  const by = y + 9,
    bh = 38;
  const recW = 150,
    recX = CR - recW;
  const vuW = 118,
    vuX = recX - 14 - vuW;
  const transW = 4 * 44 + 3 * 7,
    transX = vuX - 14 - transW;

  // transport (vector icons, not font glyphs)
  const tBtns = ['playpause', 'stop', 'loop', 'jump'];
  for (let i = 0; i < 4; i++) {
    const bx = transX + i * (44 + 7);
    const action = tBtns[i];
    const isLoopOn = action === 'loop' && AppState.isLooping;
    const col = isLoopOn ? THEME.accent : THEME.ink;
    W.button(bx, by, 44, bh, '', {});
    let type =
      action === 'playpause' ? (AppState.isPlaying ? 'pause' : 'play') : action === 'stop' ? 'stop' : action === 'loop' ? 'loop' : 'skip';
    W.icon(type, bx + 22, by + bh / 2, 16, col);
    pushHot(bx, by, 44, bh, () => transport(action));
  }

  // VU well
  panel(vuX, by, vuW, bh, 7, '#0a0d0c', '#05100d', { border: null, inset: true });
  W.vu(vuX + 10, by + 8, started ? AudioEngine.level() : 0);
  label('OUT −3 dB', vuX + 10, by + 30, { role: 'mono', weight: 500, size: 8, spacing: 0.18, color: '#5f6b68' });

  // REC / bounce
  const bouncing = AppState.recMode === 'bounce';
  panel(recX, by, recW, bh, 8, bouncing ? '#3a2326' : '#3a2326', bouncing ? '#241416' : '#241416', { dropShadow: true });
  const dotX = recX + 16,
    dotY = by + bh / 2;
  if (bouncing) {
    const ctx = drawingContext;
    ctx.save();
    ctx.shadowColor = '#ff4d4d';
    ctx.shadowBlur = 9;
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    label('STOP', recX + 30, by + 14, { weight: 700, size: 13, spacing: 0.08, color: '#ffb3b3', baseline: 'middle' });
    label('BOUNCING…', recX + 30, by + 27, { role: 'mono', weight: 500, size: 8, spacing: 0.12, color: '#c98e8e', baseline: 'middle' });
  } else {
    const ctx = drawingContext;
    ctx.fillStyle = '#5a2a2c';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    label('REC', recX + 30, by + 14, { weight: 700, size: 13, spacing: 0.08, color: '#c98e8e', baseline: 'middle' });
    label('PROCESSED', recX + 30, by + 27, { role: 'mono', weight: 500, size: 8, spacing: 0.1, color: '#8a5a5c', baseline: 'middle' });
    const pw = textWidth('PROCESSED');
    W.icon('arrow', recX + 30 + pw + 9, by + 27, 9, '#8a5a5c');
    label('WAV', recX + 30 + pw + 18, by + 27, { role: 'mono', weight: 500, size: 8, spacing: 0.1, color: '#8a5a5c', baseline: 'middle' });
  }
  pushHot(recX, by, recW, bh, toggleBounce);

  // bottom rule
  hline(CL, y + h, CR);
}

/* ---------------- routing strip ---------------- */

const CHAIN = [
  { key: 'source', label: 'SOURCE', io: true },
  { key: 'lowpass', label: 'LOW-PASS', io: false },
  { key: 'waveshaper', label: 'WAVESHAPER', io: false },
  { key: 'compressor', label: 'COMPRESSOR', io: false },
  { key: 'reverb', label: 'REVERB', io: false },
  { key: 'master', label: 'MASTER', io: false, master: true },
  { key: 'out', label: 'OUT', io: true },
];

function drawRoutingStrip() {
  const y = 94,
    h = 96;
  panel(CL, y, CW, h, 11, 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0.10)', { border: null, inset: true });
  label('SIGNAL FLOW — TAP A STAGE TO EDIT', CL + 15, y + 18, { weight: 600, size: 10, spacing: 0.2, color: THEME.ink });

  const innerL = CL + 15,
    innerW = CW - 30;
  const connW = 26,
    n = CHAIN.length;
  const nodeW = (innerW - (n - 1) * connW) / n;
  const ny = y + 28,
    nh = 56;

  for (let i = 0; i < n; i++) {
    const nx = innerL + i * (nodeW + connW);
    const node = CHAIN[i];
    const cfg = AppState.config[node.key];
    const on = node.io ? true : cfg ? cfg.on : true;
    const active = AppState.selected === node.key;

    panel(nx, ny, nodeW, nh, 10, '#33373e', '#262a30', { dropShadow: true, topHighlight: true });
    if (active) {
      const ctx = drawingContext;
      ctx.save();
      ctx.strokeStyle = THEME.accent;
      ctx.lineWidth = 2;
      ctx.shadowColor = THEME.accent;
      ctx.shadowBlur = 16;
      roundRectPath(ctx, nx - 3, ny - 3, nodeW + 6, nh + 6, 13);
      ctx.stroke();
      ctx.restore();
    }
    // LED + label (SOURCE shows a note in place of the LED; OUT adds a triangle)
    const midX = nx + nodeW / 2;
    const tw = textApproxWidth(node.label, 12);
    if (node.key === 'source') W.icon('note', midX - tw / 2 - 8, ny + 18, 12, THEME.accent);
    else led(midX - tw / 2 - 8, ny + 18, 9, THEME.accent, on);
    label(node.label, midX + 4, ny + 18, { weight: 700, size: 12, spacing: 0.05, align: 'center', baseline: 'middle' });
    if (node.key === 'out') W.icon('tri', midX + tw / 2 + 10, ny + 18, 10, THEME.ink);

    // selecting the node (whole card). Pushed FIRST so the BYP switch below,
    // pushed later, is hit-tested first and wins inside its sub-rect.
    pushHot(nx, ny, nodeW, nh, () => selectStage(node.key));

    // bypass micro-switch (only real FX stages)
    if (!node.io && !node.master) {
      const swX = midX - 28,
        swY = ny + 34;
      W.microSwitch(swX, swY, on);
      label(on ? 'ON' : 'BYP', swX + 34, swY + 7, { weight: 600, size: 9, spacing: 0.08, color: THEME.ink, baseline: 'middle' });
      pushHot(swX, swY, 60, 16, () => AudioEngine.setBypass(node.key, !cfg.on));
    }

    // connector
    if (i < n - 1) {
      const ctx = drawingContext;
      ctx.save();
      ctx.fillStyle = THEME.accent;
      ctx.globalAlpha = 0.5;
      ctx.shadowColor = THEME.accent;
      ctx.shadowBlur = 6;
      roundRectPath(ctx, nx + nodeW + connW / 2 - 9, ny + nh / 2 - 1.5, 18, 3, 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ---------------- main row: spectra + editor ---------------- */

function drawMainRow() {
  const y = 206,
    h = 460;
  const specW = 824,
    edW = 416,
    edX = CL + specW + 16;

  // spectra
  const scanT = (millis() % 3600) / 3600;
  const lcdH = (h - 14) / 2;
  W.spectrum(CL, y, specW, lcdH, 'SPECTRUM · IN', started ? AudioEngine.analyzeIn() : null, '#356f66', { barColor: '#356f66', scanT });
  W.spectrum(CL, y + lcdH + 14, specW, lcdH, 'SPECTRUM · OUT', started ? AudioEngine.analyzeOut() : null, THEME.accent, {
    barColor: THEME.accent,
    glow: true,
    scanT,
    redOverlay: AppState.recMode === 'bounce',
  });

  drawEditor(edX, y, edW, h);
}

function editorDescriptor(stage) {
  const cfg = AppState.config[stage];
  if (stage === 'source') return { name: 'SIGNAL SOURCE', sub: 'file / recording', io: true };
  if (stage === 'out') return { name: 'OUTPUT BUS', sub: 'to device', io: true };
  if (stage === 'master') {
    return {
      name: 'MASTER VOLUME',
      sub: 'output bus',
      canBypass: false,
      on: true,
      hasMix: false,
      knobs: [{ l: 'VOLUME', stage: 'master', param: 'volume', value: cfg.volume }],
      selects: [],
      toggles: [],
    };
  }
  const meta = {
    lowpass: {
      name: 'LOW-PASS FILTER',
      sub: '24 dB / oct',
      knobs: [
        ['CUTOFF', 'cutoff'],
        ['RESONANCE', 'res'],
      ],
    },
    waveshaper: {
      name: 'WAVESHAPER',
      sub: 'soft clip',
      knobs: [['DRIVE', 'amount']],
      selects: [{ l: 'OVERSAMPLE', param: 'oversample', opts: ['none', '2×', '4×'], values: ['none', '2x', '4x'] }],
    },
    compressor: {
      name: 'COMPRESSOR',
      sub: 'VCA',
      knobs: [
        ['THRESH', 'threshold'],
        ['RATIO', 'ratio'],
        ['ATTACK', 'attack'],
        ['KNEE', 'knee'],
        ['RELEASE', 'release'],
      ],
    },
    reverb: {
      name: 'REVERB',
      sub: 'hall',
      knobs: [
        ['DURATION', 'duration'],
        ['DECAY', 'decay'],
      ],
      toggles: [{ l: 'REVERSE', param: 'reverse' }],
    },
  }[stage];
  return {
    name: meta.name,
    sub: meta.sub,
    canBypass: true,
    on: cfg.on,
    hasMix: true,
    dw: cfg.dw,
    ol: cfg.ol,
    knobs: meta.knobs.map(([l, p]) => ({ l, stage, param: p, value: cfg[p] })),
    selects: meta.selects || [],
    toggles: meta.toggles || [],
  };
}

function drawEditor(x, y, w, h) {
  panel(x, y, w, h, 12, '#2f333a', '#22252b', { dropShadow: true, topHighlight: true });
  screw(x + 11, y + 11, 11, 0.52);
  screw(x + w - 11, y + 11, 11, -0.7);

  const d = editorDescriptor(AppState.selected);
  const ex = x + 16,
    ew = w - 32;

  // title strip
  led(ex + 5, y + 22, 10, THEME.accent, true);
  label('NOW EDITING', ex + 18, y + 16, { weight: 600, size: 9, spacing: 0.22, color: THEME.ink });
  label(d.name, ex + 18, y + 32, { role: 'mono', weight: 600, size: 19, color: '#e7eaee', baseline: 'alphabetic' });
  label(d.sub, x + w - 16, y + 16, { role: 'mono', weight: 500, size: 9, spacing: 0.16, color: THEME.ink, align: 'right' });
  if (d.canBypass) {
    const tX = x + w - 16 - 34,
      tY = y + 24;
    W.toggle(tX, tY, 34, 17, d.on, THEME.accent);
    pushHot(tX, tY, 34, 17, () => AudioEngine.setBypass(AppState.selected, !AppState.config[AppState.selected].on));
  }
  hline(ex, y + 48, x + w - 16, 'rgba(0,0,0,0.3)');

  if (d.io) {
    label('routing only — no parameters', x + w / 2, y + h / 2, {
      role: 'mono',
      weight: 500,
      size: 13,
      spacing: 0.06,
      color: THEME.ink,
      align: 'center',
      baseline: 'middle',
    });
    return;
  }

  if (!d.on) {
    panel(x + w - 80, y + 54, 64, 20, 5, 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.35)', { border: null });
    label('BYPASSED', x + w - 48, y + 64, { weight: 600, size: 9, spacing: 0.14, color: '#9aa0a8', align: 'center', baseline: 'middle' });
  }

  // knobs (centered, wrapping)
  let cy = y + 64;
  const cellW = 82,
    gap = 14;
  const perRow = Math.max(1, Math.floor((ew + gap) / (cellW + gap)));
  const knobs = d.knobs;
  for (let r = 0; r * perRow < knobs.length; r++) {
    const rowItems = knobs.slice(r * perRow, r * perRow + perRow);
    const rowW = rowItems.length * cellW + (rowItems.length - 1) * gap;
    let kx = x + w / 2 - rowW / 2;
    for (const k of rowItems) {
      const kcx = kx + cellW / 2,
        kcy = cy + 30;
      const ang = knobAngle(k.stage, k.param, k.value);
      W.knob(kcx, kcy, k.l, paramDisplay(k.stage, k.param, k.value), ang, THEME.accent);
      pushHot(kcx - 32, kcy - 32, 64, 64, null, { type: 'knob', stage: k.stage, param: k.param });
      kx += cellW + gap;
    }
    cy += 86;
  }
  // breathing room between the knob readouts and the selects/toggles below
  if (d.selects.length || d.toggles.length) cy += 16;

  // selects
  for (const sdef of d.selects) {
    const stg = AppState.selected;
    const cur = AppState.config[stg][sdef.param];
    const opts = sdef.opts.map((o, i) => ({ text: o, active: sdef.values[i] === cur }));
    const rects = W.segmented(ex, cy, sdef.l, opts, THEME.accent);
    for (const rc of rects) {
      const val = sdef.values[rc.index];
      pushHot(rc.x, rc.y, rc.w, rc.h, () => AudioEngine.setParam(stg, sdef.param, val));
    }
    cy += 36;
  }
  // toggles
  for (const tdef of d.toggles) {
    const stg = AppState.selected;
    const on = !!AppState.config[stg][tdef.param];
    label(tdef.l, ex, cy + 9, { weight: 600, size: 9, spacing: 0.1, color: THEME.ink, baseline: 'middle' });
    W.toggle(ex + 84, cy, 34, 17, on, THEME.accent);
    pushHot(ex + 84, cy, 34, 17, () => AudioEngine.setParam(stg, tdef.param, !on));
    cy += 30;
  }

  // mix faders + footer
  if (d.hasMix) {
    const fy = y + h - 130;
    hline(ex, fy - 10, x + w - 16);
    const stg = AppState.selected;
    const trackX = ex + 56,
      trackW = ew - 56 - 40; // mirrors W.fader's track geometry
    W.fader(ex, fy, ew, 'DRY / WET', Math.round(d.dw * 100), Math.round(d.dw * 100) + '%', THEME.accent);
    pushHot(trackX - 8, fy - 13, trackW + 16, 26, null, { type: 'fader', stage: stg, param: 'dw', trackX, trackW });
    W.fader(ex, fy + 28, ew, 'OUT LVL', Math.round(d.ol * 100), Math.round(d.ol * 100) + '%', THEME.accent);
    pushHot(trackX - 8, fy + 28 - 13, trackW + 16, 26, null, { type: 'fader', stage: stg, param: 'ol', trackX, trackW });
  }

  // footer buttons
  const foY = y + h - 16 - 38,
    foW = (ew - 9) / 2;
  const stg = AppState.selected;
  W.button(ex, foY, foW, 38, '', {});
  label('CLEAR FILTER', ex + foW / 2, foY + 19, {
    weight: 600,
    size: 12,
    spacing: 0.06,
    color: THEME.ink,
    align: 'center',
    baseline: 'middle',
  });
  pushHot(ex, foY, foW, 38, () => resetStage(stg));
  panel(ex + foW + 9, foY, foW, 38, 7, '#1f6f68', '#23262b', { dropShadow: true });
  const justSaved = millis() - savedFlash < 1200;
  label(justSaved ? 'SAVED' : 'SAVE PRESET', ex + foW + 9 + foW / 2, foY + 19, {
    weight: 700,
    size: 12,
    spacing: 0.06,
    color: '#eafffb',
    align: 'center',
    baseline: 'middle',
  });
  pushHot(ex + foW + 9, foY, foW, 38, savePreset);
}

/* ---------------- library (Slice 3a: data-driven dock) ---------------- */

// Short "fx" summary line for a card: abbreviations of the stages left ON.
const FX_ABBR = { lowpass: 'LPF', waveshaper: 'WSH', compressor: 'CMP', reverb: 'RVB' };
const LIBRARY_ACTIONS = [
  { key: 'play', col: 0, row: 0, run: libPlay },
  { key: 'EDIT', col: 1, row: 0, run: libEdit },
  { key: 'CLR', col: 0, row: 1, run: libClr },
  { key: 'DEL', col: 1, row: 1, run: libDel },
];

function fxSummary(config) {
  if (!config) return 'DRY SOURCE';
  const on = FX_STAGES.filter((s) => config[s] && config[s].on).map((s) => FX_ABBR[s]);
  return on.length ? on.join(' · ') : 'ALL BYPASSED';
}

function drawLibrary() {
  const y = 682,
    h = 134;
  panel(CL, y, CW, h, 11, 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0.10)', { border: null, inset: true });
  label('SOUNDS LIBRARY', CL + 15, y + 18, { weight: 600, size: 10, spacing: 0.2, color: THEME.ink });
  label('select to load into chain · play / edit / clr / del', CR - 15, y + 18, {
    role: 'mono',
    weight: 500,
    size: 9,
    spacing: 0.1,
    color: THEME.ink,
    align: 'right',
  });

  const cardY = y + 30,
    cardH = h - 30 - 12; // ≈92
  const addW = 132,
    gap = 10;
  const cardsW = CW - 30 - addW - gap;
  const items = AppState.library;
  const n = Math.max(1, items.length);
  const cardW = (cardsW - gap * (n - 1)) / n;

  if (items.length === 0) {
    const mx = CL + 15 + cardsW / 2;
    label('LIBRARY EMPTY', mx, cardY + cardH / 2 - 17, {
      weight: 600,
      size: 11,
      spacing: 0.1,
      color: THEME.ink,
      align: 'center',
      baseline: 'middle',
    });
    const bw = 210,
      bh = 30,
      bx = mx - bw / 2,
      by = cardY + cardH / 2 + 1;
    W.button(bx, by, bw, bh, '', {});
    label('RESTORE DEFAULT SOUNDS', mx, by + bh / 2, {
      weight: 700,
      size: 11,
      spacing: 0.06,
      color: THEME.accent,
      align: 'center',
      baseline: 'middle',
    });
    pushHot(bx, by, bw, bh, restoreLibrary);
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const cx = CL + 15 + i * (cardW + gap);
    const isActive = AppState.activeId === item.id;

    panel(cx, cardY, cardW, cardH, 9, '#2c3036', '#212429', { dropShadow: true });
    if (isActive) {
      const ctx = drawingContext;
      ctx.save();
      ctx.strokeStyle = THEME.accent;
      ctx.lineWidth = 2;
      ctx.shadowColor = THEME.accent;
      ctx.shadowBlur = 12;
      roundRectPath(ctx, cx - 2, cardY - 2, cardW + 4, cardH + 4, 11);
      ctx.stroke();
      ctx.restore();
    }
    led(cx + 12, cardY + 17, 8, THEME.accent, isActive || !!item.config);
    label(item.name, cx + 22, cardY + 17, { weight: 700, size: 14, color: '#e3e7eb', baseline: 'middle' });
    label(fxSummary(item.config), cx + 12, cardY + 35, {
      role: 'mono',
      weight: 500,
      size: 9,
      color: item.config ? THEME.accent : '#6b7178',
    });

    // whole-card click = load. Pushed first so the action buttons (pushed later,
    // hit-tested first) win inside their sub-rects.
    pushHot(cx, cardY, cardW, cardH, () => libPlay(item));

    // 2x2 action grid
    const gx = cx + 10,
      gy = cardY + 46,
      gw = (cardW - 20 - 6) / 2,
      gh = 17,
      vgap = 5;
    for (const action of LIBRARY_ACTIONS) {
      const ax = gx + action.col * (gw + 6),
        ay = gy + action.row * (gh + vgap);
      const destructive = action.key === 'DEL';
      panel(ax, ay, gw, gh, 4, destructive ? '#3a2326' : '#33373e', destructive ? '#241416' : '#262a30');
      if (action.key === 'play') W.icon('tri', ax + gw / 2, ay + gh / 2, 10, THEME.ink);
      else
        label(action.key, ax + gw / 2, ay + gh / 2 + 0.5, {
          weight: 600,
          size: 9,
          spacing: 0.04,
          color: destructive ? '#c98e8e' : THEME.ink,
          align: 'center',
          baseline: 'middle',
        });
      pushHot(ax, ay, gw, gh, () => action.run(item));
    }
  }
  // ADD SOUND card (import wired in Slice 3b)
  const addX = CR - 15 - addW;
  const ctx = drawingContext;
  ctx.save();
  ctx.fillStyle = 'rgba(42,212,200,0.05)';
  roundRectPath(ctx, addX, cardY, addW, cardH, 9);
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(42,212,200,0.45)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, addX, cardY, addW, cardH, 9);
  ctx.stroke();
  ctx.restore();
  // plus in a ringed circle
  drawingContext.save();
  drawingContext.strokeStyle = 'rgba(42,212,200,0.5)';
  drawingContext.lineWidth = 1;
  drawingContext.beginPath();
  drawingContext.arc(addX + addW / 2, cardY + 30, 12, 0, Math.PI * 2);
  drawingContext.stroke();
  drawingContext.restore();
  W.icon('plus', addX + addW / 2, cardY + 30, 13, THEME.accent);
  label('ADD SOUND', addX + addW / 2, cardY + 58, {
    weight: 700,
    size: 12,
    spacing: 0.07,
    color: THEME.accent,
    align: 'center',
    baseline: 'middle',
  });
  label('IMPORT FILE', addX + addW / 2, cardY + 73, {
    role: 'mono',
    weight: 500,
    size: 8,
    spacing: 0.1,
    color: THEME.ink,
    align: 'center',
    baseline: 'middle',
  });
  pushHot(addX, cardY, addW, cardH, openFilePicker);
}

/* ---------------- interaction plumbing ---------------- */

// fn fires on press; an optional drag descriptor begins a knob/fader drag that
// continues in mouseDragged() until release.
function pushHot(x, y, w, h, fn, drag) {
  hot.push({ x, y, w, h, fn, drag });
}

// Hairline divider drawn straight on the 2D context (p5's line() is disabled by
// the noStroke() that label() leaves set).
function hline(x1, y, x2, color = 'rgba(0,0,0,0.28)') {
  const ctx = drawingContext;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y + 0.5);
  ctx.lineTo(x2, y + 0.5);
  ctx.stroke();
}

function mousePressed() {
  if (!started) {
    powerOn();
    return;
  }
  if (AppState.modal) {
    modalMousePressed();
    return;
  }
  const dx = (mouseX - gOX) / gScale,
    dy = (mouseY - gOY) / gScale;
  for (let i = hot.length - 1; i >= 0; i--) {
    const r = hot[i];
    if (dx >= r.x && dx <= r.x + r.w && dy >= r.y && dy <= r.y + r.h) {
      if (r.drag) beginDrag(r.drag, dx, dy);
      if (r.fn) r.fn();
      return;
    }
  }
}

/* ---------------- knob / fader dragging ---------------- */

function beginDrag(d, dx, dy) {
  drag = Object.assign({}, d);
  if (drag.type === 'knob') {
    // relative drag: remember where we started, then move from there
    drag.startNorm = paramNorm(drag.stage, drag.param, AppState.config[drag.stage][drag.param]);
    drag.startY = dy;
  } else if (drag.type === 'fader') {
    applyFaderAt(drag, dx); // click-to-set: jump to the press position
  }
}

// Map a design-space x onto a fader's 0..1 track and write it live.
function applyFaderAt(d, dx) {
  const t = Math.min(1, Math.max(0, (dx - d.trackX) / d.trackW));
  AudioEngine.setParam(d.stage, d.param, t);
}

function mouseDragged() {
  if (!drag) return false;
  const dx = (mouseX - gOX) / gScale,
    dy = (mouseY - gOY) / gScale;
  if (drag.type === 'knob') {
    const SENS = 240; // design-px for a full 0..1 sweep
    const t = Math.min(1, Math.max(0, drag.startNorm + (drag.startY - dy) / SENS)); // up = increase
    AudioEngine.setParam(drag.stage, drag.param, paramDenorm(drag.stage, drag.param, t));
  } else if (drag.type === 'fader') {
    applyFaderAt(drag, dx);
  }
  return false; // suppress default browser drag/select
}

function mouseReleased() {
  drag = null;
}

// Keyboard goes to the library dialog's name field when it's open.
function keyTyped() {
  if (modalKeyTyped()) return false;
}
function keyPressed() {
  if (AppState.modal && modalKeyPressed()) return false;
}

/* ---------------- preset actions (footer) ---------------- */

// CLEAR FILTER: reset just the selected stage to the mock's default preset.
function resetStage(stage) {
  const def = makeDefaultConfig()[stage];
  if (!def) return;
  Object.assign(AppState.config[stage], def);
  if (stage === 'master') AudioEngine.applyMaster();
  else AudioEngine.applyStage(stage);
}

// SAVE PRESET: persist the whole live config so it survives a reload.
function savePreset() {
  try {
    localStorage.setItem('ferric.preset', JSON.stringify(AppState.config));
    savedFlash = millis();
  } catch (e) {
    /* storage unavailable — ignore */
  }
}

// Restore a previously saved preset (called once at power-on, before init()).
function loadPreset() {
  try {
    const s = localStorage.getItem('ferric.preset');
    if (!s) return;
    const c = JSON.parse(s);
    if (c && c.lowpass && c.master) {
      AppState.config = c;
      AppState.selected = c.selected || 'reverb';
    }
  } catch (e) {
    /* ignore malformed storage */
  }
}

function powerOn() {
  userStartAudio();
  loadPreset(); // restore a saved preset (if any) before the graph reads config
  AudioEngine.init();
  // Resume the last active sound (persisted), else the first loaded one.
  const active = AppState.library.find((x) => x.id === AppState.activeId && x.audio) || AppState.library.find((x) => x.audio);
  if (active) {
    AudioEngine.loadSource(active.audio);
    AppState.activeId = active.id;
  }
  started = true;
}

function transport(action) {
  if (action === 'playpause') AppState.isPlaying ? AudioEngine.pause() : AudioEngine.play();
  else if (action === 'stop') AudioEngine.stop();
  else if (action === 'loop') AudioEngine.toggleLoop();
  else if (action === 'jump') AudioEngine.jumpToStart();
}

// Snapshot of the effect config at the moment a bounce starts — these are the
// effects actually printed into the file, shown as chips in the bounce dialog.
let bounceConfigSnapshot = null;

function toggleBounce() {
  if (AppState.recMode === 'bounce') {
    // stop → the recorder delivers the buffer async, then we open the save dialog
    AudioEngine.stopBounce((buf) => openBounceModal(buf, bounceConfigSnapshot));
    AudioEngine.stop(); // halt the source so it doesn't mix under the bounce preview
  } else {
    bounceConfigSnapshot = deepClone(AppState.config);
    AudioEngine.startBounce(true);
  }
}

// RE-RECORD from the bounce dialog: re-arm and capture again from the top.
function rearmBounce() {
  bounceConfigSnapshot = deepClone(AppState.config);
  AudioEngine.startBounce(true);
}

/* ---------------- library actions (Slice 3a, in-memory) ---------------- */

// ▶ / card body — load this sound into the chain and play it. If the item
// carries a saved config, it's applied; dry sources keep the current chain.
function libPlay(item) {
  if (!item.audio) return;
  AudioEngine.loadSource(item.audio);
  AppState.activeId = item.id;
  if (item.config) {
    AppState.config = deepClone(item.config);
    AppState.selected = item.config.selected || AppState.selected;
    AppState.config.selected = AppState.selected;
    AudioEngine.applyConfig();
  }
  AudioEngine.play();
  persistLibrary();
}

// EDIT — load this sound (and its saved config, if any) into the editor without
// auto-playing. Dry sources start from the default preset so effects can be added.
function libEdit(item) {
  if (item.audio) AudioEngine.loadSource(item.audio);
  AppState.activeId = item.id;
  if (item.config) {
    AppState.config = deepClone(item.config);
    AppState.selected = item.config.selected || 'reverb';
  } else {
    resetConfig();
  }
  AppState.config.selected = AppState.selected;
  AudioEngine.applyConfig();
  persistLibrary();
}

// CLR — clear this sound's effects: it becomes a dry source. If it's the active
// sound, the live chain is bypassed so you hear the dry signal immediately.
function libClr(item) {
  item.config = null;
  if (AppState.activeId === item.id) {
    for (const s of FX_STAGES) AppState.config[s].on = false;
    AudioEngine.applyConfig();
  }
  persistLibrary();
}

// DEL — remove the sound from the library. If it was active, stop playback.
function libDel(item) {
  const i = AppState.library.findIndex((x) => x.id === item.id);
  if (i >= 0) AppState.library.splice(i, 1);
  if (AppState.activeId === item.id) {
    AppState.activeId = null;
    AudioEngine.stop();
  }
  if (typeof Store !== 'undefined') Store.delBlob(item.id).catch(() => {});
  persistLibrary();
}

/* ---------------- power hint overlay ---------------- */

function drawPowerHint() {
  push();
  fill(0, 0, 0, 120);
  rect(0, 0, width, height);
  const f = THEME.fonts.mono[500];
  if (f) textFont(f);
  textAlign(CENTER, CENTER);
  textSize(16);
  fill(THEME.accent);
  noStroke();
  text('CLICK TO POWER ON', width / 2, height / 2);
  pop();
}
