import { api, watchRetailFlow } from './firebase-store.js';

(() => {
  const dashboardScreen = document.getElementById('dashboardScreen');
  const inventoryScreen = document.getElementById('inventoryScreen');
  const financeScreen = document.getElementById('financeScreen');
  const connectionStatus = document.getElementById('connectionStatus');
  const dashboardError = document.getElementById('dashboardError');
  const inventoryTableBody = document.getElementById('inventoryTableBody');
  const inventoryEmpty = document.getElementById('inventoryEmpty');
  const inventorySearch = document.getElementById('inventorySearch');
  const trendFromButton = document.getElementById('trendFromButton');
  const trendToButton = document.getElementById('trendToButton');
  const trendCalendar = document.getElementById('trendCalendar');
  const trendRangeError = document.getElementById('trendRangeError');
  const chartDayDetails = document.getElementById('chartDayDetails');
  const metricsChart = document.getElementById('metricsChart');
  let trendFrom = todayLocal(-29);
  let trendTo = todayLocal();
  let calendarTarget = null;
  let calendarMonthDate = null;
  let chartPoints = [];
  let currentPointIndex = -1;
  let dashboardRequestId = 0;
  let currentView = 'dashboard';
  let inventoryProducts = [];
  let financeProducts = [];
  let financePlan = null;
  let financeStats = null;
  let financePlanDirty = false;
  let financeRequestId = 0;

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => { void setMainView(button.dataset.view); });
  });
  document.getElementById('addExpenseButton').addEventListener('click', () => {
    document.getElementById('expensePanel').classList.remove('hidden');
    document.getElementById('expenseDate').value = todayLocal();
    document.getElementById('expenseTitle').focus();
  });
  document.getElementById('closeExpenseButton').addEventListener('click', () => document.getElementById('expensePanel').classList.add('hidden'));
  document.getElementById('expenseForm').addEventListener('submit', saveExpense);
  document.getElementById('refreshInventoryButton').addEventListener('click', () => { void refreshInventory(); });
  inventorySearch.addEventListener('input', renderInventoryTable);
  document.getElementById('financeSearch').addEventListener('input', renderFinanceTable);
  document.getElementById('monthlyPlanForm').addEventListener('submit', saveFinancePlan);
  document.getElementById('monthlyPlanForm').addEventListener('input', () => {
    financePlanDirty = true;
    document.getElementById('financePlanStatus').textContent = 'Unsaved monthly cost changes.';
  });
  trendFromButton.addEventListener('click', () => openCalendar('from'));
  trendToButton.addEventListener('click', () => openCalendar('to'));
  document.getElementById('calendarPrevious').addEventListener('click', () => moveCalendarMonth(-1));
  document.getElementById('calendarNext').addEventListener('click', () => moveCalendarMonth(1));
  document.getElementById('calendarClose').addEventListener('click', closeCalendar);
  document.getElementById('trendResetButton').addEventListener('click', () => {
    trendFrom = todayLocal(-29);
    trendTo = todayLocal();
    trendRangeError.classList.add('hidden');
    closeCalendar();
    showTrendRange();
    void refreshDashboard();
  });
  document.addEventListener('pointerdown', event => {
    if (!document.getElementById('trendControls').contains(event.target)) closeCalendar();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCalendar(); });
  metricsChart.setAttribute('tabindex', '0');
  metricsChart.addEventListener('pointermove', showChartPointAtPointer);
  metricsChart.addEventListener('pointerdown', showChartPointAtPointer);
  metricsChart.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    showChartPoint(Math.max(0, Math.min(chartPoints.length - 1,
      currentPointIndex + (event.key === 'ArrowLeft' ? -1 : 1))));
  });
  function todayLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function dateUTC(value) { return new Date(`${value}T12:00:00Z`); }

  function englishDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(dateUTC(value));
  }

  function showTrendRange() {
    trendFromButton.textContent = englishDate(trendFrom);
    trendToButton.textContent = englishDate(trendTo);
    const days = Math.round((Date.parse(`${trendTo}T00:00:00Z`) - Date.parse(`${trendFrom}T00:00:00Z`)) / 86400000) + 1;
    document.getElementById('trendRangeSummary').textContent =
      `${englishDate(trendFrom)} – ${englishDate(trendTo)} · ${days} ${days === 1 ? 'day' : 'days'}`;
  }

  function openCalendar(target) {
    calendarTarget = target;
    const selected = dateUTC(target === 'from' ? trendFrom : trendTo);
    calendarMonthDate = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1, 12));
    trendCalendar.classList.remove('hidden');
    trendFromButton.setAttribute('aria-expanded', String(target === 'from'));
    trendToButton.setAttribute('aria-expanded', String(target === 'to'));
    renderCalendar();
  }

  function closeCalendar() {
    trendCalendar.classList.add('hidden');
    trendFromButton.setAttribute('aria-expanded', 'false');
    trendToButton.setAttribute('aria-expanded', 'false');
    calendarTarget = null;
  }

  function moveCalendarMonth(delta) {
    calendarMonthDate = new Date(Date.UTC(
      calendarMonthDate.getUTCFullYear(), calendarMonthDate.getUTCMonth() + delta, 1, 12));
    renderCalendar();
  }

  function renderCalendar() {
    const year = calendarMonthDate.getUTCFullYear();
    const month = calendarMonthDate.getUTCMonth();
    document.getElementById('calendarMonth').textContent = new Intl.DateTimeFormat('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(calendarMonthDate);
    document.getElementById('calendarNext').disabled =
      year * 12 + month >= dateUTC(todayLocal()).getUTCFullYear() * 12 + dateUTC(todayLocal()).getUTCMonth();
    const grid = document.getElementById('calendarDays');
    grid.replaceChildren();
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(label => {
      const day = document.createElement('span'); day.className = 'calendar-weekday'; day.textContent = label;
      grid.append(day);
    });
    for (let offset = 0; offset < new Date(Date.UTC(year, month, 1)).getUTCDay(); offset++) {
      const blank = document.createElement('span'); blank.setAttribute('aria-hidden', 'true'); grid.append(blank);
    }
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const value = new Date(Date.UTC(year, month, day, 12)).toISOString().slice(0, 10);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'calendar-day'; button.textContent = String(day);
      button.setAttribute('aria-label', englishDate(value, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
      button.disabled = value > todayLocal();
      if (value === trendFrom || value === trendTo) button.classList.add('selected');
      else if (value > trendFrom && value < trendTo) button.classList.add('between');
      button.addEventListener('click', () => selectCalendarDate(value));
      grid.append(button);
    }
  }

  function selectCalendarDate(value) {
    let from = calendarTarget === 'from' ? value : trendFrom;
    let to = calendarTarget === 'to' ? value : trendTo;
    if (from > to) {
      if (calendarTarget === 'from') to = from;
      else from = to;
    }
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
    if (days > 366) {
      trendRangeError.textContent = 'Choose a date range of 366 days or less.';
      trendRangeError.classList.remove('hidden');
      return;
    }
    trendRangeError.classList.add('hidden');
    trendFrom = from; trendTo = to;
    closeCalendar();
    showTrendRange();
    void refreshDashboard();
  }

  async function setMainView(view) {
    closeCalendar();
    currentView = view;
    dashboardScreen.classList.toggle('hidden', view !== 'dashboard');
    inventoryScreen.classList.toggle('hidden', view !== 'inventory');
    financeScreen.classList.toggle('hidden', view !== 'finance');
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    if (view === 'dashboard') await refreshDashboard();
    if (view === 'inventory') await refreshInventory();
    if (view === 'finance') await refreshFinance();
  }

  function formatAmount(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function setDatabaseStatus(online, message) {
    connectionStatus.classList.toggle('db-offline', !online);
    connectionStatus.innerHTML = `<i></i> ${message}`;
  }

  async function refreshDashboard() {
    const requestId = ++dashboardRequestId;
    dashboardError.classList.add('hidden');
    document.getElementById('dashboardUpdated').textContent = 'Updating…';
    try {
      const range = new URLSearchParams({ from: trendFrom, to: trendTo });
      const data = await api(`/api/dashboard?${range}`);
      if (requestId !== dashboardRequestId) return;
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      document.getElementById('revenueTotal').textContent = formatAmount(data.totals.revenue);
      document.getElementById('grossProfitTotal').textContent = formatAmount(data.totals.grossProfit);
      const netTotal = document.getElementById('netProfitTotal');
      netTotal.textContent = data.totals.netUnavailableReason ? 'Unavailable' : formatAmount(data.totals.netProfit);
      netTotal.classList.toggle('unavailable', Boolean(data.totals.netUnavailableReason));
      document.getElementById('netProfitFoot').textContent = data.totals.netUnavailableReason ||
        'Monthly gross less recurring operating costs and one-time expenses';
      document.getElementById('inventoryUnitsTotal').textContent = Number(data.totals.inventoryUnits || 0).toLocaleString();
      const profitNotice = document.getElementById('profitDataNotice');
      profitNotice.textContent = data.totals.missingCostData
        ? 'Some older sales have no purchase cost, so all-time gross profit is unavailable.'
        : `${data.totals.netUnavailableReason || 'Net profit is an estimate.'} ` +
          'The cash after bills trend covers this month when costs are saved; monthly bills appear on the first day.';
      profitNotice.classList.remove('hidden');
      drawMetricsChart(data.points || []);
      document.getElementById('dashboardUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      if (requestId !== dashboardRequestId) return;
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
      document.getElementById('dashboardUpdated').textContent = 'Waiting for database';
      dashboardError.textContent = `Dashboard data is not available: ${error.message}. Check firebase-config.js and Firestore rules.`;
      dashboardError.classList.remove('hidden');
      drawMetricsChart([]);
    }
  }

  function drawMetricsChart(points) {
    const svg = document.getElementById('metricsChart');
    chartPoints = points;
    currentPointIndex = -1;
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs = {}) => {
      const element = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
      return element;
    };
    svg.replaceChildren();
    if (!points.length) {
      chartDayDetails.textContent = 'No trend data for these dates.';
      const empty = make('text', { x: 460, y: 150, 'text-anchor': 'middle', class: 'chart-axis-label' });
      empty.textContent = 'Firestore data will show your sales and inventory trend.';
      svg.append(empty);
      return;
    }
    const left = 58, right = 854, top = 22, bottom = 256;
    const moneyValues = points.flatMap(point => [point.revenue, point.grossProfit, point.cashAfterBills]).filter(Number.isFinite);
    let moneyMin = Math.min(0, ...moneyValues), moneyMax = Math.max(0, ...moneyValues);
    if (moneyMax === moneyMin) moneyMax = moneyMin + 1;
    const moneyPad = (moneyMax - moneyMin) * 0.08;
    moneyMin -= moneyPad; moneyMax += moneyPad;
    const stockMin = Math.min(0, ...points.map(point => point.inventoryUnits));
    let stockMax = Math.max(0, ...points.map(point => point.inventoryUnits));
    if (stockMax === stockMin) stockMax = stockMin + 1;
    const x = index => points.length === 1 ? (left + right) / 2 : left + (right - left) * index / (points.length - 1);
    const moneyY = value => bottom - (value - moneyMin) / (moneyMax - moneyMin) * (bottom - top);
    const stockY = value => bottom - (value - stockMin) / (stockMax - stockMin) * (bottom - top);
    for (let tick = 0; tick <= 4; tick++) {
      const ratio = tick / 4;
      const y = top + ratio * (bottom - top);
      svg.append(make('line', { x1: left, y1: y, x2: right, y2: y, class: 'chart-grid' }));
      const moneyValue = moneyMax - ratio * (moneyMax - moneyMin);
      const leftLabel = make('text', { x: left - 9, y: y + 3, 'text-anchor': 'end', class: 'chart-axis-label' });
      leftLabel.textContent = compactNumber(moneyValue);
      svg.append(leftLabel);
      const rightLabel = make('text', { x: right + 10, y: y + 3, 'text-anchor': 'start', class: 'chart-axis-label' });
      rightLabel.textContent = String(Math.round(stockMax - ratio * (stockMax - stockMin)));
      svg.append(rightLabel);
    }
    [
      { key: 'revenue', color: '#f47a27', scale: moneyY },
      { key: 'grossProfit', color: '#24a97b', scale: moneyY },
      { key: 'cashAfterBills', color: '#527cdb', scale: moneyY },
      { key: 'inventoryUnits', color: '#25343c', scale: stockY },
    ].forEach(({ key, color, scale }) => {
      let path = '', open = false;
      points.forEach((point, index) => {
        const value = point[key];
        if (value === null || value === undefined || !Number.isFinite(Number(value))) { open = false; return; }
        path += `${open ? ' L' : ' M'} ${x(index).toFixed(1)} ${scale(Number(value)).toFixed(1)}`;
        open = true;
      });
      if (path) svg.append(make('path', { d: path, class: 'chart-line', stroke: color }));
      if (points.length <= 14) points.forEach((point, index) => {
        const value = point[key];
        if (value != null && Number.isFinite(Number(value))) {
          svg.append(make('circle', { cx: x(index), cy: scale(Number(value)), r: 4, fill: color }));
        }
      });
    });
    [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].forEach(index => {
      const label = make('text', { x: x(index), y: 285, 'text-anchor': 'middle', class: 'chart-axis-label' });
      label.textContent = englishDate(points[index].date, { month: 'short', day: 'numeric', year: '2-digit' });
      svg.append(label);
    });
    showChartPoint(points.length - 1);
  }

  function showChartPoint(index) {
    const point = chartPoints[index];
    if (!point || index === currentPointIndex) return;
    currentPointIndex = index;
    chartDayDetails.textContent = `${englishDate(point.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ` +
      `Revenue ${formatAmount(point.revenue)} · Gross profit ${formatAmount(point.grossProfit)} · ` +
      `Cash after bills ${point.cashAfterBills == null ? 'Unavailable' : formatAmount(point.cashAfterBills)} · Stock ${Number(point.inventoryUnits).toLocaleString('en-US')} units`;
  }

  function showChartPointAtPointer(event) {
    if (!chartPoints.length) return;
    const rect = metricsChart.getBoundingClientRect();
    const chartX = (event.clientX - rect.left) * 920 / rect.width;
    const index = chartPoints.length === 1 ? 0 : Math.round((chartX - 58) / (854 - 58) * (chartPoints.length - 1));
    showChartPoint(Math.max(0, Math.min(chartPoints.length - 1, index)));
  }

  function compactNumber(value) {
    const rounded = Math.round(value);
    return Math.abs(rounded) >= 1000 ? `${(rounded / 1000).toFixed(rounded % 1000 === 0 ? 0 : 1)}k` : String(rounded);
  }

  async function saveExpense(event) {
    event.preventDefault();
    const button = document.getElementById('saveExpenseButton');
    const message = document.getElementById('expenseMessage');
    button.disabled = true;
    button.textContent = 'Saving…';
    message.classList.add('hidden');
    try {
      await api('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('expenseTitle').value.trim(),
          amount: Number(document.getElementById('expenseAmount').value),
          expenseDate: document.getElementById('expenseDate').value,
        }),
      });
      document.getElementById('expenseForm').reset();
      document.getElementById('expensePanel').classList.add('hidden');
      await refreshDashboard();
    } catch (error) {
      message.textContent = `Could not save expense: ${error.message}`;
      message.className = 'workflow-notice error';
    } finally {
      button.disabled = false;
      button.textContent = 'Save expense';
    }
  }

  async function refreshInventory() {
    const summary = document.getElementById('inventorySummary');
    const status = document.getElementById('inventoryStatus');
    status.textContent = 'Loading from Firebase…';
    try {
      const data = await api('/api/inventory');
      inventoryProducts = data.products || [];
      const units = inventoryProducts.reduce((sum, product) => sum + Number(product.quantity || 0), 0);
      summary.textContent = `${inventoryProducts.length} products · ${units.toLocaleString()} units`;
      status.textContent = 'Synced from Firebase';
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      renderInventoryTable();
    } catch (error) {
      inventoryProducts = [];
      summary.textContent = 'Inventory unavailable';
      status.textContent = error.message;
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
      renderInventoryTable();
    }
  }

  function showInventoryAction(message, error = false) {
    const notice = document.getElementById('inventoryActionMessage');
    notice.textContent = message;
    notice.className = `inventory-action-message${error ? ' error' : ''}`;
  }

  async function deleteInventoryProduct(product, button) {
    const quantity = Number(product.quantity);
    const warning = `Remove ${product.name} (${product.barcode}) from inventory?\n\n` +
      `${quantity} units currently in stock will be removed. Past sales and revenue remain in the dashboard.`;
    if (!window.confirm(warning)) return;
    button.disabled = true;
    button.textContent = 'Removing…';
    try {
      const result = await api('/api/inventory', {
        method: 'DELETE',
        body: JSON.stringify({ barcode: product.barcode, expectedName: product.name, expectedQuantity: quantity }),
      });
      await refreshInventory();
      showInventoryAction(`${result.removed.name} removed from inventory. Past sales were kept.`);
    } catch (error) {
      await refreshInventory();
      showInventoryAction(`Could not remove product: ${error.message}`, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Delete';
    }
  }

  function renderInventoryTable() {
    const query = inventorySearch.value.trim().toLowerCase();
    const products = inventoryProducts.filter(product => `${product.name} ${product.barcode} ${product.supplierName}`.toLowerCase().includes(query));
    inventoryTableBody.replaceChildren();
    inventoryEmpty.classList.toggle('hidden', products.length > 0);
    if (!products.length) return;
    products.forEach(product => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const summary = document.createElement('div'); summary.className = 'product-summary';
      if (product.photoDataUrl?.startsWith('data:image/jpeg;base64,')) {
        const photo = document.createElement('img'); photo.src = product.photoDataUrl; photo.alt = '';
        photo.width = 36; photo.height = 36; summary.append(photo);
      }
      const nameText = document.createElement('strong'); nameText.textContent = product.name;
      summary.append(nameText); name.append(summary);
      const barcode = document.createElement('td'); barcode.textContent = product.barcode;
      const quantity = document.createElement('td'); quantity.textContent = Number(product.quantity).toLocaleString();
      const price = document.createElement('td'); price.textContent = product.originalPrice == null ? 'Set at first sale' : formatAmount(product.originalPrice);
      const arrival = document.createElement('td'); arrival.textContent = product.arrivalDate || '—';
      const supplier = document.createElement('td'); supplier.textContent = product.supplierName || '—';
      const action = document.createElement('td');
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'inventory-delete'; remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${product.name} from inventory`);
      remove.addEventListener('click', () => { void deleteInventoryProduct(product, remove); });
      action.append(remove);
      row.append(name, barcode, quantity, price, arrival, supplier, action);
      inventoryTableBody.append(row);
    });
  }

  const monthlyInputIds = {
    water: 'planWater', electricity: 'planElectricity', gas: 'planGas', sewage: 'planSewage',
    salaries: 'planSalaries', mortgagePayment: 'planMortgagePayment',
  };

  async function refreshFinance() {
    const requestId = ++financeRequestId;
    try {
      const data = await api('/api/finance');
      if (requestId !== financeRequestId) return;
      financeProducts = data.products;
      financeStats = data;
      if (!financePlanDirty) {
        financePlan = data.plan;
        for (const [field, id] of Object.entries(monthlyInputIds)) {
          document.getElementById(id).value = data.plan?.[field] ?? '';
        }
      }
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      renderFinanceSummary();
      renderFinanceTable();
    } catch (error) {
      showFinanceMessage('financePriceMessage', `Finance data is unavailable: ${error.message}`, true);
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
    }
  }

  function showFinanceMessage(id, message, error = false) {
    const element = document.getElementById(id);
    element.textContent = message;
    element.className = `finance-message${error ? ' error' : ''}`;
  }

  function renderFinanceSummary() {
    document.getElementById('financeMonthlyTotal').textContent = financePlan
      ? formatAmount(financePlan.cashCommitments) : 'Not entered';
    const gross = financeStats?.monthGrossProfit;
    document.getElementById('financeMonthlyGross').textContent = gross == null ? 'Unavailable' : formatAmount(gross);
    const net = financePlan && financePlan.mortgagePayment === 0 && gross != null
      ? gross - financePlan.profitExpenses - (financeStats?.monthOneTimeExpenses || 0) : null;
    document.getElementById('financeMonthlyNet').textContent = net === null ? 'Unavailable' : formatAmount(net);
    const cash = financePlan && gross != null
      ? gross - financePlan.cashCommitments - (financeStats?.monthOneTimeExpenses || 0) : null;
    document.getElementById('financeMonthlyCash').textContent = cash === null ? 'Unavailable' : formatAmount(cash);
    document.getElementById('financePlanStatus').textContent = financePlanDirty ? 'Unsaved monthly cost changes.'
      : !financePlan ? 'Monthly costs have not been entered. Gross profit is available; net profit is unavailable.'
        : financePlan.mortgagePayment > 0 ? 'Monthly costs saved. Net profit is unavailable with a combined mortgage payment; cash after bills is shown.'
          : 'Monthly costs saved. Net profit estimate and cash after bills are ready.';
    document.getElementById('financeCashResult').textContent = !financePlan
      ? 'Gross profit is available; enter monthly costs to see cash after bills.'
      : financePlan.mortgagePayment > 0
        ? 'Cash after bills includes the full mortgage payment. The net profit estimate is unavailable because this payment includes principal.'
        : 'Cash after bills includes monthly costs and one-time expenses recorded this month.';
  }

  async function saveFinancePlan(event) {
    event.preventDefault();
    const button = document.getElementById('saveMonthlyPlanButton');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const body = Object.fromEntries(Object.entries(monthlyInputIds)
        .map(([field, id]) => [field, document.getElementById(id).value]));
      const result = await api('/api/finance/plan', { method: 'PUT', body: JSON.stringify(body) });
      financePlan = result.plan;
      financePlanDirty = false;
      renderFinanceSummary();
      renderFinanceTable();
      showFinanceMessage('financePlanMessage', 'Monthly costs saved. The cash after bills estimate has been updated.');
    } catch (error) {
      showFinanceMessage('financePlanMessage', `Could not save monthly costs: ${error.message}`, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Save monthly costs';
    }
  }

  function renderFinanceTable() {
    const body = document.getElementById('financeTableBody');
    const query = document.getElementById('financeSearch').value.trim().toLowerCase();
    const products = financeProducts.filter(product => `${product.name} ${product.barcode}`.toLowerCase().includes(query));
    body.replaceChildren();
    document.getElementById('financeEmpty').classList.toggle('hidden', products.length > 0);
    for (const product of products) {
      const row = document.createElement('tr');
      const productCell = document.createElement('td');
      const productName = document.createElement('div'); productName.className = 'finance-product';
      if (product.photoDataUrl?.startsWith('data:image/jpeg;base64,')) {
        const image = document.createElement('img'); image.src = product.photoDataUrl; image.alt = '';
        productName.append(image);
      }
      const label = document.createElement('span'); label.textContent = `${product.name} (${product.barcode})`;
      productName.append(label); productCell.append(productName);
      const units = document.createElement('td'); units.textContent = Number(product.quantity).toLocaleString('en-US');
      const cost = document.createElement('td'); cost.textContent = product.unitCost == null ? 'Unavailable' : formatAmount(product.unitCost);
      const priceCell = document.createElement('td');
      const price = document.createElement('input'); price.type = 'number'; price.min = '0'; price.step = '0.01';
      price.inputMode = 'decimal'; price.className = 'finance-price-input';
      price.placeholder = 'Selling price'; price.value = product.originalPrice ?? '';
      price.setAttribute('aria-label', `Selling price for ${product.name}`);
      priceCell.append(price);
      const gross = document.createElement('td');
      const action = document.createElement('td');
      const save = document.createElement('button'); save.type = 'button'; save.className = 'finance-save-price';
      save.textContent = 'Save price'; action.append(save);
      function updatePreview() {
        const amount = price.value === '' ? NaN : Number(price.value);
        const valid = Number.isFinite(amount) && amount >= 0 && amount <= 1000000000 && price.validity.valid;
        const margin = valid && product.unitCost != null ? amount - Number(product.unitCost) : null;
        gross.textContent = margin == null ? '—' : formatAmount(margin);
        gross.className = margin != null && margin < 0 ? 'finance-negative' : 'finance-profit';
        save.disabled = !valid || amount === product.originalPrice;
      }
      price.addEventListener('input', updatePreview);
      save.addEventListener('click', async () => {
        save.disabled = true;
        save.textContent = 'Saving…';
        try {
          const result = await api('/api/finance/price', { method: 'PATCH', body: JSON.stringify({
            barcode: product.barcode, sellingPrice: Number(price.value), expectedPrice: product.originalPrice,
          }) });
          financeProducts = financeProducts.map(item => item.barcode === product.barcode ? result.product : item);
          showFinanceMessage('financePriceMessage', `${product.name}: selling price saved. Previous sales keep their original price.`);
          renderFinanceTable();
        } catch (error) {
          showFinanceMessage('financePriceMessage', `Could not save selling price: ${error.message}`, true);
          updatePreview();
        } finally {
          save.textContent = 'Save price';
        }
      });
      updatePreview();
      row.append(productCell, units, cost, priceCell, gross, action);
      body.append(row);
    }
  }

  watchRetailFlow(() => {
    if (currentView === 'dashboard') void refreshDashboard();
    if (currentView === 'inventory') void refreshInventory();
    if (currentView === 'finance' && !financePlanDirty && !document.activeElement?.classList.contains('finance-price-input')) void refreshFinance();
  }, error => {
    setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
    dashboardError.textContent = `Firestore is unavailable: ${error.message}`;
    dashboardError.classList.remove('hidden');
  });
  showTrendRange();
  void setMainView('dashboard');
})();
