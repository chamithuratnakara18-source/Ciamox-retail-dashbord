/* =====================================================================
   AI Counter — camera-based product recognition for a checkout counter
   Pipeline: webcam → empty-counter diff finds the item → crop → image
   embedding (DINOv2-small, runs in the browser) → nearest enrolled product
   → cashier confirms → cart → payment.
   ===================================================================== */
const MOCK = new URLSearchParams(location.search).has('mock');   // test mode: tiny colour embedder
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js';
const MODEL_ID = 'Xenova/dinov2-small';
const MODEL_TAG = MOCK ? 'mock-colour' : MODEL_ID;
const $ = id => document.getElementById(id);

/* ---------- small helpers ---------- */
const money = n => (Math.round(n * 100) / 100).toFixed(2);
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); }
function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; return v; }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = str => { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- IndexedDB ---------- */
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    if (db) return res(db);
    const r = indexedDB.open('ai-counter', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('products', { keyPath: 'id' }); r.result.createObjectStore('sales', { keyPath: 'id' }); };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };
  return {
    all: store => tx(store, 'readonly', s => s.getAll()),
    put: (store, v) => tx(store, 'readwrite', s => s.put(v)),
    del: (store, k) => tx(store, 'readwrite', s => s.delete(k)),
    clear: store => tx(store, 'readwrite', s => s.clear()),
  };
})();

/* ---------- catalogue in memory ---------- */
let products = [];            // {id,name,sku,price,thumb,model,samples:[ArrayBuffer]}
let bank = [];                // flat list [{pid, vec:Float32Array}] for fast matching
function rebuildBank() {
  bank = [];
  for (const p of products) if (p.model === MODEL_TAG) for (const buf of p.samples) bank.push({ pid: p.id, vec: new Float32Array(buf) });
  $('pCount').textContent = products.length;
  $('sCount').textContent = products.reduce((n, p) => n + p.samples.length, 0);
}
const byId = id => products.find(p => p.id === id);

/* ---------- embedding model ---------- */
let extractor = null, RawImageCls = null, modelPromise = null;
function setModelState(t) { $('modelState').textContent = t; }
function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    if (MOCK) { setModelState('Model: test mode'); return; }
    setModelState('Model: downloading… (first time only)');
    const tf = await import(TF_URL);
    tf.env.allowLocalModels = false;
    RawImageCls = tf.RawImage;
    extractor = await tf.pipeline('image-feature-extraction', MODEL_ID, { dtype: 'q8' });
    setModelState('Model: ready');
  })().catch(e => { modelPromise = null; setModelState('Model: failed to load'); toast('Could not load the AI model. Check the internet connection.'); throw e; });
  return modelPromise;
}
async function embed(canvas) {            // canvas: any size, ideally square → Float32Array (L2-normalised)
  await loadModel();
  if (MOCK) {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d'); x.drawImage(canvas, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data, v = new Float32Array(192); let m = 0;
    for (let i = 0, j = 0; i < d.length; i += 4) { v[j++] = d[i]; v[j++] = d[i + 1]; v[j++] = d[i + 2]; }
    for (const a of v) m += a; m /= v.length; for (let i = 0; i < v.length; i++) v[i] -= m;
    return norm(v);
  }
  const out = await extractor(RawImageCls.fromCanvas(canvas));
  const D = out.dims[out.dims.length - 1];
  return norm(Float32Array.from(out.data.subarray(0, D)));   // first token = global (CLS) descriptor
}

/* ---------- matching ---------- */
function match(q) {   // best score per product, top 3
  const best = new Map();
  for (const s of bank) { const c = dot(q, s.vec); if (c > (best.get(s.pid) ?? -2)) best.set(s.pid, c); }
  return [...best].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pid, score]) => ({ p: byId(pid), score }));
}

/* ---------- camera + presence engine ---------- */
const SW = 80, SH = 50;             // small analysis frame
const small = document.createElement('canvas'); small.width = SW; small.height = SH;
const sctx = small.getContext('2d', { willReadFrequently: true });
function grab(video) { sctx.drawImage(video, 0, 0, SW, SH); const d = sctx.getImageData(0, 0, SW, SH).data, g = new Float32Array(SW * SH); for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; return g; }

