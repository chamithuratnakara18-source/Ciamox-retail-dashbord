import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  addDoc, collection, doc, getDoc, getDocFromServer, getDocs, getFirestore,
  onSnapshot, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

let database;
let live;

function db() {
  if (!firebaseConfig.apiKey || !firebaseConfig.appId ||
      [firebaseConfig.apiKey, firebaseConfig.appId].some(value => value.startsWith('PASTE_'))) {
    throw new Error('Add your Firebase web app configuration to firebase-config.js in both websites.');
  }
  database ||= getFirestore(initializeApp(firebaseConfig));
  return database;
}

function productRef(barcode) {
  return doc(db(), 'products', encodeURIComponent(barcode));
}

function validText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} must be between 1 and ${max} characters.`);
  }
  return value.trim();
}

function positiveNumber(value, label, { whole = false, zero = false } = {}) {
  const number = Number(value);
  if (value === '' || value == null || !Number.isFinite(number) ||
      number < (zero ? 0 : Number.EPSILON) || number > 1000000000 ||
      (whole && !Number.isSafeInteger(number))) {
    throw new Error(`Enter a valid ${label}.`);
  }
  return number;
}

function validDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Enter a valid ${label}.`);
  }
  return value;
}

function todayLocal(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shapeProduct(data) {
  if (!data) return null;
  return {
    barcode: data.barcode, name: data.name, quantity: Number(data.quantity) || 0,
    originalPrice: data.originalPrice == null ? null : Number(data.originalPrice),
    unitCost: data.unitCost == null ? null : Number(data.unitCost),
    arrivalDate: data.arrivalDate || '', supplierName: data.supplierName || '',
    photoDataUrl: data.photoDataUrl || '',
    updatedAt: data.updatedAt,
  };
}

function rows(snapshot) {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

function sortedProducts(products) {
  return products.map(shapeProduct).sort((a, b) =>
    (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0) ||
    a.name.localeCompare(b.name));
}

function summarize({ products, sales, receipts, expenses }, from = todayLocal(-29), to = todayLocal()) {
  validDate(from, 'start date');
  validDate(to, 'end date');
  const today = todayLocal();
  const dayCount = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (dayCount < 1 || dayCount > 366 || to > today) {
    throw new Error('Choose dates up to today, within a 366-day range.');
  }
  const inventoryUnits = products.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const revenue = sales.reduce((sum, item) => sum + (Number(item.totalOriginalPrice) || 0), 0);
  const grossProfit = sales.reduce((sum, item) => sum + (Number(item.grossProfit) || 0), 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const missingCostData = sales.some(item => item.grossProfit == null || !Number.isFinite(Number(item.grossProfit)));
  const points = Array.from({ length: dayCount }, (_, index) => ({
    date: new Date(Date.parse(`${from}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10),
    revenue: 0, grossProfit: 0, netProfit: 0,
    inventoryUnits: 0, missingCostData: false, unitsSold: 0, received: 0, expenses: 0,
  }));
  const byDate = new Map(points.map(point => [point.date, point]));
  // Walk back from today's inventory to the selected end date. A negative
  // receipt records stock removed when an inventory product was deleted.
  let stock = inventoryUnits;
  for (const item of sales) {
    const point = byDate.get(item.day);
    const unitsSold = (item.items || []).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
    if (item.day > to && item.day <= today) stock += unitsSold;
    if (!point) continue;
    point.revenue += Number(item.totalOriginalPrice) || 0;
    if (item.grossProfit == null || !Number.isFinite(Number(item.grossProfit))) point.missingCostData = true;
    else point.grossProfit += Number(item.grossProfit);
    point.unitsSold += unitsSold;
  }
  for (const item of receipts) {
    if (item.arrivalDate > to && item.arrivalDate <= today) stock -= Number(item.quantity) || 0;
    const point = byDate.get(item.arrivalDate);
    if (point) point.received += Number(item.quantity) || 0;
  }
  for (const item of expenses) {
    const point = byDate.get(item.expenseDate);
    if (point) point.expenses += Number(item.amount) || 0;
  }
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index];
    point.inventoryUnits = stock;
    point.grossProfit = point.missingCostData ? null : point.grossProfit;
    point.netProfit = point.grossProfit == null ? null : point.grossProfit - point.expenses;
    stock += point.unitsSold - point.received;
  }
  return {
    totals: {
      revenue, grossProfit: missingCostData ? null : grossProfit,
      netProfit: missingCostData ? null : grossProfit - expenseTotal,
      inventoryUnits, missingCostData,
    },
    points,
  };
}

async function removeInventory(body) {
  const barcode = validText(body.barcode, 'Barcode', 128);
  const expectedName = validText(body.expectedName, 'Product name');
  const expectedQuantity = positiveNumber(body.expectedQuantity, 'expected quantity', { whole: true, zero: true });
  const ref = productRef(barcode);
  const adjustmentRef = doc(collection(db(), 'receipts'));
  return runTransaction(db(), async transaction => {
    const product = (await transaction.get(ref)).data();
    if (!product) throw new Error('This product has already been removed. Refresh inventory.');
    const quantity = Number(product.quantity);
    if (product.name !== expectedName || quantity !== expectedQuantity) {
      throw new Error('This product changed since it was displayed. Refresh inventory before removing it.');
    }
    transaction.delete(ref);
    transaction.set(adjustmentRef, {
      type: 'inventory_removal', barcode, productName: product.name,
      quantity: -quantity, unitCost: product.unitCost ?? null,
      arrivalDate: todayLocal(), supplierName: product.supplierName || '',
      createdAt: serverTimestamp(),
    });
    return { removed: { barcode, name: product.name, quantity } };
  });
}

async function loadCollections() {
  if (live) {
    await live.ready;
    if (live.error) throw live.error;
    return live.data;
  }
  const names = ['products', 'sales', 'receipts', 'expenses'];
  const snapshots = await Promise.all(names.map(name => getDocs(collection(db(), name))));
  return Object.fromEntries(names.map((name, index) => [name, rows(snapshots[index])]));
}

// Dashboard listeners keep the two independent websites in sync without polling.
export function watchRetailFlow(onChange, onError) {
  if (live) return () => {};
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  live = { data: { products: null, sales: null, receipts: null, expenses: null }, ready, error: null };
  let settled = false;
  let unsubs = [];
  try {
    unsubs = Object.keys(live.data).map(name => onSnapshot(collection(db(), name), snapshot => {
      live.data[name] = rows(snapshot);
      if (Object.values(live.data).every(value => value !== null)) {
        if (!settled) { settled = true; resolveReady(); }
        onChange();
      }
    }, error => {
      live.error = error;
      if (!settled) { settled = true; rejectReady(error); }
      onError(error);
    }));
  } catch (error) {
    live = null;
    if (!settled) { settled = true; resolveReady(); }
    queueMicrotask(() => onError(error));
  }
  return () => { unsubs.forEach(stop => stop()); live = null; };
}

async function receive(body) {
  const barcode = validText(body.barcode, 'Barcode', 128);
  const name = validText(body.name, 'Product name');
  const quantity = positiveNumber(body.quantity, 'quantity', { whole: true });
  const unitCost = positiveNumber(body.unitCost, 'purchase cost', { zero: true });
  const arrivalDate = todayLocal();
  const supplierName = validText(body.supplierName, 'supplier name');
  const photoDataUrl = body.photoDataUrl || '';
  if (typeof photoDataUrl !== 'string' || photoDataUrl.length > 100000 ||
      (photoDataUrl && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photoDataUrl))) {
    throw new Error('Choose a smaller JPEG product photo.');
  }
  const ref = productRef(barcode);
  const receiptRef = doc(collection(db(), 'receipts'));
  return runTransaction(db(), async transaction => {
    const existing = (await transaction.get(ref)).data();
    const oldQuantity = Number(existing?.quantity) || 0;
    const nextQuantity = oldQuantity + quantity;
    if (!Number.isSafeInteger(nextQuantity)) throw new Error('The stock quantity is too large.');
    const averageCost = existing?.unitCost == null || oldQuantity === 0
      ? unitCost : ((Number(existing.unitCost) * oldQuantity) + unitCost * quantity) / nextQuantity;
    const product = {
      barcode, name, quantity: nextQuantity, originalPrice: existing?.originalPrice ?? null,
      unitCost: averageCost, arrivalDate, supplierName,
      photoDataUrl: photoDataUrl || existing?.photoDataUrl || '', updatedAt: serverTimestamp(),
    };
    transaction.set(ref, product);
    transaction.set(receiptRef, {
      barcode, productName: name, quantity, originalPrice: product.originalPrice,
      unitCost, arrivalDate, supplierName, createdAt: serverTimestamp(),
    });
    return { product: shapeProduct(product), receipt: { id: receiptRef.id, quantity, supplierName, arrivalDate } };
  });
}

async function sell(body) {
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) {
    throw new Error('Add between 1 and 100 products to the cart.');
  }
  const quantities = new Map();
  const proposedPrices = new Map();
  for (const item of body.items) {
    const barcode = validText(item?.barcode, 'Barcode', 128);
    const quantity = positiveNumber(item?.quantity, 'quantity', { whole: true });
    quantities.set(barcode, (quantities.get(barcode) || 0) + quantity);
    if (item?.originalPrice != null && item.originalPrice !== '') {
      const price = positiveNumber(item.originalPrice, 'sale price', { zero: true });
      if (proposedPrices.has(barcode) && proposedPrices.get(barcode) !== price) {
        throw new Error(`Conflicting sale prices for ${barcode}.`);
      }
      proposedPrices.set(barcode, price);
    }
  }
  const barcodes = [...quantities.keys()].sort();
  const refs = barcodes.map(productRef);
  const saleRef = doc(collection(db(), 'sales'));
  return runTransaction(db(), async transaction => {
    // Read every product before writing any, as Firestore transactions require.
    const snapshots = [];
    for (const ref of refs) snapshots.push(await transaction.get(ref));
    let totalCents = 0, costCents = 0;
    const items = snapshots.map((snapshot, index) => {
      const product = snapshot.data();
      const barcode = barcodes[index];
      const quantity = quantities.get(barcode);
      if (!product) throw new Error(`Barcode ${barcode} is not in inventory.`);
      if (Number(product.quantity) < quantity) throw new Error(`Only ${product.quantity} ${product.name} in stock.`);
      if (product.unitCost == null || !Number.isFinite(Number(product.unitCost))) {
        throw new Error(`Purchase cost is missing for ${product.name}.`);
      }
      const price = product.originalPrice == null ? proposedPrices.get(barcode) : Number(product.originalPrice);
      if (price == null || !Number.isFinite(price)) {
        throw new Error(`Enter a sale price for ${product.name} before selling.`);
      }
      if (product.originalPrice != null && proposedPrices.has(barcode) && price !== proposedPrices.get(barcode)) {
        throw new Error(`The sale price for ${product.name} was set on another device. Scan it again.`);
      }
      totalCents += Math.round(price * 100) * quantity;
      costCents += Math.round(Number(product.unitCost) * 100) * quantity;
      return { barcode, name: product.name, quantity,
        originalPrice: price, unitCost: Number(product.unitCost) };
    });
    snapshots.forEach((snapshot, index) => {
      transaction.update(snapshot.ref, {
        quantity: Number(snapshot.data().quantity) - items[index].quantity,
        originalPrice: items[index].originalPrice, updatedAt: serverTimestamp(),
      });
    });
    const totalOriginalPrice = totalCents / 100;
    transaction.set(saleRef, {
      items, totalOriginalPrice, grossProfit: (totalCents - costCents) / 100,
      day: todayLocal(), createdAt: serverTimestamp(),
    });
    return { sale: { id: saleRef.id.slice(0, 8), totalOriginalPrice } };
  });
}

async function addExpense(body) {
  const title = validText(body.title, 'Expense name');
  const amount = positiveNumber(body.amount, 'amount');
  const expenseDate = validDate(body.expenseDate, 'expense date');
  const ref = await addDoc(collection(db(), 'expenses'), {
    title, amount, expenseDate, createdAt: serverTimestamp(),
  });
  return { expense: { id: ref.id, title, amount, expenseDate } };
}

// Keep the existing screen contract while replacing the SQL HTTP API with Firestore.
export async function api(path, options = {}) {
  const url = new URL(path, location.origin);
  const method = (options.method || 'GET').toUpperCase();
  if (url.pathname === '/api/health' && method === 'GET') {
    await getDocFromServer(doc(db(), 'meta', 'connection'));
    return { ok: true };
  }
  if (url.pathname === '/api/dashboard' && method === 'GET') {
    return summarize(await loadCollections(), url.searchParams.get('from') || todayLocal(-29), url.searchParams.get('to') || todayLocal());
  }
  if (url.pathname === '/api/inventory' && method === 'GET') {
    const barcode = url.searchParams.get('barcode')?.trim();
    if (barcode) return { product: shapeProduct((await getDoc(productRef(barcode))).data()) };
    const data = await loadCollections();
    return { products: sortedProducts(data.products) };
  }
  const body = JSON.parse(options.body || '{}');
  if (url.pathname === '/api/inventory' && method === 'DELETE') return removeInventory(body);
  if (url.pathname === '/api/inventory' && method === 'POST') return receive(body);
  if (url.pathname === '/api/sales' && method === 'POST') return sell(body);
  if (url.pathname === '/api/expenses' && method === 'POST') return addExpense(body);
  throw new Error('This operation is not available.');
}
