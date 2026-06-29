/*
 * ui/modal.js — the library dialog (Slice 3b: "add" mode; "bounce" mode in 3c).
 *
 * A hardware-styled overlay drawn in the same 1320-wide design space as the rack
 * (so it scales with the unit). It owns the file-import flow: a hidden file input
 * + window drag-and-drop decode an audio file into a dry p5.SoundFile, then this
 * dialog previews it, lets you name it, and adds it to the library.
 *
 * State lives in AppState.modal ('add' | 'bounce' | null) + the ModalData object
 * here (the pending import, the editable name, field focus). Input is dispatched
 * from sketch.js when AppState.modal is set.
 */

const ModalData = {
  pending: null, // add: { sound, blob, url, name, format, duration }
  name: '', // editable filename (no extension)
  focused: false, // is the name field capturing keystrokes?
};

let mhot = []; // modal hit regions (design space, like the rack's `hot`)
let importSeq = 0; // unique-id counter for imported items
let fileInput = null; // lazily-created hidden <input type=file>

function pushMhot(x, y, w, h, fn) {
  mhot.push({ x, y, w, h, fn });
}

/* ---------------- small format helpers ---------------- */

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60),
    s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function baseName(fn) {
  return String(fn).replace(/\.[^.]+$/, '');
}
function extFormat(fn) {
  const m = String(fn).match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : 'WAV';
}
function sanitizeName(s) {
  return String(s)
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();
}

/* ---------------- file import ---------------- */

function ensureFileInput() {
  if (fileInput) return;
  fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', function () {
    const f = this.files && this.files[0];
    if (f) importFile(f);
    this.value = ''; // allow re-picking the same file
  });
  document.body.appendChild(fileInput);
}

function openFilePicker() {
  ensureFileInput();
  fileInput.click();
}

// Decode an audio File into a dry p5.SoundFile and open the dialog in add mode.
function importFile(file) {
  const url = URL.createObjectURL(file);
  loadSound(
    url,
    function (snd) {
      if (ModalData.pending && ModalData.pending.url) URL.revokeObjectURL(ModalData.pending.url);
      ModalData.pending = {
        sound: snd,
        blob: file,
        url: url,
        name: baseName(file.name),
        format: extFormat(file.name),
        duration: snd.duration(),
      };
      ModalData.name = ModalData.pending.name;
      ModalData.focused = false;
      AppState.modal = 'add';
    },
    function (err) {
      console.warn('[import] decode failed', err);
      window.alert('Could not decode that audio file.');
    }
  );
}

// Drag a file anywhere onto the window to import it.
function setupModalDnD() {
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!started) return;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const ok = /^audio\//.test(f.type || '') || /\.(wav|mp3|aac|ogg|flac|m4a)$/i.test(f.name);
    if (ok) importFile(f);
  });
}

/* ---------------- actions ---------------- */

// The playable clip for whichever mode is open: imported sound, or bounce buffer.
function previewSound() {
  if (!ModalData.pending) return null;
  return ModalData.pending.sound || ModalData.pending.buffer || null;
}

function stopPreview() {
  const s = previewSound();
  if (s && s.isPlaying && s.isPlaying()) s.stop();
}

// Preview the pending clip straight to the output (dry import, or the bounce
// buffer which is already processed) — not back through the chain.
function modalPreview() {
  const s = previewSound();
  if (!s) return;
  if (s.isPlaying()) s.stop();
  else s.play();
}

function focusNameField() {
  ModalData.focused = true;
}

// CANCEL / ✕ / backdrop — discard the pending import and close.
function closeModal() {
  stopPreview();
  if (ModalData.pending && ModalData.pending.url) URL.revokeObjectURL(ModalData.pending.url);
  ModalData.pending = null;
  ModalData.focused = false;
  AppState.modal = null;
}

// Confirm dispatches by mode (Enter / the primary button both land here).
function modalConfirm() {
  if (AppState.modal === 'add') return confirmAdd();
  if (AppState.modal === 'bounce') return confirmBounce();
}