async function openCamera(video, deviceId) {
  const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const tries = [deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: 'environment' } }, true];
  let err;
  for (const v of tries) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      video.srcObject = stream;
      await video.play();
      if (!video.videoWidth) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Camera opened but no video frames arrived. Check the lens or close other camera apps.')), 5000);
        video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('The camera opened but the video stream failed.')); }, { once: true });
      });
      return stream;
    } catch (e) {
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
      err = e;
      if (['NotAllowedError', 'PermissionDeniedError', 'NotReadableError', 'TrackStartError'].includes(e?.name)) throw e;
    }
  }
  throw err;
}
function cameraErrorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return 'The browser or embedded-frame policy blocked camera access. Open AI Detection Cam directly in a new tab, allow Camera for that URL, then reload.';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No camera was found. Connect or enable a camera, then try again.';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'The camera is busy or blocked by another app. Close apps using it and try again.';
  if (error?.name === 'SecurityError' || !window.isSecureContext) return 'Camera access requires HTTPS. Open this app using its secure Vercel address.';
  return `Could not start the camera${error?.message ? `: ${error.message}` : '.'}`;
}
async function listCameras() {
  try { const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); const sel = $('camSel'); const cur = sel.value; sel.replaceChildren(...ds.map((d, i) => Object.assign(document.createElement('option'), { value: d.deviceId, textContent: d.label || 'Camera ' + (i + 1) }))); if (cur) sel.value = cur; } catch { /* ignore */ }
}

function cropSquare(video, bbox) {   // bbox in 0..1 of the frame, or null → centre square. Returns 224×224 canvas.
  const vw = video.videoWidth, vh = video.videoHeight;
  let x, y, w, h;
  if (bbox) { x = bbox.x0 * vw; y = bbox.y0 * vh; w = (bbox.x1 - bbox.x0) * vw; h = (bbox.y1 - bbox.y0) * vh; }
  else { const s = Math.min(vw, vh) * .7; x = (vw - s) / 2; y = (vh - s) / 2; w = h = s; }
  const side = Math.min(Math.max(w, h) * 1.25, Math.min(vw, vh));      // pad 25 % so the model's centre-crop keeps the item
  let cx = x + w / 2 - side / 2, cy = y + h / 2 - side / 2;
  cx = Math.max(0, Math.min(vw - side, cx)); cy = Math.max(0, Math.min(vh - side, cy));
  const c = $('work'); c.width = c.height = 224;
  c.getContext('2d').drawImage(video, cx, cy, side, side, 0, 0, 224, 224);
  const out = document.createElement('canvas'); out.width = out.height = 224; out.getContext('2d').drawImage(c, 0, 0);
  return out;
}

/* ---------- counter state ---------- */
const counter = { paused: false, stream: null, baseline: null, prev: null, stableSince: 0, armed: true, emptySince: 0, busy: false, timer: null, lastBBox: null, lastSnap: null, cand: null };
const cart = new Map();     // pid → qty

function setState(t) { $('stateC').textContent = t; $('stateE').textContent = t; }
function drawBox(bb) { for (const id of ['bboxC', 'bboxE']) { const b = $(id); if (!bb) { b.style.display = 'none'; continue; } b.style.display = 'block'; b.style.left = bb.x0 * 100 + '%'; b.style.top = bb.y0 * 100 + '%'; b.style.width = (bb.x1 - bb.x0) * 100 + '%'; b.style.height = (bb.y1 - bb.y0) * 100 + '%'; } }

