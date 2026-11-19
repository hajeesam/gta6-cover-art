// Palm Heist — Cover Studio: editor wiring.
// Builds the layout / grade pickers, photo slots and panel list, keeps an
// undo/redo history, lets the user drag a panel to re-crop it, and exports
// the cover as PNG in the three post sizes. A `?shot=` query sets up a fixed
// scene for a screenshot instead (see ./shots.js).
import { LAYOUTS, GRADES, createDefaultState, renderCover, renderCoverToSize, loadImageFromUrl, loadImageFromFile, panelRects, drawCoverWhenFontsReady } from './cover.js';
import { runShot } from './shots.js';

const canvas = document.getElementById('cover');
const status = document.getElementById('status');
const state = createDefaultState();
window.__state = state;
window.__canvas = canvas;

let selectedPanel = 0;
let undoStack = [];
let redoStack = [];

function snapshot() {
  return JSON.stringify({
    title: state.title, subtitle: state.subtitle, tagline: state.tagline,
    location: state.location, layout: state.layout, grade: state.grade,
    grain: state.grain, vignette: state.vignette, panels: state.panels,
  });
}

function restore(json) {
  const s = JSON.parse(json);
  Object.assign(state, s);
  syncInputs();
  redraw();
}

function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  updateUndoButtons();
  setStatus('Undid the last change');
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  updateUndoButtons();
  setStatus('Redid the change');
}

function updateUndoButtons() {
  document.getElementById('undo').disabled = !undoStack.length;
  document.getElementById('redo').disabled = !redoStack.length;
}

function setStatus(text) {
  status.textContent = text;
}

let redrawQueued = false;
function redraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    renderCover(canvas, state);
  });
}

function redrawNow() {
  renderCover(canvas, state);
}

// --- Text inputs ---------------------------------------------------------
const titleInput = document.getElementById('title');
const subtitleInput = document.getElementById('subtitle');
const taglineInput = document.getElementById('tagline');
const locationInput = document.getElementById('location');

function syncInputs() {
  titleInput.value = state.title;
  subtitleInput.value = state.subtitle;
  taglineInput.value = state.tagline;
  locationInput.value = state.location;
  document.querySelectorAll('#layout-picker button').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === state.layout);
    b.setAttribute('aria-pressed', b.dataset.layout === state.layout ? 'true' : 'false');
  });
  document.querySelectorAll('#grade-picker button').forEach((b) => {
    b.classList.toggle('active', b.dataset.grade === state.grade);
    b.setAttribute('aria-pressed', b.dataset.grade === state.grade ? 'true' : 'false');
  });
  document.getElementById('grain').checked = state.grain;
  document.getElementById('vignette').checked = state.vignette;
  renderPanelList();
}

function bindText(input, key) {
  // Snapshot once when editing starts, so Undo restores the pre-edit text.
  let armed = false;
  input.addEventListener('focus', () => {
    if (!armed) {
      pushHistory();
      armed = true;
    }
  });
  input.addEventListener('blur', () => { armed = false; });
  input.addEventListener('input', () => {
    state[key] = input.value;
    redraw();
  });
}
bindText(titleInput, 'title');
bindText(subtitleInput, 'subtitle');
bindText(taglineInput, 'tagline');
bindText(locationInput, 'location');

// --- Layout + grade pickers ----------------------------------------------
function buildPicker(el, items, key, attr) {
  items.forEach((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = item.label;
    b.dataset[attr] = item.id;
    b.addEventListener('click', () => {
      if (state[key] === item.id) return;
      pushHistory();
      state[key] = item.id;
      syncInputs();
      redrawNow();
      setStatus(`${item.label} selected`);
    });
    el.appendChild(b);
  });
}
buildPicker(document.getElementById('layout-picker'), LAYOUTS, 'layout', 'layout');
buildPicker(document.getElementById('grade-picker'), GRADES, 'grade', 'grade');

