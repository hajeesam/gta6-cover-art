// Palm Heist — Cover Studio: the cover engine.
// Draws a multi-panel GTA-style poster cover onto any canvas, at any size.
// Every panel is graded (posterize + duotone + optional halftone), then the
// lettering, badge, HEAT meter, barcode and location tab are painted on top.
// No network, no library: plain Canvas 2D, local fonts only.

export const LAYOUTS = [
  { id: 'hero-left', label: 'Hero Left' },
  { id: 'hero-right', label: 'Hero Right' },
  { id: 'nine-grid', label: 'Nine Grid + Center Title' },
  { id: 'tilted', label: 'Tilted Snapshots' },
  { id: 'full-bleed', label: 'Full Bleed' },
  { id: 'center-3x3', label: 'Center Title 3x3' },
];

export const GRADES = [
  { id: 'heatwave', label: 'Heatwave Halftone' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'neon', label: 'Neon Night' },
  { id: 'golden', label: 'Golden Hour' },
  { id: 'mono', label: 'Vice Mono' },
];

// Duotone stops per grade: [shadow, mid, highlight] + posterize levels.
const GRADE_TABLE = {
  heatwave: { levels: 4, stops: ['#1B0B2E', '#E2388A', '#FFD24A'], halftone: true, overlay: ['#FF7A1A', '#FF2E93'], overlayAlpha: 0.18, warm: 0 },
  sunset: { levels: 6, stops: ['#2A0E2E', '#FF6B35', '#FFD24A'], halftone: false, overlay: ['#FF9A3D', '#E2388A'], overlayAlpha: 0.22, warm: 18 },
  neon: { levels: 5, stops: ['#04121A', '#0E7C86', '#FF2E93'], halftone: false, overlay: ['#3FF6E0', '#FF2E93'], overlayAlpha: 0.16, warm: -10 },
  golden: { levels: 5, stops: ['#241204', '#C77B1E', '#FFE45C'], halftone: false, overlay: ['#FFB347', '#FF7A1A'], overlayAlpha: 0.2, warm: 26 },
  mono: { levels: 3, stops: ['#0A0410', '#5B2A86', '#E9D5FF'], halftone: true, overlay: ['#7C3AED', '#1B0B2E'], overlayAlpha: 0.12, warm: 0 },
};

const PANEL_LABELS = ['BOULEVARD', 'PIER', 'SUNSET', 'LEONIDA', 'VICE', 'PALMS', 'NIGHT', 'HEAT', 'COAST'];

/** A fresh editor state: two sample photos filling the panels by default. */
export function createDefaultState() {
  return {
    title: 'PALM HEIST',
    subtitle: 'one more sunset',
    tagline: 'EVERY STREET TELLS A STORY',
    location: 'LEONIDA',
    layout: 'hero-left',
    grade: 'heatwave',
    grain: true,
    vignette: true,
    photos: [null, null, null, null],
    // One slot per panel (max 9): which photo index it shows, its crop, its sticker label.
    panels: PANEL_LABELS.map((label, i) => ({
      photo: i % 2,
      label,
      crop: { ox: 0, oy: 0, zoom: 1 },
    })),
  };
}

export function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load image'));
    img.src = url;
  });
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      loadImageFromUrl(reader.result).then(resolve, reject);
    };
    reader.onerror = () => reject(new Error('could not read file'));
    reader.readAsDataURL(file);
  });
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Posterize + duotone-map one panel's pixels, in place, for the given grade. */
export function gradePanelPixels(imageData, gradeId) {
  const spec = GRADE_TABLE[gradeId] || GRADE_TABLE.heatwave;
  const data = imageData.data;
  const shadow = hexToRgb(spec.stops[0]);
  const mid = hexToRgb(spec.stops[1]);
  const high = hexToRgb(spec.stops[2]);
  const steps = spec.levels - 1;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const post = Math.round(lum * steps) / steps;
    const mapped = post < 0.5 ? mixRgb(shadow, mid, post * 2) : mixRgb(mid, high, (post - 0.5) * 2);
    // Keep a whisper of the original hue so faces stay readable.
    data[i] = mapped[0] * 0.88 + r * 0.12;
    data[i + 1] = mapped[1] * 0.88 + g * 0.12;
    data[i + 2] = mapped[2] * 0.88 + b * 0.12;
    if (spec.warm) {
      data[i] = Math.min(255, data[i] + spec.warm);
      data[i + 2] = Math.max(0, data[i + 2] - spec.warm * 0.6);
    }
  }
  return spec;
}

