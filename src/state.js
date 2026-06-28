/*
 * state.js — single source of truth for the FX Processor.
 *
 * Holds the effect-config model, the mock's default preset, the global UI state
 * (which stage is selected, record mode, modal), and the library list.
 *
 * This file is PURE DATA + helpers: no audio nodes, no canvas drawing. The audio
 * engine reads from here to configure its graph; the UI reads from here to render
 * and writes back here on interaction.
 *
 * Loaded in p5 global mode, so it attaches a single `AppState` global.
 */

// Left-to-right signal chain, matching the chain strip in the UI.
const STAGES = ['source', 'lowpass', 'waveshaper', 'compressor', 'reverb', 'master', 'out'];

// Stages that are actual effect nodes with on/bypass + dry/wet + output level.
const FX_STAGES = ['lowpass', 'waveshaper', 'compressor', 'reverb'];

/*
 * Parameter ranges + step metadata. Drives clamping here and (in Phase 2) the
 * knob/fader widgets. `log: true` marks controls that should map logarithmically
 * (cutoff frequency). `options` marks segmented controls.
 */
const PARAM_RANGES = {
  lowpass: {
    cutoff: { min: 20, max: 20000, log: true, unit: 'Hz' },
    res:    { min: 0,  max: 30,    unit: 'Q' },
    dw:     { min: 0,  max: 1 },
    ol:     { min: 0,  max: 1 },
  },
  waveshaper: {
    amount:     { min: 0, max: 1 },
    oversample: { options: ['none', '2x', '4x'] },
    dw:         { min: 0, max: 1 },
    ol:         { min: 0, max: 1 },
  },
  compressor: {
    threshold: { min: -100, max: 0,  unit: 'dB' },
    ratio:     { min: 1,    max: 20, unit: ':1' },
    attack:    { min: 0,    max: 1,  unit: 's' },
    knee:      { min: 0,    max: 40, unit: 'dB' },
    release:   { min: 0,    max: 1,  unit: 's' },
    dw:        { min: 0,    max: 1 },
    ol:        { min: 0,    max: 1 },
  },
  reverb: {
    duration: { min: 0, max: 10,  unit: 's' },
    decay:    { min: 0, max: 100 },
    reverse:  { options: [false, true] },
    dw:       { min: 0, max: 1 },
    ol:       { min: 0, max: 1 },
  },
  master: {
    volume: { min: 0, max: 1 },
  },
};

/*
 * The mock's initial preset (README §Data model). This is the default effect
 * config applied to a freshly loaded source and the reset target for "CLR".
 * Returned by a factory so every consumer gets an independent copy.
 */
function makeDefaultConfig() {
  return {
    selected: 'reverb',
    master:     { volume: 0.80 },
    lowpass:    { on: true,  cutoff: 1240, res: 4.0,  dw: 0.60, ol: 0.50 },
    waveshaper: { on: true,  amount: 0.55, oversample: '2x', dw: 0.72, ol: 0.50 },
    compressor: { on: false, threshold: -24, ratio: 4, attack: 0.012, knee: 6, release: 0.18, dw: 1.0, ol: 0.50 },
    reverb:     { on: true,  duration: 2.4, decay: 3.0, reverse: false, dw: 0.70, ol: 0.55 },
  };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/*
 * A library entry. `audio` is a runtime reference (a p5.SoundFile once loaded);
 * persistence of the underlying blob is a Phase 2 concern (IndexedDB).
 *   type 'file'   → pre-recorded/imported dry source (config may be null)
 *   type 'bounce' → processed output, with the config baked in attached
 */
function makeLibraryItem({ id, name, type, audio = null, config = null }) {
  return { id, name, type, audio, config };
}

const AppState = {
  // ---- effect configuration (the live, editable preset) ----
  config: makeDefaultConfig(),

  // ---- UI state (mirrors the mock's logic) ----
  selected: 'reverb',   // which stage is open in the editor
  recMode: 'idle',      // 'idle' | 'bounce'
  modal: null,          // null | 'add' | 'bounce'

  // ---- library ----
  library: [],          // LibraryItem[]
  activeId: null,       // id of the currently loaded/playing item

  // ---- transport mirror (UI reads these; engine is the authority) ----
  isPlaying: false,
  isLooping: false,

  // ---- constants exposed for convenience ----
  STAGES,
  FX_STAGES,
  PARAM_RANGES,
};

/* -------- mutation helpers (UI + harness call these) -------- */

// Select which stage the editor shows.
function selectStage(stage) {
  if (STAGES.includes(stage)) {
    AppState.selected = stage;
    AppState.config.selected = stage;
  }
}

// Read a stage's config object (lowpass/waveshaper/compressor/reverb/master).
function stageConfig(stage) {
  return AppState.config[stage];
}

// Clamp + write a single parameter into the config. Returns the stored value.
// Segmented params (oversample, reverse) are passed through as-is.
function setParam(stage, param, value) {
  const cfg = AppState.config[stage];
  if (!cfg) return undefined;
  const range = PARAM_RANGES[stage] && PARAM_RANGES[stage][param];
  if (range && typeof value === 'number' && range.min !== undefined) {
    value = clamp(value, range.min, range.max);
  }
  cfg[param] = value;
  return value;
}

// Flip / set a stage's bypass. Master has no bypass (always on).
function setBypass(stage, on) {
  const cfg = AppState.config[stage];
  if (cfg && 'on' in cfg) cfg.on = !!on;
}

// Reset all effects to the default preset (the "CLR" action).
function resetConfig() {
  AppState.config = makeDefaultConfig();
  AppState.selected = AppState.config.selected;
}