// + ADD TO LIBRARY — keep the decoded clip as a dry library item.
function confirmAdd() {
  if (!ModalData.pending) return;
  stopPreview();
  if (ModalData.pending.url) URL.revokeObjectURL(ModalData.pending.url);
  const name = sanitizeName(ModalData.name) || ModalData.pending.name || 'imported';
  const item = makeLibraryItem({
    id: 'imp-' + ++importSeq + '-' + Math.floor(millis()),
    name: name,
    type: 'file',
    audio: ModalData.pending.sound,
    config: null,
  });
  item.blob = ModalData.pending.blob; // kept for persistence
  AppState.library.push(item);
  if (typeof Store !== 'undefined') {
    Store.putBlob(item.id, item.blob).catch((e) => console.warn('[store] put failed', e));
    Store.saveLibrary(AppState.library, AppState.activeId);
  }
  ModalData.pending = null;
  ModalData.focused = false;
  AppState.modal = null;
}

// ADD TO LIBRARY — store the processed bounce + the effect config it baked in.
function confirmBounce() {
  if (!ModalData.pending) return;
  stopPreview();
  const name = sanitizeName(ModalData.name) || 'bounce';
  const item = makeLibraryItem({
    id: 'bnc-' + ++importSeq + '-' + Math.floor(millis()),
    name: name,
    type: 'bounce',
    audio: ModalData.pending.buffer,
    config: deepClone(ModalData.pending.config),
  });
  AppState.library.push(item);
  if (typeof Store !== 'undefined') {
    const ab = ModalData.pending.buffer && ModalData.pending.buffer.buffer; // p5.SoundFile → AudioBuffer
    if (ab) Store.putBlob(item.id, Store.encodeWav(ab)).catch((e) => console.warn('[store] put failed', e));
    Store.saveLibrary(AppState.library, AppState.activeId);
  }
  ModalData.pending = null;
  ModalData.focused = false;
  AppState.modal = null;
}

// EXPORT WAV — download the capture only (per the handoff's save(buf,name+'.wav')).
// Keeps the dialog open so you can still add it to the library afterwards.
function exportBounceWav() {
  if (!ModalData.pending) return;
  const name = sanitizeName(ModalData.name) || 'bounce';
  AudioEngine.saveBounce(ModalData.pending.buffer, name);
}

// Open the dialog in bounce mode once a recording is captured (called from
// sketch when the recorder's async buffer is ready). config = the snapshot of
// what was printed into the file.
function openBounceModal(buffer, config) {
  stopPreview();
  ModalData.pending = {
    buffer: buffer,
    config: config || deepClone(AppState.config),
    name: 'bounce-01',
    format: 'WAV',
    duration: buffer && buffer.duration ? buffer.duration() : 0,
  };
  ModalData.name = 'bounce-01';
  ModalData.focused = false;
  AppState.modal = 'bounce';
}

/* ---------------- keyboard ---------------- */

// Returns true if the keystroke was consumed (so sketch can preventDefault).
function modalKeyTyped() {
  if (!AppState.modal || !ModalData.focused) return false;
  if (key && key.length === 1 && key.charCodeAt(0) >= 32) {
    if (ModalData.name.length < 48) ModalData.name += key;
    return true;
  }
  return false;
}

// Returns true only for keys we consume, so the caller preventDefaults JUST those.
// Character keys must fall through (return false) — preventing their keydown would
// cancel the keypress event that drives keyTyped(), making the field untypeable.
function modalKeyPressed() {
  if (!AppState.modal) return false;
  if (keyCode === ESCAPE) {
    closeModal();
    return true;
  }
  if (keyCode === ENTER) {
    modalConfirm();
    return true;
  }
  if (keyCode === BACKSPACE) {
    if (ModalData.focused) ModalData.name = ModalData.name.slice(0, -1);
    return true; // always swallow Backspace (stop browser back-navigation)
  }
  return false; // let other keydowns through → keypress → keyTyped() can type
}

/* ---------------- input dispatch ---------------- */

function modalMousePressed() {
  const dx = (mouseX - gOX) / gScale,
    dy = (mouseY - gOY) / gScale;
  for (let i = mhot.length - 1; i >= 0; i--) {
    const r = mhot[i];
    if (dx >= r.x && dx <= r.x + r.w && dy >= r.y && dy <= r.y + r.h) {
      r.fn();
      return;
    }
  }
  closeModal(); // click outside the dialog (backdrop) → cancel
}

/* ---------------- drawing ---------------- */

