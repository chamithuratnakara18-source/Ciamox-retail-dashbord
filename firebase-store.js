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
    originalPrice: Number(data.originalPrice) || 0,
    unitCost: data.unitCost == null ? null : Number(data.unitCost),
    arrivalDate: data.arrivalDate || '', supplierName: data.supplierName || '',
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

function summarize({ products, sales, receipts, expenses }) {
  const inventoryUnits = products.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const revenue = sales.reduce((sum, item) => sum + (Number(item.totalOriginalPrice) || 0), 0);
  const grossProfit = sales.reduce((sum, item) => sum + (Number(item.grossProfit) || 0), 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const missingCostData = sales.some(item => item.grossProfit == null || !Number.isFinite(Number(item.grossProfit)));
  const points = Array.from({ length: 30 }, (_, index) => ({
    date: todayLocal(index - 29), revenue: 0, grossProfit: 0, netProfit: 0,
    inventoryUnits: 0, missingCostData: false, unitsSold: 0, received: 0, expenses: 0,
  }));
  const byDate = new Map(points.map(point => [point.date, point]));
  for (const item of sales) {
    const point = byDate.get(item.day);
    if (!point) continue;
    point.revenue += Number(item.totalOriginalPrice) || 0;
    if (item.grossProfit == null || !Number.isFinite(Number(item.grossProfit))) point.missingCostData = true;
    else point.grossProfit += Number(item.grossProfit);
    point.unitsSold += (item.items || []).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  }
  for (const item of receipts) {
    const point = byDate.get(item.arrivalDate);
    if (point) point.received += Number(item.quantity) || 0;
  }
  for (const item of expenses) {
    const point = byDate.get(item.expenseDate);
    if (point) point.expenses += Number(item.amount) || 0;
  }
  let stock = inventoryUnits;
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
  const originalPrice = positiveNumber(body.originalPrice, 'sale price', { zero: true });
  const unitCost = positiveNumber(body.unitCost, 'purchase cost', { zero: true });
  const arrivalDate = validDate(body.arrivalDate, 'arrival date');
  const supplierName = validText(body.supplierName, 'supplier name');
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
      barcode, name, quantity: nextQuantity, originalPrice: existing?.originalPrice ?? originalPrice,
      unitCost: averageCost, arrivalDate, supplierName, updatedAt: serverTimestamp(),
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
  for (const item of body.items) {
    const barcode = validText(item?.barcode, 'Barcode', 128);
    const quantity = positiveNumber(item?.quantity, 'quantity', { whole: true });
    quantities.set(barcode, (quantities.get(barcode) || 0) + quantity);
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
      totalCents += Math.round(Number(product.originalPrice) * 100) * quantity;
      costCents += Math.round(Number(product.unitCost) * 100) * quantity;
      return { barcode, name: product.name, quantity,
        originalPrice: Number(product.originalPrice), unitCost: Number(product.unitCost) };
    });
    snapshots.forEach((snapshot, index) => {
      transaction.update(snapshot.ref, {
        quantity: Number(snapshot.data().quantity) - items[index].quantity, updatedAt: serverTimestamp(),
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
  if (url.pathname === '/api/dashboard' && method === 'GET') return summarize(await loadCollections());
  if (url.pathname === '/api/inventory' && method === 'GET') {
    const barcode = url.searchParams.get('barcode')?.trim();
    if (barcode) return { product: shapeProduct((await getDoc(productRef(barcode))).data()) };
    const data = await loadCollections();
    return { products: sortedProducts(data.products) };
  }
  const body = JSON.parse(options.body || '{}');
  if (url.pathname === '/api/inventory' && method === 'POST') return receive(body);
  if (url.pathname === '/api/sales' && method === 'POST') return sell(body);
  if (url.pathname === '/api/expenses' && method === 'POST') return addExpense(body);
  throw new Error('This operation is not available.');
}