document.getElementById('grain').addEventListener('change', (e) => {
  pushHistory();
  state.grain = e.target.checked;
  redrawNow();
});
document.getElementById('vignette').addEventListener('change', (e) => {
  pushHistory();
  state.vignette = e.target.checked;
  redrawNow();
});
document.getElementById('undo').addEventListener('click', undo);
document.getElementById('redo').addEventListener('click', redo);

// --- Photo slots (up to 4 of the user's own photos) -----------------------
const slotList = document.getElementById('photo-slots');
const SAMPLES = ['boulevard.jpg', 'pier.jpg'];

async function setSlotPhoto(slot, img, name) {
  state.photos[slot] = img;
  const slotEl = slotList.children[slot];
  slotEl.querySelector('.slot-name').textContent = name;
  slotEl.classList.add('filled');
  redrawNow();
}

for (let slot = 0; slot < 4; slot++) {
  const div = document.createElement('div');
  div.className = 'slot';
  div.innerHTML = `<span class="slot-num">Photo ${slot + 1}</span>
    <span class="slot-name">empty</span>
    <label class="slot-upload">Upload<input type="file" accept="image/*"></label>
    <button type="button" class="slot-sample">Sample</button>`;
  div.querySelector('input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pushHistory();
    try {
      const img = await loadImageFromFile(file);
      await setSlotPhoto(slot, img, file.name);
      setStatus(`Photo ${slot + 1} loaded: ${file.name}`);
    } catch (err) {
      setStatus('That photo could not be read.');
    }
  });
  div.querySelector('.slot-sample').addEventListener('click', async () => {
    pushHistory();
    const img = await loadImageFromUrl(`samples/${SAMPLES[slot % 2]}`);
    await setSlotPhoto(slot, img, SAMPLES[slot % 2]);
    setStatus(`Photo ${slot + 1} filled with sample ${SAMPLES[slot % 2]}`);
  });
  slotList.appendChild(div);
}

// --- Panel list: pick a panel, assign a photo, edit its sticker ----------
function renderPanelList() {
  const list = document.getElementById('panel-list');
  list.innerHTML = '';
  const rects = panelRects(state.layout, canvas.width, canvas.height);
  const count = state.layout === 'full-bleed' ? 1 : rects.filter((r) => !r.titleCell).length;
  for (let i = 0; i < count; i++) {
    const panel = state.panels[i];
    const row = document.createElement('div');
    row.className = 'panel-row' + (i === selectedPanel ? ' selected' : '');
    row.innerHTML = `<button type="button" class="panel-pick">Panel ${i + 1}</button>
      <select aria-label="Photo for panel ${i + 1}">
        <option value="0">Photo 1</option><option value="1">Photo 2</option>
        <option value="2">Photo 3</option><option value="3">Photo 4</option>
      </select>
      <input type="text" maxlength="12" value="${panel.label}" aria-label="Sticker caption for panel ${i + 1}">`;
    const select = row.querySelector('select');
    select.value = String(panel.photo);
    select.addEventListener('change', () => {
      pushHistory();
      panel.photo = Number(select.value);
      redrawNow();
    });
    const labelInput = row.querySelector('input[type=text]');
    labelInput.addEventListener('input', () => {
      panel.label = labelInput.value.toUpperCase();
      redraw();
    });
    labelInput.addEventListener('change', pushHistory);
    row.querySelector('.panel-pick').addEventListener('click', () => {
      selectedPanel = i;
      renderPanelList();
      setStatus(`Panel ${i + 1} selected — drag it on the preview to crop`);
    });
    list.appendChild(row);
  }
}