/** Grade one photo into an offscreen canvas the size of its panel. */
export function gradePhotoToPanel(photo, panelW, panelH, crop, gradeId) {
  const spec = GRADE_TABLE[gradeId] || GRADE_TABLE.heatwave;
  const w = Math.max(8, Math.min(900, Math.round(panelW)));
  const h = Math.max(8, Math.round((panelH / panelW) * w));
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  if (photo) {
    const iw = photo.naturalWidth || photo.width;
    const ih = photo.naturalHeight || photo.height;
    const scale = Math.max(w / iw, h / ih) * (crop.zoom || 1);
    const pw = iw * scale;
    const ph = ih * scale;
    const dx = (w - pw) / 2 + (crop.ox || 0) * w * 0.4;
    const dy = (h - ph) / 2 + (crop.oy || 0) * h * 0.4;
    octx.drawImage(photo, dx, dy, pw, ph);
  } else {
    const g = octx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#3A1454');
    g.addColorStop(1, '#12061F');
    octx.fillStyle = g;
    octx.fillRect(0, 0, w, h);
  }
  const imageData = octx.getImageData(0, 0, w, h);
  gradePanelPixels(imageData, gradeId);
  octx.putImageData(imageData, 0, 0);
  if (spec.halftone) paintHalftone(octx, imageData, w, h);
  // Sunset wash, soft-light so the duotone still reads through.
  const wash = octx.createLinearGradient(0, 0, w, h);
  wash.addColorStop(0, spec.overlay[0]);
  wash.addColorStop(1, spec.overlay[1]);
  octx.globalCompositeOperation = 'soft-light';
  octx.globalAlpha = spec.overlayAlpha * 2.2;
  octx.fillStyle = wash;
  octx.fillRect(0, 0, w, h);
  octx.globalCompositeOperation = 'source-over';
  octx.globalAlpha = 1;
  return off;
}

