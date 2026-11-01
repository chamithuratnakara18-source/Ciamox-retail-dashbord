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

function posRef() { return doc(db(), 'receipts', 'pos-active'); }

function posItems(data) {
  return Array.isArray(data?.items) ? data.items.filter(item =>
    typeof item.barcode === 'string' && Number.isSafeInteger(item.quantity) && item.quantity > 0)
    .map(item => ({ barcode: item.barcode, quantity: item.quantity })) : [];
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

function comparisonDates(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const count = Math.round((end - start) / 86400000) + 1;
  const previousTo = new Date(start - 86400000).toISOString().slice(0, 10);
  const month = from.slice(0, 7);
  const nextMonthStart = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1));
  const wholeMonth = from === `${month}-01` && to === new Date(nextMonthStart.getTime() - 86400000).toISOString().slice(0, 10);
  const previousFrom = wholeMonth ? `${precedingMonth(month)}-01`
    : new Date(start - count * 86400000).toISOString().slice(0, 10);
  return { from: previousFrom, to: previousTo, wholeMonth };
}

function overviewRange(period, anchor) {
  validDate(anchor, 'dashboard date');
  if (anchor > todayLocal()) throw new Error('Choose a dashboard date up to today.');
  if (!['day', 'month', 'year'].includes(period)) throw new Error('Choose Day, Month, or Year.');
  const [year, month] = anchor.split('-').map(Number);
  const date = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  if (period === 'day') {
    const previous = date(year, month - 1, Number(anchor.slice(-2)) - 1);
    return { from: anchor, to: anchor, previousFrom: previous, previousTo: previous };
  }
  if (period === 'month') {
    const from = `${anchor.slice(0, 7)}-01`;
    const to = [date(year, month, 0), todayLocal()].sort()[0];
    const previousFrom = date(year, month - 2, 1);
    const previousEnd = date(year, month - 1, 0);
    const previousTo = to === date(year, month, 0) ? previousEnd
      : date(year, month - 2, Math.min(Number(to.slice(-2)), Number(previousEnd.slice(-2))));
    return { from, to, previousFrom, previousTo };
  }
  const from = `${year}-01-01`;
  const to = [`${year}-12-31`, todayLocal()].sort()[0];
  const previousFrom = `${year - 1}-01-01`;
  const priorEnd = `${year - 1}-12-31`;
  const previousTo = to === `${year}-12-31` ? priorEnd : date(year - 1, Number(to.slice(5, 7)) - 1,
    Math.min(Number(to.slice(-2)), new Date(Date.UTC(year - 1, Number(to.slice(5, 7)), 0)).getUTCDate()));
  return { from, to, previousFrom, previousTo };
}

