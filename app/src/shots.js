// Fixed scenes for screenshots: ?shot=editor shows the page with a sample
// photo loaded; ?shot=cover shows the cover alone, at the size the query
// names (?size=1920x1080, 1080x1350 or 1080x1080). `layout` and `grade`
// pick the look, `caption` the title words, `photo` the sample.
// window.__shotReady is set once the cover is fully painted.
import { renderCover, loadImageFromUrl, drawCoverWhenFontsReady } from './cover.js';

function setCoverSize(canvas, sizeParam) {
  const [w, h] = (sizeParam || '1920x1080').split('x').map(Number);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    canvas.width = w;
    canvas.height = h;
  }
}

export async function runShot(shot, query, state) {
  const canvas = document.getElementById('cover');
  const caption = query.get('caption');
  if (caption) {
    state.title = caption;
    const titleInput = document.getElementById('title');
    if (titleInput) titleInput.value = caption;
  }
  if (query.get('layout')) state.layout = query.get('layout');
  if (query.get('grade')) state.grade = query.get('grade');
  if (query.get('subtitle')) state.subtitle = query.get('subtitle');
  if (query.get('tagline')) state.tagline = query.get('tagline');

  // Fill every photo slot with the named sample so all panels have art.
  const photoName = query.get('photo') || 'boulevard';
  const otherName = photoName === 'boulevard' ? 'pier' : 'boulevard';
  const [first, second] = await Promise.all([
    loadImageFromUrl(`samples/${photoName}.jpg`),
    loadImageFromUrl(`samples/${otherName}.jpg`),
  ]);
  state.photos[0] = first;
  state.photos[1] = second;
  state.photos[2] = first;
  state.photos[3] = second;

  // Per-panel crop overrides for this shot only, so a face that the default
  // cover-fit would cut off can be pulled back into frame:
  // `crops=1:0.41,1.92,1;2:0,0,1.5` means panel 1 -> {ox,oy,zoom}, etc.
  // Panels are indexed by panel-rect order, the same order renderCover uses.
  const cropsParam = query.get('crops');
  if (cropsParam) {
    for (const part of cropsParam.split(';')) {
      const [idxStr, vals] = part.split(':');
      const nums = (vals || '').split(',').map(Number);
      const i = Number(idxStr);
      if (Number.isInteger(i) && state.panels[i] && nums.length === 3 && nums.every(Number.isFinite)) {
        state.panels[i].crop = { ox: nums[0], oy: nums[1], zoom: nums[2] };
      }
    }
  }

  if (shot === 'cover') {
    document.body.classList.add('shot-cover');
    setCoverSize(canvas, query.get('size'));
  }
  await drawCoverWhenFontsReady(canvas, state);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.__shotReady = true;
}
