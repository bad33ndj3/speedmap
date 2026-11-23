import { runSpeedTestForSpot, cancelSpeedTest } from './speedtest.js';
import { rotateClockwise, layoutFloorplan } from './rotation.js';

const $ = id => document.getElementById(id);
const key = 'speedmap-v1';
const empty = () => ({ version: 1, image: null, spots: [], providers: { a: 'Connection A', b: 'Connection B' }, results: [] });
let state = empty();
let adding = false;
let selected = '';
let running = false;
let liveResult = null;
let liveContext = '';
let mapOperation = 0;
const connection = network => state.providers[network] || (network === 'a' ? 'Connection A' : 'Connection B');

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
function nextMeasurement() {
  for (const network of ['a', 'b']) {
    const spot = state.spots.find(spot => !last(spot.id, network));
    if (spot) return { spot, network };
  }
  return null;
}

function suggestNextMeasurement() {
  const next = nextMeasurement();
  if (!next) return;
  selected = next.spot.id;
  $('selected-provider').value = next.network;
}

function renderReadout() {
  $('live-context').textContent = liveContext || 'Current connection';
  const summary = liveResult?.details.summary;
  for (const [field, value, unit] of [
    ['down', liveResult?.down, ''], ['up', liveResult?.up, ''],
    ['ping', liveResult?.ping, ' ms'], ['loaded', liveResult?.loaded, ' ms'],
    ['jitter', summary?.jitter, ' ms'],
    ['loss', Number.isFinite(summary?.packetLoss) ? summary.packetLoss * 100 : null, '%'],
  ]) {
    $('live-' + field).textContent = Number.isFinite(value) ? fmt(value) + unit : '—';
  }
  $('live-loss').parentElement.hidden = !Number.isFinite(summary?.packetLoss);
  const scores = $('live-scores');
  scores.replaceChildren();
  for (const [key, label] of [['streaming', 'Streaming'], ['gaming', 'Gaming'], ['rtc', 'Video calls']]) {
    const rating = liveResult?.details.scores?.[key]?.classificationName;
    if (typeof rating !== 'string') continue;
    const item = document.createElement('li');
    item.textContent = label + ' · ' + rating;
    scores.append(item);
  }
  scores.hidden = !scores.children.length;
}

function renderMeasurement() {
  const spot = state.spots.find(spot => spot.id === selected);
  const network = $('selected-provider').value;
  $('measurement-setup').hidden = !spot;
  $('measure-guide').hidden = Boolean(spot);
  $('measure-guide').textContent = 'Test your current connection. Add a spot to save measurements on the map.';
  $('measurement-progress').textContent = ['a', 'b'].map(key =>
    connection(key) + ' · ' + state.spots.filter(spot => last(spot.id, key)).length + '/' + state.spots.length
  ).join('   /   ');
  $('test-instruction').textContent = !spot || running ? '' :
    'Go to ' + spot.name + ' and connect to ' + connection(network) + ' before starting.';
  $('test-instruction').hidden = !$('test-instruction').textContent;
  $('start-test').disabled = running;
  $('start-test').hidden = running;
  $('start-test').textContent = spot && last(spot.id, network) ? 'Retest this spot' : 'Run speed test';
  $('cancel-test').hidden = !running;
  $('view-results').hidden = !state.results.length || running;
  $('view-results').textContent = nextMeasurement() ? 'View results so far ↓' : 'View completed comparison ↓';
  $('results-panel').hidden = !state.results.length;
  const paired = state.spots.filter(spot => last(spot.id, 'a') && last(spot.id, 'b')).length;
  $('results-guide').textContent = paired === state.spots.length && paired > 0
    ? 'Every spot has results for both connections.'
    : paired + ' of ' + state.spots.length + ' spots have results for both connections.';
  renderReadout();
}