function drawModalLayer() {
  mhot = [];
  // dim backdrop (screen space)
  push();
  noStroke();
  fill(0, 0, 0, 150);
  rect(0, 0, width, height);
  pop();
  // dialog (design space — same transform as the rack)
  push();
  translate(gOX, gOY);
  scale(gScale);
  if (AppState.modal === 'add') drawAddDialog();
  else if (AppState.modal === 'bounce') drawBounceDialog();
  pop();
}

// Draw a captured buffer's waveform into an LCD strip (real peaks if available).
function drawWaveform(buf, x, y, w, h, color) {
  let peaks = null;
  try {
    if (buf && buf.getPeaks) peaks = buf.getPeaks(Math.min(260, Math.floor(w)));
  } catch (e) {
    /* no peaks */
  }
  const ctx = drawingContext,
    midY = y + h / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1;
  if (peaks && peaks.length) {
    // Normalize to the buffer's own peak so quiet bounces still read; cap the
    // gain so near-silence doesn't get amplified into full-scale noise.
    let max = 0;
    for (let i = 0; i < peaks.length; i++) max = Math.max(max, Math.abs(peaks[i]));
    const gain = max > 0.002 ? Math.min(1 / max, 14) : 0;
    const step = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const a = Math.min(1, Math.abs(peaks[i]) * gain) * (h / 2 - 3);
      const px = x + i * step;
      ctx.beginPath();
      ctx.moveTo(px, midY - Math.max(0.5, a));
      ctx.lineTo(px, midY + Math.max(0.5, a));
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(x, midY);
    ctx.lineTo(x + w, midY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCloseX(cx, cy, s, color) {
  const ctx = drawingContext;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const r = s / 2;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r);
  ctx.lineTo(cx + r, cy + r);
  ctx.moveTo(cx + r, cy - r);
  ctx.lineTo(cx - r, cy + r);
  ctx.stroke();
  ctx.restore();
}

function drawAddDialog() {
  const p = ModalData.pending;
  if (!p) {
    closeModal();
    return;
  }

  const dlgW = 720,
    dlgH = 500;
  const dlgX = (DW - dlgW) / 2,
    dlgY = (RACK_H - dlgH) / 2;
  const padX = dlgX + 28,
    innerW = dlgW - 56;

  // dialog body + a backing hit-rect that absorbs clicks (defocus, no close)
  panel(dlgX, dlgY, dlgW, dlgH, 16, '#272b31', '#1a1c21', { dropShadow: true, topHighlight: true, border: '#3a3f47' });
  pushMhot(dlgX, dlgY, dlgW, dlgH, () => {
    ModalData.focused = false;
  });

  // header
  led(padX + 5, dlgY + 30, 11, THEME.accent, true);
  label('ADD A SOUND', padX + 20, dlgY + 24, { weight: 800, size: 20, spacing: 0.04, color: '#e7eaee', baseline: 'middle' });
  label('IMPORT TO LIBRARY', padX + 20, dlgY + 44, {
    role: 'mono',
    weight: 500,
    size: 9,
    spacing: 0.2,
    color: THEME.ink,
    baseline: 'middle',
  });
  const xcx = dlgX + dlgW - 30,
    xcy = dlgY + 30;
  drawCloseX(xcx, xcy, 14, THEME.ink);
  pushMhot(xcx - 16, xcy - 16, 32, 32, closeModal);

  // context badge
  const bgY = dlgY + 62,
    bgH = 24,
    bgW = 440;
  panel(padX, bgY, bgW, bgH, 6, 'rgba(42,212,200,0.10)', 'rgba(42,212,200,0.05)', { border: 'rgba(42,212,200,0.30)' });
  W.icon('plus', padX + 16, bgY + bgH / 2, 10, THEME.accent);
  label('NEW SOURCE · IMPORTED FILE · ' + fmtDuration(p.duration) + ' · ' + p.format, padX + 30, bgY + bgH / 2, {
    role: 'mono',
    weight: 600,
    size: 9,
    spacing: 0.08,
    color: THEME.accent,
    baseline: 'middle',
  });

  // file zone (dashed)
  const zx = padX,
    zy = dlgY + 98,
    zw = innerW,
    zh = 120;
  const ctx = drawingContext;
  ctx.save();
  ctx.fillStyle = 'rgba(42,212,200,0.04)';
  roundRectPath(ctx, zx, zy, zw, zh, 10);
  ctx.fill();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(42,212,200,0.40)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, zx, zy, zw, zh, 10);
  ctx.stroke();
  ctx.restore();

  // preview button
  const pvx = zx + 46,
    pvy = zy + zh / 2,
    playing = p.sound.isPlaying();
  ctx.save();
  ctx.strokeStyle = THEME.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pvx, pvy, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  W.icon(playing ? 'stop' : 'tri', pvx + (playing ? 0 : 2), pvy, 15, THEME.accent);
  pushMhot(pvx - 22, pvy - 22, 44, 44, modalPreview);

  // selected-file row
  const tx = pvx + 40;
  W.icon('note', tx + 6, pvy - 9, 12, THEME.accent);
  label(p.name + '.' + p.format.toLowerCase(), tx + 18, pvy - 9, {
    role: 'mono',
    weight: 600,
    size: 14,
    color: '#e3e7eb',
    baseline: 'middle',
  });
  label(fmtDuration(p.duration) + ' · ' + p.format + ' · drop a file to replace', tx + 18, pvy + 13, {
    role: 'mono',
    weight: 500,
    size: 9,
    color: THEME.ink,
    baseline: 'middle',
  });

  // BROWSE
  const brW = 124,
    brH = 38,
    brX = zx + zw - 22 - brW,
    brY = pvy - brH / 2;
  W.button(brX, brY, brW, brH, '', {});
  W.icon('arrow', brX + 26, brY + brH / 2, 11, THEME.accent);
  label('BROWSE', brX + brW / 2 + 8, brY + brH / 2, {
    weight: 700,
    size: 12,
    spacing: 0.08,
    color: THEME.accent,
    align: 'center',
    baseline: 'middle',
  });
  pushMhot(brX, brY, brW, brH, openFilePicker);

  // name field
  const nlY = dlgY + 238;
  label('FILE NAME', padX, nlY, { weight: 600, size: 9, spacing: 0.2, color: THEME.ink });
  const fldX = padX,
    fldY = nlY + 10,
    fldW = innerW,
    fldH = 42;
  panel(fldX, fldY, fldW, fldH, 8, '#15171b', '#1d2025', { border: ModalData.focused ? THEME.accent : '#3a3f47', inset: true });
  label('.' + p.format.toLowerCase(), fldX + fldW - 16, fldY + fldH / 2, {
    role: 'mono',
    weight: 500,
    size: 13,
    color: THEME.ink,
    align: 'right',
    baseline: 'middle',
  });
  label(ModalData.name, fldX + 16, fldY + fldH / 2, { role: 'mono', weight: 600, size: 15, color: '#e7eaee', baseline: 'middle' });
  if (ModalData.focused && Math.floor(millis() / 450) % 2 === 0) {
    const cwd = textWidth(ModalData.name); // mono 15 still current from the label above
    const cxp = fldX + 16 + cwd + 2;
    ctx.save();
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cxp, fldY + 11);
    ctx.lineTo(cxp, fldY + fldH - 11);
    ctx.stroke();
    ctx.restore();
  }
  pushMhot(fldX, fldY, fldW, fldH, focusNameField);

  // dry-source note
  label('Added as a dry source — no effects applied. Load it into the chain to add effects.', padX, dlgY + 318, {
    role: 'mono',
    weight: 500,
    size: 10,
    color: THEME.ink,
  });

  // actions
  const aH = 46,
    aY = dlgY + dlgH - 28 - aH;
  const cancelW = 140;
  W.button(padX, aY, cancelW, aH, '', {});
  label('CANCEL', padX + cancelW / 2, aY + aH / 2, {
    weight: 700,
    size: 13,
    spacing: 0.06,
    color: THEME.ink,
    align: 'center',
    baseline: 'middle',
  });
  pushMhot(padX, aY, cancelW, aH, closeModal);

  const addW = 230,
    addX = dlgX + dlgW - 28 - addW;
  panel(addX, aY, addW, aH, 9, '#1f6f68', '#23262b', { dropShadow: true });
  W.icon('plus', addX + 28, aY + aH / 2, 14, '#eafffb');
  label('ADD TO LIBRARY', addX + addW / 2 + 12, aY + aH / 2, {
    weight: 700,
    size: 13,
    spacing: 0.06,
    color: '#eafffb',
    align: 'center',
    baseline: 'middle',
  });
  pushMhot(addX, aY, addW, aH, modalConfirm);
}