function analyse(g) {
  const base = counter.baseline; let changed = 0, x0 = SW, y0 = SH, x1 = -1, y1 = -1;
  for (let i = 0; i < g.length; i++) if (Math.abs(g[i] - base[i]) > 28) { changed++; const x = i % SW, y = (i / SW) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  let moved = 0; if (counter.prev) for (let i = 0; i < g.length; i++) if (Math.abs(g[i] - counter.prev[i]) > 20) moved++;
  return { frac: changed / g.length, motion: counter.prev ? moved / g.length : 1, bbox: x1 < 0 ? null : { x0: x0 / SW, y0: y0 / SH, x1: (x1 + 1) / SW, y1: (y1 + 1) / SH } };
}

function tick() {
  const v = $('vidC');
  if (!counter.stream || !v.videoWidth) return;
  const g = grab(v), now = performance.now();
  if (!counter.baseline) { counter.baseline = g; counter.prev = g; setState('Counter empty · ready'); return; }
  const a = analyse(g); counter.prev = g;
  const present = a.frac > 0.03;
  if (!present) {
    drawBox(null);
    if (a.motion < 0.01) { for (let i = 0; i < g.length; i++) counter.baseline[i] += (g[i] - counter.baseline[i]) * 0.03; }   // follow slow lighting changes
    if (!counter.emptySince) counter.emptySince = now;
    if (now - counter.emptySince > 500 && !counter.armed) { counter.armed = true; counter.cand = null; renderCand(null); }
    counter.stableSince = 0; setState('Counter empty · ready'); $('rescanBtn').disabled = !counter.lastSnap;
    return;
  }
  counter.emptySince = 0; drawBox(a.bbox); counter.lastBBox = a.bbox;
  if (a.motion > 0.015) { counter.stableSince = 0; setState('Item moving…'); return; }
  if (!counter.stableSince) counter.stableSince = now;
  if (!counter.armed && !counter.paused) { setState('Item recognised · remove it to scan the next'); return; }
  if (counter.paused) return;
  if (now - counter.stableSince > 600 && !counter.busy) recognise(a.bbox);
  else setState('Hold still…');
}

async function recognise(bbox) {
  counter.busy = true; setState('Recognising…');
  try {
    const crop = cropSquare($('vidC'), bbox);
    const q = await embed(crop);
    counter.lastSnap = { crop, q };
    $('rescanBtn').disabled = false;
    counter.armed = false;
    const top = bank.length ? match(q) : [];
    const thr = $('thr').value / 100, mar = $('mar').value / 100;
    let level = 'none';
    if (top.length && top[0].score >= thr) level = (top.length < 2 || top[0].score - top[1].score >= mar) ? 'ok' : 'maybe';
    else if (top.length && top[0].score >= thr - 0.15) level = 'maybe';
    counter.cand = { top, level, q, crop };
    renderCand(counter.cand);
    if (level === 'ok' && $('autoAdd').checked && top[0].score >= thr + 0.12) { addToCart(top[0].p.id); toast('Added ' + top[0].p.name); }
    setState(level === 'ok' ? 'Match found' : level === 'maybe' ? 'Please confirm' : 'Not recognised');
  } catch (e) { console.error(e); setState('Recognition failed'); counter.armed = true; }
  counter.busy = false;
}

function renderCand(c) {
  const box = $('candBox'); box.replaceChildren();
  if (!c) return;
  const wrap = document.createElement('div'); wrap.className = 'cand ' + c.level;
  const t = document.createElement('div'); t.className = 't';
  t.textContent = c.level === 'ok' ? 'Looks like:' : c.level === 'maybe' ? 'Not sure — which one is it?' : (bank.length ? 'No confident match' : 'Catalogue is empty — enrol products first');
  wrap.append(t);
  c.top.forEach((m, i) => {
    const b = document.createElement('button'); b.className = 'opt';
    const img = document.createElement('img'); img.src = m.p.thumb || ''; img.alt = '';
    const n = document.createElement('div'); n.className = 'n'; const nb = document.createElement('b'); nb.textContent = m.p.name; const ns = document.createElement('span'); ns.className = 'mute'; ns.textContent = money(m.p.price);
    n.append(nb, ns);
    const pc = document.createElement('span'); pc.className = 'pct'; pc.textContent = Math.round(m.score * 100) + '%';
    b.append(img, n, pc);
    if (i === 0 && c.level === 'ok') { b.style.borderColor = 'var(--acc)'; b.style.borderWidth = '2px'; }
    b.onclick = () => confirmPick(m.p.id, i);
    wrap.append(b);
  });
  const row = document.createElement('div'); row.className = 'row';
  const nw = document.createElement('button'); nw.className = 'btn ghost'; nw.textContent = 'Not listed — enrol this product';
  nw.onclick = () => { switchTab('catalogue'); enrol.samples = [{ q: c.q, thumb: c.crop.toDataURL('image/jpeg', .7) }]; renderSamples(); toast('Sample copied. Fill in the name and price.'); };
  row.append(nw); wrap.append(row);
  box.append(wrap);
}

async function confirmPick(pid, rank) {
  addToCart(pid);
  const c = counter.cand;
  if (c && rank > 0) {           // cashier corrected the AI → learn from it
    const p = byId(pid);
    try { await persistAiSamples(p, [...p.samples, c.q.buffer.slice(0)]); toast('Added. Saved this view of ' + p.name + ' to Firebase.'); }
    catch (error) { toast('Added, but Firebase could not save the AI correction: ' + error.message); }
  } else toast('Added ' + byId(pid).name);
  counter.cand = null; renderCand(null);
}

/* ---------- cart + payment ---------- */
function addToCart(pid) {
  const p = byId(pid), quantity = cart.get(pid) || 0;
  if (!p) return;
  if (quantity >= p.quantity) { toast(`Only ${p.quantity} ${p.name} in Firebase stock.`); return; }
  cart.set(pid, quantity + 1); renderCart();
}
function cartTotal() { let t = 0; for (const [pid, q] of cart) t += (byId(pid)?.price || 0) * q; return t; }
function renderCart() {
  const box = $('cartLines'); box.replaceChildren();
  if (!cart.size) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Place a product on the counter.'; box.append(e); }
  for (const [pid, q] of cart) {
    const p = byId(pid); if (!p) continue;
    const l = document.createElement('div'); l.className = 'line';
    const im = document.createElement('img'); im.className = 'thumb'; im.src = p.thumb || '';
    const n = document.createElement('div'); n.className = 'n'; const b = document.createElement('b'); b.textContent = p.name; const s = document.createElement('span'); s.className = 'mute'; s.textContent = money(p.price) + ' each'; n.append(b, s);
    const qt = document.createElement('div'); qt.className = 'qty';
    const mi = document.createElement('button'); mi.textContent = '−'; mi.onclick = () => { const v = (cart.get(pid) || 0) - 1; v > 0 ? cart.set(pid, v) : cart.delete(pid); renderCart(); };
    const qs = document.createElement('b'); qs.textContent = q;
    const pl = document.createElement('button'); pl.textContent = '+'; pl.disabled = q >= p.quantity; pl.title = pl.disabled ? 'No more stock available' : 'Add one'; pl.onclick = () => addToCart(pid);
    qt.append(mi, qs, pl);
    const amt = document.createElement('b'); amt.textContent = money(p.price * q); amt.style.minWidth = '64px'; amt.style.textAlign = 'right';
    l.append(im, n, qt, amt); box.append(l);
  }
  $('cartTotal').textContent = money(cartTotal());
  $('payBtn').disabled = !cart.size;
}
$('clearBtn').onclick = () => { cart.clear(); renderCart(); };
$('payBtn').onclick = () => { $('payTotal').textContent = money(cartTotal()); $('cashIn').value = ''; $('changeV').textContent = '0.00'; $('payMethod').dispatchEvent(new Event('change')); $('payDlg').showModal(); };
$('payMethod').onchange = () => $('cashBox').classList.toggle('hide', $('payMethod').value !== 'Cash');
$('cashIn').oninput = () => { $('changeV').textContent = money(Math.max(0, (+$('cashIn').value || 0) - cartTotal())); };
$('payCancel').onclick = () => $('payDlg').close();
$('payDone').onclick = async () => {
  const total = cartTotal();
  if ($('payMethod').value === 'Cash' && (+$('cashIn').value || 0) < total) { toast('Cash received is less than the total.'); return; }
  const paymentMethod = ({ Cash: 'cash', Card: 'card', 'Mobile / QR': 'qr' })[$('payMethod').value];
  const items = [...cart].map(([barcode, quantity]) => ({ barcode, quantity }));
  $('payDone').disabled = true;
  let sale;
  try {
    ({ sale } = await aiModelRequest('/api/sales', { method: 'POST', body: { items, paymentMethod } }));
    cart.clear(); renderCart(); $('payDlg').close();
    toast(`Sale #${sale.id} saved to Firebase · ${money(sale.totalOriginalPrice)}`);
  } catch (error) {
    toast(error.message || 'Firebase could not save the sale.');
    $('payDone').disabled = false;
    return;
  }
  $('payDone').disabled = false;
  try { await syncFirebaseProducts(); }
  catch { $('firebaseState').textContent = `Sale saved; inventory refresh failed. Tap “Refresh from Firebase”.`; }
};

/* ---------- counter camera controls ---------- */
async function startCounterCam() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const message = 'Camera access is unavailable here. Open the secure HTTPS site in a current browser.';
    $('cameraHelp').textContent = message; setState('Camera unavailable'); toast(message); return;
  }
  if (document.permissionsPolicy?.allowsFeature?.('camera') === false || document.featurePolicy?.allowsFeature?.('camera') === false) {
    const message = 'This embedded page is blocked from using the camera. Open the camera directly using the link below.';
    $('cameraHelp').textContent = message; setState('Camera blocked in frame'); return;
  }
  $('camBtn').disabled = true;
  $('cameraHelp').textContent = 'Waiting for browser camera permission…'; setState('Requesting camera…');
  try {
    // This call runs directly from the Start-camera button click, so the browser can show its native permission prompt.
    counter.stream = await openCamera($('vidC'), $('camSel').value || null);
    $('vidE').srcObject = counter.stream; $('vidE').play().catch(() => {});
    await listCameras();
    counter.baseline = null; counter.armed = true; counter.emptySince = 0;
    $('camBtn').textContent = $('camBtnE').textContent = 'Stop camera'; $('calBtn').disabled = false; $('snapBtn').disabled = false;
    setState('Keep the counter empty…');
    $('cameraHelp').textContent = 'Camera is live. Video stays on this device and is not uploaded.';
    clearInterval(counter.timer); counter.timer = setInterval(tick, 120);
    loadModel().catch(() => {});
  } catch (e) { const message = cameraErrorMessage(e); $('cameraHelp').textContent = message; setState('Camera could not start'); toast(message); }
  finally { $('camBtn').disabled = false; }
}
function stopCounterCam() {
  clearInterval(counter.timer); counter.stream?.getTracks().forEach(t => t.stop()); counter.stream = null; $('vidC').srcObject = null; $('vidE').srcObject = null;
  $('camBtn').textContent = $('camBtnE').textContent = 'Start camera'; $('calBtn').disabled = true; $('snapBtn').disabled = true; setState('Camera off'); $('cameraHelp').textContent = 'Press Start camera to trigger your browser’s camera permission prompt.'; drawBox(null);
}
$('camBtn').onclick = () => counter.stream ? stopCounterCam() : startCounterCam();
$('camSel').onchange = () => { if (counter.stream) { stopCounterCam(); startCounterCam(); } };
$('cameraHelp').textContent = 'Camera controls ready. Press Start camera to request access.';
$('calBtn').onclick = () => { counter.baseline = null; counter.armed = true; setState('Recalibrating — keep the counter empty'); };
$('rescanBtn').onclick = () => { counter.armed = true; counter.stableSince = 0; counter.cand = null; renderCand(null); };
$('thr').oninput = $('mar').oninput = () => { $('thrV').textContent = $('thr').value + '%'; $('marV').textContent = $('mar').value + '%'; try { localStorage.setItem('aic-thr', $('thr').value); localStorage.setItem('aic-mar', $('mar').value); } catch { /* ignore */ } };

