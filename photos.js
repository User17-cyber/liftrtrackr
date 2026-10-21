// Meal photos for analysis: up to three, each resized for Claude (longest side 1,600 px) with a small
// square thumbnail. The first shows the meal. Each extra one is either the same meal from another
// angle (so Claude can judge height and depth) or what was left after eating (so it's subtracted).
const $ = id => document.getElementById(id);
const MAX = 3;
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
export const ROLES = { meal: 'The meal', angle: 'Another angle', after: 'After eating' };

let photos = [], hooks;
export const getPhotos = () => photos;

// hooks: {onChange(), showError(message), hideError(), active() → whether pasting adds a photo now}
export function initPhotos(h) {
  hooks = h;
  const input = $('photo-input'), zone = $('dropzone');
  input.addEventListener('change', async () => { for (const f of [...input.files]) await addPhoto(f); input.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', async e => {
    e.preventDefault(); zone.classList.remove('drag');
    const files = [...(e.dataTransfer?.files || [])].filter(x => x.type.startsWith('image/') || /\.(heic|heif)$/i.test(x.name));
    if (!files.length) return hooks.showError('That file is not an image. Drop a JPEG, PNG or WebP photo.');
    for (const f of files) await addPhoto(f);
  });
  document.addEventListener('paste', e => {
    if (!hooks.active() || e.target.closest?.('input, textarea')) return;
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); addPhoto(f); }
  });
  $('photo-preview').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (b) removePhoto(Number(b.dataset.rm));
  });
  $('photo-preview').addEventListener('change', e => {
    const s = e.target.closest('[data-role]');
    if (s && photos[Number(s.dataset.role)]) { photos[Number(s.dataset.role)].role = s.value === 'after' ? 'after' : 'angle'; hooks.onChange(); }
  });
}

async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
}

export async function addPhoto(file) {
  if (photos.length >= MAX) return hooks.showError(`Up to ${MAX} photos per meal. Remove one to add another.`);
  hooks.hideError();
  let src;
  try { src = await decode(file); } catch {
    return hooks.showError("This photo couldn't be opened here. iPhone HEIC photos may need converting: share it as a JPEG, or screenshot it and upload that.");
  }
  const w = src.width, h = src.height, scale = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  const t = document.createElement('canvas'), s = Math.min(w, h);
  t.width = t.height = 112;
  t.getContext('2d').drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 112, 112);
  src.close?.();
  if (!blob) return hooks.showError("This photo couldn't be prepared. Try a different file.");
  photos.push({ blob, url: URL.createObjectURL(blob), thumb: t.toDataURL('image/jpeg', 0.62), role: photos.length ? 'angle' : 'meal' });
  hooks.onChange();
}

function removePhoto(i) {
  const [p] = photos.splice(i, 1);
  if (p) URL.revokeObjectURL(p.url);
  if (photos[0]) photos[0].role = 'meal';
  hooks.onChange();
}

export function clearPhotos() {
  photos.forEach(p => URL.revokeObjectURL(p.url));
  photos = [];
  hooks.onChange();
}

// Draws the chosen photos: the meal large, extra photos as tiles with what each shows.
export function renderPhotos() {
  const prev = $('photo-preview');
  $('dropzone').hidden = photos.length > 0;
  prev.hidden = !photos.length;
  if (!photos.length) { prev.innerHTML = ''; return; }
  const [first, ...more] = photos;
  prev.innerHTML = `<div class="photo-main"><img src="${first.url}" alt="Your meal photo"><button type="button" class="tile-x" data-rm="0" aria-label="Remove the meal photo">${ICON_X}</button></div>
    ${more.length || photos.length < MAX ? `<div class="photo-more">
      ${more.map((p, k) => `<figure class="photo-tile">
        <img src="${p.url}" alt="">
        <button type="button" class="tile-x" data-rm="${k + 1}" aria-label="Remove photo ${k + 2}">${ICON_X}</button>
        <select data-role="${k + 1}" aria-label="What photo ${k + 2} shows"><option value="angle" ${p.role === 'angle' ? 'selected' : ''}>${ROLES.angle}</option><option value="after" ${p.role === 'after' ? 'selected' : ''}>${ROLES.after}</option></select>
      </figure>`).join('')}
      ${photos.length < MAX ? `<label for="photo-input" class="photo-add"><b>+ Add a photo</b><span>A side view helps with piled food; a photo after eating subtracts leftovers.</span></label>` : ''}
    </div>` : ''}`;
}
