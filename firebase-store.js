import {
  collection, doc, getDoc, getDocFromServer, getDocs, getFirestore,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { firebaseApp } from './firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';

const auth = getAuth(firebaseApp);

let database;
let live;

function db() {
  if (!firebaseConfig.apiKey || !firebaseConfig.appId ||
      [firebaseConfig.apiKey, firebaseConfig.appId].some(value => value.startsWith('PASTE_'))) {
    throw new Error('Add your Firebase web app configuration to firebase-config.js in both websites.');
  }
  database ||= getFirestore(firebaseApp);
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

function addCalendarMonths(value, count) {
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function recordedStockPeaks(products, sales, receipts, today) {
  const movements = new Map(products.map(product => [product.barcode, []]));
  const addMovement = (barcode, day, delta, createdAt, received = 0) => {
    const entries = movements.get(barcode);
    if (!entries || typeof day !== 'string' || day > today) return;
    entries.push({ day, delta, received, at: createdAt?.toMillis?.() || 0 });
  };
  for (const receipt of receipts) {
    const quantity = Number(receipt.quantity) || 0;
    addMovement(receipt.barcode, receipt.arrivalDate, quantity, receipt.createdAt, quantity > 0 ? quantity : 0);
  }
  for (const sale of sales) {
    for (const item of Array.isArray(sale.items) ? sale.items : []) {
      const quantity = Number(item.quantity);
      if (Number.isFinite(quantity) && quantity > 0) addMovement(item.barcode, sale.day, -quantity, sale.createdAt);
    }
  }
  return new Map(products.map(product => {
    const current = Math.max(0, Number(product.quantity) || 0);
    let balance = current, peak = current;
    const entries = movements.get(product.barcode) || [];
    entries.sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at || a.delta - b.delta);
    for (const event of entries) {
      const before = balance - event.delta;
      peak = Math.max(peak, balance, before, before + event.received);
      balance = before;
    }
    return [product.barcode, peak];
  }));
}

function inventoryAnalyticsRange(period, requestedAnchor = todayLocal()) {
  if (!['day', 'month', 'year'].includes(period)) throw new Error('Choose Day, Month, or Year.');
  const anchor = validDate(requestedAnchor, 'analytics date');
  const today = todayLocal();
  if (anchor > today) throw new Error('Choose an analytics date up to today.');
  const [year, month] = anchor.split('-').map(Number);
  let from = anchor;
  let to = anchor;
  if (period === 'month') {
    from = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = new Date(`${from}T00:00:00.000Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    monthEnd.setUTCDate(0);
    to = monthEnd.toISOString().slice(0, 10);
  } else if (period === 'year') {
    from = `${year}-01-01`;
    to = `${year}-12-31`;
  }
  return { from, to: to > today ? today : to };
}

function productSupplierName(data) {
  for (const value of [data?.supplierName, data?.supplier, data?.vendorName, data?.vendor]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function shapeProduct(data) {
  if (!data) return null;
  return {
    barcode: data.barcode, name: data.name, quantity: Number(data.quantity) || 0,
    originalPrice: data.originalPrice == null ? null : Number(data.originalPrice),
    unitCost: data.unitCost == null ? null : Number(data.unitCost),
    arrivalDate: data.arrivalDate || '', supplierName: productSupplierName(data), category: data.category || '',
    manufactureDate: data.manufactureDate || '', expiryDate: data.expiryDate || '',
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
  const inventoryToday = todayLocal();
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
  const stockPeaks = recordedStockPeaks(products, data.sales, data.receipts, inventoryToday);
  const alerts = products.map(product => {
    const peakStock = stockPeaks.get(product.barcode) || 0;
    const stockPercent = peakStock > 0 ? product.quantity / peakStock * 100 : 0;
    return { barcode: product.barcode, name: product.name, quantity: product.quantity, peakStock,
      stockPercent, status: product.quantity <= 0 ? 'critical' : stockPercent <= 30 ? 'low' : null };
  }).filter(product => product.status);
  const todayIndex = Math.floor(Date.parse(`${inventoryToday}T00:00:00Z`) / 86400000);
  const expiryWindowEnd = addCalendarMonths(inventoryToday, 2);
  const expiryWarnings = products.filter(product => product.quantity > 0 && product.expiryDate).flatMap(product => {
    try { validDate(product.expiryDate, 'expiry date'); } catch { return []; }
    if (product.expiryDate > expiryWindowEnd) return [];
    const daysUntilExpiry = Math.floor(Date.parse(`${product.expiryDate}T00:00:00Z`) / 86400000) - todayIndex;
    const price = product.originalPrice != null && Number.isFinite(Number(product.originalPrice)) && Number(product.originalPrice) > 0
      ? Number(product.originalPrice) : null;
    const cost = product.unitCost != null && Number.isFinite(Number(product.unitCost))
      ? Number(product.unitCost) : null;
    const targetDiscount = daysUntilExpiry <= 14 ? 30 : daysUntilExpiry <= 30 ? 20 : 10;
    const safeDiscount = price != null && cost != null
      ? Math.max(0, Math.floor(((price - cost) / price) * 100) - 5) : null;
    const discountRate = safeDiscount == null ? null : Math.min(targetDiscount, safeDiscount);
    const buyOneGetOneSafe = product.quantity >= 2 && price != null && cost != null && price >= cost * 2;
    const recommendation = daysUntilExpiry < 0 ? 'Expired: remove from sale; do not promote.'
      : price == null || cost == null ? 'Check selling price and unit cost before discounting.'
        : daysUntilExpiry <= 14 && buyOneGetOneSafe ? 'Recommend Buy 1 Get 1 Free; the pair covers recorded cost.'
          : discountRate > 0 ? `Recommend ${discountRate}% off; keeps at least 5% gross margin.`
            : buyOneGetOneSafe ? 'Recommend Buy 1 Get 1 Free; the pair covers recorded cost.'
              : 'No price-safe promotion; review selling price and unit cost.';
    return [{ barcode: product.barcode, name: product.name, quantity: product.quantity,
      expiryDate: product.expiryDate, daysUntilExpiry, discountRate, buyOneGetOneSafe, recommendation }];
  }).sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry || a.name.localeCompare(b.name));
  return {
    period, anchor, range, totals: { revenue: revenue(sales), previousRevenue: revenue(previousSales),
      orders: sales.length, previousOrders: previousSales.length, grossProfit: gross(sales),
      productCount: products.length, stockAlerts: alerts.length,
      critical: alerts.filter(alert => alert.status === 'critical').length,
      low: alerts.filter(alert => alert.status === 'low').length },
    chart, alerts, bestSelling, previousSelling, expiryWindowEnd, expiryWarnings,
  };
}

function saleCreatedAt(sale) {
  try {
    if (sale.createdAt?.toDate) return sale.createdAt.toDate();
    if (Number.isFinite(Number(sale.createdAt?.seconds))) return new Date(Number(sale.createdAt.seconds) * 1000);
    if (sale.createdAt instanceof Date) return sale.createdAt;
  } catch { /* Older sales may not contain a readable timestamp. */ }
  return null;
}

function orderAnalytics(data, period = 'year', anchor = todayLocal()) {
  if (!['day', 'month', 'year'].includes(period)) throw new Error('Choose Day, Month, or Year.');
  const selectedAnchor = validDate(anchor, 'order analytics date');
  if (selectedAnchor > todayLocal()) throw new Error('Choose an order analytics date up to today.');
  const range = overviewRange(period, selectedAnchor);
  const sales = data.sales.filter(sale => typeof sale.day === 'string' && sale.day >= range.from && sale.day <= range.to);
  const buckets = [];
  const labelDate = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));

  if (period === 'year') {
    const year = Number(selectedAnchor.slice(0, 4));
    for (let month = 0; month < 12; month++) {
      const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
      buckets.push({ from, to, label: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
        .format(new Date(`${from}T12:00:00Z`)) });
    }
  } else if (period === 'month') {
    const year = Number(selectedAnchor.slice(0, 4)), month = Number(selectedAnchor.slice(5, 7));
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const date = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
      buckets.push({ from: date, to: date, label: String(day) });
    }
  } else {
    for (let block = 0; block < 6; block++) {
      const startHour = block * 4, endHour = startHour + 3;
      buckets.push({ startHour, endHour,
        label: `${String(startHour).padStart(2, '0')}:00–${String(endHour).padStart(2, '0')}:59` });
    }
  }

  const hourlyCounts = Array.from({ length: 24 }, (_, hour) => ({
    hour, label: `${String(hour).padStart(2, '0')}:00`, count: 0,
  }));
  sales.forEach(sale => {
    const date = saleCreatedAt(sale);
    if (date) hourlyCounts[date.getHours()].count++;
  });
  const frequency = buckets.map(bucket => {
    const count = period === 'day'
      ? sales.filter(sale => {
        const date = saleCreatedAt(sale);
        return date && date.getHours() >= bucket.startHour && date.getHours() <= bucket.endHour;
      }).length
      : sales.filter(sale => sale.day >= bucket.from && sale.day <= bucket.to).length;
    return { label: bucket.label, count, from: bucket.from || null, to: bucket.to || null };
  });
  const peak = frequency.reduce((best, item) => item.count > (best?.count ?? 0) ? item : best, null);
  const peakPrefix = period === 'year' ? 'PEAK MONTH' : period === 'month' ? 'PEAK DAY' : 'PEAK BLOCK';
  let peakLabel = 'No orders';
  if (peak?.count) {
    if (period === 'year') peakLabel = `${peak.label} ${selectedAnchor.slice(0, 4)} · ${peak.count} orders`;
    else if (period === 'month') peakLabel = `${labelDate(peak.from)} · ${peak.count} orders`;
    else peakLabel = `${peak.label} · ${peak.count} orders`;
  }
  const busiestHour = hourlyCounts.reduce((best, item) => item.count > (best?.count ?? 0) ? item : best, null);
  const busiestTime = busiestHour?.count
    ? `${busiestHour.label}–${String(busiestHour.hour).padStart(2, '0')}:59 · ${busiestHour.count} orders`
    : 'No timed orders';
  const itemCounts = new Map();
  sales.forEach(sale => (Array.isArray(sale.items) ? sale.items : []).forEach(item => {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const name = String(item.name || item.barcode || 'Item');
    itemCounts.set(name, (itemCounts.get(name) || 0) + quantity);
  }));
  const topItems = [...itemCounts].map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 10);
  const orders = [...sales].sort((a, b) => (saleCreatedAt(b)?.getTime() || 0) - (saleCreatedAt(a)?.getTime() || 0));
  const subtitle = period === 'year' ? `Monthly frequency · ${selectedAnchor.slice(0, 4)}`
    : period === 'month' ? `Daily frequency · ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${selectedAnchor.slice(0, 7)}-01T12:00:00Z`))}`
      : `Order frequency · ${labelDate(selectedAnchor)}`;
  return {
    period, anchor: selectedAnchor, range, subtitle, peakLabel, peakPrefix,
    orderCount: sales.length, averagePerSlot: frequency.length ? sales.length / frequency.length : 0,
    frequency, hourlyCounts, busiestTime, topItems, orders: orders.slice(0, 50), totalOrdersInRange: orders.length,
  };
}

function supplierAnalytics(data) {
  const suppliers = new Map();
  const supplierKey = value => typeof value === 'string'
    ? value.normalize('NFC').trim().toLocaleLowerCase() : '';
  const archivedSuppliers = new Set((data.suppliers || [])
    .filter(profile => profile?.archived === true)
    .map(profile => supplierKey(profile.name)));
  // Current inventory is the source of truth for active supplier names. An old
  // archived profile must not hide a supplier still assigned to an inventory item.
  const inventorySupplierKeys = new Set((data.products || [])
    .map(product => supplierKey(productSupplierName(product)))
    .filter(Boolean));
  const getSupplier = value => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) return null;
    const key = supplierKey(name);
    if (!suppliers.has(key)) suppliers.set(key, {
      key, name, categories: new Set(), items: new Map(), currentStock: 0,
      currentStockValue: 0, missingCurrentCostProducts: 0, inboundUnits: 0,
      inboundRecords: 0, recordedInboundCost: 0, costedInboundUnits: 0,
      lastArrivalDate: '', city: '', country: '', supplierType: '', latitude: null,
      longitude: null, leadTimeDays: null, qualityScore: null, defectRate: null,
    });
    return suppliers.get(key);
  };
  const unassignedProducts = [];
  for (const product of sortedProducts(data.products)) {
    const supplier = getSupplier(productSupplierName(product));
    if (!supplier) { unassignedProducts.push(product); continue; }
    const itemKey = product.barcode || product.name.toLocaleLowerCase();
    const item = supplier.items.get(itemKey) || {
      barcode: product.barcode || '', name: product.name || 'Product', category: '', quantity: 0,
      unitCost: null, receivedUnits: 0, arrivalDate: '',
    };
    item.name = product.name || item.name;
    item.category = product.category || item.category;
    item.quantity = Math.max(0, Number(product.quantity) || 0);
    item.unitCost = product.unitCost != null && Number.isFinite(Number(product.unitCost)) ? Number(product.unitCost) : null;
    item.arrivalDate = product.arrivalDate || item.arrivalDate;
    supplier.items.set(itemKey, item);
    if (item.category) supplier.categories.add(item.category);
    supplier.currentStock += item.quantity;
    if (item.unitCost == null) supplier.missingCurrentCostProducts++;
    else supplier.currentStockValue += item.quantity * item.unitCost;
    if (item.arrivalDate > supplier.lastArrivalDate) supplier.lastArrivalDate = item.arrivalDate;
  }
  for (const receipt of data.receipts) {
    const quantity = Number(receipt.quantity);
    if (receipt.type === 'inventory_removal' || receipt.type === 'pos_order' ||
        !Number.isFinite(quantity) || quantity <= 0) continue;
    const supplier = getSupplier(productSupplierName(receipt));
    if (!supplier) continue;
    supplier.inboundRecords++;
    supplier.inboundUnits += quantity;
    if (receipt.arrivalDate > supplier.lastArrivalDate) supplier.lastArrivalDate = receipt.arrivalDate || '';
    const unitCost = receipt.unitCost == null ? null : Number(receipt.unitCost);
    if (unitCost != null && Number.isFinite(unitCost) && unitCost >= 0) {
      supplier.recordedInboundCost += quantity * unitCost;
      supplier.costedInboundUnits += quantity;
    }
    const barcode = typeof receipt.barcode === 'string' ? receipt.barcode : '';
    const name = String(receipt.productName || barcode || 'Product');
    const itemKey = barcode || name.toLocaleLowerCase();
    const item = supplier.items.get(itemKey) || {
      barcode, name, category: '', quantity: 0, unitCost: unitCost,
      receivedUnits: 0, arrivalDate: '',
    };
    item.receivedUnits += quantity;
    if (receipt.arrivalDate > item.arrivalDate) item.arrivalDate = receipt.arrivalDate;
    if (item.unitCost == null && unitCost != null && Number.isFinite(unitCost)) item.unitCost = unitCost;
    supplier.items.set(itemKey, item);
  }
  for (const profile of data.suppliers || []) {
    if (profile?.archived === true) continue;
    // Keep saved supplier profiles visible after reload, even before the scanner
    // has recorded a product or receipt for that supplier.
    const supplier = suppliers.get(supplierKey(profile?.name)) || getSupplier(profile?.name);
    if (!supplier) continue;
    supplier.city = profile.city || '';
    supplier.country = profile.country || '';
    supplier.supplierType = profile.supplierType || '';
    supplier.latitude = profile.latitude == null ? null : Number(profile.latitude);
    supplier.longitude = profile.longitude == null ? null : Number(profile.longitude);
    supplier.leadTimeDays = profile.leadTimeDays == null ? null : Number(profile.leadTimeDays);
    supplier.qualityScore = profile.qualityScore == null ? null : Number(profile.qualityScore);
    supplier.defectRate = profile.defectRate == null ? null : Number(profile.defectRate);
  }
  const list = [...suppliers.values()].filter(supplier =>
    !archivedSuppliers.has(supplier.key) || inventorySupplierKeys.has(supplier.key)).map(supplier => ({
    key: supplier.key,
    name: supplier.name,
    city: supplier.city,
    country: supplier.country,
    supplierType: supplier.supplierType,
    latitude: supplier.latitude,
    longitude: supplier.longitude,
    leadTimeDays: Number.isFinite(supplier.leadTimeDays) ? supplier.leadTimeDays : null,
    qualityScore: Number.isFinite(supplier.qualityScore) ? supplier.qualityScore : null,
    defectRate: Number.isFinite(supplier.defectRate) ? supplier.defectRate : null,
    categories: [...supplier.categories].sort((a, b) => a.localeCompare(b)),
    items: [...supplier.items.values()].sort((a, b) => a.name.localeCompare(b.name)),
    productCount: supplier.items.size,
    currentProductCount: [...supplier.items.values()].filter(item => item.quantity > 0).length,
    currentStock: supplier.currentStock,
    currentStockValue: supplier.currentStockValue,
    missingCurrentCostProducts: supplier.missingCurrentCostProducts,
    inboundUnits: supplier.inboundUnits,
    inboundRecords: supplier.inboundRecords,
    recordedInboundCost: supplier.recordedInboundCost,
    costedInboundUnits: supplier.costedInboundUnits,
    averageRecordedUnitCost: supplier.costedInboundUnits > 0
      ? supplier.recordedInboundCost / supplier.costedInboundUnits : null,
    lastArrivalDate: supplier.lastArrivalDate,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...new Set(list.flatMap(supplier => supplier.categories))].sort((a, b) => a.localeCompare(b));
  return {
    summary: {
      supplierCount: list.length,
      productsSupplied: list.reduce((total, supplier) => total + supplier.productCount, 0),
      currentStockUnits: list.reduce((total, supplier) => total + supplier.currentStock, 0),
      recordedInboundCost: list.reduce((total, supplier) => total + supplier.recordedInboundCost, 0),
      inboundRecords: list.reduce((total, supplier) => total + supplier.inboundRecords, 0),
      unassignedProducts: unassignedProducts.length,
    },
    categories,
    suppliers: list,
    supplierProfileWarning: data.supplierProfileError || '',
    unassignedProducts: unassignedProducts.map(product => ({
      barcode: product.barcode, name: product.name, quantity: product.quantity,
      category: product.category, arrivalDate: product.arrivalDate,
    })),
  };
}

function financePeriodRange(period, requestedAnchor = todayLocal()) {
  if (!['day', 'month', 'year'].includes(period)) throw new Error('Choose Day, Month, or Year.');
  const anchor = validDate(requestedAnchor, 'finance date');
  const today = todayLocal();
  if (anchor > today) throw new Error('Choose a finance date up to today.');
  if (period === 'day') return { from: anchor, to: anchor };
  const year = Number(anchor.slice(0, 4)), month = Number(anchor.slice(5, 7));
  if (period === 'month') {
    const from = `${anchor.slice(0, 7)}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { from, to: lastDay > today ? today : lastDay };
  }
  const from = `${year}-01-01`;
  const lastDay = `${year}-12-31`;
  return { from, to: lastDay > today ? today : lastDay };
}

function financePreviousRange(period, anchor, selectedRange) {
  if (period === 'day') {
    const previousDay = new Date(Date.parse(`${anchor}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    return { from: previousDay, to: previousDay };
  }
  if (period === 'month') {
    const previousMonth = precedingMonth(anchor.slice(0, 7));
    const from = `${previousMonth}-01`;
    const fullEnd = new Date(Date.UTC(Number(previousMonth.slice(0, 4)), Number(previousMonth.slice(5, 7)), 0))
      .toISOString().slice(0, 10);
    if (selectedRange.to === todayLocal() && anchor.slice(0, 7) === todayLocal().slice(0, 7)) {
      const elapsed = Number(selectedRange.to.slice(-2));
      const previousMonthEnd = Number(fullEnd.slice(-2));
      const to = new Date(Date.UTC(Number(previousMonth.slice(0, 4)), Number(previousMonth.slice(5, 7)) - 1,
        Math.min(elapsed, previousMonthEnd))).toISOString().slice(0, 10);
      return { from, to };
    }
    return { from, to: fullEnd };
  }
  const selectedYear = Number(anchor.slice(0, 4));
  const previousYear = selectedYear - 1;
  const from = `${previousYear}-01-01`;
  if (selectedYear < Number(todayLocal().slice(0, 4))) return { from, to: `${previousYear}-12-31` };
  const shifted = addCalendarMonths(anchor, -12);
  return { from, to: shifted < from ? from : shifted };
}

function monthEnd(month) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

function financeMetricsForRange(data, range, currentPlan) {
  const expenses = data.expenses.filter(item => item.type !== 'monthly_plan' &&
    item.expenseDate >= range.from && item.expenseDate <= range.to);
  let costs = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const planByMonth = new Map(data.expenses
    .filter(item => item.id?.startsWith('monthly-plan-') && item.type === 'monthly_plan')
    .map(item => [item.id.slice('monthly-plan-'.length), shapeMonthlyPlan(item)]));
  const currentMonth = todayLocal().slice(0, 7);
  let month = range.from.slice(0, 7);
  const lastMonth = range.to.slice(0, 7);
  while (month <= lastMonth) {
    const firstDay = `${month}-01`;
    if (firstDay >= range.from && firstDay <= range.to) {
      const plan = planByMonth.get(month) || (month === currentMonth ? currentPlan : null);
      if (plan) costs += plan.cashCommitments;
    }
    month = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
      .toISOString().slice(0, 7);
  }
  const inbound = data.receipts.filter(item => item.type !== 'inventory_removal' &&
    Number(item.quantity) > 0 && item.arrivalDate >= range.from && item.arrivalDate <= range.to);
  const productPurchases = inbound.some(item => item.unitCost == null || !Number.isFinite(Number(item.unitCost)))
    ? null : inbound.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);
  const sales = data.sales.filter(item => item.day >= range.from && item.day <= range.to);
  const grossProfit = sales.some(item => item.grossProfit == null || !Number.isFinite(Number(item.grossProfit)))
    ? null : sales.reduce((sum, item) => sum + Number(item.grossProfit), 0);
  return { costs, productPurchases, grossProfit,
    netProfit: grossProfit == null ? null : grossProfit - costs };
}

function financeTrend(data, period, anchor, currentPlan) {
  const selectedRange = financePeriodRange(period, anchor);
  const buckets = [];
  if (period === 'day') {
    for (let offset = 13; offset >= 0; offset--) {
      const day = new Date(Date.parse(`${anchor}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);
      buckets.push({ from: day, to: day, label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${day}T12:00:00Z`)) });
    }
  } else if (period === 'month') {
    let month = anchor.slice(0, 7);
    for (let index = 5; index >= 0; index--) {
      const cursor = anchor.slice(0, 7);
      month = cursor;
      for (let step = 0; step < index; step++) month = precedingMonth(month);
      const from = `${month}-01`;
      const end = monthEnd(month);
      const to = end > todayLocal() ? todayLocal() : end;
      buckets.push({ from, to, label: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
        .format(new Date(`${from}T12:00:00Z`)) });
    }
  } else {
    const year = Number(anchor.slice(0, 4));
    for (let monthNumber = 1; monthNumber <= 12; monthNumber++) {
      const month = `${year}-${String(monthNumber).padStart(2, '0')}`;
      const from = `${month}-01`;
      const end = monthEnd(month);
      const to = end > selectedRange.to ? selectedRange.to : end;
      buckets.push({ from, to: from > selectedRange.to ? null : to,
        label: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
          .format(new Date(`${from}T12:00:00Z`)) });
    }
  }
  return buckets.map(bucket => ({ label: bucket.label, ...(bucket.to
    ? financeMetricsForRange(data, { from: bucket.from, to: bucket.to }, currentPlan)
    : { costs: null, productPurchases: null, grossProfit: null, netProfit: null }) }));
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

async function getFinance(requestedPeriod = 'month', requestedAnchor = todayLocal()) {
  const data = await loadCollections();
  const currentMonth = todayLocal().slice(0, 7);
  const currentPlan = shapeMonthlyPlan(data.expenses.find(item => item.id === 'monthly-plan'));
  const period = requestedPeriod;
  const anchor = validDate(requestedAnchor, 'finance date');
  const range = financePeriodRange(period, anchor);
  const comparisonRange = financePreviousRange(period, anchor, range);
  const metrics = financeMetricsForRange(data, range, currentPlan);
  const previousMetrics = financeMetricsForRange(data, comparisonRange, currentPlan);
  const trend = financeTrend(data, period, anchor, currentPlan);
  const trendSubtitle = period === 'day'
    ? `Daily movement · ${trend[0]?.label || ''} – ${trend.at(-1)?.label || ''}`
    : period === 'month' ? `Monthly movement · Last 6 months through ${trend.at(-1)?.label || ''}`
      : `Monthly movement · ${anchor.slice(0, 4)}`;
  const comparisonDate = new Date(`${comparisonRange.from}T12:00:00Z`);
  const comparisonLabel = period === 'day'
    ? `vs ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(comparisonDate)}`
    : period === 'month'
      ? `vs ${new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(comparisonDate)}`
      : `vs ${comparisonRange.from.slice(0, 4)}`;
  return {
    products: sortedProducts(data.products),
    period, anchor, range, trend, trendSubtitle, comparisonRange, comparisonLabel,
    metrics, previousMetrics,
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

async function loadSupplierCollections() {
  if (live) {
    await live.ready;
    if (live.error) throw live.error;
    return {
      products: live.data.products,
      receipts: live.data.receipts,
      suppliers: live.data.suppliers || [],
      supplierProfileError: live.supplierProfileError?.message || '',
    };
  }
  const [productsSnapshot, receiptsSnapshot] = await Promise.all([
    getDocs(collection(db(), 'products')),
    getDocs(collection(db(), 'receipts')),
  ]);
  let suppliers = [];
  let supplierProfileError = '';
  try {
    suppliers = rows(await getDocs(collection(db(), 'suppliers')));
  } catch (error) {
    // Profile fields enrich the supplier list, but inventory and receipts are
    // the source of supplier names. A denied profile read must not hide them.
    supplierProfileError = error?.message || 'Saved supplier details could not be loaded.';
  }
  return {
    products: rows(productsSnapshot),
    receipts: rows(receiptsSnapshot),
    suppliers,
    supplierProfileError,
  };
}

function inventoryAnalytics(data, requestedPeriod = 'day', requestedAnchor = todayLocal()) {
  const { from, to } = inventoryAnalyticsRange(requestedPeriod, requestedAnchor);
  const dayMilliseconds = 86400000;
  const dayIndex = value => Math.floor(Date.parse(`${value}T00:00:00Z`) / dayMilliseconds);
  const days = dayIndex(to) - dayIndex(from) + 1;
  const labelDate = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
  const productRows = sortedProducts(data.products).map(product => {
    const quantity = Math.max(0, Number(product.quantity) || 0);
    const hasCost = product.unitCost != null && Number.isFinite(Number(product.unitCost));
    return { ...product, quantity, stockValue: hasCost ? quantity * Number(product.unitCost) : null };
  });
  const categoryMap = new Map();
  let units = 0, knownStockValue = 0, missingCostProducts = 0;
  for (const product of productRows) {
    units += product.quantity;
    const categoryName = product.category || 'Uncategorized';
    if (!categoryMap.has(categoryName)) categoryMap.set(categoryName, {
      name: categoryName, productCount: 0, units: 0, knownValue: 0, complete: true,
    });
    const category = categoryMap.get(categoryName);
    category.productCount += 1;
    category.units += product.quantity;
    if (product.stockValue == null && product.quantity > 0) {
      category.complete = false;
      missingCostProducts += 1;
    } else {
      category.knownValue += product.stockValue || 0;
      knownStockValue += product.stockValue || 0;
    }
  }
  const categories = [...categoryMap.values()].sort((a, b) => b.knownValue - a.knownValue || a.name.localeCompare(b.name));
  const totalKnownValue = categories.reduce((sum, category) => sum + category.knownValue, 0);
  let cumulativeShare = 0;
  categories.forEach(category => {
    category.share = totalKnownValue > 0 ? category.knownValue / totalKnownValue * 100 : 0;
    const before = cumulativeShare;
    cumulativeShare += category.share;
    category.cumulativeShare = cumulativeShare;
    category.abcClass = before < 70 ? 'A' : before < 90 ? 'B' : 'C';
  });

  const startIndex = dayIndex(from), endIndex = dayIndex(to);
  const movementBuckets = Math.min(9, days);
  const bucketSize = Math.max(1, Math.ceil(days / movementBuckets));
  const points = Array.from({ length: days }, (_, index) => ({
    date: new Date((startIndex + index) * dayMilliseconds).toISOString().slice(0, 10),
    received: 0, sold: 0, removed: 0,
  }));
  const pointMap = new Map(points.map(point => [point.date, point]));
  const soldByBarcode = new Map();
  for (const sale of data.sales) {
    if (sale.day < from || sale.day > to || !Array.isArray(sale.items)) continue;
    const point = pointMap.get(sale.day);
    for (const item of sale.items) {
      const quantity = Number(item.quantity);
      if (typeof item.barcode !== 'string' || !Number.isFinite(quantity) || quantity <= 0) continue;
      soldByBarcode.set(item.barcode, (soldByBarcode.get(item.barcode) || 0) + quantity);
      if (point) point.sold += quantity;
    }
  }
  for (const receipt of data.receipts) {
    if (!receipt.arrivalDate || receipt.arrivalDate < from || receipt.arrivalDate > to) continue;
    const point = pointMap.get(receipt.arrivalDate);
    const quantity = Number(receipt.quantity) || 0;
    if (!point || !quantity) continue;
    if (receipt.type === 'inventory_removal' || quantity < 0) point.removed += Math.abs(quantity);
    else point.received += quantity;
  }
  const buckets = [];
  for (let index = 0; index < points.length; index += bucketSize) {
    const group = points.slice(index, index + bucketSize);
    const first = group[0].date, last = group.at(-1).date;
    buckets.push({
      label: first === last ? labelDate(first) : `${labelDate(first)}–${labelDate(last)}`,
      received: group.reduce((sum, point) => sum + point.received, 0),
      sold: group.reduce((sum, point) => sum + point.sold, 0),
      removed: group.reduce((sum, point) => sum + point.removed, 0),
    });
  }

  const expiryItems = productRows.filter(product => product.quantity > 0 && /^\d{4}-\d{2}-\d{2}$/.test(product.expiryDate || ''))
    .map(product => {
      const expiryIndex = dayIndex(product.expiryDate);
      const daysLeft = expiryIndex - endIndex;
      const status = daysLeft < 0 ? 'Expired' : daysLeft <= 7 ? 'Within 7 days'
        : daysLeft <= 30 ? '8–30 days' : daysLeft <= 90 ? '31–90 days' : 'Over 90 days';
      return { barcode: product.barcode, name: product.name, category: product.category || 'Uncategorized',
        expiryDate: product.expiryDate, daysLeft, quantity: product.quantity, valueAtRisk: product.stockValue, status };
    }).sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
  const expiringSoon = expiryItems.filter(item => item.daysLeft >= 0 && item.daysLeft <= 7).length;
  const expiredCount = expiryItems.filter(item => item.daysLeft < 0).length;

  const selling = productRows.map(product => ({
    barcode: product.barcode, name: product.name, category: product.category || 'Uncategorized',
    quantity: product.quantity, unitsSold: soldByBarcode.get(product.barcode) || 0,
    daysLeft: product.quantity <= 0 ? 0 : null,
  }));
  const sellingTotal = selling.reduce((sum, item) => sum + item.unitsSold, 0);
  let soldCumulative = 0;
  const movers = selling.filter(item => item.unitsSold > 0).sort((a, b) => b.unitsSold - a.unitsSold || a.name.localeCompare(b.name));
  const classByBarcode = new Map();
  movers.forEach(item => {
    const before = soldCumulative / Math.max(1, sellingTotal) * 100;
    soldCumulative += item.unitsSold;
    classByBarcode.set(item.barcode, before < 70 ? 'A' : before < 90 ? 'B' : 'C');
  });
  const stockoutItems = selling.map(item => {
    const unitsPerDay = item.unitsSold / days;
    const daysLeft = item.quantity <= 0 ? 0 : unitsPerDay > 0 ? item.quantity / unitsPerDay : null;
    const status = item.quantity <= 0 ? 'Out of stock' : item.unitsSold <= 0 ? 'No recent sales'
      : daysLeft <= 7 ? 'Reorder now' : daysLeft <= 14 ? 'Plan reorder' : 'Healthy';
    return { ...item, unitsPerDay, daysLeft, movementClass: classByBarcode.get(item.barcode) || '', status };
  }).sort((a, b) => (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) ||
    b.unitsSold - a.unitsSold || a.name.localeCompare(b.name));
  const runoutCount = stockoutItems.filter(item => item.quantity <= 0 || (item.daysLeft != null && item.daysLeft <= 7)).length;

  return {
    range: { from, to, days },
    summary: { productCount: productRows.length, units, stockValue: missingCostProducts ? null : knownStockValue,
      knownStockValue, missingCostProducts, expiredCount, expiringSoon, runoutCount },
    categories, movement: buckets, expiryItems, stockoutItems,
  };
}

// Dashboard listeners keep the two independent websites in sync without polling.
export function watchRetailFlow(onChange, onError) {
  if (live) return () => {};
  let active = true;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const coreNames = ['products', 'sales', 'receipts', 'expenses'];
  live = {
    data: { products: null, sales: null, receipts: null, expenses: null, suppliers: [] },
    ready, error: null, supplierProfileError: null,
  };
  let settled = false;
  let unsubs = [];
  try {
    unsubs = Object.keys(live.data).map(name => onSnapshot(collection(db(), name), snapshot => {
      if (!active) return;
      live.data[name] = rows(snapshot);
      if (name === 'suppliers') live.supplierProfileError = null;
      if (coreNames.every(coreName => live.data[coreName] !== null)) {
        if (!settled) { settled = true; resolveReady(); }
        onChange();
      }
    }, error => {
      if (!active) return;
      if (name === 'suppliers') {
        live.data.suppliers = [];
        live.supplierProfileError = error;
        if (coreNames.every(coreName => live.data[coreName] !== null)) onChange();
        return;
      }
      live.error = error;
      if (!settled) { settled = true; rejectReady(error); }
      onError(error);
    }));
  } catch (error) {
    live = null;
    if (!settled) { settled = true; resolveReady(); }
    queueMicrotask(() => onError(error));
  }
  return () => { active = false; unsubs.forEach(stop => stop()); live = null; };
}

// One shared checkout for the store. A phone scan changes this document; every
// open dashboard receives the new cart through the document listener.
export function watchPos(onChange, onError) {
  const stop = onSnapshot(posRef(), snapshot => onChange(posItems(snapshot.data())), onError);
  return stop;
}

// Keep the existing screen contract while replacing the SQL HTTP API with Firestore.
export async function api(path, options = {}) {
  const url = new URL(path, location.origin);
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    await auth.authStateReady();
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const response = await fetch(`${url.pathname}${url.search}`, {
      method,
      headers,
      body: options.body || '{}',
      credentials: 'same-origin',
    });
    let result = {}, receivedJson = false;
    try {
      result = await response.json();
      receivedJson = true;
    } catch { /* Vercel's missing-function response may be an HTML page. */ }
    if (!response.ok) {
      if (response.status === 404 && !receivedJson) {
        throw new Error('The server API is not deployed on this site. Include the root-level api folder and redeploy.');
      }
      throw new Error(result.error || `Request failed (${response.status}).`);
    }
    return result;
  }
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
  if (url.pathname === '/api/order-analytics' && method === 'GET') {
    return orderAnalytics(await loadCollections(), url.searchParams.get('period') || 'year',
      url.searchParams.get('anchor') || todayLocal());
  }
  if (url.pathname === '/api/supplier-analytics' && method === 'GET') {
    return supplierAnalytics(await loadSupplierCollections());
  }
  if (url.pathname === '/api/inventory/analytics' && method === 'GET') {
    return inventoryAnalytics(await loadCollections(), url.searchParams.get('period') || 'day',
      url.searchParams.get('anchor') || todayLocal());
  }
  if (url.pathname === '/api/inventory' && method === 'GET') {
    const barcode = url.searchParams.get('barcode')?.trim();
    if (barcode) return { product: shapeProduct((await getDoc(productRef(barcode))).data()) };
    const products = sortedProducts(rows(await getDocs(collection(db(), 'products'))));
    const categories = [...new Set(products.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { products, categories };
  }
  if (url.pathname === '/api/pos' && method === 'GET') {
    const [cart, products] = await Promise.all([getDoc(posRef()), getDocs(collection(db(), 'products'))]);
    return { items: posItems(cart.data()), products: sortedProducts(rows(products)) };
  }
  if (url.pathname === '/api/finance' && method === 'GET') {
    return getFinance(url.searchParams.get('period') || 'month', url.searchParams.get('anchor') || todayLocal());
  }
  throw new Error('This operation is not available.');
}