// --- Drag / wheel crop on the preview canvas ------------------------------
function panelAt(clientX, clientY) {
  const box = canvas.getBoundingClientRect();
  const x = ((clientX - box.left) / box.width) * canvas.width;
  const y = ((clientY - box.top) / box.height) * canvas.height;
  const rects = panelRects(state.layout, canvas.width, canvas.height);
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (r.titleCell) continue;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

let dragging = null;
canvas.addEventListener('pointerdown', (e) => {
  const hit = panelAt(e.clientX, e.clientY);
  if (hit < 0) return;
  selectedPanel = hit;
  renderPanelList();
  dragging = { x: e.clientX, y: e.clientY, pushed: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const panel = state.panels[selectedPanel];
  if (!panel) return;
  if (!dragging.pushed) {
    pushHistory();
    dragging.pushed = true;
  }
  const box = canvas.getBoundingClientRect();
  panel.crop.ox = Math.max(-1, Math.min(1, panel.crop.ox - ((e.clientX - dragging.x) / box.width) * 2));
  panel.crop.oy = Math.max(-1, Math.min(1, panel.crop.oy - ((e.clientY - dragging.y) / box.height) * 2));
  dragging.x = e.clientX;
  dragging.y = e.clientY;
  redraw();
});
canvas.addEventListener('pointerup', () => { dragging = null; });
canvas.addEventListener('wheel', (e) => {
  const hit = panelAt(e.clientX, e.clientY);
  if (hit < 0) return;
  e.preventDefault();
  const panel = state.panels[hit];
  panel.crop.zoom = Math.max(1, Math.min(3, panel.crop.zoom * (e.deltaY > 0 ? 0.92 : 1.09)));
  redraw();
}, { passive: false });

// --- Export ----------------------------------------------------------------
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportPng(w, h) {
  return new Promise((resolve, reject) => {
    const off = renderCoverToSize(state, w, h);
    off.toBlob((blob) => {
      if (!blob) return reject(new Error('export failed'));
      resolve(blob);
    }, 'image/png');
  });
}

/** Test hook: render + measure a PNG export without downloading it. */
window.__exportCover = async (w, h) => {
  const blob = await exportPng(w, h);
  const buf = await blob.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ok = pngMagic.every((b, i) => head[i] === b);
  return { width: w, height: h, bytes: buf.byteLength, png: ok };
};

const EXPORT_SIZES = [
  { w: 1080, h: 1080, name: 'palm-heist-1080x1080.png' },
  { w: 1080, h: 1350, name: 'palm-heist-1080x1350.png' },
  { w: 1920, h: 1080, name: 'palm-heist-1920x1080.png' },
];

EXPORT_SIZES.forEach(({ w, h, name }) => {
  document.getElementById(`export-${w}x${h}`).addEventListener('click', async () => {
    setStatus(`Exporting ${w} x ${h}…`);
    const blob = await exportPng(w, h);
    downloadBlob(blob, name);
    setStatus(`Saved ${name}`);
  });
});

document.getElementById('export-all').addEventListener('click', async () => {
  setStatus('Exporting all 3 sizes…');
  for (const { w, h, name } of EXPORT_SIZES) {
    const blob = await exportPng(w, h);
    downloadBlob(blob, name);
    await new Promise((r) => setTimeout(r, 350));
  }
  setStatus('Saved all 3 sizes: 1080x1080, 1080x1350, 1920x1080');
});

// --- Boot ------------------------------------------------------------------
async function boot() {
  syncInputs();
  updateUndoButtons();
  // Load the two bundled samples into slots 1 and 2 so the first paint is real art.
  try {
    const [a, b] = await Promise.all([
      loadImageFromUrl('samples/boulevard.jpg'),
      loadImageFromUrl('samples/pier.jpg'),
    ]);
    state.photos[0] = a;
    state.photos[1] = b;
    slotList.children[0].querySelector('.slot-name').textContent = 'boulevard.jpg';
    slotList.children[0].classList.add('filled');
    slotList.children[1].querySelector('.slot-name').textContent = 'pier.jpg';
    slotList.children[1].classList.add('filled');
  } catch (e) { /* samples are optional; empty panels still render */ }
  const query = new URLSearchParams(location.search);
  if (query.get('shot')) {
    await runShot(query.get('shot'), query, state);
  } else {
    await drawCoverWhenFontsReady(canvas, state);
  }
  renderPanelList();
}

boot();