/** Halftone dots: oval dots on a 45-degree grid, radius from luminance. */
export function paintHalftone(ctx, imageData, w, h) {
  const spacing = Math.max(6, Math.round(w / 140));
  const data = imageData.data;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(Math.PI / 4);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = '#1B0B2E';
  const diag = Math.ceil(Math.hypot(w, h));
  for (let y = -diag / 2; y < diag / 2; y += spacing) {
    for (let x = -diag / 2; x < diag / 2; x += spacing) {
      const px = Math.round(x + w / 2);
      const py = Math.round(y + h / 2);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const i = (py * w + px) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      const r = (1 - lum) * spacing * 0.62;
      if (r < 0.6) continue;
      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, r, r * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Panel rectangles (fractions of the canvas) for a layout at this size. */
export function panelRects(layout, W, H) {
  const portrait = H > W * 1.08;
  const gap = 0.012;
  if (layout === 'full-bleed') {
    return [{ x: 0, y: 0, w: W, h: H, rot: 0 }];
  }
  if (layout === 'nine-grid' || layout === 'center-3x3') {
    const cells = [];
    const cw = (W * (1 - gap * 4)) / 3;
    const ch = (H * (1 - gap * 4)) / 3;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        cells.push({
          x: W * gap + col * (cw + W * gap),
          y: H * gap + row * (ch + H * gap),
          w: cw, h: ch, rot: 0,
          titleCell: row === 1 && col === 1,
        });
      }
    }
    return cells;
  }
  if (layout === 'tilted') {
    if (portrait) {
      return [
        { x: W * 0.06, y: H * 0.05, w: W * 0.86, h: H * 0.34, rot: -0.24 },
        { x: W * 0.08, y: H * 0.38, w: W * 0.8, h: H * 0.3, rot: 0.16 },
        { x: W * 0.05, y: H * 0.66, w: W * 0.88, h: H * 0.28, rot: -0.38 },
      ];
    }
    return [
      { x: W * 0.04, y: H * 0.1, w: W * 0.42, h: H * 0.72, rot: -0.24 },
      { x: W * 0.36, y: H * 0.06, w: W * 0.4, h: H * 0.8, rot: 0.16 },
      { x: W * 0.62, y: H * 0.14, w: W * 0.36, h: H * 0.68, rot: -0.38 },
    ];
  }
  // Hero layouts.
  const mirror = layout === 'hero-right';
  if (portrait) {
    const hero = { x: W * 0.04, y: H * 0.04, w: W * 0.92, h: H * 0.46, rot: -0.03, hero: true };
    const small = [0, 1, 2].map((i) => ({
      x: W * (0.04 + i * 0.32), y: H * 0.53, w: W * 0.28, h: H * 0.22, rot: 0.05,
    }));
    return [hero, ...small];
  }
  const hero = mirror
    ? { x: W * 0.42, y: H * 0.06, w: W * 0.54, h: H * 0.8, rot: 0.03, hero: true }
    : { x: W * 0.035, y: H * 0.06, w: W * 0.54, h: H * 0.8, rot: -0.03, hero: true };
  const sx = mirror ? W * 0.035 : W * 0.615;
  const small = [0, 1, 2].map((i) => ({
    x: sx, y: H * (0.06 + i * 0.27), w: W * 0.35, h: H * 0.24, rot: 0.05,
  }));
  return [hero, ...small];
}

function drawPanelWithSeam(ctx, graded, rect, W) {
  ctx.save();
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(rect.rot || 0);
  // Slanted clip: top edge sheared 4 degrees, the GTA poster cut.
  const shear = rect.w * 0.035;
  ctx.beginPath();
  ctx.moveTo(-rect.w / 2 + shear, -rect.h / 2);
  ctx.lineTo(rect.w / 2, -rect.h / 2);
  ctx.lineTo(rect.w / 2 - shear, rect.h / 2);
  ctx.lineTo(-rect.w / 2, rect.h / 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(graded, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
  ctx.restore();
  // Neon magenta seam + glow around the panel.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rect.rot || 0);
  ctx.strokeStyle = '#FF2E93';
  ctx.lineWidth = Math.max(3, W * 0.003);
  ctx.shadowColor = '#FF2E93';
  ctx.shadowBlur = Math.max(10, W * 0.012);
  ctx.strokeRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
  ctx.restore();
}

function drawSticker(ctx, text, x, y, scale, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `${Math.round(26 * scale)}px Anton, sans-serif`;
  const w = ctx.measureText(text).width + 28 * scale;
  const h = 40 * scale;
  ctx.fillStyle = '#FFF6D8';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#12061F';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 2 * scale);
  ctx.restore();
}

function drawStarburst(ctx, cx, cy, r, scale) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.2);
  ctx.beginPath();
  const points = 16;
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * 0.78;
    const a = (i / (points * 2)) * Math.PI * 2;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#FFD24A';
  ctx.shadowColor = 'rgba(255,46,147,0.8)';
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#05030F';
  ctx.stroke();
  ctx.fillStyle = '#05030F';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(22 * scale)}px Anton, sans-serif`;
  ctx.fillText('EST.', 0, -12 * scale);
  ctx.fillText('2026', 0, 12 * scale);
  ctx.restore();
}

function drawStars(ctx, x, y, size, filled) {
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 5; i++) {
    const cx = i * size * 1.25;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 === 0 ? size / 2 : size / 4.5;
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = i < filled ? '#3FF6E0' : 'rgba(255,255,255,0.25)';
    ctx.shadowColor = i < filled ? '#3FF6E0' : 'transparent';
    ctx.shadowBlur = i < filled ? 10 : 0;
    ctx.fill();
  }
  ctx.restore();
}

function drawBarcode(ctx, x, y, w, h, seed) {
  ctx.save();
  ctx.fillStyle = '#FFF6D8';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#05030F';
  let px = x + 4;
  let s = seed;
  while (px < x + w - 4) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const bw = 2 + (s % 5);
    if (s % 3 !== 0) ctx.fillRect(px, y + 3, bw, h - 6);
    px += bw + 2;
  }
  ctx.restore();
}

function fitTitleSize(ctx, lines, maxW, start) {
  let size = start;
  while (size > 20) {
    ctx.font = `${size}px Anton, sans-serif`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= maxW) return size;
    size -= 4;
  }
  return size;
}

function paintTitleBlock(ctx, state, zone, W, H, reserve) {
  const scale = W / 1920;
  const lines = state.title.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const titleLines = lines.length > 1 ? [lines.slice(0, -1).join(' '), lines[lines.length - 1]] : lines;
  const startSize = Math.round(Math.min(230, zone.h * 0.42) * Math.max(0.7, scale) + 40);
  let size = fitTitleSize(ctx, titleLines, zone.w, startSize);
  // Shrink until title + subtitle fit inside the zone (the nine-grid center cell is small),
  // leaving `reserve` pixels at the foot for the tagline, stars and barcode.
  // The height below mirrors the y accumulation in the drawing loop exactly:
  // first baseline at size*0.95, one size*0.98 step per line, then the subtitle.
  const blockHeight = (s) => s * 0.95 + titleLines.length * s * 0.98 + (state.subtitle.trim() ? Math.max(30, s * 0.34) : 0);
  while (size > 20 && blockHeight(size) > zone.h - (reserve || 0)) size -= 4;
  const grad = ctx.createLinearGradient(zone.x, zone.y, zone.x + zone.w, zone.y + zone.h);
  grad.addColorStop(0, '#FFE45C');
  grad.addColorStop(0.5, '#FF7A1A');
  grad.addColorStop(1, '#FF2E93');
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  let y = zone.y + size * 0.95;
  titleLines.forEach((line, i) => {
    const lx = zone.x + (i === 1 ? size * 0.12 : 0);
    ctx.font = `${size}px Anton, sans-serif`;
    // Hard offset shadow, then black outline, then gradient fill.
    ctx.fillStyle = '#05030F';
    ctx.fillText(line, lx + size * 0.045, y + size * 0.045);
    ctx.lineWidth = Math.max(6, size * 0.055);
    ctx.strokeStyle = '#05030F';
    ctx.strokeText(line, lx, y);
    ctx.fillStyle = grad;
    ctx.fillText(line, lx, y);
    y += size * 0.98;
  });
  // Script subtitle tucked under the title, cyan with a magenta glow.
  if (state.subtitle.trim()) {
    const subSize = Math.round(Math.max(30, size * 0.34));
    ctx.font = `${subSize}px Pacifico, cursive`;
    ctx.fillStyle = '#3FF6E0';
    ctx.shadowColor = '#FF2E93';
    ctx.shadowBlur = 22;
    ctx.fillText(state.subtitle.trim(), zone.x + size * 0.1, y + subSize * 0.55);
    ctx.shadowBlur = 0;
    y += subSize;
  }
  ctx.restore();
  return { bottom: y, size, zone };
}

function drawGrain(ctx, W, H) {
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.06;
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.hypot(W, H) / 1.5);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(5,3,15,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Draw the whole cover for `state` onto `canvas` (at its own pixel size). */
export function renderCover(canvas, state) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const scale = W / 1920;
  const portrait = H > W * 1.08;
  ctx.fillStyle = '#12061F';
  ctx.fillRect(0, 0, W, H);

  const rects = panelRects(state.layout, W, H);
  rects.forEach((rect, i) => {
    if (rect.titleCell) return; // center cell is the title block, not a photo
    const panel = state.panels[i % state.panels.length];
    const photo = panel && panel.photo >= 0 ? state.photos[panel.photo] : null;
    const graded = gradePhotoToPanel(photo, rect.w, rect.h, panel ? panel.crop : { ox: 0, oy: 0, zoom: 1 }, state.grade);
    drawPanelWithSeam(ctx, graded, rect, W);
    // The top-right small panel sits under the title block, so its sticker
    // would hide behind the lettering — skip it there.
    const topSmallHidden = (state.layout === 'hero-left' || state.layout === 'hero-right') && i === 1;
    if (panel && panel.label && state.layout !== 'full-bleed' && !rect.hero && !topSmallHidden) {
      drawSticker(ctx, panel.label, rect.x + rect.w / 2, rect.y + rect.h - 22 * scale - 8, Math.max(0.5, scale), 0.05);
    }
  });

  // Title zone per layout.
  let zone;
  if (state.layout === 'nine-grid') {
    const cell = rects[4];
    zone = { x: cell.x + cell.w * 0.06, y: cell.y + cell.h * 0.08, w: cell.w * 0.92, h: cell.h * 0.84 };
    ctx.fillStyle = '#12061F';
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
  } else if (state.layout === 'center-3x3') {
    zone = { x: W * 0.22, y: H * 0.36, w: W * 0.56, h: H * 0.3 };
    ctx.save();
    ctx.fillStyle = 'rgba(18,6,31,0.82)';
    ctx.fillRect(zone.x - 20, zone.y - 20, zone.w + 40, zone.h + 60);
    ctx.restore();
  } else if (state.layout === 'tilted') {
    zone = portrait
      ? { x: W * 0.08, y: H * 0.02, w: W * 0.84, h: H * 0.2 }
      : { x: W * 0.3, y: H * 0.02, w: W * 0.62, h: H * 0.3 };
  } else if (state.layout === 'full-bleed') {
    zone = portrait
      ? { x: W * 0.06, y: H * 0.62, w: W * 0.88, h: H * 0.3 }
      : { x: W * 0.05, y: H * 0.58, w: W * 0.7, h: H * 0.36 };
  } else if (state.layout === 'hero-right') {
    zone = portrait
      ? { x: W * 0.06, y: H * 0.3, w: W * 0.88, h: H * 0.2 }
      : { x: W * 0.03, y: H * 0.03, w: W * 0.44, h: H * 0.38 };
  } else {
    zone = portrait
      ? { x: W * 0.06, y: H * 0.3, w: W * 0.88, h: H * 0.2 }
      : { x: W * 0.55, y: H * 0.03, w: W * 0.42, h: H * 0.38 };
  }
  const isGrid = state.layout === 'nine-grid' || state.layout === 'center-3x3';
  const titleInfo = paintTitleBlock(ctx, state, zone, W, H, isGrid ? zone.h * 0.26 : 0);

  // Grid layouts have no free margin: the tagline, HEAT stars and barcode
  // live inside the title cell instead of as overlays on the photos.
  if (isGrid) {
    const tz = titleInfo.zone;
    const ts = Math.max(14, titleInfo.size * 0.14);
    ctx.save();
    ctx.fillStyle = '#FFD24A';
    ctx.font = `${Math.round(ts)}px Anton, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try { ctx.letterSpacing = `${Math.round(3 * scale)}px`; } catch (e) { /* older canvas */ }
    const tagY = titleInfo.bottom + ts * 0.9;
    ctx.fillText(state.tagline.trim().toUpperCase(), tz.x + tz.w / 2, tagY);
    try { ctx.letterSpacing = '0px'; } catch (e) { /* ignore */ }
    ctx.restore();
    drawStars(ctx, tz.x + tz.w / 2 - 5 * Math.max(10, 18 * scale) * 1.25 / 2, tagY + ts * 1.1, Math.max(10, 18 * scale), 5);
    drawBarcode(ctx, tz.x + tz.w * 0.18, tagY + ts * 2.4, tz.w * 0.64, Math.max(12, 20 * scale), state.title.length * 7 + 13);
  }

  // Tagline bar, slanted -2 degrees, as wide as the hero. Grid layouts and
  // full-bleed carry their words inside the title block instead.
  if (state.tagline.trim() && !isGrid && state.layout !== 'full-bleed') {
    const barW = portrait ? W * 0.92 : W * 0.54;
    const barX = portrait ? W * 0.04 : (state.layout === 'hero-right' ? W * 0.42 : W * 0.035);
    const barY = state.layout === 'tilted' ? H * 0.95 : (portrait ? H * 0.78 : H * 0.88);
    ctx.save();
    ctx.translate(barX + barW / 2, barY);
    ctx.rotate(-0.035);
    ctx.fillStyle = '#FF2E93';
    ctx.shadowColor = '#FF2E93';
    ctx.shadowBlur = 16;
    const barH = Math.max(28, 44 * scale);
    ctx.fillRect(-barW / 2, -barH / 2, barW, barH);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#FFF6D8';
    ctx.font = `${Math.round(Math.max(16, 28 * scale))}px Anton, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try { ctx.letterSpacing = `${Math.round(4 * scale)}px`; } catch (e) { /* older canvas */ }
    ctx.fillText(state.tagline.trim().toUpperCase(), 0, 1);
    try { ctx.letterSpacing = '0px'; } catch (e) { /* ignore */ }
    ctx.restore();
  }

  // Starburst badge on the hero's top-left corner.
  const heroRect = rects.find((r) => r.hero) || rects[0];
  drawStarburst(ctx, heroRect.x + 90 * scale, heroRect.y + 80 * scale, Math.max(34, 62 * scale), Math.max(0.6, scale));

  // Location tab, top-right.
  ctx.save();
  ctx.fillStyle = '#FFD24A';
  ctx.font = `${Math.round(Math.max(16, 26 * scale))}px Anton, sans-serif`;
  const locText = (state.location || 'LEONIDA').toUpperCase();
  const locW = ctx.measureText(locText).width + 36 * scale;
  const tabX = W - locW - W * 0.02;
  const tabY = H * 0.015;
  const tabH = Math.max(26, 40 * scale);
  ctx.fillRect(tabX, tabY, locW, tabH);
  ctx.fillStyle = '#05030F';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(locText, tabX + locW / 2, tabY + tabH / 2 + 1);
  ctx.restore();

  // HEAT meter + barcode strip, bottom-right corner, clear of the canvas edge.
  // (Grid layouts already drew theirs inside the title cell, above.)
  if (!isGrid) {
    const meterY = H - Math.max(72, 104 * scale);
    ctx.save();
    ctx.fillStyle = '#FFF6D8';
    ctx.font = `${Math.round(Math.max(14, 22 * scale))}px Anton, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HEAT', W * 0.62, meterY);
    ctx.restore();
    drawStars(ctx, W * 0.62 + 70 * scale, meterY, Math.max(16, 30 * scale), 5);
    drawBarcode(ctx, W * 0.62, meterY + Math.max(22, 34 * scale), W * 0.3, Math.max(18, 30 * scale), state.title.length * 7 + 13);
  }

  if (state.vignette) drawVignette(ctx, W, H);
  if (state.grain) drawGrain(ctx, W, H);
  return canvas;
}

/** Render `state` to a fresh canvas at an export size. */
export function renderCoverToSize(state, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  renderCover(canvas, state);
  return canvas;
}

/** Wait until the bundled fonts are ready, then draw. */
export async function drawCoverWhenFontsReady(canvas, state) {
  try {
    await document.fonts.ready;
  } catch (e) { /* fonts are optional; fall back to sans-serif */ }
  renderCover(canvas, state);
}
