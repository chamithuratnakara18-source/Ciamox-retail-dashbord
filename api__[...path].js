const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { settings: ultralyticsSettings, uploadReferences } = require('../lib/ultralytics-sync');

const ROLES = ['owner', 'admin', 'manager', 'cashier'];
const MONEY_LIMIT = 1_000_000_000;
const MAX_BODY_BYTES = 180_000;
const MONTHLY_FIELDS = ['water', 'electricity', 'gas', 'sewage', 'salaries', 'mortgagePayment'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function adminApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new HttpError(503, 'Backend is not configured with Firebase Admin credentials.');
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw); } catch { throw new HttpError(503, 'Firebase Admin credentials are invalid.'); }
  if (!serviceAccount.project_id || (process.env.FIREBASE_PROJECT_ID && serviceAccount.project_id !== process.env.FIREBASE_PROJECT_ID)) {
    throw new HttpError(503, 'Firebase Admin credentials do not match the configured project.');
  }
  return initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
}

function db() { return getFirestore(adminApp()); }
function productRef(barcode) { return db().collection('products').doc(encodeURIComponent(barcode)); }
function aiCounterModelRef(barcode) { return db().collection('aiCounterModels').doc(encodeURIComponent(barcode)); }
function posRef() { return db().collection('receipts').doc('pos-active'); }
function auditRef() { return db().collection('auditLogs').doc(); }
function supplierRef(name) { return db().collection('suppliers').doc(encodeURIComponent(name.normalize('NFC').trim().toLocaleLowerCase())); }

function fail(status, message) { throw new HttpError(status, message); }
function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(400, `${label} must be between 1 and ${max} characters.`);
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > max) fail(400, `${label} must be between 1 and ${max} characters.`);
  return normalized;
}
function number(value, label, { whole = false, zero = false } = {}) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) fail(400, `Enter a valid ${label}.`);
  const parsed = Number(value);
  if (value === '' || value == null || !Number.isFinite(parsed) || parsed < (zero ? 0 : Number.EPSILON) || parsed > MONEY_LIMIT || (whole && !Number.isSafeInteger(parsed))) {
    fail(400, `Enter a valid ${label}.`);
  }
  return parsed;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    fail(400, `Enter a valid ${label}.`);
  }
  return value;
}
function today() {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function posItems(value) {
  return Array.isArray(value?.items) ? value.items.filter(item => typeof item?.barcode === 'string' && Number.isSafeInteger(item.quantity) && item.quantity > 0)
    .map(item => ({ barcode: item.barcode, quantity: item.quantity })) : [];
}
function cents(value, label) {
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result)) fail(400, `The ${label} is too large.`);
  return result;
}
function productView(product) {
  return {
    barcode: product.barcode, name: product.name, quantity: Number(product.quantity) || 0,
    originalPrice: product.originalPrice == null ? null : Number(product.originalPrice),
    unitCost: product.unitCost == null ? null : Number(product.unitCost),
    arrivalDate: product.arrivalDate || '', supplierName: product.supplierName || '', category: product.category || '',
    manufactureDate: product.manufactureDate || '', expiryDate: product.expiryDate || '',
    photoDataUrl: product.photoDataUrl || '', updatedAt: product.updatedAt,
  };
}
function posProductView(product) {
  return {
    barcode: product.barcode, name: product.name, quantity: Number(product.quantity) || 0,
    originalPrice: product.originalPrice == null ? null : Number(product.originalPrice),
    photoDataUrl: product.photoDataUrl || '',
    hasUnitCost: product.unitCost != null && Number.isFinite(Number(product.unitCost)),
  };
}
// Password-free preview mode. The API is intentionally unauthenticated until
// Firebase sign-in and role checks are restored for the public release.
function requireRole() {}
function writeAudit(transaction, user, action, target, detail = {}) {
  transaction.set(auditRef(), {
    actorUid: user.uid, actorEmail: user.email || '', action, target,
    detail, createdAt: FieldValue.serverTimestamp(),
  });
}