function render() {
  $('quick-test-link').hidden = Boolean(state.image);
  $('choose-plan').textContent = state.image ? 'Replace floor plan' : 'Choose floor plan';
  $('choose-plan').classList.toggle('button-primary', !state.image);
  $('choose-plan').classList.toggle('button-secondary', Boolean(state.image));
  $('choose-plan').disabled = running;
  $('restore-backup').disabled = running;
  $('clear-map').hidden = !state.image && !state.spots.length;
  $('clear-map').disabled = running;
  $('export-json').disabled = !state.image && !state.spots.length;
  $('map-actions').hidden = !state.image;
  $('map-test-link').hidden = !state.spots.length || running;
  $('map-hint').textContent = !state.image ? 'Choose a photo, screenshot or image of your floor plan.'
    : adding ? 'Tap or click the map where you want to measure.'
    : state.spots.length ? 'Select a marker to test that spot. Drag it to move it.'
    : 'Add a spot where you want to measure, such as the kitchen.';
  $('map-image').hidden = !state.image;
  if (state.image) $('map-image').src = state.image; else $('map-image').removeAttribute('src');
  $('map-empty').hidden = !!state.image;
  if (state.image) layoutFloorplan($('map-image'), $('map'), state.rotation || 0);
  else { $('map').style.width = ''; $('map').style.aspectRatio = ''; }
  if ($('rotate-map')) $('rotate-map').disabled = !state.image || running;
  $('add-spot').disabled = !state.image || running; $('floorplan-input').disabled = running; $('import-json').disabled = running; $('selected-spot').disabled = running; $('selected-provider').disabled = running;
  $('add-spot').textContent = adding ? 'Cancel adding spot' : 'Add spot';
  $('add-spot').classList.toggle('button-primary', !state.spots.length && !adding);
  $('add-spot').classList.toggle('button-secondary', Boolean(state.spots.length || adding));
  $('map').classList.toggle('adding', adding);
  $('map-markers').replaceChildren();
  $('spots-list').replaceChildren();
  for (const spot of state.spots) {
    const marker = document.createElement('button');
    marker.disabled = running;
    marker.classList.toggle('selected-marker', spot.id === selected);
    marker.type = 'button'; marker.classList.add('marker'); marker.textContent = String(state.spots.indexOf(spot) + 1);
    marker.title = spot.name; marker.setAttribute('aria-label', `${spot.name}, drag to move`);
    marker.style.left = `${spot.x * 100}%`; marker.style.top = `${spot.y * 100}%`;
    marker.addEventListener('pointerdown', event => {
      if (running) return;
      event.stopPropagation(); marker.setPointerCapture(event.pointerId);
      let moved = false;
      const move = e => { const rect = $('map').getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)); marker.style.left = `${x*100}%`; marker.style.top = `${y*100}%`; moved = true; };
      const end = e => { marker.removeEventListener('pointermove', move); marker.removeEventListener('pointerup', end); marker.removeEventListener('pointercancel', cancel); if (moved) { const rect = $('map').getBoundingClientRect(); const next = clone(); const s = next.spots.find(s => s.id === spot.id); s.x = Math.max(0, Math.min(1, (e.clientX - rect.left)/rect.width)); s.y = Math.max(0, Math.min(1, (e.clientY - rect.top)/rect.height)); if (!save(next)) { marker.style.left = `${spot.x * 100}%`; marker.style.top = `${spot.y * 100}%`; } } selected = spot.id; syncSpotSelection(); };
      const cancel = () => { marker.removeEventListener('pointermove', move); marker.removeEventListener('pointerup', end); render(); };
      marker.addEventListener('pointermove', move); marker.addEventListener('pointerup', end); marker.addEventListener('pointercancel', cancel);
    });
    marker.addEventListener('click', e => { e.stopPropagation(); selected = spot.id; syncSpotSelection(); });
    $('map-markers').append(marker);
    marker.dataset.spotId = spot.id;
    const row = document.createElement('div'); row.className = 'spot-row';
    const number = document.createElement('span');
    number.className = 'spot-number';
    number.textContent = marker.textContent;
    number.setAttribute('aria-hidden', 'true');
    const name = document.createElement('input'); name.type = 'text'; name.value = spot.name; name.setAttribute('aria-label', 'Spot name'); name.disabled = running;
    name.addEventListener('input', () => { const value = name.value.trim(); if (!value) return; const next = clone(); next.spots.find(s => s.id === spot.id).name = value; save(next); });
    name.addEventListener('change', () => { const value = name.value.trim(); if (!value) { name.value = spot.name; return; } const next = clone(); next.spots.find(s => s.id === spot.id).name = value; save(next); render(); });
    const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Remove'; del.disabled = running; del.addEventListener('click', () => { if (!confirm(`Remove “${spot.name}” and all its measurements?`)) return; const next = clone(); next.spots = next.spots.filter(s => s.id !== spot.id); next.results = next.results.filter(r => r.spotId !== spot.id); if (save(next)) { if (selected === spot.id) selected = ''; render(); } });
    row.append(number, name, del); $('spots-list').append(row);
  }
  for (const k of ['a','b']) { const input = $(`provider-${k}`); if (document.activeElement !== input) input.value = state.providers[k]; input.disabled = running; }
  const select = $('selected-spot'); select.replaceChildren();
  if (!state.spots.some(s => s.id === selected)) selected = state.spots[0]?.id || '';
  for (const spot of state.spots) select.add(new Option(spot.name, spot.id)); select.value = selected;
  for (const k of ['a','b']) { const option = $('selected-provider').querySelector(`option[value="${k}"]`); option.textContent = connection(k); }
  syncSpotSelection();
  renderResults();
}