/* ---------- enrolment ---------- */
const enrol = { samples: [], editId: null };
function updateSelectedProduct() {
  const p = byId($('pProduct').value);
  $('selectedProductInfo').textContent = p
    ? `${p.barcode} · ${p.quantity} in stock · ${p.price > 0 ? money(p.price) : 'Set selling price in Finance'} · ${p.category || 'No category'}`
    : 'Product name, barcode, price, stock, and photo come from Firebase Inventory.';
  $('usePhotoBtn').disabled = !p?.photoDataUrl;
  $('saveProd').disabled = !(p && enrol.samples.length);
}
async function aiModelRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let result = {};
  try { result = await response.json(); } catch { /* use the generic response below */ }
  if (!response.ok) throw new Error(result.error || `AI model request failed (${response.status}).`);
  return result;
}
async function persistAiSamples(product, samples) {
  if (MODEL_TAG !== 'Xenova/dinov2-small') throw new Error('Test mode samples are not saved to Firebase.');
  if (samples.length > 32) throw new Error('This product has reached the 32 sample limit. Clear training first.');
  await aiModelRequest('/api/ai-counter/models', { method: 'PUT', body: { barcode: product.barcode, model: MODEL_TAG, samples: samples.map(b64) } });
  product.samples = samples; product.model = MODEL_TAG;
  await DB.put('products', product); rebuildBank(); renderList();
}
async function loadAiModels(barcodes) {
  const found = new Map();
  for (let start = 0; start < barcodes.length; start += 25) {
    const query = new URLSearchParams();
    for (const barcode of barcodes.slice(start, start + 25)) query.append('barcode', barcode);
    const response = await aiModelRequest(`/api/ai-counter/models?${query}`);
    for (const model of response.models || []) found.set(String(model.barcode), model);
  }
  return found;
}
async function syncFirebaseProducts() {
  $('firebaseState').textContent = 'Loading Firebase inventory…';
  $('syncProducts').disabled = true;
  try {
    const response = await aiModelRequest('/api/inventory');
    const saved = await DB.all('products');
    const existing = new Map();
    for (const item of saved) { existing.set(String(item.id), item); if (item.sku) existing.set(String(item.sku), item); }
    const inventoryRows = (Array.isArray(response.products) ? response.products : []).filter(row => row && (row.barcode || row.id));
    let cloudModels = new Map(), modelsUnavailable = '';
    try { cloudModels = await loadAiModels(inventoryRows.map(row => String(row.barcode || row.id))); }
    catch (error) { modelsUnavailable = ` · AI samples unavailable: ${error.message}`; }
    const next = inventoryRows.map(row => {
      const barcode = String(row.barcode || row.id);
      const old = existing.get(barcode);
      const remote = cloudModels.get(barcode);
      const remoteSamples = remote?.model === MODEL_TAG && Array.isArray(remote.samples) ? remote.samples.map(unb64) : null;
      const localSamples = old?.model === MODEL_TAG && Array.isArray(old.samples) ? old.samples : [];
      return {
        ...(old || {}), id: barcode, barcode, name: String(row.name || barcode), sku: barcode,
        price: Number(row.originalPrice ?? row.price) || 0, quantity: Number(row.quantity) || 0,
        category: String(row.category || ''), photoDataUrl: row.photoDataUrl || '',
        thumb: row.photoDataUrl || old?.thumb || '', model: remote?.model || MODEL_TAG,
        samples: remoteSamples ?? localSamples,
      };
    });
    await DB.clear('products');
    for (const item of next) await DB.put('products', item);
    products = next;
    for (const barcode of [...cart.keys()]) if (!products.some(item => item.id === barcode)) cart.delete(barcode);
    rebuildBank(); renderProductSelect(); renderList(); renderCart(); updateSelectedProduct();
    $('firebaseState').textContent = `Firebase connected · ${next.length} inventory products${modelsUnavailable}`;
  } catch (error) {
    $('firebaseState').textContent = `Firebase inventory unavailable: ${error.message}`;
    throw error;
  } finally { $('syncProducts').disabled = false; }
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.data?.type !== 'retailflow:refresh-inventory') return;
  syncFirebaseProducts().catch(error => toast(error.message));
});
function renderProductSelect() {
  const select = $('pProduct'), previous = select.value || enrol.editId || '';
  select.replaceChildren(new Option(products.length ? 'Choose an inventory product…' : 'No Firebase products found', ''));
  for (const p of [...products].sort((a, b) => a.name.localeCompare(b.name))) {
    select.add(new Option(`${p.name} · ${p.barcode}`, p.id));
  }
  select.value = products.some(p => p.id === previous) ? previous : '';
}
function renderSamples() {
  const r = $('samplesRow'); r.replaceChildren();
  enrol.samples.forEach((s, i) => { const im = document.createElement('img'); im.src = s.thumb; im.title = 'Click to remove'; im.style.cursor = 'pointer'; im.onclick = () => { enrol.samples.splice(i, 1); renderSamples(); }; r.append(im); });
  const n = enrol.samples.length;
  $('snapHint').textContent = n ? n + ' sample' + (n > 1 ? 's' : '') + ' ready' + (n < 6 ? ' — capture more angles for better accuracy.' : '.') : 'Select a Firebase product, then capture it from several angles. Saved AI samples sync through Firebase.';
  updateSelectedProduct();
}
$('pProduct').onchange = () => { enrol.samples = []; enrol.editId = $('pProduct').value || null; $('enrolTitle').textContent = byId(enrol.editId)?.name ? 'Train: ' + byId(enrol.editId).name : 'Train a Firebase product'; renderSamples(); };
$('syncProducts').onclick = () => syncFirebaseProducts().catch(error => toast(error.message));
$('camBtnE').onclick = () => $('camBtn').click();
$('snapBtn').onclick = async () => {
  const p = byId($('pProduct').value);
  if (!p) { toast('Select an onboarded Firebase product first.'); return; }
  if (p.samples.length + enrol.samples.length >= 32) { toast('This product has reached the 32 sample limit.'); return; }
  $('snapBtn').disabled = true;
  try {
    // Same pipeline as the live counter: if an item is on the (calibrated) counter, crop to it.
    let bbox = null;
    if (counter.baseline) { const a = analyse(grab($('vidE'))); if (a.frac > 0.03) bbox = a.bbox; }
    if (!bbox) toast('Tip: place the product on the empty counter so it is cropped exactly like at checkout.');
    const crop = cropSquare($('vidE'), bbox), q = await embed(crop);
    enrol.samples.push({ q, thumb: crop.toDataURL('image/jpeg', .7) }); renderSamples();
  } catch (e) { console.error(e); toast('Capture failed.'); }
  $('snapBtn').disabled = !counter.stream;
};
$('resetEnrol').onclick = resetEnrol;
function resetEnrol() { enrol.samples = []; enrol.editId = $('pProduct').value || null; $('enrolTitle').textContent = byId(enrol.editId) ? 'Train: ' + byId(enrol.editId).name : 'Train a Firebase product'; renderSamples(); }
$('usePhotoBtn').onclick = async () => {
  const p = byId($('pProduct').value);
  if (!p?.photoDataUrl) return;
  if (p.samples.length + enrol.samples.length >= 32) { toast('This product has reached the 32 sample limit.'); return; }
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = p.photoDataUrl; });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 224;
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    canvas.getContext('2d').drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 224, 224);
    const q = await embed(canvas); enrol.samples.push({ q, thumb: canvas.toDataURL('image/jpeg', .7) }); renderSamples();
  } catch (error) { console.error(error); toast('Could not use the Firebase product photo.'); }
};
$('saveProd').onclick = async () => {
  const p = byId($('pProduct').value);
  if (!p || !enrol.samples.length) return;
  $('saveProd').disabled = true;
  try {
    await persistAiSamples(p, [...p.samples, ...enrol.samples.map(s => s.q.buffer.slice(0))]);
    toast('AI samples saved to Firebase for ' + p.name); resetEnrol();
  } catch (error) { toast(error.message || 'Firebase could not save AI samples.'); }
  finally { updateSelectedProduct(); }
};
function renderList() {
  const q = $('pSearch').value.trim().toLowerCase(), box = $('pList'); box.replaceChildren();
  const list = products.filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = products.length ? 'No match.' : 'No Firebase inventory products found. Add products in RetailFlow Inventory, then refresh.'; box.append(e); }
  for (const p of list.slice(0, 300)) {
    const r = document.createElement('div'); r.className = 'prow';
    const im = document.createElement('img'); im.className = 'thumb'; im.src = p.thumb || '';
    const n = document.createElement('div'); n.className = 'n'; const b = document.createElement('b'); b.textContent = p.name; const s = document.createElement('span'); s.className = 'mute'; s.textContent = `${money(p.price)} · ${p.quantity} in stock · ${p.samples.length} AI samples${p.category ? ' · ' + p.category : ''}`; n.append(b, s);
    const add = document.createElement('button'); add.className = 'btn ghost'; add.textContent = 'Train'; add.onclick = () => { $('pProduct').value = p.id; enrol.editId = p.id; enrol.samples = []; $('enrolTitle').textContent = 'Train: ' + p.name; switchTab('catalogue'); renderSamples(); };
    const del = document.createElement('button'); del.className = 'btn ghost'; del.textContent = 'Clear training'; del.disabled = !p.samples.length; del.onclick = async () => {
      try {
        await aiModelRequest('/api/ai-counter/models', { method: 'DELETE', body: { barcode: p.barcode } });
        p.samples = []; p.model = MODEL_TAG; await DB.put('products', p); cart.delete(p.id); rebuildBank(); renderList(); renderCart();
        toast('AI training removed from Firebase.');
      } catch (error) { toast(error.message || 'Could not clear Firebase training.'); }
    };
    r.append(im, n, add, del); box.append(r);
  }
  if (list.length > 300) { const m = document.createElement('div'); m.className = 'mute'; m.style.padding = '8px'; m.textContent = `Showing 300 of ${list.length}. Use search.`; box.append(m); }
}
$('pSearch').oninput = renderList;

