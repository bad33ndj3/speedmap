import { runSpeedTestForSpot, cancelSpeedTest } from './speedtest.js';
import { rotateClockwise, layoutFloorplan } from './rotation.js';

const $ = id => document.getElementById(id);
const key = 'speedmap-v1';
const empty = () => ({ version: 1, image: null, spots: [], providers: { a: 'Provider A', b: 'Provider B' }, results: [] });
let state = empty();
let adding = false;
let selected = '';
let running = false;

function validate(value) {
  if (!value || value.version !== 1 || (value.rotation !== undefined && ![0, 90, 180, 270].includes(value.rotation)) || !(value.image === null || (typeof value.image === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value.image))) || !Array.isArray(value.spots) || !Array.isArray(value.results) || !value.providers || !['a','b'].every(k => typeof value.providers[k] === 'string')) throw Error('Invalid file.');
  const ids = new Set();
  for (const s of value.spots) {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id) || typeof s.name !== 'string' || !s.name.trim() || !Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.x > 1 || s.y < 0 || s.y > 1) throw Error('Invalid spot.');
    ids.add(s.id);
  }
  for (const r of value.results) {
    if (!r || !ids.has(r.spotId) || !['a','b'].includes(r.network) || !r.details || typeof r.details !== 'object' || !['down','up','ping','loaded'].every(k => r[k] === null || (typeof r[k] === 'number' && Number.isFinite(r[k])))) throw Error('Invalid measurement.');
  }
  return value;
}
function save(next = state) {
  try {
    localStorage.setItem(key, JSON.stringify(next));
    state = next;
    $('storage-status').textContent = 'Saved on this device.';
    return true;
  } catch {
    $('storage-status').textContent = 'Could not save. Storage is full or unavailable. Export a backup and try a smaller image.';
    return false;
  }
}
try { const saved = localStorage.getItem(key); if (saved) state = validate(JSON.parse(saved)); }
catch { $('storage-status').textContent = 'Saved data could not be read. Import a backup.'; }
const clone = () => structuredClone(state);
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fmt = n => n == null ? '—' : new Intl.NumberFormat('nl-NL', {maximumFractionDigits: 1}).format(n);
function last(spotId, network) { return state.results.filter(r => r.spotId === spotId && r.network === network).at(-1); }
function render() {
  $('map-image').hidden = !state.image;
  if (state.image) $('map-image').src = state.image; else $('map-image').removeAttribute('src');
  $('map-empty').hidden = !!state.image;
  if (state.image) layoutFloorplan($('map-image'), $('map'), state.rotation || 0);
  else { $('map').style.width = ''; $('map').style.aspectRatio = ''; }
  if ($('rotate-map')) $('rotate-map').disabled = !state.image || running;
  $('add-spot').disabled = !state.image || running; $('floorplan-input').disabled = running; $('import-json').disabled = running; $('selected-spot').disabled = running; $('selected-provider').disabled = running;
  $('add-spot').textContent = adding ? 'Click the map' : 'Add spot';
  $('map').classList.toggle('adding', adding);
  $('map-markers').replaceChildren();
  $('spots-list').replaceChildren();
  for (const spot of state.spots) {
    const marker = document.createElement('button');
    marker.type = 'button'; marker.className = 'marker'; marker.textContent = String(state.spots.indexOf(spot) + 1);
    marker.title = spot.name; marker.setAttribute('aria-label', `${spot.name}, drag to move`);
    marker.style.left = `${spot.x * 100}%`; marker.style.top = `${spot.y * 100}%`;
    marker.addEventListener('pointerdown', event => {
      if (running) return;
      event.stopPropagation(); marker.setPointerCapture(event.pointerId);
      let moved = false;
      const move = e => { const rect = $('map').getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)); marker.style.left = `${x*100}%`; marker.style.top = `${y*100}%`; moved = true; };
      const end = e => { marker.removeEventListener('pointermove', move); marker.removeEventListener('pointerup', end); marker.removeEventListener('pointercancel', cancel); if (moved) { const rect = $('map').getBoundingClientRect(); const next = clone(); const s = next.spots.find(s => s.id === spot.id); s.x = Math.max(0, Math.min(1, (e.clientX - rect.left)/rect.width)); s.y = Math.max(0, Math.min(1, (e.clientY - rect.top)/rect.height)); save(next); } selected = spot.id; render(); };
      const cancel = () => { marker.removeEventListener('pointermove', move); marker.removeEventListener('pointerup', end); render(); };
      marker.addEventListener('pointermove', move); marker.addEventListener('pointerup', end); marker.addEventListener('pointercancel', cancel);
    });
    marker.addEventListener('click', e => { e.stopPropagation(); selected = spot.id; $('selected-spot').value = selected; });
    $('map-markers').append(marker);
    const row = document.createElement('div'); row.className = 'spot-row';
    const name = document.createElement('input'); name.type = 'text'; name.value = spot.name; name.setAttribute('aria-label', 'Spot name'); name.disabled = running;
    name.addEventListener('input', () => { const value = name.value.trim(); if (!value) return; const next = clone(); next.spots.find(s => s.id === spot.id).name = value; save(next); });
    name.addEventListener('change', () => { const value = name.value.trim(); if (!value) { name.value = spot.name; return; } const next = clone(); next.spots.find(s => s.id === spot.id).name = value; save(next); render(); });
    const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Remove'; del.disabled = running; del.addEventListener('click', () => { if (!confirm(`Remove “${spot.name}” and all its measurements?`)) return; const next = clone(); next.spots = next.spots.filter(s => s.id !== spot.id); next.results = next.results.filter(r => r.spotId !== spot.id); if (save(next)) { if (selected === spot.id) selected = ''; render(); } });
    row.append(name, del); $('spots-list').append(row);
  }
  for (const k of ['a','b']) { const input = $(`provider-${k}`); if (document.activeElement !== input) input.value = state.providers[k]; input.disabled = running; }
  const select = $('selected-spot'); select.replaceChildren();
  if (!state.spots.some(s => s.id === selected)) selected = state.spots[0]?.id || '';
  for (const spot of state.spots) select.add(new Option(spot.name, spot.id)); select.value = selected;
  for (const k of ['a','b']) { const option = $('selected-provider').querySelector(`option[value="${k}"]`); option.textContent = state.providers[k] || `Provider ${k.toUpperCase()}`; }
  $('start-test').disabled = running || !selected; $('cancel-test').hidden = !running;
  $('results').replaceChildren();
  if (!state.results.length) { const p = document.createElement('p'); p.textContent = 'No measurements yet. Choose a spot and start the first round.'; $('results').append(p); }
  for (const spot of state.spots) {
    const a = last(spot.id, 'a'), b = last(spot.id, 'b'); if (!a && !b) continue;
    const article = document.createElement('article'); article.className = 'result';
    const title = document.createElement('h3'); title.textContent = spot.name; article.append(title);
    const table = document.createElement('table'); table.className = 'comparison-table';
    const caption = document.createElement('caption'); caption.textContent = `Latest measurements at ${spot.name}. Difference is ${state.providers.b} minus ${state.providers.a}.`; table.append(caption);
    const head = document.createElement('thead'); const heading = document.createElement('tr');
    for (const label of ['Measurement', state.providers.a, state.providers.b, 'Difference']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; heading.append(th); }
    head.append(heading); table.append(head);
    const body = document.createElement('tbody');
    for (const [label, field, unit] of [['Download','down','Mbps'], ['Upload','up','Mbps'], ['Ping','ping','ms'], ['Loaded latency','loaded','ms']]) {
      const row = document.createElement('tr'); const th = document.createElement('th'); th.scope = 'row'; th.textContent = label; row.append(th);
      for (const measurement of [a, b]) { const td = document.createElement('td'); const value = measurement?.[field]; td.textContent = value == null ? '—' : `${fmt(value)} ${unit}`; row.append(td); }
      const difference = document.createElement('td');
      if (a?.[field] != null && b?.[field] != null) { const delta = b[field] - a[field]; difference.textContent = `${delta > 0 ? '+' : ''}${fmt(delta)} ${unit}`; }
      else difference.textContent = '—';
      row.append(difference); body.append(row);
    }
    table.append(body); article.append(table);
    const note = document.createElement('p'); note.className = 'comparison-note'; note.textContent = `Latest result per label. Difference: ${state.providers.b} minus ${state.providers.a}.`; article.append(note);
    $('results').append(article);
  }
}
$('floorplan-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) { $('storage-status').textContent = 'Choose a PNG, JPEG, WebP or GIF image.'; e.target.value = ''; return; }
  const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => { const next = clone(); next.image = reader.result; next.rotation = 0; if (save(next)) render(); e.target.value = ''; }; image.onerror = () => { $('storage-status').textContent = 'Could not read this image.'; e.target.value = ''; }; image.src = reader.result; }; reader.onerror = () => { $('storage-status').textContent = 'Could not read the image.'; }; reader.readAsDataURL(file);
});
$('add-spot').addEventListener('click', () => { adding = !adding; render(); });
$('map').addEventListener('click', e => { if (!adding || !state.image || running) return; const rect = $('map').getBoundingClientRect(); const next = clone(); const spot = {id: uid(), name: `Spot ${next.spots.length + 1}`, x: Math.max(0, Math.min(1, (e.clientX - rect.left)/rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top)/rect.height))}; next.spots.push(spot); if (save(next)) { selected = spot.id; adding = false; render(); } });
for (const k of ['a','b']) $(`provider-${k}`).addEventListener('input', e => { const value = e.target.value.trim(); if (!value) return; const next = clone(); next.providers[k] = value; save(next); });
for (const k of ['a','b']) $(`provider-${k}`).addEventListener('change', e => { const next = clone(); next.providers[k] = e.target.value.trim() || `Provider ${k.toUpperCase()}`; save(next); render(); });
$('selected-spot').addEventListener('change', e => { selected = e.target.value; });
$('start-test').addEventListener('click', async () => { const network = $('selected-provider').value; if (network === 'b' && state.spots.some(s => !last(s.id, 'a'))) { $('test-status').textContent = 'Measure every spot on the first connection first.'; return; } running = true; render(); try { await runSpeedTestForSpot({spotId: selected, network}); } finally { running = false; render(); } });
window.addEventListener('speedtest-status', e => { $('test-status').textContent = e.detail; });
window.addEventListener('speedtest-result', e => { const next = clone(); next.results.push(e.detail); if (!save(next)) { state = next; $('storage-status').textContent = 'Measurement is only in memory. Export a backup now.'; } render(); });
function report() {
  const lines = ['# Speed measurements', '', `Connections: A = ${state.providers.a}; B = ${state.providers.b}`, '', '## Comparison (latest measurement per spot)', ''];
  for (const s of state.spots) { lines.push(`### ${s.name}`); for (const k of ['a','b']) { const r = last(s.id,k); lines.push(`- ${state.providers[k]}: ${r ? `download ${fmt(r.down)} Mbit/s, upload ${fmt(r.up)} Mbit/s, ping ${fmt(r.ping)} ms, loaded latency ${fmt(r.loaded)} ms` : 'not measured'}`); } const a = last(s.id,'a'), b = last(s.id,'b'); if (a && b) for (const [label, field, unit] of [['Download','down','Mbit/s'],['Upload','up','Mbit/s'],['Latency','ping','ms'],['Loaded latency','loaded','ms']]) if (a[field] != null && b[field] != null) lines.push(`- Difference ${label} (B − A): ${fmt(b[field]-a[field])} ${unit}`); lines.push(''); }
  lines.push('## All detailed measurements', '', '```json', JSON.stringify(state.results.map(r => ({...r, spotName: state.spots.find(s => s.id === r.spotId)?.name, providerName: state.providers[r.network]})), null, 2), '```'); return lines.join('\n');
}
$('copy-report').addEventListener('click', async () => { const text = report(); try { if (!navigator.clipboard?.writeText) throw Error('clipboard unavailable'); await navigator.clipboard.writeText(text); $('report-fallback').hidden = true; $('storage-status').textContent = 'Report copied.'; } catch { $('report-text').value = text; $('report-fallback').hidden = false; $('report-text').focus(); $('report-text').select(); } });
$('export-json').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], {type:'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'speedmap.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('import-json').addEventListener('change', async e => { const file = e.target.files[0]; if (!file) return; try { const next = validate(JSON.parse(await file.text())); if (!confirm('Replace your current map and measurements with this file?')) return; if (save(next)) { selected = ''; adding = false; render(); } } catch { $('storage-status').textContent = 'Import failed: this is not a valid Speedmap file.'; } finally { e.target.value = ''; } });
$('map-image').addEventListener('load', () => layoutFloorplan($('map-image'), $('map'), state.rotation || 0));
$('rotate-map')?.addEventListener('click', () => {
  if (!state.image || running) return;
  const next = clone();
  next.rotation = ((next.rotation || 0) + 90) % 360;
  next.spots = next.spots.map(rotateClockwise);
  if (save(next)) render();
});
const cancel = $('cancel-test'); if (cancel) cancel.addEventListener('click', cancelSpeedTest);
render();

// Only the public page address is encoded; local measurements remain on this device.
import { pageUrl, isLocalOnly } from './qr.js';
$('open-qr').addEventListener('click', () => {
  const url = pageUrl(window.location);
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qr-code').innerHTML = qr.createSvgTag({cellSize: 5, margin: 20, scalable: true});
    $('qr-url').textContent = url;
    $('qr-local-warning').hidden = !isLocalOnly(window.location.hostname);
    $('qr-dialog').showModal();
  } catch {
    $('storage-status').textContent = 'Could not create the QR code. Open this page address on your phone instead.';
  }
});
$('close-qr').addEventListener('click', () => $('qr-dialog').close());