function overview(data, period, anchor) {
  const range = overviewRange(period, anchor);
  const within = (day, from, to) => typeof day === 'string' && day >= from && day <= to;
  const sales = data.sales.filter(sale => within(sale.day, range.from, range.to));
  const previousSales = data.sales.filter(sale => within(sale.day, range.previousFrom, range.previousTo));
  const revenue = entries => entries.reduce((sum, sale) => sum + (Number(sale.totalOriginalPrice) || 0), 0);
  const gross = entries => entries.some(sale => sale.grossProfit == null || !Number.isFinite(Number(sale.grossProfit)))
    ? null : entries.reduce((sum, sale) => sum + Number(sale.grossProfit), 0);
  const buckets = period === 'month'
    ? Array.from({ length: Math.ceil(Number(range.to.slice(-2)) / 7) }, (_, index) => ({
      label: `${index * 7 + 1}–${Math.min((index + 1) * 7, Number(range.to.slice(-2)))}`,
      from: `${range.from.slice(0, 7)}-${String(index * 7 + 1).padStart(2, '0')}`,
      to: `${range.from.slice(0, 7)}-${String(Math.min((index + 1) * 7, Number(range.to.slice(-2)))).padStart(2, '0')}`,
    }))
    : period === 'year'
      ? Array.from({ length: Number(range.to.slice(5, 7)) }, (_, index) => ({
        label: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(range.from.slice(0, 4)), index, 1))),
        from: `${range.from.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-01`,
        to: `${range.from.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-${String(new Date(Date.UTC(Number(range.from.slice(0, 4)), index + 1, 0)).getUTCDate()).padStart(2, '0')}`,
      })) : [{ label: anchor.slice(5), from: anchor, to: anchor }];
  const chart = buckets.map(bucket => {
    const entries = sales.filter(sale => within(sale.day, bucket.from, bucket.to));
    return { label: bucket.label, revenue: revenue(entries), grossProfit: gross(entries) };
  });
  const counts = entries => {
    const result = new Map();
    entries.forEach(sale => (Array.isArray(sale.items) ? sale.items : []).forEach(item => {
      const quantity = Number(item.quantity);
      if (typeof item.barcode !== 'string' || !Number.isFinite(quantity) || quantity <= 0) return;
      const existing = result.get(item.barcode);
      result.set(item.barcode, { barcode: item.barcode, name: String(item.name || item.barcode),
        quantity: (existing?.quantity || 0) + quantity });
    }));
    return [...result.values()];
  };
  const bestSelling = counts(sales).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  const previousSelling = counts(previousSales);
  const products = sortedProducts(data.products);
  const alerts = products.filter(product => product.quantity <= 5)
    .map(product => ({ barcode: product.barcode, name: product.name, quantity: product.quantity,
      status: product.quantity === 0 ? 'critical' : 'low' }));
  return {
    period, anchor, range, totals: { revenue: revenue(sales), previousRevenue: revenue(previousSales),
      orders: sales.length, previousOrders: previousSales.length, grossProfit: gross(sales),
      productCount: products.length, stockAlerts: alerts.length,
      critical: alerts.filter(alert => alert.status === 'critical').length,
      low: alerts.filter(alert => alert.status === 'low').length },
    chart, alerts, bestSelling, previousSelling,
  };
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
  const priorPlans = new Map(expenses.filter(item => item.id?.startsWith('monthly-plan-') && item.type === 'monthly_plan')
    .map(item => [item.id.slice('monthly-plan-'.length), shapeMonthlyPlan(item)]));
  const oneTimeExpenses = expenses.filter(item => item.type !== 'monthly_plan');
  const monthlyExpenses = oneTimeExpenses.filter(item => item.expenseDate?.startsWith(currentMonth))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const monthlySales = sales.filter(item => item.day?.startsWith(currentMonth));
  const monthlyGross = monthlySales.reduce((sum, item) => sum + (Number(item.grossProfit) || 0), 0);
  const monthlyMissingCost = monthlySales.some(item => item.grossProfit == null || !Number.isFinite(Number(item.grossProfit)));
  const missingCostData = sales.some(item => item.grossProfit == null || !Number.isFinite(Number(item.grossProfit)));
  const netUnavailableReason = !plan ? 'Enter monthly costs in Finance to see net profit on a cash basis.'
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
    const pointMonth = point.date.slice(0, 7);
    const pointPlan = pointMonth === currentMonth ? plan : priorPlans.get(pointMonth);
    point.cashAfterBills = !pointPlan || point.grossProfit == null
      ? null : point.grossProfit - point.expenses - (point.date.endsWith('-01') ? pointPlan.cashCommitments : 0);
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

// One shared checkout for the store. A phone scan changes this document; every
// open dashboard receives the new cart through the document listener.
export function watchPos(onChange, onError) {
  return onSnapshot(posRef(), snapshot => onChange(posItems(snapshot.data())), onError);
}

async function addPosScan(body) {
  const barcode = validText(body.barcode, 'Barcode', 128);
  const ref = productRef(barcode), cartRef = posRef();
  return runTransaction(db(), async transaction => {
    const product = (await transaction.get(ref)).data();
    const cart = (await transaction.get(cartRef)).data();
    if (!product) throw new Error('This barcode is not in inventory. Add it in Inbound first.');
    const items = posItems(cart);
    const current = items.find(item => item.barcode === barcode);
    if (Number(product.quantity) <= (current?.quantity || 0)) {
      throw new Error(`Only ${Number(product.quantity) || 0} ${product.name} in stock.`);
    }
    if (current) current.quantity++;
    else {
      if (items.length >= 100) throw new Error('The order has reached 100 different products.');
      items.push({ barcode, quantity: 1 });
    }
    transaction.set(cartRef, { type: 'pos_order', items, updatedAt: serverTimestamp() });
    return { product: shapeProduct(product), quantity: current?.quantity || 1 };
  });
}

async function adjustPos(body) {
  const barcode = validText(body.barcode, 'Barcode', 128);
  const delta = Number(body.delta);
  if (!Number.isSafeInteger(delta) || delta === 0 || delta < -1000000000 || delta > 1) {
    throw new Error('Choose a valid order quantity change.');
  }
  const cartRef = posRef(), ref = productRef(barcode);
  return runTransaction(db(), async transaction => {
    const product = (await transaction.get(ref)).data();
    const items = posItems((await transaction.get(cartRef)).data());
    const item = items.find(row => row.barcode === barcode);
    if (!item) throw new Error('This item is no longer in the order.');
    const next = Math.max(0, item.quantity + delta);
    if (delta > 0 && (!product || next > Number(product.quantity))) {
      throw new Error(`Only ${Number(product?.quantity) || 0} ${product?.name || barcode} in stock.`);
    }
    if (next) item.quantity = next;
    else items.splice(items.indexOf(item), 1);
    transaction.set(cartRef, { type: 'pos_order', items, updatedAt: serverTimestamp() });
    return { items };
  });
}