async function receive(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const barcode = text(body.barcode, 'Barcode', 128);
  const name = text(body.name, 'Product name');
  const quantity = number(body.quantity, 'quantity', { whole: true });
  const unitCost = number(body.unitCost, 'purchase cost', { zero: true });
  const supplierName = text(body.supplierName, 'supplier name');
  const manufactureDate = body.manufactureDate ? date(body.manufactureDate, 'manufacture date') : '';
  const expiryDate = body.expiryDate ? date(body.expiryDate, 'expiry date') : '';
  if (manufactureDate && expiryDate && expiryDate < manufactureDate) fail(400, 'Expiry date must be on or after the manufacture date.');
  const photoDataUrl = body.photoDataUrl || '';
  if (typeof photoDataUrl !== 'string' || photoDataUrl.length > 100_000 || (photoDataUrl && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photoDataUrl))) {
    fail(400, 'Choose a smaller JPEG product photo.');
  }
  const trainingPhotos = body.trainingPhotos;
  if (trainingPhotos != null && (!Array.isArray(trainingPhotos) || trainingPhotos.length !== 6 ||
      trainingPhotos.some(url => typeof url !== 'string' || (url && (url.length > 100000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)))) ||
      (trainingPhotos.some(Boolean) && trainingPhotos.some(url => !url)))) fail(400, 'Capture all six valid product views or leave the set empty.');
  const ref = productRef(barcode), receiptRef = db().collection('receipts').doc();
  const supplierProfileRef = supplierRef(supplierName), actor = user;
  const arrivalDate = today();
  let previousSync;
  const saved = await db().runTransaction(async transaction => {
    const [snapshot, supplierProfileSnapshot] = await Promise.all([
      transaction.get(ref), transaction.get(supplierProfileRef),
    ]);
    const existing = snapshot.data();
    previousSync = existing?.ultralyticsSync;
    const oldQuantity = Number(existing?.quantity) || 0;
    const nextQuantity = oldQuantity + quantity;
    if (!Number.isSafeInteger(nextQuantity)) fail(400, 'The stock quantity is too large.');
    const averageCost = existing?.unitCost == null || oldQuantity === 0 ? unitCost : ((Number(existing.unitCost) * oldQuantity) + unitCost * quantity) / nextQuantity;
    const product = {
      barcode, name, quantity: nextQuantity, originalPrice: existing?.originalPrice ?? null, unitCost: averageCost,
      arrivalDate, supplierName,
      manufactureDate: manufactureDate || existing?.manufactureDate || '', expiryDate: expiryDate || existing?.expiryDate || '',
      photoDataUrl: photoDataUrl || existing?.photoDataUrl || '', trainingPhotos: trainingPhotos?.some(Boolean) ? trainingPhotos : (existing?.trainingPhotos || []), category: existing?.category || '',
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Preserve camera reference vectors stored on the inventory document when
    // another delivery updates stock or replaces the six scanner photos.
    transaction.set(ref, product, { merge: true });
    transaction.set(receiptRef, { barcode, productName: name, quantity, originalPrice: product.originalPrice, unitCost,
      arrivalDate, supplierName, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() });
    if (supplierProfileSnapshot.data()?.archived === true) {
      transaction.update(supplierProfileRef, { archived: false, updatedAt: FieldValue.serverTimestamp() });
    }
    writeAudit(transaction, actor, 'inventory.receive', barcode, { quantity, unitCost });
    return { product: productView(product), receipt: { id: receiptRef.id, quantity, supplierName, arrivalDate } };
  });
  // Upload only after Firestore commits. A third-party outage must not undo
  // inventory receiving or leave the cashier thinking the stock was lost.
  if (trainingPhotos?.every(Boolean)) {
    try {
      const config = ultralyticsSettings();
      if (config) {
        const sync = await uploadReferences({ barcode, trainingPhotos, ultralyticsSync: previousSync }, config);
        if (sync.status === 'queued') await ref.update({ ultralyticsSync: { ...sync, updatedAt: FieldValue.serverTimestamp() } });
        saved.trainingSync = { status: sync.status };
      }
    } catch (error) {
      console.error('Ultralytics reference upload failed:', error.message);
      saved.trainingSync = { status: 'failed', message: 'Saved to Firebase; Ultralytics sync will retry.' };
    }
  }
  return saved;
}