// Bounce mode — save the processed capture (effects baked in) to the library.
function drawBounceDialog() {
  const p = ModalData.pending;
  if (!p) {
    closeModal();
    return;
  }

  const dlgW = 720,
    dlgH = 500;
  const dlgX = (DW - dlgW) / 2,
    dlgY = (RACK_H - dlgH) / 2;
  const padX = dlgX + 28,
    innerW = dlgW - 56;
  const ctx = drawingContext;

  panel(dlgX, dlgY, dlgW, dlgH, 16, '#272b31', '#1a1c21', { dropShadow: true, topHighlight: true, border: '#3a3f47' });
  pushMhot(dlgX, dlgY, dlgW, dlgH, () => {
    ModalData.focused = false;
  });

  // header (red LED — this is a recording)
  led(padX + 5, dlgY + 30, 11, THEME.recRed, true);
  label('RECORDING CAPTURED', padX + 20, dlgY + 24, { weight: 800, size: 20, spacing: 0.04, color: '#e7eaee', baseline: 'middle' });
  label('SAVE TO LIBRARY', padX + 20, dlgY + 44, {
    role: 'mono',
    weight: 500,
    size: 9,
    spacing: 0.2,
    color: THEME.ink,
    baseline: 'middle',
  });
  const xcx = dlgX + dlgW - 30,
    xcy = dlgY + 30;
  drawCloseX(xcx, xcy, 14, THEME.ink);
  pushMhot(xcx - 16, xcy - 16, 32, 32, closeModal);

  // context badge (red-tinted)
  const bgY = dlgY + 62,
    bgH = 24,
    bgW = 460;
  panel(padX, bgY, bgW, bgH, 6, 'rgba(255,77,77,0.12)', 'rgba(255,77,77,0.05)', { border: 'rgba(255,77,77,0.30)' });
  ctx.save();
  ctx.fillStyle = THEME.recRed;
  ctx.beginPath();
  ctx.arc(padX + 16, bgY + bgH / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  label('BOUNCE · PROCESSED OUTPUT · ' + fmtDuration(p.duration) + ' · WAV', padX + 28, bgY + bgH / 2, {
    role: 'mono',
    weight: 600,
    size: 9,
    spacing: 0.08,
    color: '#ffb3b3',
    baseline: 'middle',
  });

  // preview LCD strip: ▶ + waveform + WAV·48k
  const zx = padX,
    zy = dlgY + 96,
    zw = innerW,
    zh = 92;
  ctx.save();
  ctx.fillStyle = vGrad(zy, zh, THEME.lcd[0], THEME.lcd[1]);
  roundRectPath(ctx, zx, zy, zw, zh, 10);
  ctx.fill();
  ctx.restore();
  const playing = previewSound() && previewSound().isPlaying();
  const pvx = zx + 40,
    pvy = zy + zh / 2;
  ctx.save();
  ctx.strokeStyle = THEME.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pvx, pvy, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  W.icon(playing ? 'stop' : 'tri', pvx + (playing ? 0 : 2), pvy, 14, THEME.accent);
  pushMhot(pvx - 20, pvy - 20, 40, 40, modalPreview);
  drawWaveform(p.buffer, pvx + 34, zy + 12, zw - (pvx + 34 - zx) - 70, zh - 24, THEME.accent);
  label('WAV · 48k', zx + zw - 14, pvy, { role: 'mono', weight: 500, size: 9, color: '#3f5e58', align: 'right', baseline: 'middle' });
  ctx.strokeStyle = 'rgba(42,212,200,0.12)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, zx + 0.5, zy + 0.5, zw - 1, zh - 1, 10);
  ctx.stroke();

  // file name
  const nlY = dlgY + 208;
  label('FILE NAME', padX, nlY, { weight: 600, size: 9, spacing: 0.2, color: THEME.ink });
  const fldX = padX,
    fldY = nlY + 10,
    fldW = innerW,
    fldH = 40;
  panel(fldX, fldY, fldW, fldH, 8, '#15171b', '#1d2025', { border: ModalData.focused ? THEME.accent : '#3a3f47', inset: true });
  label('.wav', fldX + fldW - 16, fldY + fldH / 2, {
    role: 'mono',
    weight: 500,
    size: 13,
    color: THEME.ink,
    align: 'right',
    baseline: 'middle',
  });
  label(ModalData.name, fldX + 16, fldY + fldH / 2, { role: 'mono', weight: 600, size: 15, color: '#e7eaee', baseline: 'middle' });
  if (ModalData.focused && Math.floor(millis() / 450) % 2 === 0) {
    const cwd = textWidth(ModalData.name),
      cxp = fldX + 16 + cwd + 2;
    ctx.save();
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cxp, fldY + 10);
    ctx.lineTo(cxp, fldY + fldH - 10);
    ctx.stroke();
    ctx.restore();
  }
  pushMhot(fldX, fldY, fldW, fldH, focusNameField);

  // EFFECTS BAKED IN chips — lit if that stage was ON when bounced
  label('EFFECTS BAKED IN', padX, dlgY + 278, { weight: 600, size: 9, spacing: 0.2, color: THEME.ink });
  const chips = [
    ['LOW-PASS', 'lowpass'],
    ['WAVESHAPER', 'waveshaper'],
    ['COMPRESSOR', 'compressor'],
    ['REVERB', 'reverb'],
  ];
  const cgap = 10,
    cy0 = dlgY + 290,
    chH = 30,
    chW = (innerW - cgap * 3) / 4;
  for (let i = 0; i < chips.length; i++) {
    const [txt, key] = chips[i];
    const on = !!(p.config && p.config[key] && p.config[key].on);
    const cxp = padX + i * (chW + cgap);
    panel(cxp, cy0, chW, chH, 7, on ? 'rgba(42,212,200,0.12)' : '#26292e', on ? 'rgba(42,212,200,0.05)' : '#1d2024', {
      border: on ? 'rgba(42,212,200,0.45)' : '#33373e',
    });
    led(cxp + 14, cy0 + chH / 2, 7, THEME.accent, on);
    label(txt, cxp + 26, cy0 + chH / 2, { weight: 700, size: 10, spacing: 0.04, color: on ? '#dffefb' : '#6b7178', baseline: 'middle' });
  }

  // actions: DISCARD · RE-RECORD (left)  |  EXPORT WAV · ADD TO LIBRARY (right)
  const aH = 46,
    aY = dlgY + dlgH - 28 - aH;
  const rightEdge = dlgX + dlgW - 28;

  const disW = 112;
  W.button(padX, aY, disW, aH, '', {});
  label('DISCARD', padX + disW / 2, aY + aH / 2, {
    weight: 700,
    size: 13,
    spacing: 0.06,
    color: '#c98e8e',
    align: 'center',
    baseline: 'middle',
  });
  pushMhot(padX, aY, disW, aH, closeModal);

  const rerX = padX + disW + 10,
    rerW = 150;
  W.button(rerX, aY, rerW, aH, '', {});
  W.icon('loop', rerX + 24, aY + aH / 2, 15, THEME.ink);
  label('RE-RECORD', rerX + rerW / 2 + 12, aY + aH / 2, {
    weight: 700,
    size: 13,
    spacing: 0.06,
    color: THEME.ink,
    align: 'center',
    baseline: 'middle',
  });
  pushMhot(rerX, aY, rerW, aH, () => {
    closeModal();
    rearmBounce();
  });

  // primary: add to library (rightmost, teal)
  const addW = 190,
    addX = rightEdge - addW;
  panel(addX, aY, addW, aH, 9, '#1f6f68', '#23262b', { dropShadow: true });
  W.icon('plus', addX + 26, aY + aH / 2, 14, '#eafffb');
  label('ADD TO LIBRARY', addX + addW / 2 + 10, aY + aH / 2, {
    weight: 700,
    size: 13,
    spacing: 0.06,
    color: '#eafffb',
    align: 'center',
    baseline: 'middle',
  });
  pushMhot(addX, aY, addW, aH, modalConfirm);

  // secondary: export the WAV (download only; leaves the dialog open)
  const expW = 148,
    expX = addX - 10 - expW;
  W.button(expX, aY, expW, aH, '', {});
  W.icon('arrow', expX + 22, aY + aH / 2, 13, THEME.accent);
  label('EXPORT WAV', expX + expW / 2 + 10, aY + aH / 2, {
    weight: 700,
    size: 13,
    spacing: 0.06,
    color: THEME.accent,
    align: 'center',
    baseline: 'middle',
  });
  pushMhot(expX, aY, expW, aH, exportBounceWav);
}