/* ---------- self-test (leave-one-sample-out) ---------- */
$('selfTest').onclick = () => {
  const out = $('testOut'); out.classList.remove('hide');
  const multi = bank.filter(s => bank.filter(x => x.pid === s.pid).length >= 2);
  if (multi.length < 4) { out.textContent = 'Enrol at least a few products with 2+ samples each, then run this again.'; return; }
  let right = 0, tot = 0, okScores = [], badScores = [], confusions = new Map();
  for (const s of multi) {
    const best = new Map();
    for (const o of bank) { if (o === s) continue; const c = dot(s.vec, o.vec); if (c > (best.get(o.pid) ?? -2)) best.set(o.pid, c); }
    const r = [...best].sort((a, b) => b[1] - a[1]); if (!r.length) continue;
    tot++; if (r[0][0] === s.pid) { right++; okScores.push(r[0][1]); } else { badScores.push(r[0][1]); const k = byId(s.pid).name + ' → ' + byId(r[0][0]).name; confusions.set(k, (confusions.get(k) || 0) + 1); }
  }
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) + '%' : '—';
  const conf = [...confusions].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `  ${k} (×${n})`).join('\n');
  out.textContent = `Top-1 accuracy: ${right}/${tot} = ${Math.round(right / tot * 100)}%\nAverage similarity when right: ${avg(okScores)} · when wrong: ${avg(badScores)}\n${conf ? 'Most confused pairs:\n' + conf + '\n' : ''}Tip: set "minimum similarity" a little above the "when wrong" average.`;
};

