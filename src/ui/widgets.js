/*
 * ui/widgets.js — reusable canvas widgets for the FX Processor.
 *
 * Each widget is a pure draw function in design-space coordinates. They read
 * values from config but don't own state; interaction is wired in sketch.js via
 * the immediate-mode hit list. Slice 1 renders everything; knob/fader DRAG
 * editing arrives in Slice 2.
 *
 * Also holds the param→normalized-angle and param→display-string mappings that
 * turn real engine values (1240 Hz, 0.012 s) into the mock's readouts (1.24 kHz,
 * 12 ms) and knob indicator angles.
 *
 * Exposes a `W` global (the widget namespace)
 */

const W = {};

/* ---------------- value ↔ display / angle mapping ---------------- */

// Normalize an actual param value to 0..1 within its range (log for cutoff).
function paramNorm(stage, param, value) {
  const r = (PARAM_RANGES[stage] || {})[param];
  if (!r || r.min === undefined) return 0;
  if (r.db) {
    // gain → dBFS → 0..1 across a −60…0 dB taper (knob rotates linearly in dB)
    const floor = -60;
    const db = 20 * Math.log10(Math.max(0.001, value));
    return Math.min(1, Math.max(0, (db - floor) / (0 - floor)));
  }
  if (r.log) {
    const lo = Math.log(r.min),
      hi = Math.log(r.max);
    return (Math.log(Math.max(r.min, value)) - lo) / (hi - lo);
  }
  return (value - r.min) / (r.max - r.min);
}

// Inverse of paramNorm: 0..1 → actual value (used by Slice 2 drag editing).
function paramDenorm(stage, param, t) {
  const r = (PARAM_RANGES[stage] || {})[param];
  if (!r || r.min === undefined) return t;
  t = Math.min(1, Math.max(0, t));
  if (r.db) {
    if (t <= 0) return 0; // true silence at the very bottom
    const floor = -60;
    return Math.pow(10, (floor + t * (0 - floor)) / 20); // dB taper → linear gain
  }
  if (r.log) {
    const lo = Math.log(r.min),
      hi = Math.log(r.max);
    return Math.exp(lo + t * (hi - lo));
  }
  return r.min + t * (r.max - r.min);
}

// Indicator angle in radians: -135° + value·270° (README geometry).
function knobAngle(stage, param, value) {
  return ((-135 + paramNorm(stage, param, value) * 270) * Math.PI) / 180;
}

// Human-readable readout for a param, matching the mock's strings.
function paramDisplay(stage, param, value) {
  switch (stage + '.' + param) {
    case 'lowpass.cutoff':
      return value >= 1000 ? (value / 1000).toFixed(2) + ' kHz' : Math.round(value) + ' Hz';
    case 'lowpass.res':
      return value.toFixed(1);
    case 'waveshaper.amount':
      return '+' + Math.round(value * 32) + ' dB';
    case 'compressor.threshold':
      return Math.round(value) + ' dB';
    case 'compressor.ratio':
      return value.toFixed(1) + ':1';
    case 'compressor.attack':
      return Math.round(value * 1000) + ' ms';
    case 'compressor.knee':
      return Math.round(value) + ' dB';
    case 'compressor.release':
      return Math.round(value * 1000) + ' ms';
    case 'reverb.duration':
      return value.toFixed(1) + ' s';
    case 'reverb.decay':
      return value.toFixed(1);
    case 'master.volume':
      return (20 * Math.log10(Math.max(0.001, value))).toFixed(0) + ' dB';
    default:
      return String(value);
  }
}

/* ---------------- knob (Ø60) ---------------- */

