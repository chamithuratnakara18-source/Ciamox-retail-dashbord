import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  addDoc, collection, doc, getDoc, getDocFromServer, getDocs, getFirestore,
  onSnapshot, runTransaction, serverTimestamp, writeBatch,
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

const monthlyFields = ['water', 'electricity', 'gas', 'sewage', 'salaries', 'mortgagePayment'];

function precedingMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}

function purchaseCostInMonth(receipts, month) {
  const inbound = receipts.filter(item => item.type !== 'inventory_removal' &&
    Number(item.quantity) > 0 && item.arrivalDate?.startsWith(month));
  if (inbound.some(item => item.unitCost == null || !Number.isFinite(Number(item.unitCost)))) return null;
  return inbound.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);
}

function grossProfitInMonth(sales, month) {
  const monthlySales = sales.filter(item => item.day?.startsWith(month));
  if (monthlySales.some(item => item.grossProfit == null || !Number.isFinite(Number(item.grossProfit)))) return null;
  return monthlySales.reduce((sum, item) => sum + Number(item.grossProfit), 0);
}

function shapeMonthlyPlan(data) {
  if (!data || data.type !== 'monthly_plan') return null;
  const plan = Object.fromEntries(monthlyFields.map(field => [field, Number(data[field]) || 0]));
  plan.cashCommitments = monthlyFields.reduce((sum, field) => sum + plan[field], 0);
  return plan;
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
  const plan = shapeMonthlyPlan(expenses.find(item => item.id === 'monthly-plan'));
  const currentMonth = today.slice(0, 7);
  const oneTimeExpenses = expenses.filter(item => item.type !== 'monthly_plan');
  const monthlyExpenses = oneTimeExpenses.filter(item => item.expenseDate?.startsWith(currentMonth))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const monthlySales = sales.filter(item => item.day?.startsWith(currentMonth));
  const monthlyGross = monthlySales.reduce((sum, item) => sum + (Number(item.grossProfit) || 0), 0);
  const monthlyMissingCost = monthlySales.some(item => item.grossProfit == null || !Number.isFinite(Number(item.grossProfit)));
  const missingCostData = sales.some(item => item.grossProfit == null || !Number.isFinite(Number(item.grossProfit)));
  const netUnavailableReason = !plan ? 'Enter monthly costs in Finance to estimate monthly cash after bills.'
    : monthlyMissingCost ? 'Purchase cost is missing from a sale this month.' : null;
  const points = Array.from({ length: dayCount }, (_, index) => ({
    date: new Date(Date.parse(`${from}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10),
    revenue: 0, grossProfit: 0, netProfit: 0, cashAfterBills: 0,
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
  for (const item of oneTimeExpenses) {
    const point = byDate.get(item.expenseDate);
    if (point) point.expenses += Number(item.amount) || 0;
  }
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index];
    point.inventoryUnits = stock;
    point.grossProfit = point.missingCostData ? null : point.grossProfit;
    point.cashAfterBills = !plan || !point.date.startsWith(currentMonth) || point.grossProfit == null
      ? null : point.grossProfit - point.expenses - (point.date === `${currentMonth}-01` ? plan.cashCommitments : 0);
    point.netProfit = point.cashAfterBills;
    stock += point.unitsSold - point.received;
  }
  return {
    totals: {
      revenue, grossProfit: missingCostData ? null : grossProfit,
      netProfit: netUnavailableReason ? null : monthlyGross - plan.cashCommitments - monthlyExpenses,
      netCashAfterCommitments: plan && !monthlyMissingCost ? monthlyGross - plan.cashCommitments - monthlyExpenses : null,
      netProfitBasis: 'cash_after_bills',
      monthlyGrossProfit: monthlyMissingCost ? null : monthlyGross,
      monthlyOneTimeExpenses: monthlyExpenses,
      monthlyMortgagePayment: plan?.mortgagePayment || 0,
      inventoryUnits, missingCostData, netUnavailableReason,
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

async function setSellingPrice(body) {
  const barcode = validText(body.barcode, 'Barcode', 128);
  const sellingPrice = positiveNumber(body.sellingPrice, 'selling price', { zero: true });
  const expectedPrice = body.expectedPrice == null ? null
    : positiveNumber(body.expectedPrice, 'previous selling price', { zero: true });
  const ref = productRef(barcode);
  return runTransaction(db(), async transaction => {
    const product = (await transaction.get(ref)).data();
    if (!product) throw new Error('This product is no longer in inventory. Refresh Finance.');
    const currentPrice = product.originalPrice == null ? null : Number(product.originalPrice);
    if (currentPrice !== expectedPrice) throw new Error('The selling price changed on another device. Refresh Finance.');
    transaction.update(ref, { originalPrice: sellingPrice, updatedAt: serverTimestamp() });
    return { product: shapeProduct({ ...product, originalPrice: sellingPrice }) };
  });
}

async function saveMonthlyPlan(body) {
  const plan = Object.fromEntries(monthlyFields.map(field => [field,
    body[field] === '' || body[field] == null ? 0 : positiveNumber(body[field], field, { zero: true })]));
  if (!monthlyFields.some(field => plan[field] > 0)) {
    throw new Error('Enter at least one monthly cost. Leave the plan unsaved if you have not entered costs yet.');
  }
  const currentMonth = todayLocal().slice(0, 7);
  const savedPlan = {
    type: 'monthly_plan', ...plan,
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db());
  batch.set(doc(db(), 'expenses', 'monthly-plan'), savedPlan);
  batch.set(doc(db(), 'expenses', `monthly-plan-${currentMonth}`), savedPlan);
  await batch.commit();
  return { plan: shapeMonthlyPlan({ type: 'monthly_plan', ...plan }) };
}

async function getFinance() {
  const data = await loadCollections();
  const totals = summarize(data).totals;
  const currentMonth = todayLocal().slice(0, 7);
  const previousMonth = precedingMonth(currentMonth);
  const currentPlan = shapeMonthlyPlan(data.expenses.find(item => item.id === 'monthly-plan'));
  const currentPlanSnapshotExists = Boolean(shapeMonthlyPlan(data.expenses.find(item => item.id === `monthly-plan-${currentMonth}`)));
  const previousPlan = shapeMonthlyPlan(data.expenses.find(item => item.id === `monthly-plan-${previousMonth}`));
  const previousGrossProfit = grossProfitInMonth(data.sales, previousMonth);
  const previousOneTimeExpenses = data.expenses.filter(item => item.type !== 'monthly_plan' &&
    item.expenseDate?.startsWith(previousMonth)).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return {
    products: sortedProducts(data.products),
    plan: currentPlan,
    monthGrossProfit: totals.monthlyGrossProfit,
    monthOneTimeExpenses: totals.monthlyOneTimeExpenses,
    netProfit: totals.netProfit,
    netProfitBasis: totals.netProfitBasis,
    netCashAfterCommitments: totals.netCashAfterCommitments,
    netUnavailableReason: totals.netUnavailableReason,
    currentPlanSnapshotExists,
    comparisonMonth: previousMonth,
    metrics: {
      fixedCosts: currentPlan?.cashCommitments ?? null,
      productPurchases: purchaseCostInMonth(data.receipts, currentMonth),
      grossProfit: totals.monthlyGrossProfit,
      netProfit: totals.netProfit,
    },
    previousMetrics: {
      fixedCosts: previousPlan?.cashCommitments ?? null,
      productPurchases: purchaseCostInMonth(data.receipts, previousMonth),
      grossProfit: previousGrossProfit,
      netProfit: previousPlan && previousGrossProfit != null
        ? previousGrossProfit - previousPlan.cashCommitments - previousOneTimeExpenses : null,
    },
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
  if (url.pathname === '/api/finance' && method === 'GET') return getFinance();
  const body = JSON.parse(options.body || '{}');
  if (url.pathname === '/api/inventory' && method === 'DELETE') return removeInventory(body);
  if (url.pathname === '/api/finance/price' && method === 'PATCH') return setSellingPrice(body);
  if (url.pathname === '/api/finance/plan' && method === 'PUT') return saveMonthlyPlan(body);
  if (url.pathname === '/api/inventory' && method === 'POST') return receive(body);
  if (url.pathname === '/api/sales' && method === 'POST') return sell(body);
  if (url.pathname === '/api/expenses' && method === 'POST') return addExpense(body);
  throw new Error('This operation is not available.');
}