const resultMetrics = [
  ['Download', 'down', 'Mbps'], ['Upload', 'up', 'Mbps'],
  ['Ping', 'ping', 'ms'], ['Latency under load', 'loaded', 'ms'],
];

function renderResults() {
  const results = $('results');
  const open = new Set(Array.from(results.querySelectorAll('details[open]'), detail => detail.dataset.spotId));
  results.replaceChildren();
  const rooms = state.spots.map(spot => ({ spot, a: last(spot.id, 'a'), b: last(spot.id, 'b') }));
  const chartMetrics = resultMetrics.slice(0, 3);
  const scale = Object.fromEntries(chartMetrics.map(([, field]) => [
    field, rooms.reduce((max, { a, b }) => Math.max(max, a?.[field] ?? 0, b?.[field] ?? 0), 0),
  ]));
  for (const { spot, a, b } of rooms) {
    const article = document.createElement('article');
    article.className = 'result room-comparison';
    const title = document.createElement('h3');
    title.textContent = spot.name;
    article.append(title);
    const charts = document.createElement('div');
    charts.className = 'room-metrics';
    for (const [label, field, unit] of chartMetrics) {
      const chart = document.createElement('div');
      chart.className = 'metric-chart';
      const heading = document.createElement('h4');
      heading.textContent = `${label} · ${unit}`;
      chart.append(heading);
      for (const [network, measurement] of [['a', a], ['b', b]]) {
        const reading = measurement?.[field];
        const label = document.createElement('div');
        label.className = 'bar-label';
        const name = document.createElement('span');
        name.textContent = connection(network);
        const number = document.createElement('strong');
        number.textContent = reading == null ? (measurement ? 'Unavailable' : 'Not measured') : fmt(reading);
        label.append(name, number);
        const track = document.createElement('div');
        track.className = 'bar-track';
        track.setAttribute('aria-hidden', 'true');
        if (reading != null && scale[field] > 0) {
          const bar = document.createElement('span');
          bar.className = 'result-bar bar-' + network;
          bar.style.width = Math.max(0, reading / scale[field] * 100) + '%';
          track.append(bar);
        }
        chart.append(label, track);
      }
      if (a?.[field] != null && b?.[field] != null) {
        const change = document.createElement('p');
        change.className = 'room-change';
        const delta = b[field] - a[field];
        change.textContent = delta === 0 ? 'No change' :
          `${connection('b')} · ${delta > 0 ? '+' : ''}${fmt(delta)} ${unit}`;
        chart.append(change);
      }
      charts.append(chart);
    }
    article.append(charts);
    results.append(article);
    if (!a && !b) continue;
    const details = document.createElement('details');
    details.className = 'room-details';
    details.dataset.spotId = spot.id;
    details.open = open.has(spot.id);
    const summary = document.createElement('summary');
    summary.textContent = 'All measurements';
    details.append(summary);
    const table = document.createElement('table'); table.className = 'comparison-table';
    const caption = document.createElement('caption'); caption.textContent = `Latest measurements at ${spot.name}. Difference is ${state.providers.b} minus ${state.providers.a}.`; table.append(caption);
    const head = document.createElement('thead'); const heading = document.createElement('tr');
    for (const label of ['Measurement', connection('a'), connection('b'), 'Change (B − A)']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; heading.append(th); }
    head.append(heading); table.append(head);
    const body = document.createElement('tbody');
    for (const [label, field, unit] of resultMetrics) {
      const row = document.createElement('tr'); const th = document.createElement('th'); th.scope = 'row'; th.textContent = label; row.append(th);
      for (const measurement of [a, b]) { const td = document.createElement('td'); const value = measurement?.[field]; td.textContent = value == null ? '—' : `${fmt(value)} ${unit}`; row.append(td); }
      const difference = document.createElement('td');
      if (a?.[field] != null && b?.[field] != null) { const delta = b[field] - a[field]; difference.textContent = `${delta > 0 ? '+' : ''}${fmt(delta)} ${unit}`; }
      else difference.textContent = '—';
      row.append(difference); body.append(row);
    }
    table.append(body);
    details.append(table);
    article.append(details);
  }
}
function syncSpotSelection() {
  $('selected-spot').value = selected;
  for (const marker of $('map-markers').children) {
    const active = marker.dataset.spotId === selected;
    marker.classList.toggle('selected-marker', active);
    marker.setAttribute('aria-pressed', String(active));
  }
  renderMeasurement();
}