W.knob = function (cx, cy, lbl, disp, angle, accent) {
  const ctx = drawingContext;
  const R = 30;

  // knurled ring (conic gradient approximation via radial wedges)
  ctx.save();
  for (let a = 0; a < 360; a += 12) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ((a - 90) * Math.PI) / 180, ((a - 90 + 6) * Math.PI) / 180);
    ctx.fillStyle = '#464c55';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ((a - 90 + 6) * Math.PI) / 180, ((a - 90 + 12) * Math.PI) / 180);
    ctx.fillStyle = '#2a2e34';
    ctx.fill();
  }
  ctx.restore();

  // dark cap
  const cap = ctx.createRadialGradient(cx - 8, cy - 9, 2, cx, cy, R - 9);
  cap.addColorStop(0, '#474c54');
  cap.addColorStop(0.74, '#20232a');
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 9, 0, Math.PI * 2);
  ctx.fill();

  // indicator
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.shadowColor = accent;
  ctx.shadowBlur = 7;
  ctx.fillStyle = accent;
  roundRectPath(ctx, -1.5, -(R - 6), 3, 14, 1.5);
  ctx.fill();
  ctx.restore();

  // labels
  label(lbl, cx, cy + R + 12, { weight: 600, size: 9, spacing: 0.09, align: 'center', upper: true });
  label(disp, cx, cy + R + 25, { role: 'mono', weight: 500, size: 11, color: accent, align: 'center' });
};

/* ---------------- horizontal fader (mix) ---------------- */

W.fader = function (x, y, w, lbl, pct, disp, accent) {
  // Label, track groove, cap and readout all share the centerline `y`.
  label(lbl, x, y, { weight: 600, size: 9, spacing: 0.08, baseline: 'middle' });
  const trackX = x + 56,
    trackW = w - 56 - 40;
  panel(trackX, y - 5, trackW, 10, 5, '#15171b', '#23262b', { border: null, inset: true });

  const capX = trackX + (pct / 100) * trackW;
  const ctx = drawingContext;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = vGrad(y - 12, 24, '#5b616b', '#2b2f35');
  roundRectPath(ctx, capX - 10, y - 12, 20, 24, 5);
  ctx.fill();
  ctx.restore();
  // teal center line on the cap
  ctx.fillStyle = accent;
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 5;
  ctx.fillRect(capX - 7, y - 1, 14, 2);
  ctx.restore();

  label(disp, x + w, y, { role: 'mono', weight: 500, size: 11, color: accent, align: 'right', baseline: 'middle' });
};

/* ---------------- segmented control ---------------- */

// opts: array of {text, active}. Returns array of hit rects [{x,y,w,h,index}].
W.segmented = function (x, y, lbl, opts, accent) {
  label(lbl, x, y + 9, { weight: 600, size: 9, spacing: 0.1, baseline: 'middle' });
  let ox = x + 84;
  const rects = [];
  for (let i = 0; i < opts.length; i++) {
    const tw = textApproxWidth(opts[i].text, 11) + 26;
    panel(ox, y, tw, 26, 6, '#33373e', '#262a30');
    if (opts[i].active) {
      const ctx = drawingContext;
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 8;
      roundRectPath(ctx, ox - 1, y - 1, tw + 2, 28, 7);
      ctx.stroke();
      ctx.restore();
    }
    label(opts[i].text, ox + tw / 2, y + 13, { weight: 600, size: 11, align: 'center', baseline: 'middle' });
    rects.push({ x: ox, y, w: tw, h: 26, index: i });
    ox += tw + 6;
  }
  return rects;
};

/* ---------------- toggle switch (pill) ---------------- */