/* ---------- backup ---------- */
$('expBtn').onclick = () => {
  const data = { app: 'ai-counter', model: MODEL_TAG, products: products.map(p => ({ ...p, samples: p.samples.map(b64) })) };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); a.download = 'ai-counter-catalogue.json'; a.click();
};
$('impBtn').onclick = () => $('impFile').click();
$('impFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d.app !== 'ai-counter') throw new Error('Not a catalogue backup');
    for (const p of d.products) { p.samples = p.samples.map(unb64); const i = products.findIndex(x => x.id === p.id); i >= 0 ? products[i] = p : products.push(p); await DB.put('products', p); }
    rebuildBank(); renderList(); toast('Imported ' + d.products.length + ' products');
  } catch (err) { toast('Import failed: ' + err.message); }
  e.target.value = '';
};

/* ---------- tabs + boot ---------- */
function switchTab(t) {
  $('viewCounter').classList.toggle('hide', t !== 'counter'); $('viewCatalogue').classList.toggle('hide', t !== 'catalogue');
  $('tabCounter').classList.toggle('on', t === 'counter'); $('tabCatalogue').classList.toggle('on', t === 'catalogue');
  counter.paused = t !== 'counter';
}
$('tabCounter').onclick = () => switchTab('counter'); $('tabCatalogue').onclick = () => switchTab('catalogue');

(async () => {
  try { const a = localStorage.getItem('aic-thr'), b = localStorage.getItem('aic-mar'); if (a) $('thr').value = a; if (b) $('mar').value = b; } catch { /* ignore */ }
  $('thr').dispatchEvent(new Event('input'));
  // Do not show persisted inventory cache before a successful Firebase read.
  // Only camera samples are reused, matched to current inventory by barcode.
  products = []; rebuildBank(); renderList(); renderCart(); renderSamples();
  try { await syncFirebaseProducts(); } catch { /* Keep the page open and show the Firebase error above. */ }
  if (MOCK) window.__t = { embed, match, products: () => products, bank: () => bank, enrol, cart, counter, DB, renderSamples };
})();