function resetMapView() {
  selected = '';
  adding = false;
  liveResult = null;
  liveContext = '';
  $('test-status').textContent = '';
  $('report-status').textContent = '';
  $('report-fallback').hidden = true;
  $('report-text').value = '';
  $('floorplan-input').value = '';
  $('selected-provider').value = 'a';
}

$('clear-map').addEventListener('click', () => {
  if (running || !confirm('Clear the floor plan and remove its spots and measurements from this browser?')) return;
  if (save({ ...state, image: null, rotation: 0, spots: [], results: [] })) {
    mapOperation++;
    resetMapView();
    render();
    $('storage-status').textContent = 'Floor plan cleared.';
    $('choose-plan').focus();
  }
});

$('choose-plan').addEventListener('click', () => $('floorplan-input').click());
$('restore-backup').addEventListener('click', () => $('import-json').click());
$('floorplan-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) { $('storage-status').textContent = 'Choose a PNG, JPEG, WebP or GIF image.'; e.target.value = ''; return; }
  const operation = ++mapOperation;
  const reader = new FileReader();
  const readFailed = () => {
    if (operation !== mapOperation) return;
    $('storage-status').textContent = 'Could not read this image.';
    e.target.value = '';
  };
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      if (operation !== mapOperation) return;
      e.target.value = '';
      if (running) return;
      if (state.spots.length && !confirm('Replace the floor plan and remove all spots and measurements?')) return;
      const next = { ...state, image: reader.result, rotation: 0, spots: [], results: [] };
      if (save(next)) {
        resetMapView();
        render();
        $('add-spot').focus();
      }
    };
    image.onerror = readFailed;
    image.src = reader.result;
  };
  reader.onerror = readFailed;
  reader.readAsDataURL(file);
});
$('add-spot').addEventListener('click', () => { adding = !adding; render(); });
$('map').addEventListener('click', e => { if (!adding || !state.image || running) return; const rect = $('map').getBoundingClientRect(); const next = clone(); const spot = {id: uid(), name: `Spot ${next.spots.length + 1}`, x: Math.max(0, Math.min(1, (e.clientX - rect.left)/rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top)/rect.height))}; next.spots.push(spot); if (save(next)) { selected = spot.id; adding = false; render(); } });
for (const k of ['a','b']) $(`provider-${k}`).addEventListener('input', e => { const value = e.target.value.trim(); if (!value) return; const next = clone(); next.providers[k] = value; save(next); });
for (const k of ['a','b']) $(`provider-${k}`).addEventListener('change', e => { const next = clone(); next.providers[k] = e.target.value.trim() || `Provider ${k.toUpperCase()}`; save(next); render(); });
$('selected-spot').addEventListener('change', e => {
  selected = e.target.value;
  syncSpotSelection();
});
$('selected-provider').addEventListener('change', renderMeasurement);
$('start-test').addEventListener('click', async () => {
  if (running) return;
  const spot = state.spots.find(spot => spot.id === selected);
  const network = $('selected-provider').value;
  liveContext = spot ? spot.name + ' · ' + connection(network) : 'Current connection';
  liveResult = null;
  running = true;
  render();
  $('cancel-test').focus();
  try {
    const result = await runSpeedTestForSpot({ spotId: spot?.id ?? null, network });
    if (result?.spotId) suggestNextMeasurement();
  } finally {
    const returnFocus = document.activeElement === $('cancel-test');
    running = false;
    render();
    if (returnFocus) $('start-test').focus();
  }
});
window.addEventListener('speedtest-status', e => {
  const status = $('test-status');
  if (status.textContent !== e.detail) status.textContent = e.detail;
});
window.addEventListener('speedtest-progress', e => {
  liveResult = e.detail;
  renderReadout();
});
window.addEventListener('speedtest-result', e => {
  liveResult = e.detail;
  renderReadout();
  if (e.detail.spotId === null) return;
  const next = clone();
  next.results.push(e.detail);
  if (!save(next)) {
    state = next;
    $('storage-status').textContent = 'Measurement is only in memory. Download a backup now.';
    document.querySelector('.backup-panel').open = true;
  }
});
function report() {
  const lines = ['# Speed measurements', '', `Connections: A = ${state.providers.a}; B = ${state.providers.b}`, '', '## Comparison (latest measurement per spot)', ''];
  for (const s of state.spots) { lines.push(`### ${s.name}`); for (const k of ['a','b']) { const r = last(s.id,k); lines.push(`- ${state.providers[k]}: ${r ? `download ${fmt(r.down)} Mbit/s, upload ${fmt(r.up)} Mbit/s, ping ${fmt(r.ping)} ms, loaded latency ${fmt(r.loaded)} ms` : 'not measured'}`); } const a = last(s.id,'a'), b = last(s.id,'b'); if (a && b) for (const [label, field, unit] of [['Download','down','Mbit/s'],['Upload','up','Mbit/s'],['Latency','ping','ms'],['Loaded latency','loaded','ms']]) if (a[field] != null && b[field] != null) lines.push(`- Difference ${label} (B − A): ${fmt(b[field]-a[field])} ${unit}`); lines.push(''); }
  lines.push('## All detailed measurements', '', '```json', JSON.stringify(state.results.map(r => ({...r, spotName: state.spots.find(s => s.id === r.spotId)?.name, providerName: state.providers[r.network]})), null, 2), '```'); return lines.join('\n');
}
$('copy-report').addEventListener('click', async () => { const text = report(); try { if (!navigator.clipboard?.writeText) throw Error('clipboard unavailable'); await navigator.clipboard.writeText(text); $('report-fallback').hidden = true; $('report-status').textContent = 'Report copied.'; } catch { $('report-text').value = text; $('report-fallback').hidden = false; $('report-text').focus(); $('report-text').select(); } });
$('export-json').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], {type:'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'speedmap.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('import-json').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const operation = ++mapOperation;
  try {
    const next = validate(JSON.parse(await file.text()));
    if (operation !== mapOperation || running) return;
    if (!confirm('Replace your current map and measurements with this file?')) return;
    if (save(next)) {
      resetMapView();
      suggestNextMeasurement();
      render();
    }
  } catch {
    if (operation === mapOperation) $('storage-status').textContent = 'Import failed: this is not a valid Speedmap file.';
  }
});
$('map-image').addEventListener('load', () => layoutFloorplan($('map-image'), $('map'), state.rotation || 0));
$('rotate-map')?.addEventListener('click', () => {
  if (!state.image || running) return;
  const next = clone();
  next.rotation = ((next.rotation || 0) + 90) % 360;
  next.spots = next.spots.map(rotateClockwise);
  if (save(next)) render();
});
const cancel = $('cancel-test'); if (cancel) cancel.addEventListener('click', cancelSpeedTest);
suggestNextMeasurement();
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