// Two sizes used in mock: title 34x17, inline 34x17, micro 28x14.
W.toggle = function (x, y, w, h, on, accent) {
  panel(x, y, w, h, h / 2, '#14171b', '#202329', { border: null, inset: true });
  const knobD = h - 4;
  const kx = on ? x + w - knobD - 2 : x + 2;
  const ctx = drawingContext;
  if (on) {
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 7;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(kx + knobD / 2, y + h / 2, knobD / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = vGrad(y + 2, knobD, '#4a4e54', '#2c3036');
    ctx.beginPath();
    ctx.arc(kx + knobD / 2, y + h / 2, knobD / 2, 0, Math.PI * 2);
    ctx.fill();
  }
};

// Square micro-switch used in the chain strip (28x14, slides a square cap).
W.microSwitch = function (x, y, on) {
  panel(x, y, 28, 14, 3, '#14171b', '#202329', { border: null, inset: true });
  const ctx = drawingContext;
  ctx.fillStyle = on ? vGrad(y + 1, 12, '#5b616b', '#2c3036') : vGrad(y + 1, 12, '#3a3e44', '#23262b');
  const cx = on ? x + 28 - 13 : x + 1;
  roundRectPath(ctx, cx, y + 1, 12, 12, 2);
  ctx.fill();
};

/* ---------------- transport / generic raised button ---------------- */

W.button = function (x, y, w, h, glyph, opts = {}) {
  const { size = 14, color = THEME.ink, c1 = '#3b3f47', c2 = '#23262b', spacing = 0 } = opts;
  panel(x, y, w, h, 8, c1, c2, { dropShadow: true, topHighlight: true });
  label(glyph, x + w / 2, y + h / 2, { weight: 700, size, color, align: 'center', baseline: 'middle', spacing });
};

/* ---------------- LCD spectrum panel ---------------- */

W.spectrum = function (x, y, w, h, title, spec, accent, opts = {}) {
  const { barColor = accent, glow = false, scanT = 0, redOverlay = false } = opts;
  const ctx = drawingContext;

  // screen well
  ctx.save();
  ctx.fillStyle = vGrad(y, h, THEME.lcd[0], THEME.lcd[1]);
  roundRectPath(ctx, x, y, w, h, 9);
  ctx.fill();
  ctx.restore();
  // scanlines
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 9);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let yy = y; yy < y + h; yy += 3) ctx.fillRect(x, yy, w, 1);
  ctx.restore();

  // header text
  label(title, x + 12, y + 16, { role: 'mono', weight: 500, size: 10, color: title.includes('OUT') ? accent : '#5f7d77', spacing: 0.2 });
  label(title.includes('OUT') ? 'processed' : 'original', x + w - 12, y + 16, {
    role: 'mono',
    weight: 500,
    size: 10,
    color: '#3f5e58',
    align: 'right',
  });

  // bars
  const padX = 12,
    padBottom = 22,
    padTop = 26;
  const areaX = x + padX,
    areaW = w - padX * 2;
  const areaBottom = y + h - padBottom,
    areaH = h - padTop - padBottom;
  const N = 26;
  const bw = areaW / N;
  for (let i = 0; i < N; i++) {
    let v = 0;
    if (spec && spec.length) {
      const idx = Math.floor((i / N) * spec.length);
      v = spec[idx] / 255;
    }
    const bh = Math.max(1, v * areaH);
    if (glow) {
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = 7;
    }
    ctx.fillStyle = barColor;
    roundRectPath(ctx, areaX + i * bw + 1, areaBottom - bh, bw - 2, bh, 2);
    ctx.fill();
    if (glow) ctx.restore();
  }

  // freq ticks
  const ticks = ['50', '200', '1k', '5k', '20k'];
  for (let i = 0; i < ticks.length; i++) {
    const tx = areaX + (i / (ticks.length - 1)) * areaW;
    label(ticks[i], tx, y + h - 7, {
      role: 'mono',
      weight: 500,
      size: 8,
      color: '#34534d',
      align: i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center',
    });
  }

  // scan line
  const sx = areaX + scanT * areaW;
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(150,230,220,0.55)';
  ctx.fillRect(sx, y + 8, 2, h - 30);
  ctx.restore();

  // glass highlight
  ctx.save();
  const gl = ctx.createLinearGradient(x, y, x + w * 0.6, y + h * 0.6);
  gl.addColorStop(0, 'rgba(255,255,255,0.10)');
  gl.addColorStop(0.42, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  roundRectPath(ctx, x, y, w, h, 9);
  ctx.fill();
  ctx.restore();

  // bounce-red overlay
  if (redOverlay) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,60,60,0.10)';
    roundRectPath(ctx, x, y, w, h, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,77,77,0.5)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 8);
    ctx.stroke();
    ctx.restore();
  }

  // hairline border
  ctx.strokeStyle = 'rgba(42,212,200,0.12)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 9);
  ctx.stroke();
};

/* ---------------- output VU meter (14 segments) ---------------- */

W.vu = function (x, y, level) {
  const N = 14,
    segW = 5,
    gap = 2,
    segH = 13;
  const lit = Math.round(Math.min(1, level / 0.35) * N);
  for (let i = 0; i < N; i++) {
    const sx = x + i * (segW + gap);
    let col = '#1b2422';
    if (i < lit) col = i < 9 ? THEME.vu.teal : i < 12 ? THEME.vu.amber : THEME.vu.red;
    const ctx = drawingContext;
    if (i < lit) {
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 5;
    }
    ctx.fillStyle = col;
    roundRectPath(ctx, sx, y, segW, segH, 1);
    ctx.fill();
    if (i < lit) ctx.restore();
  }
};