async function clearPos() {
  const cartRef = posRef();
  return runTransaction(db(), async transaction => {
    await transaction.get(cartRef);
    transaction.set(cartRef, { type: 'pos_order', items: [], updatedAt: serverTimestamp() });
    return { items: [] };
  });
}

async function checkoutPos(body) {
  const paymentMethod = validText(body.paymentMethod, 'Payment method', 12);
  if (!['cash', 'card', 'qr'].includes(paymentMethod)) throw new Error('Choose Cash, Card, or QR.');
  const cartRef = posRef(), saleRef = doc(collection(db(), 'sales'));
  return runTransaction(db(), async transaction => {
    const items = posItems((await transaction.get(cartRef)).data());
    if (!items.length) throw new Error('The order is empty or was already checked out.');
    const ordered = [...items].sort((a, b) => a.barcode.localeCompare(b.barcode));
    const refs = ordered.map(item => productRef(item.barcode));
    const snapshots = [];
    for (const ref of refs) snapshots.push(await transaction.get(ref));
    let totalCents = 0, costCents = 0;
    const sold = ordered.map((item, index) => {
      const product = snapshots[index].data();
      if (!product) throw new Error(`${item.barcode} is no longer in inventory.`);
      if (Number(product.quantity) < item.quantity) throw new Error(`Only ${product.quantity} ${product.name} in stock.`);
      if (product.unitCost == null || !Number.isFinite(Number(product.unitCost))) {
        throw new Error(`Purchase cost is missing for ${product.name}.`);
      }
      const price = product.originalPrice == null ? null : Number(product.originalPrice);
      if (price == null || !Number.isFinite(price) || price < 0) {
        throw new Error(`Set a selling price for ${product.name} in Finance before checkout.`);
      }
      totalCents += Math.round(price * 100) * item.quantity;
      costCents += Math.round(Number(product.unitCost) * 100) * item.quantity;
      return { barcode: item.barcode, name: product.name, quantity: item.quantity,
        originalPrice: price, unitCost: Number(product.unitCost) };
    });
    if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(costCents)) {
      throw new Error('The order total is too large. Reduce its quantity.');
    }
    snapshots.forEach((snapshot, index) => transaction.update(snapshot.ref, {
      quantity: Number(snapshot.data().quantity) - sold[index].quantity, updatedAt: serverTimestamp(),
    }));
    const totalOriginalPrice = totalCents / 100;
    transaction.set(saleRef, {
      items: sold, totalOriginalPrice, grossProfit: (totalCents - costCents) / 100,
      day: todayLocal(), paymentMethod, source: 'pos', createdAt: serverTimestamp(),
    });
    transaction.set(cartRef, { type: 'pos_order', items: [], updatedAt: serverTimestamp() });
    return { sale: { id: saleRef.id.slice(0, 8), totalOriginalPrice, paymentMethod } };
  });
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
    const from = url.searchParams.get('from') || todayLocal(-29);
    const to = url.searchParams.get('to') || todayLocal();
    const data = await loadCollections();
    const selected = summarize(data, from, to);
    const previous = comparisonDates(from, to);
    return { ...selected, comparison: { ...previous, points: summarize(data, previous.from, previous.to).points } };
  }
  if (url.pathname === '/api/overview' && method === 'GET') {
    return overview(await loadCollections(), url.searchParams.get('period') || 'month',
      url.searchParams.get('anchor') || todayLocal());
  }
  if (url.pathname === '/api/inventory' && method === 'GET') {
    const barcode = url.searchParams.get('barcode')?.trim();
    if (barcode) return { product: shapeProduct((await getDoc(productRef(barcode))).data()) };
    const data = await loadCollections();
    return { products: sortedProducts(data.products) };
  }
  if (url.pathname === '/api/pos' && method === 'GET') {
    const [cart, data] = await Promise.all([getDoc(posRef()), loadCollections()]);
    return { items: posItems(cart.data()), products: sortedProducts(data.products) };
  }
  if (url.pathname === '/api/finance' && method === 'GET') return getFinance();
  const body = JSON.parse(options.body || '{}');
  if (url.pathname === '/api/pos/scan' && method === 'POST') return addPosScan(body);
  if (url.pathname === '/api/pos/adjust' && method === 'POST') return adjustPos(body);
  if (url.pathname === '/api/pos/checkout' && method === 'POST') return checkoutPos(body);
  if (url.pathname === '/api/pos' && method === 'DELETE') return clearPos();
  if (url.pathname === '/api/inventory' && method === 'DELETE') return removeInventory(body);
  if (url.pathname === '/api/finance/price' && method === 'PATCH') return setSellingPrice(body);
  if (url.pathname === '/api/finance/plan' && method === 'PUT') return saveMonthlyPlan(body);
  if (url.pathname === '/api/inventory' && method === 'POST') return receive(body);
  if (url.pathname === '/api/sales' && method === 'POST') return sell(body);
  if (url.pathname === '/api/expenses' && method === 'POST') return addExpense(body);
  throw new Error('This operation is not available.');
}
