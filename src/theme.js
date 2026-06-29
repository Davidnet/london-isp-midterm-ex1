/*
 * theme.js — design tokens + low-level canvas drawing primitives.
 *
 * Tokens come straight from the handoff README + the .dc.html mock (colors,
 * finishes, fonts, geometry). Primitives wrap the raw CanvasRenderingContext2D
 * (p5's `drawingContext`) so the rest of the UI can draw gradient panels, LEDs,
 * screws, and skeuomorphic detail that plain p5 fills can't express.
 *
 * Exposes a single `THEME` global plus draw helpers (panel, led, screw, …).
 */

const THEME = {
  accent: '#2ad4c8', // teal (default; cosmetic-swappable later)
  // Panel finishes (default Graphite).
  finishes: {
    Graphite: { a: '#3a3f47', b: '#2b2f35', ink: '#b3b9c1' },
    Cream: { a: '#e9e3d6', b: '#d9d2c2', ink: '#4d473c' },
    Black: { a: '#282b30', b: '#1a1c20', ink: '#c4c9d0' },
  },
  finish: 'Graphite',
  screws: true,

  // Desk backdrop + LCD + record-red + VU colors.
  desk: ['#24282f', '#15171b', '#0c0d10'],
  lcd: ['#08130f', '#040b09'],
  recRed: '#ff4d4d',
  vu: { teal: '#2ad4c8', amber: '#e8b54d', red: '#e85d5d' },

  // Fonts (loaded in preload → set in sketch). weight → p5.Font.
  fonts: { hank: {}, mono: {} },

  // Convenience getters
  get ink() {
    return this.finishes[this.finish].ink;
  },
  get plateA() {
    return this.finishes[this.finish].a;
  },
  get plateB() {
    return this.finishes[this.finish].b;
  },
};

/* ---------------- path + gradient helpers ---------------- */

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Vertical linear gradient between two colors over [y, y+h].
function vGrad(y, h, c1, c2) {
  const g = drawingContext.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  return g;
}

/* ---------------- panel: the workhorse surface ---------------- */

/*
 * A rounded, vertically-graded panel with optional border, outer drop shadow,
 * and inset shadow (recessed look). Used for the rack, modules, buttons, wells.
 */
function panel(x, y, w, h, r, c1, c2, opts = {}) {
  const ctx = drawingContext;
  const { border = '#14171b', dropShadow = false, inset = false, topHighlight = false } = opts;

  ctx.save();
  if (dropShadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.42)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
  }
  ctx.fillStyle = vGrad(y, h, c1, c2);
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  if (inset) {
    // recessed well: dark inner top shadow
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    roundRectPath(ctx, x, y - 3, w, h + 3, r);
    ctx.stroke();
    ctx.restore();
  }

  if (topHighlight) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + r, y + 0.5);
    ctx.lineTo(x + w - r, y + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  if (border) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = border;
    roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();
  }
}

/* ---------------- small parts ---------------- */

// Glowing indicator LED in a dark socket.
function led(cx, cy, d, color, on) {
  const ctx = drawingContext;
  ctx.fillStyle = '#222d30';
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fill();
  if (on) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = d * 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Brushed-metal corner screw with a rotated slot.
function screw(cx, cy, d, angle) {
  if (!THEME.screws) return;
  const ctx = drawingContext;
  const g = ctx.createRadialGradient(cx - d * 0.15, cy - d * 0.2, 1, cx, cy, d / 2);
  g.addColorStop(0, '#7a8088');
  g.addColorStop(0.72, '#34383e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fill();
  // slot
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-d * 0.32, -1, d * 0.64, 2);
  ctx.restore();
}

/* ---------------- text ---------------- */

/*
 * Draw a text label. role picks font+weight; spacing is letter-spacing in em
 * (applied via canvas letterSpacing where supported). align: 'left'|'center'|'right'.
 */
function label(txt, x, y, opts = {}) {
  const {
    role = 'hank',
    weight = 600,
    size = 11,
    color = THEME.ink,
    spacing = 0,
    align = 'left',
    baseline = 'alphabetic',
    upper = false,
  } = opts;

  const fam = THEME.fonts[role];
  const f = fam[weight] || fam[Object.keys(fam)[0]];
  if (f) textFont(f);
  textSize(size);
  fill(color);
  noStroke();
  textAlign(
    align === 'center' ? CENTER : align === 'right' ? RIGHT : LEFT,
    baseline === 'middle' ? CENTER : baseline === 'top' ? TOP : BASELINE
  );

  const ctx = drawingContext;
  const hadSpacing = 'letterSpacing' in ctx;
  if (hadSpacing && spacing) ctx.letterSpacing = spacing + 'em';
  text(upper ? String(txt).toUpperCase() : txt, x, y);
  if (hadSpacing && spacing) ctx.letterSpacing = '0em';
}