/* ---------------- vector icons ---------------- */

/*
 * Draw an icon as a vector shape (NOT a font glyph). The vendored fonts lack
 * symbols like ▶ ■ ↻ ⇤ ► ＋ and p5 canvas text has no system fallback, so these
 * would render as tofu boxes. Drawing them keeps the unit self-contained.
 * `s` is the icon's bounding box size; cx,cy is its center.
 */
W.icon = function (type, cx, cy, s, color) {
  const ctx = drawingContext;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const r = s / 2;

  switch (type) {
    case 'play':
    case 'tri': {
      // right-pointing triangle
      const w = type === 'tri' ? s * 0.42 : r * 0.84;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy - r * 0.82);
      ctx.lineTo(cx - r * 0.62, cy + r * 0.82);
      ctx.lineTo(cx + (type === 'tri' ? w : r * 0.84), cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pause': {
      const bw = s * 0.2,
        gap = s * 0.18,
        bh = s * 0.84;
      roundRectPath(ctx, cx - gap / 2 - bw, cy - bh / 2, bw, bh, 1);
      ctx.fill();
      roundRectPath(ctx, cx + gap / 2, cy - bh / 2, bw, bh, 1);
      ctx.fill();
      break;
    }
    case 'stop': {
      const side = s * 0.74;
      roundRectPath(ctx, cx - side / 2, cy - side / 2, side, side, 2);
      ctx.fill();
      break;
    }
    case 'loop': {
      // refresh-style circular arrow with a gap + arrowhead at top
      const R = r * 0.66;
      ctx.lineWidth = s * 0.14;
      const top = -Math.PI / 2,
        gap = 0.55;
      const aEnd = top - gap + Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, top + gap, aEnd);
      ctx.stroke();
      // arrowhead at the end of the arc, pointing along travel (clockwise)
      const px = cx + Math.cos(aEnd) * R,
        py = cy + Math.sin(aEnd) * R;
      const tx = -Math.sin(aEnd),
        ty = Math.cos(aEnd); // tangent (travel dir)
      const nx = Math.cos(aEnd),
        ny = Math.sin(aEnd); // radial
      const L = s * 0.22,
        Wd = s * 0.17;
      ctx.beginPath();
      ctx.moveTo(px + tx * L, py + ty * L);
      ctx.lineTo(px + nx * Wd, py + ny * Wd);
      ctx.lineTo(px - nx * Wd, py - ny * Wd);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'skip': {
      // ⇤ : bar on the left + left-pointing triangle
      const bw = s * 0.12,
        bh = s * 0.8;
      roundRectPath(ctx, cx - r * 0.7, cy - bh / 2, bw, bh, 1);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.6, cy - r * 0.72);
      ctx.lineTo(cx + r * 0.6, cy + r * 0.72);
      ctx.lineTo(cx - r * 0.32, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'plus': {
      const t = s * 0.2,
        l = s * 0.82;
      roundRectPath(ctx, cx - t / 2, cy - l / 2, t, l, 1);
      ctx.fill();
      roundRectPath(ctx, cx - l / 2, cy - t / 2, l, t, 1);
      ctx.fill();
      break;
    }
    case 'arrow': {
      // →
      ctx.lineWidth = s * 0.12;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.8, cy);
      ctx.lineTo(cx + r * 0.3, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.8, cy);
      ctx.lineTo(cx + r * 0.1, cy - r * 0.45);
      ctx.lineTo(cx + r * 0.1, cy + r * 0.45);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'note': {
      // ♪
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.35, cy + r * 0.45, r * 0.34, r * 0.26, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.04, cy + r * 0.45);
      ctx.lineTo(cx - r * 0.04, cy - r * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.04, cy - r * 0.7);
      ctx.quadraticCurveTo(cx + r * 0.5, cy - r * 0.55, cx + r * 0.35, cy - r * 0.1);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
};

/* ---------------- helpers ---------------- */

// Rough text width without committing a font (segmented sizing before draw).
function textApproxWidth(txt, size) {
  return String(txt).length * size * 0.62;
}