async function syncExistingReferences() {
  const config = ultralyticsSettings();
  if (!config) return { status: 'disabled' };
  const snapshots = await db().collection('products').get();
  let queued = 0, failed = 0;
  // Three datasets per run stay below the Platform upload rate limit.
  for (const snapshot of snapshots.docs) {
    if (queued + failed >= 3) break;
    const product = snapshot.data();
    if (!Array.isArray(product.trainingPhotos) || product.trainingPhotos.length !== 6 || product.trainingPhotos.some(photo => !photo)) continue;
    try {
      const outcome = await uploadReferences(product, config);
      if (outcome.status === 'unchanged') continue;
      await snapshot.ref.update({ ultralyticsSync: { ...outcome, updatedAt: FieldValue.serverTimestamp() } });
      queued++;
    } catch (error) {
      failed++;
      console.error('Ultralytics scheduled sync failed:', error.message);
    }
  }
  return { status: 'processed', queued, failed };
}

function optionalSupplierText(value, label, max = 120) {
  if (value == null || value === '') return '';
  return text(value, label, max);
}

function optionalSupplierNumber(value, label, min, max) {
  if (value == null || value === '') return null;
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) fail(400, `Enter a valid ${label}.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) fail(400, `Enter a valid ${label} between ${min} and ${max}.`);
  return parsed;
}

async function saveSupplierProfile(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const name = text(body.name, 'Supplier name', 120);
  const city = optionalSupplierText(body.city, 'City', 120);
  const country = optionalSupplierText(body.country, 'Country', 120);
  const supplierType = optionalSupplierText(body.supplierType, 'Supplier type', 80);
  const latitude = optionalSupplierNumber(body.latitude, 'latitude', -90, 90);
  const longitude = optionalSupplierNumber(body.longitude, 'longitude', -180, 180);
  const leadTimeDays = optionalSupplierNumber(body.leadTimeDays, 'lead time', 0, 3650);
  const qualityScore = optionalSupplierNumber(body.qualityScore, 'quality score', 0, 100);
  const defectRate = optionalSupplierNumber(body.defectRate, 'defect rate', 0, 100);
  if ((latitude == null) !== (longitude == null)) fail(400, 'Enter both latitude and longitude to place the supplier on the map.');
  const ref = supplierRef(name);
  const supplier = { key: name.normalize('NFC').trim().toLocaleLowerCase(), name, city, country, supplierType,
    latitude, longitude, leadTimeDays, qualityScore, defectRate };
  await db().runTransaction(async transaction => {
    const existing = (await transaction.get(ref)).data();
    transaction.set(ref, {
      ...supplier,
      createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      archived: false,
    });
    writeAudit(transaction, user, existing ? 'supplier.update' : 'supplier.create', ref.id,
      { city: Boolean(city), country: Boolean(country), hasCoordinates: latitude != null,
        hasLeadTime: leadTimeDays != null, hasQualityScore: qualityScore != null });
  });
  return { supplier };
}

async function archiveSupplier(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const name = text(body.name, 'Supplier name', 120);
  const ref = supplierRef(name);
  const key = name.normalize('NFC').trim().toLocaleLowerCase();
  await db().runTransaction(async transaction => {
    const existing = (await transaction.get(ref)).data();
    transaction.set(ref, {
      ...existing,
      key,
      name: existing?.name || name,
      archived: true,
      createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, user, 'supplier.archive', ref.id, {});
  });
  return { supplier: { key, name, archived: true } };
}

async function removeInventory(body, user) {
  requireRole(user, ['owner', 'admin']);
  const barcode = text(body.barcode, 'Barcode', 128), expectedName = text(body.expectedName, 'Product name');
  const expectedQuantity = number(body.expectedQuantity, 'expected quantity', { whole: true, zero: true });
  const ref = productRef(barcode), adjustmentRef = db().collection('receipts').doc();
  return db().runTransaction(async transaction => {
    const product = (await transaction.get(ref)).data();
    if (!product) fail(409, 'This product has already been removed. Refresh inventory.');
    const quantity = Number(product.quantity);
    if (product.name !== expectedName || quantity !== expectedQuantity) fail(409, 'This product changed since it was displayed. Refresh inventory before removing it.');
    transaction.delete(ref);
    transaction.delete(aiCounterModelRef(barcode));
    transaction.set(adjustmentRef, { type: 'inventory_removal', barcode, productName: product.name, quantity: -quantity,
      unitCost: product.unitCost ?? null, arrivalDate: today(), supplierName: product.supplierName || '',
      createdBy: user.uid, createdAt: FieldValue.serverTimestamp() });
    writeAudit(transaction, user, 'inventory.remove', barcode, { quantity });
    return { removed: { barcode, name: product.name, quantity } };
  });
}

async function assignCategory(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const barcode = text(body.barcode, 'Barcode', 128), category = text(body.category, 'Category name', 80);
  const ref = productRef(barcode);
  return db().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), product = snapshot.data();
    if (!product) fail(409, 'This product is no longer in inventory. Refresh and try again.');
    transaction.update(ref, { category, updatedAt: FieldValue.serverTimestamp() });
    writeAudit(transaction, user, 'inventory.category', barcode, { category });
    return { product: productView({ ...product, category }) };
  });
}

async function setSellingPrice(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const barcode = text(body.barcode, 'Barcode', 128), sellingPrice = number(body.sellingPrice, 'selling price', { zero: true });
  const expectedPrice = body.expectedPrice == null ? null : number(body.expectedPrice, 'previous selling price', { zero: true });
  const ref = productRef(barcode);
  return db().runTransaction(async transaction => {
    const product = (await transaction.get(ref)).data();
    if (!product) fail(409, 'This product is no longer in inventory. Refresh Finance.');
    const currentPrice = product.originalPrice == null ? null : Number(product.originalPrice);
    if (currentPrice !== expectedPrice) fail(409, 'The selling price changed on another device. Refresh Finance.');
    transaction.update(ref, { originalPrice: sellingPrice, updatedAt: FieldValue.serverTimestamp() });
    writeAudit(transaction, user, 'finance.selling_price', barcode, { sellingPrice });
    return { product: productView({ ...product, originalPrice: sellingPrice }) };
  });
}

async function saveMonthlyPlan(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const plan = Object.fromEntries(MONTHLY_FIELDS.map(field => [field, body[field] === '' || body[field] == null ? 0 : number(body[field], field, { zero: true })]));
  if (!MONTHLY_FIELDS.some(field => plan[field] > 0)) fail(400, 'Enter at least one monthly cost.');
  const currentMonth = today().slice(0, 7), savedPlan = { type: 'monthly_plan', ...plan, updatedBy: user.uid, updatedAt: FieldValue.serverTimestamp() };
  const batch = db().batch();
  batch.set(db().collection('expenses').doc('monthly-plan'), savedPlan);
  batch.set(db().collection('expenses').doc(`monthly-plan-${currentMonth}`), savedPlan);
  batch.set(auditRef(), { actorUid: user.uid, actorEmail: user.email || '', action: 'finance.monthly_plan', target: currentMonth, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { plan: { ...plan, cashCommitments: MONTHLY_FIELDS.reduce((sum, field) => sum + plan[field], 0) } };
}

async function addExpense(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const title = text(body.title, 'Expense name'), amount = number(body.amount, 'amount');
  const expenseDate = date(body.expenseDate, 'expense date');
  if (expenseDate > today()) fail(400, 'Cost date cannot be in the future.');
  const expenseKind = body.expenseKind === undefined ? 'one_time' : body.expenseKind;
  if (!['monthly_cost', 'one_time'].includes(expenseKind)) fail(400, 'Choose a valid cost type.');
  const ref = db().collection('expenses').doc();
  const batch = db().batch();
  batch.set(ref, { title, amount, expenseDate, expenseKind, createdBy: user.uid, createdAt: FieldValue.serverTimestamp() });
  batch.set(auditRef(), { actorUid: user.uid, actorEmail: user.email || '', action: 'finance.expense', target: ref.id, detail: { amount }, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { expense: { id: ref.id, title, amount, expenseDate, expenseKind } };
}

async function addPosScan(body, user) {
  requireRole(user, ROLES);
  const barcode = text(body.barcode, 'Barcode', 128), ref = productRef(barcode), cartRef = posRef();
  return db().runTransaction(async transaction => {
    const [productSnapshot, cartSnapshot] = await Promise.all([transaction.get(ref), transaction.get(cartRef)]);
    const product = productSnapshot.data();
    if (!product) fail(404, 'This barcode is not in inventory. Add it in Inbound first.');
    const items = posItems(cartSnapshot.data()), current = items.find(item => item.barcode === barcode);
    if (Number(product.quantity) <= (current?.quantity || 0)) fail(409, `Only ${Number(product.quantity) || 0} ${product.name} in stock.`);
    if (current) current.quantity++;
    else { if (items.length >= 100) fail(400, 'The order has reached 100 different products.'); items.push({ barcode, quantity: 1 }); }
    transaction.set(cartRef, { type: 'pos_order', items, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid });
    return { product: posProductView(product), quantity: current?.quantity || 1 };
  });
}

async function adjustPos(body, user) {
  requireRole(user, ROLES);
  const barcode = text(body.barcode, 'Barcode', 128), delta = Number(body.delta);
  if (!Number.isSafeInteger(delta) || delta === 0 || delta < -1_000_000_000 || delta > 1) fail(400, 'Choose a valid order quantity change.');
  const cartRef = posRef(), ref = productRef(barcode);
  return db().runTransaction(async transaction => {
    const [productSnapshot, cartSnapshot] = await Promise.all([transaction.get(ref), transaction.get(cartRef)]);
    const product = productSnapshot.data(), items = posItems(cartSnapshot.data()), item = items.find(row => row.barcode === barcode);
    if (!item) fail(409, 'This item is no longer in the order.');
    const next = Math.max(0, item.quantity + delta);
    if (delta > 0 && (!product || next > Number(product.quantity))) fail(409, `Only ${Number(product?.quantity) || 0} ${product?.name || barcode} in stock.`);
    if (next) item.quantity = next; else items.splice(items.indexOf(item), 1);
    transaction.set(cartRef, { type: 'pos_order', items, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid });
    return { items };
  });
}

async function clearPos(user) {
  requireRole(user, ROLES);
  const cartRef = posRef();
  return db().runTransaction(async transaction => {
    await transaction.get(cartRef);
    transaction.set(cartRef, { type: 'pos_order', items: [], updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid });
    return { items: [] };
  });
}

async function checkoutPos(body, user) {
  requireRole(user, ROLES);
  const paymentMethod = text(body.paymentMethod, 'Payment method', 12);
  if (!['cash', 'card', 'qr'].includes(paymentMethod)) fail(400, 'Choose Cash, Card, or QR.');
  const cartRef = posRef(), saleRef = db().collection('sales').doc();
  return db().runTransaction(async transaction => {
    const items = posItems((await transaction.get(cartRef)).data());
    if (!items.length) fail(409, 'The order is empty or was already checked out.');
    const ordered = [...items].sort((a, b) => a.barcode.localeCompare(b.barcode)), refs = ordered.map(item => productRef(item.barcode));
    const snapshots = [];
    for (const ref of refs) snapshots.push(await transaction.get(ref));
    let totalCents = 0, costCents = 0;
    const sold = ordered.map((item, index) => {
      const product = snapshots[index].data();
      if (!product) fail(409, `${item.barcode} is no longer in inventory.`);
      if (Number(product.quantity) < item.quantity) fail(409, `Only ${product.quantity} ${product.name} in stock.`);
      if (product.unitCost == null || !Number.isFinite(Number(product.unitCost))) fail(400, `Purchase cost is missing for ${product.name}.`);
      const price = product.originalPrice == null ? null : Number(product.originalPrice);
      if (price == null || !Number.isFinite(price) || price < 0) fail(400, `Set a selling price for ${product.name} in Finance before checkout.`);
      totalCents += cents(price, 'order total') * item.quantity;
      costCents += cents(Number(product.unitCost), 'product cost') * item.quantity;
      return { barcode: item.barcode, name: product.name, quantity: item.quantity, originalPrice: price, unitCost: Number(product.unitCost) };
    });
    if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(costCents)) fail(400, 'The order total is too large. Reduce its quantity.');
    snapshots.forEach((snapshot, index) => transaction.update(snapshot.ref, { quantity: Number(snapshot.data().quantity) - sold[index].quantity, updatedAt: FieldValue.serverTimestamp() }));
    const totalOriginalPrice = totalCents / 100;
    transaction.set(saleRef, { items: sold, totalOriginalPrice, grossProfit: (totalCents - costCents) / 100,
      day: today(), paymentMethod, source: 'pos', createdBy: user.uid, createdAt: FieldValue.serverTimestamp() });
    transaction.set(cartRef, { type: 'pos_order', items: [], updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid });
    writeAudit(transaction, user, 'pos.checkout', saleRef.id, { totalOriginalPrice, paymentMethod, itemCount: sold.length });
    return { sale: { id: saleRef.id.slice(0, 8), totalOriginalPrice, paymentMethod } };
  });
}

async function sell(body, user) {
  requireRole(user, ROLES);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) fail(400, 'Add between 1 and 100 products to the cart.');
  const paymentMethod = body.paymentMethod == null ? null : text(body.paymentMethod, 'Payment method', 12);
  if (paymentMethod && !['cash', 'card', 'qr'].includes(paymentMethod)) fail(400, 'Choose Cash, Card, or QR.');
  const quantities = new Map(), proposedPrices = new Map();
  for (const item of body.items) {
    const barcode = text(item?.barcode, 'Barcode', 128), quantity = number(item?.quantity, 'quantity', { whole: true });
    const nextQuantity = (quantities.get(barcode) || 0) + quantity;
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity > MONEY_LIMIT) fail(400, 'The requested product quantity is too large.');
    quantities.set(barcode, nextQuantity);
    if (item?.originalPrice != null && item.originalPrice !== '') {
      const price = number(item.originalPrice, 'sale price', { zero: true });
      if (proposedPrices.has(barcode) && proposedPrices.get(barcode) !== price) fail(400, `Conflicting sale prices for ${barcode}.`);
      proposedPrices.set(barcode, price);
    }
  }
  const barcodes = [...quantities.keys()].sort(), refs = barcodes.map(productRef), saleRef = db().collection('sales').doc();
  return db().runTransaction(async transaction => {
    const snapshots = [];
    for (const ref of refs) snapshots.push(await transaction.get(ref));
    let totalCents = 0, costCents = 0;
    const items = snapshots.map((snapshot, index) => {
      const product = snapshot.data(), barcode = barcodes[index], quantity = quantities.get(barcode);
      if (!product) fail(404, `Barcode ${barcode} is not in inventory.`);
      if (Number(product.quantity) < quantity) fail(409, `Only ${product.quantity} ${product.name} in stock.`);
      if (product.unitCost == null || !Number.isFinite(Number(product.unitCost))) fail(400, `Purchase cost is missing for ${product.name}.`);
      const price = product.originalPrice == null ? proposedPrices.get(barcode) : Number(product.originalPrice);
      if (price == null || !Number.isFinite(price)) fail(400, `Enter a sale price for ${product.name} before selling.`);
      if (product.originalPrice != null && proposedPrices.has(barcode) && price !== proposedPrices.get(barcode)) fail(409, `The sale price for ${product.name} was set on another device. Scan it again.`);
      totalCents += cents(price, 'sale total') * quantity;
      costCents += cents(Number(product.unitCost), 'product cost') * quantity;
      return { barcode, name: product.name, quantity, originalPrice: price, unitCost: Number(product.unitCost) };
    });
    if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(costCents)) fail(400, 'The order total is too large.');
    snapshots.forEach((snapshot, index) => transaction.update(snapshot.ref, { quantity: Number(snapshot.data().quantity) - items[index].quantity,
      originalPrice: items[index].originalPrice, updatedAt: FieldValue.serverTimestamp() }));
    const totalOriginalPrice = totalCents / 100;
    transaction.set(saleRef, { items, totalOriginalPrice, grossProfit: (totalCents - costCents) / 100,
      day: today(), ...(paymentMethod ? { paymentMethod } : {}), createdBy: user.uid, createdAt: FieldValue.serverTimestamp() });
    writeAudit(transaction, user, 'pos.sale', saleRef.id, { totalOriginalPrice, itemCount: items.length, ...(paymentMethod ? { paymentMethod } : {}) });
    return { sale: { id: saleRef.id.slice(0, 8), totalOriginalPrice, ...(paymentMethod ? { paymentMethod } : {}) } };
  });
}

async function saveAiCounterModel(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const barcode = text(body.barcode, 'Barcode', 128);
  const model = text(body.model, 'AI model', 80);
  if (model !== 'Xenova/dinov2-small') fail(400, 'Unsupported AI model.');
  const fromInventory = body.kind === 'inventoryViews';
  if (!Array.isArray(fromInventory ? body.photoSamples : body.samples) || !(fromInventory ? body.photoSamples : body.samples).length || (fromInventory ? body.photoSamples : body.samples).length > 32) {
    fail(400, 'Save between 1 and 32 camera samples per product.');
  }
  const samples = (fromInventory ? body.photoSamples : body.samples).map(sample => {
    if (typeof sample !== 'string' || sample.length !== 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(sample)) {
      fail(400, 'An AI sample has an invalid format.');
    }
    const bytes = Buffer.from(sample, 'base64');
    if (bytes.length !== 1536 || bytes.toString('base64') !== sample) fail(400, 'An AI sample has an invalid size.');
    return sample;
  });
  await db().runTransaction(async transaction => {
    const product = (await transaction.get(productRef(barcode))).data();
    if (!product) fail(409, 'This product is no longer in Firebase inventory. Refresh and try again.');
    const fields = fromInventory
      ? { photoSamples: samples, sourceKey: text(body.sourceKey, 'Photo set version', 80) }
      : { samples };
    transaction.set(aiCounterModelRef(barcode), { barcode, model, ...fields, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid }, { merge: true });
  });
  return { model: { barcode, model, sampleCount: samples.length } };
}

async function deleteAiCounterModel(body, user) {
  requireRole(user, ['owner', 'admin', 'manager']);
  const barcode = text(body.barcode, 'Barcode', 128);
  await aiCounterModelRef(barcode).delete();
  return { removed: { barcode } };
}

function routeParts(request) {
  const parsed = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
  return { pathname: parsed.pathname, query: parsed.searchParams };
}
function readBody(req) {
  const body = req.body ?? {};
  if (!body || (typeof body !== 'string' && (typeof body !== 'object' || Array.isArray(body)))) fail(400, 'Request body must be a JSON object.');
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) fail(413, 'Request is too large.');
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body || '{}') : body;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Request body must be a JSON object.');
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, 'Request body must be valid JSON.');
  }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
  return origin === `${proto}://${host}`;
}
function originAllowed(req) {
  const origin = req.headers.origin;
  return !origin || sameOrigin(req) || (process.env.RETAILFLOW_SCANNER_ORIGIN && origin === process.env.RETAILFLOW_SCANNER_ORIGIN);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const origin = req.headers.origin;
  if (!originAllowed(req)) return res.status(403).json({ error: 'Cross-origin requests are not accepted.' });
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_BODY_BYTES) return res.status(413).json({ error: 'Request is too large.' });

  const user = { uid: 'public-preview', email: '', retailRole: 'owner' };
  try {
    const { pathname, query } = routeParts(req);
    const method = String(req.method || '').toUpperCase();
    let result;
    if (method === 'GET' && pathname === '/api/ultralytics/sync') {
      if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
        fail(403, 'Scheduled sync is not authorized.');
      result = await syncExistingReferences();
    } else if (method === 'GET' && pathname === '/api/health') {
      requireRole(user, ROLES);
      await db().collection('meta').doc('connection').get();
      result = { ok: true };
    } else if (method === 'GET' && pathname === '/api/inventory') {
      requireRole(user, ROLES);
      const barcode = query.get('barcode')?.trim();
      const snapshots = barcode
        ? [await productRef(text(barcode, 'Barcode', 128)).get()]
        : (await db().collection('products').get()).docs;
      const products = snapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data());
      const view = user.retailRole === 'cashier' ? posProductView : productView;
      const safeProducts = products.map(product => ({...view(product), ...(query.get('training') === '1' ? {trainingPhotos: Array.isArray(product.trainingPhotos) ? product.trainingPhotos : []} : {})})).sort((a, b) =>
        (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0) || a.name.localeCompare(b.name));
      result = barcode ? { product: safeProducts[0] || null } : {
        products: safeProducts,
        categories: user.retailRole === 'cashier' ? [] : [...new Set(safeProducts.map(product => product.category).filter(Boolean))].sort(),
      };
    } else if (method === 'GET' && (pathname === '/api/ai-counter/models' || pathname === '/api/ai-models')) {
      requireRole(user, ['owner', 'admin', 'manager']);
      const barcodes = [...new Set(query.getAll('barcode').map(value => text(value, 'Barcode', 128)))];
      if (!barcodes.length || barcodes.length > 25) fail(400, 'Request between 1 and 25 inventory barcodes.');
      const snapshots = await db().getAll(...barcodes.map(aiCounterModelRef));
      result = { models: snapshots.filter(snapshot => snapshot.exists).map(snapshot => {
        const data = snapshot.data();
        return { barcode: data.barcode, model: data.model, samples: data.samples, photoSamples: data.photoSamples, sourceKey: data.sourceKey };
      }) };
    } else if (method === 'GET' && pathname === '/api/pos') {
      requireRole(user, ROLES);
      const [cart, productSnapshot] = await Promise.all([posRef().get(), db().collection('products').get()]);
      const products = productSnapshot.docs.map(snapshot => posProductView(snapshot.data())).sort((a, b) => a.name.localeCompare(b.name));
      result = { items: posItems(cart.data()), products };
    } else if (pathname === '/api/pos' && method === 'DELETE') result = await clearPos(user);
    else {
      if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        res.setHeader('Allow', 'GET, POST, PATCH, PUT, DELETE');
        return res.status(405).json({ error: 'Operation not available.' });
      }
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'Use application/json for API requests.');
      const body = readBody(req);
      if (pathname === '/api/inventory' && method === 'POST') result = await receive(body, user);
      else if ((pathname === '/api/ai-counter/models' || pathname === '/api/ai-models') && method === 'PUT') result = await saveAiCounterModel(body, user);
      else if ((pathname === '/api/ai-counter/models' || pathname === '/api/ai-models') && method === 'DELETE') result = await deleteAiCounterModel(body, user);
      else if (pathname === '/api/suppliers' && method === 'POST') result = await saveSupplierProfile(body, user);
      else if (pathname === '/api/suppliers' && method === 'DELETE') result = await archiveSupplier(body, user);
      else if (pathname === '/api/inventory' && method === 'DELETE') result = await removeInventory(body, user);
      else if (pathname === '/api/inventory/category' && method === 'PATCH') result = await assignCategory(body, user);
      else if (pathname === '/api/finance/price' && method === 'PATCH') result = await setSellingPrice(body, user);
      else if (pathname === '/api/finance/plan' && method === 'PUT') result = await saveMonthlyPlan(body, user);
      else if (pathname === '/api/expenses' && method === 'POST') result = await addExpense(body, user);
      else if (pathname === '/api/pos/scan' && method === 'POST') result = await addPosScan(body, user);
      else if (pathname === '/api/pos/adjust' && method === 'POST') result = await adjustPos(body, user);
      else if (pathname === '/api/pos/checkout' && method === 'POST') result = await checkoutPos(body, user);
      else if (pathname === '/api/sales' && method === 'POST') result = await sell(body, user);
      else { res.setHeader('Allow', 'GET, POST, PATCH, PUT, DELETE'); return res.status(405).json({ error: 'Operation not available.' }); }
    }
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error('RetailFlow API operation failed:', error?.message || 'unknown error');
    const message = status === 503 && error instanceof HttpError
      ? error.message
      : status >= 500 ? 'The server could not complete this request.' : error.message;
    return res.status(status).json({ error: message });
  }
};
