/*
 * audioEngine.js — the fixed effects graph and everything audio.
 *
 *   SOURCE → LOW-PASS → WAVESHAPER → COMPRESSOR → REVERB → MASTER → OUTPUT
 *
 * The graph is built once (init) and never rewired. A new source is patched in
 * at loadSource(); config changes are pushed into the existing nodes. Two p5.FFTs
 * tap the pre-FX source and the post-FX master bus; a p5.Amplitude meters master;
 * a p5.SoundRecorder bounces the master bus to a WAV.
 *
 * Bypass strategy (v1): a bypassed stage stays wired in place but is set to
 * drywet(0) + amp(1), i.e. it passes the dry signal straight through. No graph
 * rewiring. (If a stage is found to "leak" at drywet(0), upgrade that one stage
 * to a true dry-reroute later.)
 *
 * Reads its parameters from the global AppState (see state.js). Exposes a single
 * `AudioEngine` global.
 */

const AudioEngine = (function () {
  // Effect nodes (created once in init).
  let nodes = null;          // { lowpass, waveshaper, compressor, reverb, masterGain }
  let src = null;            // current p5.SoundFile

  // Analysis / metering.
  let fftIn = null;          // taps the source (pre-FX)
  let fftOut = null;         // taps masterGain (post-FX)
  let amplitude = null;      // master level for the VU meter

  // Recording (bounce).
  let recorder = null;
  let recBuffer = null;
  let recording = false;
  let onBounceComplete = null;   // fires when the recorded buffer is ready

  let started = false;       // AudioContext running + graph built

  // p5.sound effects expose `.input` (a Web Audio node); raw nodes do not.
  // Connect into `.input` when present, else the object itself.
  function inputOf(node) {
    return node && node.input ? node.input : node;
  }

  /*
   * Build the node graph once. Each p5.sound effect auto-connects to the main
   * output on creation, so we disconnect them first, then wire the fixed chain
   * and route only masterGain to the device.
   */
  function init() {
    if (nodes) return;

    nodes = {
      lowpass:    new p5.LowPass(),
      waveshaper: new p5.Distortion(),
      compressor: new p5.Compressor(),
      reverb:     new p5.Reverb(),
      masterGain: new p5.Gain(),
    };

    // Remove each effect's default route to the main output.
    [nodes.lowpass, nodes.waveshaper, nodes.compressor, nodes.reverb].forEach((n) => n.disconnect());

    // Wire the fixed series chain.
    nodes.lowpass.connect(inputOf(nodes.waveshaper));
    nodes.waveshaper.connect(inputOf(nodes.compressor));
    nodes.compressor.connect(inputOf(nodes.reverb));
    nodes.reverb.connect(inputOf(nodes.masterGain));
    nodes.masterGain.connect();             // → main output (device)

    // Analyzers / meter. fftIn is pointed at the source in loadSource().
    fftIn = new p5.FFT();
    fftOut = new p5.FFT();
    fftOut.setInput(nodes.masterGain);
    amplitude = new p5.Amplitude();
    amplitude.setInput(nodes.masterGain);

    // Recorder taps the master bus so bounces capture post-FX audio.
    recorder = new p5.SoundRecorder();
    recorder.setInput(nodes.masterGain);

    applyConfig();
    started = true;
  }

  /*
   * Patch a loaded p5.SoundFile into the head of the chain. Disconnects its
   * default route to main out so it only flows through the FX chain, and points
   * the pre-FX analyzer at it.
   */
  function loadSource(soundFile) {
    if (!nodes) init();
    if (src && src.isPlaying && src.isPlaying()) src.stop();

    src = soundFile;
    src.disconnect();
    src.connect(inputOf(nodes.lowpass));
    fftIn.setInput(src);

    AppState.isPlaying = false;
    return src;
  }

  /* ---------------- config application ---------------- */

  // Push the entire AppState.config into the live nodes.
  function applyConfig() {
    if (!nodes) return;
    applyStage('lowpass');
    applyStage('waveshaper');
    applyStage('compressor');
    applyStage('reverb');
    applyMaster();
  }

  // Apply one FX stage from config, honoring bypass via drywet(0)/amp(1).
  function applyStage(stage) {
    if (!nodes) return;
    const cfg = AppState.config[stage];
    const node = nodes[stage];
    if (!cfg || !node) return;

    // Stage-specific parameters first (these are unaffected by bypass).
    switch (stage) {
      case 'lowpass':
        node.freq(cfg.cutoff);
        node.res(cfg.res);
        break;
      case 'waveshaper':
        node.set(cfg.amount, cfg.oversample);
        break;
      case 'compressor':
        node.threshold(cfg.threshold);
        node.ratio(cfg.ratio);
        node.attack(cfg.attack);
        node.knee(cfg.knee);
        node.release(cfg.release);
        break;
      case 'reverb':
        node.set(cfg.duration, cfg.decay, cfg.reverse);
        break;
    }

    // Bypass: dry passthrough at unity. Active: configured mix + output level.
    if (cfg.on) {
      node.drywet(cfg.dw);
      node.amp(cfg.ol);
    } else {
      node.drywet(0);
      node.amp(1);
    }
  }

  function applyMaster() {
    if (!nodes) return;
    nodes.masterGain.amp(AppState.config.master.volume);
  }

  // Convenience wrappers that update state then re-apply just that stage.
  function setParam(stage, param, value) {
    const stored = (typeof window.setParam === 'function')
      ? window.setParam(stage, param, value)   // state.js helper (clamps)
      : (AppState.config[stage][param] = value);
    if (stage === 'master') applyMaster();
    else applyStage(stage);
    return stored;
  }

  function setBypass(stage, on) {
    if (typeof window.setBypass === 'function') window.setBypass(stage, on);
    else if (AppState.config[stage]) AppState.config[stage].on = !!on;
    applyStage(stage);
  }

  /* ---------------- transport ---------------- */

  function play() {
    if (!src) return;
    src.setLoop(AppState.isLooping);
    if (src.isPaused && src.isPaused()) src.play();
    else if (!src.isPlaying()) src.play();
    AppState.isPlaying = true;
  }

  function pause() {
    if (src && src.isPlaying()) src.pause();
    AppState.isPlaying = false;
  }

  function stop() {
    if (src) src.stop();
    AppState.isPlaying = false;
  }

  function toggleLoop() {
    AppState.isLooping = !AppState.isLooping;
    if (src) src.setLoop(AppState.isLooping);
    return AppState.isLooping;
  }

  function jumpToStart() {
    if (src) src.jump(0);
  }

  /* ---------------- analysis / metering ---------------- */

  function analyzeIn() {
    return fftIn ? fftIn.analyze() : [];
  }
  function analyzeOut() {
    return fftOut ? fftOut.analyze() : [];
  }
  function level() {
    return amplitude ? amplitude.getLevel() : 0;
  }

  /* ---------------- bounce (record processed output) ---------------- */

  // Start recording the master bus. Plays the source from the top if requested.
  // p5.SoundRecorder delivers the captured buffer ASYNCHRONOUSLY: the callback
  // we register here fires only after stop() and the worklet has transferred the
  // samples into recBuffer — that's the only point the buffer is valid to save.
  function startBounce(playFromStart = true) {
    if (!nodes || recording) return;
    recBuffer = new p5.SoundFile();
    recording = true;
    AppState.recMode = 'bounce';
    if (playFromStart && src) {
      src.jump(0);
      play();
    }
    recorder.record(recBuffer, undefined, () => {
      recording = false;
      AppState.recMode = 'idle';
      if (typeof onBounceComplete === 'function') onBounceComplete(recBuffer);
      onBounceComplete = null;
    });
  }

  // Stop recording. `cb(recBuffer)` runs once the buffer has actually been
  // transferred (see startBounce) — not synchronously here.
  function stopBounce(cb) {
    if (!recording) return;
    onBounceComplete = (typeof cb === 'function') ? cb : null;
    recorder.stop();   // async → triggers the record() callback above
  }

  // Trigger a browser download of a recorded buffer as WAV.
  function saveBounce(buffer, name) {
    const filename = (name || 'bounce').replace(/\.wav$/i, '') + '.wav';
    save(buffer, filename);  // p5 global save() handles p5.SoundFile → WAV
  }

  function isRecording() {
    return recording;
  }

  return {
    init,
    loadSource,
    applyConfig,
    applyStage,
    applyMaster,
    setParam,
    setBypass,
    play,
    pause,
    stop,
    toggleLoop,
    jumpToStart,
    analyzeIn,
    analyzeOut,
    level,
    startBounce,
    stopBounce,
    saveBounce,
    isRecording,
    get started() { return started; },
    get source() { return src; },
    get nodes() { return nodes; },
  };
})();
