import { api, watchPos, watchRetailFlow } from './firebase-store.js?finance-direct-20261109-3';

(() => {
  const dashboardScreen = document.getElementById('dashboardScreen');
  const inventoryScreen = document.getElementById('inventoryScreen');
  const posScreen = document.getElementById('posScreen');
  const financeScreen = document.getElementById('financeScreen');
  const ordersScreen = document.getElementById('ordersScreen');
  const suppliersScreen = document.getElementById('suppliersScreen');
  const aiCounterScreen = document.getElementById('aiCounterScreen');
  const aiCounterFrame = document.getElementById('aiCounterFrame');
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionStatusText = document.getElementById('connectionStatusText');
  const hubLayout = document.getElementById('hubLayout');
  const dashboardError = document.getElementById('dashboardError');
  const inventoryTableBody = document.getElementById('inventoryTableBody');
  const inventoryEmpty = document.getElementById('inventoryEmpty');
  const inventorySearch = document.getElementById('inventorySearch');
  const categoryFilters = document.getElementById('inventoryCategoryFilters');
  const categoryProducts = document.getElementById('inventoryCategoryProducts');
  const categorySearch = document.getElementById('inventoryCategorySearch');
  const categoryDialog = document.getElementById('inventoryCategoryDialog');
  const categoryDialogMessage = document.getElementById('inventoryCategoryDialogMessage');
  let dashboardRequestId = 0;
  let orderRequestId = 0;
  let orderPeriod = 'year';
  let orderAnchor = todayLocal();
  let supplierRequestId = 0;
  let supplierFrameReady = false;
  let supplierFramePayload = null;
  let supplierFrameError = null;
  let supplierSaveBusy = false;
  let currentView = 'dashboard';
  let inventoryProducts = [];
  let inventoryCategories = [];
  let activeInventoryCategory = 'All products';
  let categoryProduct = null;
  let financeProducts = [];
  let financeStats = null;
  let financeRequestId = 0;
  let financePeriod = 'month';
  let financeAnchor = todayLocal();
  let financeExpenseKind = 'monthly_cost';
  let posProducts = [];
  let posItems = [];
  let posFilter = 'all';
  let posPayment = 'cash';
  let posBusy = false;
  let posProductsReady = false;
  let posProductRequestId = 0;
  let overviewPeriod = 'month';
  let overviewAnchor = lastMonthRange().to;
  let bestPeriod = 'day';
  let bestAnchor = todayLocal();
  let bestView = 'pie';
  let alertFilter = 'all';
  let overviewData = null;
  let bestData = null;
  let stopRetailListener = () => {};
  let stopPosListener = () => {};
  let listenersStarted = false;
  const overviewAnchorInput = document.getElementById('overviewAnchor');
  const bestAnchorInput = document.getElementById('bestSellingAnchor');
  const financeAnchorInput = document.getElementById('financeAnchor');
  const orderAnchorInput = document.getElementById('orderAnchor');
  const supplierDashboardFrame = document.getElementById('supplierDashboardFrame');

  function syncOverviewControls() {
    const today = todayLocal();
    overviewAnchorInput.max = today;
    bestAnchorInput.max = today;
    overviewAnchorInput.value = overviewAnchor;
    bestAnchorInput.value = bestAnchor;
    document.querySelectorAll('[data-overview-period]').forEach(button => {
      const active = button.dataset.overviewPeriod === overviewPeriod;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-best-period]').forEach(button => {
      const active = button.dataset.bestPeriod === bestPeriod;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-best-view]').forEach(button => {
      const active = button.dataset.bestView === bestView;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }

  function syncFinanceControls() {
    const today = todayLocal();
    financeAnchorInput.max = today;
    financeAnchorInput.value = financeAnchor;
    document.querySelectorAll('[data-finance-period]').forEach(button => {
      const active = button.dataset.financePeriod === financePeriod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.getElementById('financePeriodText').textContent = periodName(financePeriod, financeAnchor);
  }

  function syncOrderControls() {
    const [year, month] = orderAnchor.split('-');
    orderAnchorInput.type = orderPeriod === 'day' ? 'date' : orderPeriod === 'month' ? 'month' : 'number';
    orderAnchorInput.value = orderPeriod === 'year' ? year : orderPeriod === 'month' ? `${year}-${month}` : orderAnchor;
    orderAnchorInput.setAttribute('aria-label', `Order analytics ${orderPeriod}`);
    if (orderPeriod === 'year') {
      orderAnchorInput.min = '2000';
      orderAnchorInput.max = todayLocal().slice(0, 4);
      orderAnchorInput.step = '1';
    } else {
      orderAnchorInput.removeAttribute('min');
      orderAnchorInput.max = orderPeriod === 'month' ? todayLocal().slice(0, 7) : todayLocal();
      orderAnchorInput.removeAttribute('step');
    }
    document.querySelectorAll('[data-order-period]').forEach(button => {
      const active = button.dataset.orderPeriod === orderPeriod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setFinanceExpenseKind(kind) {
    if (!['monthly_cost', 'one_time'].includes(kind)) return;
    financeExpenseKind = kind;
    document.querySelectorAll('[data-cost-kind]').forEach(button => {
      const active = button.dataset.costKind === kind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const monthly = kind === 'monthly_cost';
    document.getElementById('expensePanelTitle').textContent = monthly ? 'Record a monthly cost' : 'Record a one-time cost';
    document.getElementById('expenseTitle').placeholder = monthly
      ? 'For example: electricity or salaries' : 'For example: repairs or supplies';
    document.getElementById('expenseKindHelp').textContent = monthly
      ? 'A dated monthly bill is recorded once and included in the selected period.'
      : 'A one-time cost is included in the period containing its date.';
  }

  document.querySelectorAll('[data-overview-period]').forEach(button => button.addEventListener('click', () => {
    overviewPeriod = button.dataset.overviewPeriod;
    syncOverviewControls(); void refreshDashboard();
  }));
  document.querySelectorAll('[data-best-period]').forEach(button => button.addEventListener('click', () => {
    bestPeriod = button.dataset.bestPeriod;
    syncOverviewControls(); void refreshDashboard();
  }));
  document.querySelectorAll('[data-finance-period]').forEach(button => button.addEventListener('click', () => {
    financePeriod = button.dataset.financePeriod;
    syncFinanceControls(); void refreshFinance();
  }));
  document.querySelectorAll('[data-order-period]').forEach(button => button.addEventListener('click', () => {
    orderPeriod = button.dataset.orderPeriod;
    syncOrderControls();
    void refreshOrderAnalytics();
  }));
  document.querySelectorAll('[data-best-view]').forEach(button => button.addEventListener('click', () => {
    bestView = button.dataset.bestView;
    syncOverviewControls(); renderBestSelling(bestData);
  }));
  document.querySelectorAll('[data-alert-filter]').forEach(button => button.addEventListener('click', () => {
    alertFilter = button.dataset.alertFilter;
    document.querySelectorAll('[data-alert-filter]').forEach(option => {
      const active = option === button;
      option.classList.toggle('active', active); option.setAttribute('aria-pressed', String(active));
    });
    renderAlerts(overviewData);
  }));
  overviewAnchorInput.addEventListener('change', () => {
    if (!overviewAnchorInput.value || overviewAnchorInput.value > todayLocal()) return;
    overviewAnchor = overviewAnchorInput.value; void refreshDashboard();
  });
  bestAnchorInput.addEventListener('change', () => {
    if (!bestAnchorInput.value || bestAnchorInput.value > todayLocal()) return;
    bestAnchor = bestAnchorInput.value; void refreshDashboard();
  });
  financeAnchorInput.addEventListener('change', () => {
    if (!financeAnchorInput.value || financeAnchorInput.value > todayLocal()) {
      financeAnchorInput.value = financeAnchor;
      return;
    }
    financeAnchor = financeAnchorInput.value;
    syncFinanceControls(); void refreshFinance();
  });
  orderAnchorInput.addEventListener('change', () => {
    const value = orderAnchorInput.value;
    const candidate = orderPeriod === 'year' ? `${value}-01-01`
      : orderPeriod === 'month' ? `${value}-01` : value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || candidate > todayLocal() || Number.isNaN(Date.parse(`${candidate}T12:00:00Z`))) {
      syncOrderControls();
      return;
    }
    orderAnchor = candidate;
    syncOrderControls();
    void refreshOrderAnalytics();
  });

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => { void setMainView(button.dataset.view); });
  });
  document.getElementById('addExpenseButton').addEventListener('click', () => {
    document.getElementById('expensePanel').classList.remove('hidden');
    document.getElementById('expenseDate').value = financeAnchor;
    document.getElementById('expenseDate').max = todayLocal();
    const message = document.getElementById('expenseMessage');
    message.textContent = '';
    message.className = 'workflow-notice hidden';
    document.getElementById('expenseTitle').focus();
  });
  document.getElementById('closeExpenseButton').addEventListener('click', () => document.getElementById('expensePanel').classList.add('hidden'));
  document.getElementById('expenseForm').addEventListener('submit', saveExpense);
  document.querySelectorAll('[data-cost-kind]').forEach(button => button.addEventListener('click', () => {
    setFinanceExpenseKind(button.dataset.costKind);
  }));
  document.getElementById('refreshInventoryButton').addEventListener('click', () => { void refreshInventory(); });
  inventorySearch.addEventListener('input', renderInventoryTable);
  categorySearch.addEventListener('input', renderInventoryCategories);
  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    const message = event.data;
    const analyticsFrame = document.getElementById('inventoryAnalyticsFrame');
    if (analyticsFrame && event.source === analyticsFrame.contentWindow && message?.type === 'inventory-analytics-height') {
      analyticsFrame.style.height = `${Math.max(900, Number(message.height) || 0)}px`;
      return;
    }
    if (!supplierDashboardFrame || event.source !== supplierDashboardFrame.contentWindow) return;
    if (message?.type === 'supplier-dashboard-ready') {
      supplierFrameReady = true;
      if (supplierFramePayload) supplierDashboardFrame.contentWindow.postMessage({ type: 'supplier-data', data: supplierFramePayload }, location.origin);
      else if (supplierFrameError) supplierDashboardFrame.contentWindow.postMessage({ type: 'supplier-error', message: supplierFrameError }, location.origin);
    } else if (message?.type === 'supplier-dashboard-height') {
      supplierDashboardFrame.style.height = `${Math.max(700, Number(message.height) || 0)}px`;
    } else if (message?.type === 'supplier-save') {
      void saveSupplierDataFromFrame(message.data);
    } else if (message?.type === 'supplier-delete') {
      void deleteSupplierFromFrame(message.data);
    }
  });
  document.querySelectorAll('[data-inventory-tab]').forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.inventoryTab;
    document.querySelectorAll('[data-inventory-tab]').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-inventory-view]').forEach(view => view.classList.toggle('active', view.dataset.inventoryView === selected));
    if (selected === 'analytics') void refreshInventoryAnalytics();
  }));
  document.getElementById('createCategoryChoice').addEventListener('click', () => {
    document.getElementById('createCategoryFields').classList.remove('hidden');
    document.getElementById('existingCategoryFields').classList.add('hidden');
    document.getElementById('newInventoryCategoryName').focus();
  });
  document.getElementById('existingCategoryChoice').addEventListener('click', () => {
    document.getElementById('existingCategoryFields').classList.remove('hidden');
    document.getElementById('createCategoryFields').classList.add('hidden');
    const select = document.getElementById('existingInventoryCategory');
    select.replaceChildren(...inventoryCategories.map(category => {
      const option = document.createElement('option'); option.value = category; option.textContent = category; return option;
    }));
    if (!inventoryCategories.length) showCategoryDialogMessage('There are no categories yet. Create a new category first.');
    else { categoryDialogMessage.classList.add('hidden'); select.focus(); }
  });
  document.getElementById('closeInventoryCategoryDialog').addEventListener('click', () => categoryDialog.close());
  document.getElementById('saveNewInventoryCategory').addEventListener('click', () => { void createAndAssignInventoryCategory(); });
  document.getElementById('assignExistingInventoryCategory').addEventListener('click', () => { void assignInventoryCategory(); });
  document.getElementById('financeSearch').addEventListener('input', renderFinanceTable);
  document.getElementById('posSearch').addEventListener('input', renderPosCatalog);
  document.querySelectorAll('[data-pos-filter]').forEach(button => button.addEventListener('click', () => {
    posFilter = button.dataset.posFilter;
    document.querySelectorAll('[data-pos-filter]').forEach(option => {
      option.classList.toggle('active', option === button);
      option.setAttribute('aria-pressed', String(option === button));
    });
    renderPosCatalog();
  }));
  document.querySelectorAll('[data-pos-payment]').forEach(button => button.addEventListener('click', () => {
    posPayment = button.dataset.posPayment;
    document.querySelectorAll('[data-pos-payment]').forEach(option => {
      option.classList.toggle('active', option === button);
      option.setAttribute('aria-pressed', String(option === button));
    });
  }));
  document.getElementById('posClearButton').addEventListener('click', async () => {
    if (!posItems.length || !window.confirm('Clear the current shared POS order?')) return;
    await changePos(async () => {
      await api('/api/pos', { method: 'DELETE' });
      return { clear: true, message: 'Order cleared.' };
    });
  });
  document.getElementById('posCheckoutButton').addEventListener('click', async () => {
    await changePos(async () => {
      const { sale } = await api('/api/pos/checkout', {
        method: 'POST', body: JSON.stringify({ paymentMethod: posPayment }),
      });
      return { clear: true, message: `Sale #${sale.id} complete · ${formatAmount(sale.totalOriginalPrice)} paid by ${posPayment.toUpperCase()}.` };
    });
  });
  function todayLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function lastMonthRange() {
    const now = new Date();
    const toDate = new Date(now.getFullYear(), now.getMonth(), 0, 12);
    const fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12);
    const local = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { from: local(fromDate), to: local(toDate) };
  }

  function dateUTC(value) { return new Date(`${value}T12:00:00Z`); }

  function englishDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(dateUTC(value));
  }

  async function setMainView(view) {
    currentView = view;
    dashboardScreen.classList.toggle('hidden', view !== 'dashboard');
    inventoryScreen.classList.toggle('hidden', view !== 'inventory');
    posScreen.classList.toggle('hidden', view !== 'pos');
    financeScreen.classList.toggle('hidden', view !== 'finance');
    ordersScreen.classList.toggle('hidden', view !== 'orders');
    suppliersScreen.classList.toggle('hidden', view !== 'suppliers');
    aiCounterScreen.classList.toggle('hidden', view !== 'ai-counter');
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    if (view === 'dashboard') await refreshDashboard();
    if (view === 'inventory') await refreshInventory();
    if (view === 'pos') await refreshPosProducts();
    if (view === 'finance') await refreshFinance();
    if (view === 'orders') await refreshOrderAnalytics();
    if (view === 'suppliers') {
      if (supplierDashboardFrame?.getAttribute('src') === 'about:blank') supplierDashboardFrame.src = './supplier-dashboard.html?v=supplier-profile-20261103-7';
      await refreshSupplierDashboard();
    }
    if (view === 'ai-counter' && aiCounterFrame?.getAttribute('src') === 'about:blank') {
      aiCounterFrame.src = './ai-counter.html?v=auto-focus-20261109-3';
    } else if (view === 'ai-counter') {
      aiCounterFrame?.contentWindow?.postMessage({ type: 'retailflow:refresh-inventory' }, location.origin);
    }
  }

  function formatAmount(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function setDatabaseStatus(online, message) {
    connectionStatus.classList.toggle('db-offline', !online);
    connectionStatusText.textContent = message;
  }

  function svgNode(tag, attributes = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function periodName(period, anchor) {
    if (period === 'day') return englishDate(anchor, { day: 'numeric', month: 'long', year: 'numeric' });
    if (period === 'year') return anchor.slice(0, 4);
    return englishDate(`${anchor.slice(0, 7)}-01`, { month: 'long', year: 'numeric' });
  }

  function applyDelta(id, selected, previous) {
    const element = document.getElementById(id);
    element.className = '';
    if (!previous) {
      element.textContent = selected ? 'New activity' : '—';
      element.classList.add('neutral');
      return;
    }
    const change = (selected - previous) / previous * 100;
    element.textContent = `${change > 0 ? '↑ +' : change < 0 ? '↓ −' : '— '}${Math.abs(change).toFixed(1)}%`;
    element.classList.toggle('down', change < 0);
    element.classList.toggle('neutral', change === 0);
  }

  function renderOverview(data) {
    if (!data) return;
    document.getElementById('overviewPeriodText').textContent = periodName(data.period, data.anchor);
    const suffix = data.period[0].toUpperCase() + data.period.slice(1);
    document.getElementById('overviewRevenueLabel').textContent = `Revenue · ${suffix}`;
    document.getElementById('overviewOrdersLabel').textContent = `Orders · ${suffix}`;
    document.getElementById('overviewRevenue').textContent = formatAmount(data.totals.revenue);
    document.getElementById('overviewOrders').textContent = Number(data.totals.orders).toLocaleString('en-US');
    document.getElementById('overviewAlertCount').textContent = Number(data.totals.stockAlerts).toLocaleString('en-US');
    document.getElementById('overviewProductCount').textContent = Number(data.totals.productCount).toLocaleString('en-US');
    document.getElementById('overviewAlertBreakdown').textContent = `${data.totals.critical} critical · ${data.totals.low} low`;
    document.getElementById('overviewStockBreakdown').textContent = 'In inventory now';
    applyDelta('overviewRevenueDelta', data.totals.revenue, data.totals.previousRevenue);
    applyDelta('overviewOrdersDelta', data.totals.orders, data.totals.previousOrders);
    document.getElementById('overviewChartSubtitle').textContent =
      `${periodName(data.period, data.anchor)} · historical completed sales`;
    renderRevenueChart(data);
    renderAlerts(data);
    renderExpiryWarnings(data);
  }

  function renderAlerts(data) {
    if (!data) return;
    const headline = document.getElementById('overviewAlertHeadline');
    headline.textContent = !data.totals.productCount ? 'No products in inventory'
      : data.alerts.length ? `${data.alerts.length} ${data.alerts.length === 1 ? 'product needs' : 'products need'} attention`
        : 'All products are healthy';
    headline.title = 'Critical: out of stock. Low: at or below 30% of recorded peak stock.';
    const list = document.getElementById('overviewAlertList');
    list.replaceChildren();
    const alerts = data.alerts.filter(item => alertFilter === 'all' || item.status === alertFilter);
    if (!alerts.length) {
      const empty = document.createElement('p');
      empty.className = 'overview-empty';
      empty.textContent = !data.totals.productCount ? 'No products in inventory yet.'
        : alertFilter === 'all' ? 'No stock alerts right now.'
        : `No ${alertFilter} stock alerts right now.`;
      list.append(empty); return;
    }
    alerts.forEach(item => {
      const row = document.createElement('div'); row.className = 'overview-alert-row';
      const name = document.createElement('span'); name.textContent = item.name;
      const code = document.createElement('small'); code.textContent = item.barcode;
      name.append(code);
      const badge = document.createElement('b'); badge.className = item.status;
      badge.textContent = item.status === 'critical' ? 'Out of stock'
        : `${item.quantity} left · ${Math.round(item.stockPercent)}%`;
      badge.title = item.status === 'low'
        ? `${item.quantity} in stock from a recorded peak of ${item.peakStock}. Low-stock warning starts at 30%.`
        : 'No units currently in stock.';
      row.append(name, badge); list.append(row);
    });
  }

  function renderExpiryWarnings(data) {
    const items = data.expiryWarnings || [];
    const headline = document.getElementById('overviewExpiryHeadline');
    const list = document.getElementById('overviewExpiryList');
    const expiredCount = items.filter(item => item.daysUntilExpiry < 0).length;
    headline.textContent = items.length
      ? `${items.length} ${items.length === 1 ? 'product' : 'products'}${expiredCount ? ` · ${expiredCount} expired` : ''}`
      : 'No products expiring within 2 months';
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p'); empty.className = 'overview-empty';
      empty.textContent = 'No expiry warnings right now.'; list.append(empty); return;
    }
    items.forEach(item => {
      const expired = item.daysUntilExpiry < 0;
      const row = document.createElement('article'); row.className = `overview-expiry-row${expired ? ' expired' : ''}`;
      const top = document.createElement('div'); top.className = 'overview-expiry-top';
      const name = document.createElement('strong'); name.textContent = item.name;
      const badge = document.createElement('b'); badge.textContent = expired ? 'Expired' : `${item.daysUntilExpiry} days left`;
      top.append(name, badge);
      const meta = document.createElement('small'); meta.className = 'overview-expiry-meta';
      meta.textContent = `${item.quantity} in stock · Expires ${englishDate(item.expiryDate)}`;
      const recommendation = document.createElement('p'); recommendation.className = 'overview-expiry-promo';
      recommendation.textContent = item.recommendation;
      row.append(top, meta, recommendation);
      if (!expired) {
        const options = document.createElement('small'); options.className = 'overview-expiry-options';
        options.textContent = item.discountRate == null
          ? 'Set selling price and unit cost to calculate safe promotion options.'
          : `Discount option: ${item.discountRate > 0 ? `${item.discountRate}% off` : 'no safe markdown'} · Buy 1 Get 1 Free: ${item.buyOneGetOneSafe ? 'cost-safe' : 'not recommended'}`;
        row.append(options);
      }
      list.append(row);
    });
  }

  function smoothOverviewPath(points) {
    if (!points.length) return '';
    const rounded = number => Number(number.toFixed(1));
    let path = `M ${rounded(points[0].x)} ${rounded(points[0].y)}`;
    if (points.length === 1) return path;
    const slopes = points.slice(1).map((point, index) =>
      (point.y - points[index].y) / (point.x - points[index].x));
    const tangents = points.map((_, index) => {
      if (index === 0) return slopes[0];
      if (index === points.length - 1) return slopes.at(-1);
      const a = slopes[index - 1], b = slopes[index];
      if (a * b <= 0) return 0;
      const leftWidth = points[index].x - points[index - 1].x;
      const rightWidth = points[index + 1].x - points[index].x;
      const w1 = 2 * rightWidth + leftWidth, w2 = rightWidth + 2 * leftWidth;
      return (w1 + w2) / (w1 / a + w2 / b);
    });
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      const third = (b.x - a.x) / 3;
      path += ` C ${rounded(a.x + third)} ${rounded(a.y + tangents[index - 1] * third)}` +
        ` ${rounded(b.x - third)} ${rounded(b.y - tangents[index] * third)}` +
        ` ${rounded(b.x)} ${rounded(b.y)}`;
    }
    return path;
  }

  function renderRevenueChart(data) {
    const svg = document.getElementById('overviewRevenueChart');
    svg.replaceChildren();
    const empty = document.getElementById('overviewChartEmpty');
    const chart = data.chart;
    const values = chart.flatMap(point => [point.revenue, point.grossProfit]).filter(Number.isFinite);
    const hasSales = data.totals.orders > 0;
    empty.classList.toggle('hidden', hasSales);
    svg.setAttribute('aria-label', `Revenue ${formatAmount(data.totals.revenue)}, gross profit ${formatAmount(data.totals.grossProfit)} for ${periodName(data.period, data.anchor)}`);
    if (!chart.length) return;
    const left = 55, right = 850, top = 29, bottom = 260;
    let minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
    if (minimum === maximum) maximum = minimum + 1;
    const pad = (maximum - minimum) * .1;
    if (minimum < 0) minimum -= pad;
    maximum += pad;
    const y = value => bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
    const x = index => chart.length === 1 ? (left + right) / 2 : left + index * (right - left) / (chart.length - 1);
    const baseline = y(0);
    for (let tick = 0; tick < 5; tick++) {
      const gridY = top + tick * (bottom - top) / 4;
      svg.append(svgNode('line', { x1: left, y1: gridY, x2: right, y2: gridY, stroke: '#e8edf0', 'stroke-width': 1 }));
      const label = svgNode('text', { x: left - 10, y: gridY + 4, 'text-anchor': 'end', fill: '#95a1ad', 'font-size': 12 });
      label.textContent = compactNumber(maximum - tick * (maximum - minimum) / 4);
      svg.append(label);
    }
    const defs = svgNode('defs');
    const fill = svgNode('linearGradient', { id: 'overview-revenue-fill', x1: 0, x2: 0, y1: 0, y2: 1 });
    fill.append(svgNode('stop', { offset: '0%', 'stop-color': '#f6a16a', 'stop-opacity': .42 }));
    fill.append(svgNode('stop', { offset: '100%', 'stop-color': '#f6a16a', 'stop-opacity': .02 }));
    defs.append(fill); svg.prepend(defs);
    const runs = key => {
      const result = []; let run = [];
      chart.forEach((point, index) => {
        if (point[key] == null || !Number.isFinite(Number(point[key]))) {
          if (run.length) result.push(run); run = [];
        } else run.push({ x: x(index), y: y(Number(point[key])) });
      });
      if (run.length) result.push(run);
      return result;
    };
    const revenueRuns = runs('revenue');
    revenueRuns.forEach(run => {
      if (run.length < 2) return;
      const start = run[0], end = run.at(-1);
      svg.append(svgNode('path', { d: `${smoothOverviewPath(run)} L ${end.x} ${baseline} L ${start.x} ${baseline} Z`,
        fill: 'url(#overview-revenue-fill)', stroke: 'none' }));
    });
    [['revenue', '#e87518', revenueRuns], ['grossProfit', '#17a552', runs('grossProfit')]].forEach(([key, color, chunks]) => {
      chunks.forEach(run => svg.append(svgNode('path', { d: smoothOverviewPath(run), fill: 'none', stroke: color,
        'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
      chart.forEach((point, index) => {
        if (point[key] == null) return;
        const dot = svgNode('circle', { cx: x(index), cy: y(point[key]), r: index === chart.length - 1 ? 5 : 3,
          fill: color, tabindex: 0 });
        const title = svgNode('title'); title.textContent = `${point.label}: ${key === 'revenue' ? 'Revenue' : 'Gross profit'} ${formatAmount(point[key])}`;
        dot.append(title); svg.append(dot);
      });
    });
    chart.forEach((point, index) => {
      const label = svgNode('text', { x: x(index), y: 292, 'text-anchor': 'middle', fill: '#a7b5c3',
        'font-size': chart.length > 9 ? 10 : 12 });
      label.textContent = point.label; svg.append(label);
    });
    if (data.totals.grossProfit == null) {
      const note = svgNode('text', { x: right, y: 17, 'text-anchor': 'end', fill: '#b35b3a', 'font-size': 11 });
      note.textContent = 'Gross profit unavailable: missing product cost'; svg.append(note);
    }
  }

  function sellingColors(data) {
    const palette = [
      [92, 38, 67], [218, 43, 54], [42, 90, 62], [211, 11, 57],
      [15, 69, 61], [181, 45, 52], [293, 31, 59], [352, 61, 59],
      [120, 39, 49], [25, 61, 50], [246, 39, 61], [197, 52, 50],
    ];
    const barcodes = [...new Set([...data.bestSelling, ...data.previousSelling].map(item => item.barcode))].sort();
    return new Map(barcodes.map((barcode, index) => {
      const [hue, saturation, lightness] = palette[index] ||
        [Math.round(11 + (index - palette.length) * 137.508) % 360, 55, 55];
      return [barcode, {
        fill: `hsl(${hue} ${saturation}% ${lightness}%)`,
        shadow: `hsl(${hue} ${saturation}% ${Math.max(28, lightness - 22)}%)`,
        pale: `hsl(${hue} ${Math.max(30, saturation - 18)}% ${Math.min(88, lightness + 26)}%)`,
      }];
    }));
  }

  function renderBestSelling(data) {
    if (!data) return;
    document.getElementById('bestSellingSubtitle').textContent =
      `Quantity share · ${periodName(data.period, data.anchor)}`;
    const pie = document.getElementById('bestSellingPie');
    const bar = document.getElementById('bestSellingBar');
    document.getElementById('bestSellingStage').classList.toggle('is-bar', bestView === 'bar');
    pie.classList.toggle('hidden', bestView !== 'pie');
    bar.classList.toggle('hidden', bestView !== 'bar');
    const empty = document.getElementById('bestSellingEmpty');
    const hasCurrent = data.bestSelling.some(item => item.quantity > 0);
    const hasPrevious = data.previousSelling.some(item => item.quantity > 0);
    empty.classList.toggle('hidden', bestView === 'pie' ? hasCurrent : hasCurrent || hasPrevious);
    empty.textContent = bestView === 'pie' ? 'No item sales recorded for this period.'
      : 'No item sales recorded for either period.';
    if (bestView === 'pie') renderSellingPie(data);
    else renderSellingBars(data);
  }

  function renderSellingPie(data) {
    const svg = document.getElementById('bestSellingPie');
    const legend = document.getElementById('bestSellingLegend');
    svg.replaceChildren(); legend.replaceChildren();
    const items = data.bestSelling.filter(item => item.quantity > 0);
    if (!items.length) {
      svg.append(svgNode('ellipse', { cx: 310, cy: 160, rx: 190, ry: 113, fill: '#fff', stroke: '#f2f3f3' }));
      legend.append(Object.assign(document.createElement('p'), { textContent: 'Item shares appear after a completed sale.' }));
      return;
    }
    const colors = sellingColors(data);
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    const segments = items.map(item => ({ ...item, ...colors.get(item.barcode) }));
    const cx = 310, cy = 155, outerX = 191, outerY = 107, innerX = 91, innerY = 51, depth = 24;
    const fmt = number => Number(number.toFixed(2));
    const polar = (angle, radiusX, radiusY, offset = 0) =>
      `${fmt(cx + radiusX * Math.cos(angle))} ${fmt(cy + offset + radiusY * Math.sin(angle))}`;
    const topPath = (start, end) => {
      const whole = end - start > Math.PI * 2 - .00001;
      if (whole) return `M ${polar(start, outerX, outerY)} A ${outerX} ${outerY} 0 1 1 ${polar(start + Math.PI, outerX, outerY)}` +
        ` A ${outerX} ${outerY} 0 1 1 ${polar(end, outerX, outerY)} L ${polar(end, innerX, innerY)}` +
        ` A ${innerX} ${innerY} 0 1 0 ${polar(start + Math.PI, innerX, innerY)}` +
        ` A ${innerX} ${innerY} 0 1 0 ${polar(start, innerX, innerY)} Z`;
      const large = end - start > Math.PI ? 1 : 0;
      return `M ${polar(start, outerX, outerY)} A ${outerX} ${outerY} 0 ${large} 1 ${polar(end, outerX, outerY)}` +
        ` L ${polar(end, innerX, innerY)} A ${innerX} ${innerY} 0 ${large} 0 ${polar(start, innerX, innerY)} Z`;
    };
    svg.append(svgNode('ellipse', { cx, cy: cy + depth + 10, rx: outerX + 4, ry: outerY + 3,
      fill: '#b8c4d0', opacity: .2 }));
    let angle = -Math.PI / 2;
    const shapes = segments.map(item => {
      const end = angle + item.quantity / total * Math.PI * 2;
      const shape = { ...item, start: angle, end };
      angle = end; return shape;
    });
    // Only the front half has an exposed outer wall. Each sector uses its own
    // darker shade to create depth while the top remains a true quantity share.
    shapes.forEach(item => {
      const a = Math.max(0, item.start), b = Math.min(Math.PI, item.end);
      if (b <= a) return;
      svg.append(svgNode('path', { d: `M ${polar(a, outerX, outerY)} A ${outerX} ${outerY} 0 ${b - a > Math.PI ? 1 : 0} 1 ${polar(b, outerX, outerY)}` +
        ` L ${polar(b, outerX, outerY, depth)} A ${outerX} ${outerY} 0 ${b - a > Math.PI ? 1 : 0} 0 ${polar(a, outerX, outerY, depth)} Z`,
      fill: item.shadow }));
    });
    svg.append(svgNode('ellipse', { cx, cy: cy + 12, rx: innerX, ry: innerY, fill: '#d8e1e9' }));
    svg.append(svgNode('ellipse', { cx, cy: cy + 19, rx: innerX - 3, ry: innerY - 5, fill: '#f8f8f8' }));
    const centerMain = svgNode('text', { x: cx, y: cy + 7, 'text-anchor': 'middle', fill: '#182735',
      'font-size': 17, 'font-weight': 750 });
    const centerSub = svgNode('text', { x: cx, y: cy + 28, 'text-anchor': 'middle', fill: '#82909b', 'font-size': 12 });
    centerMain.textContent = `${total} sold`;
    centerSub.textContent = 'Selected period';
    shapes.forEach(item => {
      const percent = item.quantity / total * 100;
      const slice = svgNode('path', { d: topPath(item.start, item.end), fill: item.fill,
        stroke: shapes.length === 1 ? 'none' : '#ffffff', 'stroke-width': .7, tabindex: 0, role: 'img',
        'aria-label': `${item.name}: ${item.quantity} sold, ${percent.toFixed(1)} percent` });
      const tooltip = svgNode('title'); tooltip.textContent = `${item.name}: ${item.quantity} sold · ${percent.toFixed(1)}%`;
      slice.append(tooltip);
      const show = () => { centerMain.textContent = `${percent.toFixed(1)}%`; centerSub.textContent = item.name.length > 20 ? `${item.name.slice(0, 17)}…` : item.name; };
      const reset = () => { centerMain.textContent = `${total} sold`; centerSub.textContent = 'Selected period'; };
      slice.addEventListener('pointerenter', show); slice.addEventListener('focus', show);
      slice.addEventListener('pointerleave', reset); slice.addEventListener('blur', reset);
      svg.append(slice);
    });
    svg.append(centerMain, centerSub);
    shapes.forEach(item => {
      const row = document.createElement('div'); row.className = 'overview-legend-row';
      const label = document.createElement('span');
      const swatch = document.createElement('i'); swatch.style.background = item.fill;
      const name = document.createElement('span'); name.className = 'name'; name.textContent = item.name; name.title = item.name;
      label.append(swatch, name);
      const count = document.createElement('strong'); count.textContent = `${item.quantity} · ${(item.quantity / total * 100).toFixed(1)}%`;
      row.append(label, count); legend.append(row);
    });
  }

  function renderSellingBars(data) {
    const svg = document.getElementById('bestSellingBar');
    const legend = document.getElementById('bestSellingLegend');
    svg.replaceChildren(); legend.replaceChildren();
    const colors = sellingColors(data);
    const current = new Map(data.bestSelling.map(item => [item.barcode, item]));
    const previous = new Map(data.previousSelling.map(item => [item.barcode, item]));
    const items = [...new Set([...current.keys(), ...previous.keys()])]
      .map(barcode => ({ barcode, name: current.get(barcode)?.name || previous.get(barcode)?.name || barcode,
        selected: current.get(barcode)?.quantity || 0, prior: previous.get(barcode)?.quantity || 0 }))
      .sort((a, b) => b.selected - a.selected || b.prior - a.prior || a.name.localeCompare(b.name));
    if (!items.length) {
      legend.append(Object.assign(document.createElement('p'), { textContent: 'Compare sold quantities after a completed sale.' }));
      return;
    }
    const left = 63, right = Math.max(785, left + items.length * 104), top = 25, bottom = 268;
    const chartWidth = right + 35;
    svg.setAttribute('viewBox', `0 0 ${chartWidth} 350`);
    svg.style.width = items.length <= 6 ? '100%' : `${chartWidth}px`;
    const maximum = Math.max(1, ...items.flatMap(item => [item.selected, item.prior]));
    for (let tick = 0; tick <= 4; tick++) {
      const y = bottom - tick * (bottom - top) / 4;
      svg.append(svgNode('line', { x1: left, y1: y, x2: right, y2: y,
        stroke: '#d9dee3', 'stroke-width': 1, 'stroke-dasharray': '4 5' }));
      const label = svgNode('text', { x: left - 12, y: y + 4, 'text-anchor': 'end', fill: '#8b949e', 'font-size': 12 });
      label.textContent = String(Number((tick * maximum / 4).toFixed(1))); svg.append(label);
    }
    const groupWidth = (right - left) / items.length;
    const barWidth = Math.min(33, groupWidth * .27);
    const guide = svgNode('g', { visibility: 'hidden', 'pointer-events': 'none' });
    const guideLine = svgNode('line', { x1: left, x2: right, stroke: '#202630', 'stroke-width': 1.2 });
    const guideBox = svgNode('rect', { x: 4, width: 49, height: 22, rx: 4, fill: '#202630' });
    const guideText = svgNode('text', { x: 28, 'text-anchor': 'middle', fill: '#fff', 'font-size': 12,
      'font-weight': 700 });
    guide.append(guideLine, guideBox, guideText);
    items.forEach((item, index) => {
      const cx = left + groupWidth * (index + .5);
      const color = colors.get(item.barcode);
      [[item.selected, color.fill, -barWidth - 2, 'Selected'], [item.prior, color.pale, 2, 'Previous']]
        .forEach(([value, color, dx, label]) => {
          const height = value / maximum * (bottom - top);
          const rect = svgNode('rect', { x: cx + dx, y: bottom - height, width: barWidth,
            height, fill: color, tabindex: 0, role: 'img', 'aria-label': `${item.name}: ${label} ${value} sold` });
          const title = svgNode('title'); title.textContent = `${item.name}: ${label} ${value} sold`;
          rect.append(title); svg.append(rect);
          rect.addEventListener('pointerenter', () => {
            const guideY = Math.max(top + 8, bottom - height);
            guideLine.setAttribute('y1', guideY); guideLine.setAttribute('y2', guideY);
            guideBox.setAttribute('y', guideY - 11);
            guideText.setAttribute('y', guideY + 4); guideText.textContent = String(value);
            guide.setAttribute('visibility', 'visible');
          });
          rect.addEventListener('pointerleave', () => guide.setAttribute('visibility', 'hidden'));
        });
      const name = svgNode('text', { x: cx, y: 296, 'text-anchor': 'middle', fill: '#82909c', 'font-size': 11 });
      name.textContent = item.name.length > 14 ? `${item.name.slice(0, 12)}…` : item.name;
      svg.append(name);
    });
    svg.append(guide);
    items.forEach(item => {
      const row = document.createElement('div'); row.className = 'overview-legend-row';
      const label = document.createElement('span');
      const swatch = document.createElement('i'); swatch.style.background = colors.get(item.barcode).fill;
      const title = document.createElement('span'); title.className = 'name';
      title.textContent = item.name; title.title = item.name;
      label.append(swatch, title);
      const count = document.createElement('strong');
      count.textContent = `${item.selected} / ${item.prior}`;
      count.title = 'Selected period / previous period';
      row.append(label, count); legend.append(row);
    });
    const note = document.createElement('p');
    note.textContent = 'Solid = selected period · light = previous period. Counts show selected / previous.';
    legend.append(note);
  }

  async function refreshDashboard() {
    const requestId = ++dashboardRequestId;
    dashboardError.classList.add('hidden');
    document.getElementById('dashboardUpdated').textContent = 'Updating…';
    try {
      const [overview, best] = await Promise.all([
        api(`/api/overview?${new URLSearchParams({ period: overviewPeriod, anchor: overviewAnchor })}`),
        api(`/api/overview?${new URLSearchParams({ period: bestPeriod, anchor: bestAnchor })}`),
      ]);
      if (requestId !== dashboardRequestId) return;
      overviewData = overview; bestData = best;
      renderOverview(overview);
      renderBestSelling(best);
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      document.getElementById('dashboardUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      if (requestId !== dashboardRequestId) return;
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
      document.getElementById('dashboardUpdated').textContent = 'Waiting for database';
      dashboardError.textContent = `Dashboard data is not available: ${error.message}. Check firebase-config.js and Firestore rules.`;
      dashboardError.classList.remove('hidden');
    }
  }

  async function refreshOrderAnalytics() {
    const requestId = ++orderRequestId;
    document.getElementById('ordersError').classList.add('hidden');
    document.getElementById('ordersUpdated').textContent = 'Updating…';
    try {
      const stats = await api(`/api/order-analytics?${new URLSearchParams({ period: orderPeriod, anchor: orderAnchor })}`);
      if (requestId !== orderRequestId) return;
      renderOrderAnalytics(stats);
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      document.getElementById('ordersUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      if (requestId !== orderRequestId) return;
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
      document.getElementById('ordersUpdated').textContent = 'Waiting for database';
      document.getElementById('ordersError').textContent = `Order analytics are not available: ${error.message}. Check Firebase access and Firestore rules.`;
      document.getElementById('ordersError').classList.remove('hidden');
    }
  }

  function renderOrderAnalytics(data) {
    const now = new Date();
    const stamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    document.getElementById('orderAnalyticsSubtitle').textContent = data.subtitle;
    document.getElementById('orderFrequencyTotal').textContent = `${Number(data.orderCount).toLocaleString('en-US')} orders`;
    document.getElementById('orderPeakLabel').textContent = data.peakPrefix;
    document.getElementById('orderPeakValue').textContent = data.peakLabel;
    document.getElementById('orderBusiestTime').textContent = data.busiestTime;
    document.getElementById('orderAverageSlot').textContent = Number(data.averagePerSlot || 0).toFixed(1);
    const frequencyTitle = data.period === 'year' ? 'Order frequency by month'
      : data.period === 'month' ? 'Order frequency by day' : 'Order frequency by 4-hour block';
    document.getElementById('orderFrequencyTitle').textContent = frequencyTitle;
    document.getElementById('orderTopItemsSubtitle').textContent = `${periodName(data.period, data.anchor)} · ${data.orderCount} completed orders`;
    document.getElementById('orderHistorySubtitle').textContent = `${data.totalOrdersInRange} completed orders · ${periodName(data.period, data.anchor)}`;
    renderOrderBars(document.getElementById('orderFrequencyBars'), data.frequency, '#c95052', 46, `${frequencyTitle}, ${data.orderCount} orders`);
    renderOrderBars(document.getElementById('orderTimeBars'), data.hourlyCounts, '#252a30', 30, `Time of day order frequency, updated ${stamp}`);
    renderTopOrderItems(data.topItems);
    renderOrderHistory(data.orders);
  }

  function renderOrderBars(container, items, color, maxWidth, description) {
    container.replaceChildren();
    container.setAttribute('aria-label', description);
    const maximum = Math.max(0, ...items.map(item => Number(item.count) || 0));
    items.forEach(item => {
      const count = Number(item.count) || 0;
      const column = document.createElement('div'); column.className = 'orders-bar-item';
      column.title = `${item.label}: ${count} ${count === 1 ? 'order' : 'orders'}`;
      const value = document.createElement('span'); value.className = 'orders-bar-value';
      value.textContent = count ? String(count) : '';
      const track = document.createElement('span'); track.className = 'orders-bar-track';
      const bar = document.createElement('i'); bar.className = 'orders-bar';
      if (count > 0 && maximum > 0) {
        const height = Math.max(5, count / maximum * 176);
        bar.style.height = `${height}px`;
        bar.style.maxWidth = `${maxWidth}px`;
        bar.style.backgroundColor = color;
      } else {
        bar.classList.add('is-zero');
      }
      bar.setAttribute('aria-hidden', 'true');
      track.append(bar);
      const label = document.createElement('span'); label.className = 'orders-bar-label'; label.textContent = item.label;
      column.append(value, track, label);
      container.append(column);
    });
  }

  function renderTopOrderItems(items) {
    const container = document.getElementById('orderTopItems');
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p'); empty.className = 'overview-empty';
      empty.textContent = 'No item sales recorded in this period.'; container.append(empty); return;
    }
    const maximum = Math.max(...items.map(item => Number(item.quantity) || 0));
    items.forEach((item, index) => {
      const row = document.createElement('div'); row.className = 'order-top-row';
      const rank = document.createElement('span'); rank.className = 'order-top-rank'; rank.textContent = String(index + 1);
      const name = document.createElement('span'); name.className = 'order-top-name'; name.textContent = item.name; name.title = item.name;
      const track = document.createElement('span'); track.className = 'order-top-track';
      const fill = document.createElement('i'); fill.style.width = `${Math.max(0, Number(item.quantity) / maximum * 100)}%`; fill.setAttribute('aria-hidden', 'true'); track.append(fill);
      const count = document.createElement('span'); count.className = 'order-top-count'; count.textContent = `${item.quantity} ${item.quantity === 1 ? 'item' : 'items'}`;
      row.append(rank, name, track, count); container.append(row);
    });
  }

  function orderDateTime(sale) {
    const timestamp = sale.createdAt?.toDate?.() || (Number.isFinite(Number(sale.createdAt?.seconds))
      ? new Date(Number(sale.createdAt.seconds) * 1000) : null);
    if (timestamp && !Number.isNaN(timestamp.getTime())) {
      return `${new Intl.DateTimeFormat('en-CA').format(timestamp)} · ${new Intl.DateTimeFormat('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true,
      }).format(timestamp).toLowerCase()}`;
    }
    return sale.day ? `${englishDate(sale.day)} · time unavailable` : 'Date unavailable';
  }

  function orderItemSummary(sale) {
    return (Array.isArray(sale.items) ? sale.items : []).map(item =>
      `${Number(item.quantity) || 0}× ${String(item.name || item.barcode || 'Item')}`).join(', ') || 'No item details';
  }

  function renderOrderHistory(orders) {
    const container = document.getElementById('orderHistoryList');
    container.replaceChildren();
    if (!orders.length) {
      const empty = document.createElement('p'); empty.className = 'overview-empty';
      empty.textContent = 'No completed orders in this period.'; container.append(empty); return;
    }
    orders.forEach(sale => {
      const row = document.createElement('article'); row.className = 'order-history-row';
      const id = document.createElement('span'); id.className = 'order-history-id';
      id.textContent = sale.id ? `#${String(sale.id).slice(0, 8)}` : '#—';
      const items = document.createElement('span'); items.className = 'order-history-items'; items.textContent = orderItemSummary(sale); items.title = items.textContent;
      const date = document.createElement('span'); date.className = 'order-history-date'; date.textContent = orderDateTime(sale);
      const total = document.createElement('strong'); total.className = 'order-history-total'; total.textContent = `€ ${formatAmount(sale.totalOriginalPrice)}`;
      const actions = document.createElement('div'); actions.className = 'order-history-actions';
      const receipt = document.createElement('button'); receipt.type = 'button'; receipt.textContent = '▤ Receipt';
      receipt.addEventListener('click', () => printOrderReceipt(sale));
      const reprint = document.createElement('button'); reprint.type = 'button'; reprint.textContent = '⎙ Reprint';
      reprint.addEventListener('click', () => printOrderReceipt(sale));
      const done = document.createElement('span'); done.className = 'order-done'; done.textContent = 'DONE'; done.setAttribute('aria-label', 'Completed sale');
      actions.append(receipt, reprint, done);
      row.append(id, items, date, total, actions); container.append(row);
    });
  }

  function printOrderReceipt(sale) {
    const popup = window.open('about:blank', '_blank', 'width=520,height=720');
    if (!popup) {
      const error = document.getElementById('ordersError');
      error.textContent = 'Allow pop-ups for this site to print a receipt.';
      error.classList.remove('hidden'); return;
    }
    popup.opener = null;
    const escape = value => String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    const lines = (Array.isArray(sale.items) ? sale.items : []).map(item =>
      `<tr><td>${escape(item.name || item.barcode || 'Item')} × ${Number(item.quantity) || 0}</td><td>€ ${formatAmount((Number(item.originalPrice) || 0) * (Number(item.quantity) || 0))}</td></tr>`).join('');
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escape(sale.id || '')}</title><style>body{font:14px system-ui,sans-serif;max-width:380px;margin:36px auto;color:#17232b}h1{font-size:20px}p{color:#667585}table{width:100%;border-collapse:collapse}td{padding:9px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right;white-space:nowrap}.total{display:flex;justify-content:space-between;margin-top:18px;font-size:18px;font-weight:700}</style></head><body><h1>RetailFlow receipt</h1><p>Order #${escape(String(sale.id || '').slice(0, 8))}<br>${escape(orderDateTime(sale))}</p><table>${lines}</table><div class="total"><span>Total</span><span>€ ${formatAmount(sale.totalOriginalPrice)}</span></div><script>window.addEventListener('load',()=>window.print())<\/script></body></html>`);
    popup.document.close();
  }

  async function refreshSupplierDashboard() {
    const requestId = ++supplierRequestId;
    try {
      const data = await api('/api/supplier-analytics');
      if (requestId !== supplierRequestId) return;
      supplierFramePayload = data;
      supplierFrameError = null;
      if (supplierFrameReady && supplierDashboardFrame?.contentWindow) {
        supplierDashboardFrame.contentWindow.postMessage({ type: 'supplier-data', data }, location.origin);
      }
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
    } catch (error) {
      if (requestId !== supplierRequestId) return;
      supplierFramePayload = null;
      supplierFrameError = error.message;
      if (supplierFrameReady && supplierDashboardFrame?.contentWindow) {
        supplierDashboardFrame.contentWindow.postMessage({ type: 'supplier-error', message: error.message }, location.origin);
      }
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
    }
  }

  async function saveSupplierDataFromFrame(data) {
    if (supplierSaveBusy) return;
    supplierSaveBusy = true;
    try {
      const result = await api('/api/suppliers', { method: 'POST', body: JSON.stringify(data || {}) });
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      if (supplierDashboardFrame?.contentWindow) {
        supplierDashboardFrame.contentWindow.postMessage({ type: 'supplier-save-result', ok: true, supplier: result.supplier }, location.origin);
      }
    } catch (error) {
      if (supplierDashboardFrame?.contentWindow) {
        supplierDashboardFrame.contentWindow.postMessage({ type: 'supplier-save-result', ok: false, message: error.message }, location.origin);
      }
    } finally {
      supplierSaveBusy = false;
    }
  }

  async function deleteSupplierFromFrame(data) {
    if (supplierSaveBusy) return;
    supplierSaveBusy = true;
    try {
      const result = await api('/api/suppliers', { method: 'DELETE', body: JSON.stringify(data || {}) });
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      supplierDashboardFrame?.contentWindow?.postMessage({
        type: 'supplier-delete-result', ok: true, supplier: result.supplier,
      }, location.origin);
    } catch (error) {
      supplierDashboardFrame?.contentWindow?.postMessage({
        type: 'supplier-delete-result', ok: false, message: error.message,
      }, location.origin);
    } finally {
      supplierSaveBusy = false;
    }
  }

  function compactNumber(value) {
    const absolute = Math.abs(value);
    if (absolute >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
    if (absolute >= 10) return String(Math.round(value));
    if (absolute >= 1) return String(Number(value.toFixed(1)));
    return String(Number(value.toFixed(2)));
  }

  function showPosMessage(message, error = false) {
    const element = document.getElementById('posMessage');
    element.textContent = message;
    element.className = `pos-message${error ? ' error' : ''}`;
  }

  async function changePos(task, success = '') {
    if (posBusy) return;
    posBusy = true;
    renderPosCatalog();
    renderPosOrder();
    try {
      const result = await task();
      if (result?.clear) posItems = [];
      if (success || result?.message) showPosMessage(result?.message || success);
    } catch (error) {
      showPosMessage(`Order was not changed: ${error.message}`, true);
    } finally {
      posBusy = false;
      renderPosCatalog();
      renderPosOrder();
    }
  }

  async function refreshPosProducts() {
    const requestId = ++posProductRequestId;
    document.getElementById('posConnectionLabel').textContent = 'Loading products…';
    try {
      const { products } = await api('/api/inventory');
      if (requestId !== posProductRequestId) return;
      posProducts = products || [];
      posProductsReady = true;
      document.getElementById('posConnectionLabel').textContent = 'Live POS order';
      renderPosCatalog();
      renderPosOrder();
    } catch (error) {
      if (requestId !== posProductRequestId) return;
      document.getElementById('posConnectionLabel').textContent = 'Connection unavailable';
      showPosMessage(`Products are unavailable: ${error.message}`, true);
    }
  }

  function productPicture(product, className) {
    if (product?.photoDataUrl?.startsWith('data:image/jpeg;base64,')) {
      const image = document.createElement('img');
      image.className = className; image.src = product.photoDataUrl;
      image.alt = ''; return image;
    }
    const fallback = document.createElement('span');
    fallback.className = `${className} pos-product-placeholder${className === 'pos-order-thumb' ? ' placeholder' : ''}`;
    fallback.textContent = product?.name?.charAt(0).toUpperCase() || '▣';
    return fallback;
  }

  function renderPosCatalog() {
    const grid = document.getElementById('posProductGrid');
    const search = document.getElementById('posSearch').value.trim().toLowerCase();
    const products = posProducts.filter(product => (posFilter !== 'available' || Number(product.quantity) > 0) &&
      `${product.name} ${product.barcode}`.toLowerCase().includes(search));
    grid.replaceChildren();
    if (!products.length) {
      const empty = document.createElement('p'); empty.className = 'pos-empty-catalog';
      empty.textContent = posProductsReady ? 'No products match. Add stock with the phone scanner or change the search.' : 'Loading products…';
      grid.append(empty); return;
    }
    for (const product of products) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'pos-product';
      const available = Number(product.quantity) > 0;
      const priced = product.originalPrice != null && Number.isFinite(Number(product.originalPrice));
      const costed = product.hasUnitCost === true || (product.unitCost != null && Number.isFinite(Number(product.unitCost)));
      card.disabled = posBusy || !available || !priced || !costed;
      card.setAttribute('aria-label', `Add ${product.name} to the order${card.disabled ? ' (unavailable)' : ''}`);
      card.append(productPicture(product, 'pos-product-image'));
      const details = document.createElement('span'); details.className = 'pos-product-details';
      const name = document.createElement('span'); name.className = 'pos-product-name'; name.textContent = product.name;
      const price = document.createElement('span'); price.className = 'pos-product-price';
      price.textContent = priced ? formatAmount(product.originalPrice) : 'Price needed';
      const meta = document.createElement('span'); meta.className = 'pos-product-meta';
      meta.textContent = !available ? 'Out of stock' : !priced ? 'Set selling price in Finance'
        : !costed ? 'Purchase cost missing' : `${Number(product.quantity).toLocaleString('en-US')} in stock · Tap to add`;
      details.append(name, price, meta); card.append(details);
      card.addEventListener('click', () => changePos(() => api('/api/pos/scan', {
        method: 'POST', body: JSON.stringify({ barcode: product.barcode }),
      }), `${product.name} added to the current order.`));
      grid.append(card);
    }
  }

  function renderPosOrder() {
    const container = document.getElementById('posOrderItems');
    container.replaceChildren();
    const count = posItems.reduce((sum, item) => sum + Number(item.quantity), 0);
    document.getElementById('posItemCount').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
    document.getElementById('posClearButton').disabled = !count || posBusy;
    if (!posItems.length) {
      const empty = document.createElement('div'); empty.className = 'pos-order-empty';
      empty.innerHTML = 'No items added yet.<br>Scan on your phone or tap a product.';
      container.append(empty);
    }
    let cents = 0, incomplete = false;
    for (const item of posItems) {
      const product = posProducts.find(candidate => candidate.barcode === item.barcode);
      const price = product?.originalPrice;
      const validPrice = price != null && Number.isFinite(Number(price)) && Number(price) >= 0;
      const validCost = product?.unitCost != null && Number.isFinite(Number(product.unitCost));
      const enough = product && Number(product.quantity) >= Number(item.quantity);
      if (!validPrice || !validCost || !enough) incomplete = true;
      else cents += Math.round(Number(price) * 100) * Number(item.quantity);
      const row = document.createElement('div'); row.className = 'pos-order-item';
      row.append(productPicture(product, 'pos-order-thumb'));
      const content = document.createElement('div');
      const name = document.createElement('strong'); name.className = 'pos-order-name'; name.textContent = product?.name || item.barcode;
      const detail = document.createElement('span'); detail.className = 'pos-order-detail';
      detail.textContent = !product ? 'Product unavailable' : !validPrice ? 'Set selling price in Finance'
        : !validCost ? 'Purchase cost missing' : !enough ? 'Not enough stock' : `${formatAmount(price)} each`;
      content.append(name, detail); row.append(content);
      const linePrice = document.createElement('strong'); linePrice.className = 'pos-order-price';
      linePrice.textContent = validPrice ? formatAmount(Math.round(Number(price) * 100) * Number(item.quantity) / 100) : '—';
      row.append(linePrice);
      const quantity = document.createElement('div'); quantity.className = 'pos-qty';
      const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−';
      minus.setAttribute('aria-label', `Remove one ${product?.name || item.barcode}`);
      minus.disabled = posBusy;
      minus.addEventListener('click', () => changePos(() => api('/api/pos/adjust', {
        method: 'POST', body: JSON.stringify({ barcode: item.barcode, delta: -1 }),
      })));
      const amount = document.createElement('span'); amount.textContent = item.quantity;
      const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+';
      plus.setAttribute('aria-label', `Add one ${product?.name || item.barcode}`);
      plus.disabled = posBusy || !enough || Number(product.quantity) <= Number(item.quantity);
      plus.addEventListener('click', () => changePos(() => api('/api/pos/scan', {
        method: 'POST', body: JSON.stringify({ barcode: item.barcode }),
      })));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pos-remove';
      remove.textContent = 'Remove'; remove.disabled = posBusy;
      remove.addEventListener('click', () => changePos(() => api('/api/pos/adjust', {
        method: 'POST', body: JSON.stringify({ barcode: item.barcode, delta: -Number(item.quantity) }),
      })));
      quantity.append(minus, amount, plus, remove); row.append(quantity); container.append(row);
    }
    const total = incomplete ? '—' : formatAmount(cents / 100);
    document.getElementById('posSubtotal').textContent = total;
    document.getElementById('posTotal').textContent = total;
    document.getElementById('posCheckoutButton').disabled = !count || incomplete || posBusy;
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
          expenseKind: financeExpenseKind,
        }),
      });
      document.getElementById('expenseForm').reset();
      document.getElementById('expensePanel').classList.add('hidden');
      await refreshFinance();
    } catch (error) {
      message.textContent = `Could not save expense: ${error.message}`;
      message.className = 'workflow-notice error';
    } finally {
      button.disabled = false;
      button.textContent = 'Save cost';
    }
  }

  async function refreshInventory() {
    const summary = document.getElementById('inventorySummary');
    const status = document.getElementById('inventoryStatus');
    status.textContent = 'Loading from Firebase…';
    try {
      const data = await api('/api/inventory');
      inventoryProducts = data.products || [];
      inventoryCategories = data.categories || [];
      const units = inventoryProducts.reduce((sum, product) => sum + Number(product.quantity || 0), 0);
      summary.textContent = `${inventoryProducts.length} products · ${units.toLocaleString()} units`;
      status.textContent = 'Synced from Firebase';
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      renderInventoryTable();
      renderInventoryCategories();
      if (document.querySelector('[data-inventory-view="analytics"]')?.classList.contains('active')) {
        void refreshInventoryAnalytics();
      }
    } catch (error) {
      inventoryProducts = [];
      summary.textContent = 'Inventory unavailable';
      status.textContent = error.message;
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
      renderInventoryTable();
    }
  }

  async function refreshInventoryAnalytics() {
    const frame = document.getElementById('inventoryAnalyticsFrame');
    if (frame) frame.src = `./inventory-analytics.html?refresh=${Date.now()}`;
  }

  function showInventoryAction(message, error = false) {
    const notice = document.getElementById('inventoryActionMessage');
    notice.textContent = message;
    notice.className = `inventory-action-message${error ? ' error' : ''}`;
  }

  function showCategoryDialogMessage(message) {
    categoryDialogMessage.textContent = message;
    categoryDialogMessage.classList.remove('hidden');
  }

  function openInventoryCategoryDialog(product) {
    categoryProduct = product;
    document.getElementById('inventoryCategoryProductName').textContent = `${product.name} · ${product.barcode}`;
    document.getElementById('createCategoryFields').classList.add('hidden');
    document.getElementById('existingCategoryFields').classList.add('hidden');
    document.getElementById('newInventoryCategoryName').value = '';
    categoryDialogMessage.classList.add('hidden');
    categoryDialog.showModal();
  }

  function renderInventoryCategories() {
    const hasUncategorized = inventoryProducts.some(product => !product.category);
    const categories = ['All products', ...inventoryCategories, ...(hasUncategorized ? ['Uncategorized'] : [])];
    if (!categories.includes(activeInventoryCategory)) activeInventoryCategory = 'All products';
    categoryFilters.replaceChildren(...categories.map(category => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'inventory-category-filter';
      button.textContent = category;
      button.setAttribute('aria-pressed', String(category === activeInventoryCategory));
      button.classList.toggle('active', category === activeInventoryCategory);
      button.addEventListener('click', () => { activeInventoryCategory = category; renderInventoryCategories(); });
      return button;
    }));

    const query = categorySearch.value.trim().toLocaleLowerCase();
    const products = inventoryProducts.filter(product => {
      const inCategory = activeInventoryCategory === 'All products' ||
        (activeInventoryCategory === 'Uncategorized' ? !product.category : product.category === activeInventoryCategory);
      const matchesQuery = `${product.name} ${product.barcode} ${product.supplierName}`.toLocaleLowerCase().includes(query);
      return inCategory && matchesQuery;
    });
    categoryProducts.replaceChildren();
    if (!products.length) {
      const empty = document.createElement('p'); empty.className = 'inventory-category-empty';
      empty.textContent = inventoryProducts.length ? 'No products match this category and search.' : 'No inventory products found.';
      categoryProducts.append(empty); return;
    }

    const formatInventoryDate = value => {
      if (!value) return '—';
      const date = new Date(`${value}T00:00:00`);
      return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
    };
    for (const product of products) {
      const card = document.createElement('article'); card.className = 'inventory-category-product';
      const media = document.createElement('div'); media.className = 'inventory-category-product-media';
      if (product.photoDataUrl?.startsWith('data:image/')) {
        const image = document.createElement('img'); image.src = product.photoDataUrl; image.alt = product.name;
        media.append(image);
      } else {
        const placeholder = document.createElement('div'); placeholder.className = 'inventory-category-product-placeholder';
        placeholder.textContent = product.name.slice(0, 1).toLocaleUpperCase(); media.append(placeholder);
      }
      const stock = document.createElement('span'); stock.className = 'inventory-category-stock';
      stock.textContent = `${Number(product.quantity || 0).toLocaleString()} Stock`; media.append(stock);
      const details = document.createElement('div'); details.className = 'inventory-category-product-details';
      const name = document.createElement('h3'); name.textContent = product.name;
      const facts = document.createElement('div'); facts.className = 'inventory-category-facts';
      for (const [label, value] of [
        ['Supplier', product.supplierName || '—'],
        ['Manufacture date', formatInventoryDate(product.manufactureDate)],
        ['Expiry date', formatInventoryDate(product.expiryDate)],
      ]) {
        const fact = document.createElement('p');
        const caption = document.createElement('span'); caption.textContent = label;
        const content = document.createElement('strong'); content.textContent = value;
        fact.append(caption, content); facts.append(fact);
      }
      details.append(name, facts); card.append(media, details); categoryProducts.append(card);
    }
  }

  async function createAndAssignInventoryCategory() {
    const name = document.getElementById('newInventoryCategoryName').value.trim();
    if (!name || !categoryProduct) return showCategoryDialogMessage('Enter a category name first.');
    if (inventoryCategories.some(category => category.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return showCategoryDialogMessage('That category already exists. Choose “Add to an existing category” instead.');
    }
    const button = document.getElementById('saveNewInventoryCategory');
    button.disabled = true; button.textContent = 'Saving…';
    try {
      await api('/api/inventory/category', { method: 'PATCH', body: JSON.stringify({ barcode: categoryProduct.barcode, category: name }) });
      categoryDialog.close(); await refreshInventory();
      showInventoryAction(`${categoryProduct.name} added to ${name}.`);
    } catch (error) { showCategoryDialogMessage(error.message); }
    finally { button.disabled = false; button.textContent = 'Create and assign'; }
  }

  async function assignInventoryCategory() {
    const category = document.getElementById('existingInventoryCategory').value;
    if (!category || !categoryProduct) return showCategoryDialogMessage('Create a category before assigning products.');
    const button = document.getElementById('assignExistingInventoryCategory');
    button.disabled = true; button.textContent = 'Saving…';
    try {
      await api('/api/inventory/category', { method: 'PATCH', body: JSON.stringify({ barcode: categoryProduct.barcode, category }) });
      categoryDialog.close(); await refreshInventory();
      showInventoryAction(`${categoryProduct.name} added to ${category}.`);
    } catch (error) { showCategoryDialogMessage(error.message); }
    finally { button.disabled = false; button.textContent = 'Assign category'; }
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

  let inventoryMeterId = 0;
  function createInventoryMeter(quantityValue) {
    const quantity = Number(quantityValue) || 0;
    const isLow = quantity <= 5;
    const cell = document.createElement('td');
    cell.className = 'inventory-stock-cell';
    const meter = document.createElement('div');
    meter.className = 'inventory-stock-meter';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 68');
    svg.setAttribute('aria-hidden', 'true');
    const gradientId = `stockMeterGradient-${++inventoryMeterId}`;
    svg.innerHTML = `<defs><linearGradient id="${gradientId}" x1="0" x2="1"><stop offset="0" stop-color="#ef5350"/><stop offset=".5" stop-color="#f5c542"/><stop offset="1" stop-color="#31c48d"/></linearGradient></defs><path class="stock-track" d="M12 61 A48 48 0 0 1 108 61"/><path class="stock-band" style="stroke:url(#${gradientId})" d="M12 61 A48 48 0 0 1 108 61"/>`;
    const pointer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pointer.setAttribute('class', 'stock-pointer');
    const markerRatio = Math.min(1, quantity / 20);
    const angle = Math.PI * (1 - markerRatio);
    pointer.setAttribute('cx', String(60 + 48 * Math.cos(angle)));
    pointer.setAttribute('cy', String(61 - 48 * Math.sin(angle)));
    pointer.setAttribute('r', '6');
    svg.append(pointer);
    const value = document.createElement('strong');
    value.textContent = quantity.toLocaleString();
    const status = document.createElement('small');
    status.textContent = isLow ? 'Low stock' : 'Healthy';
    meter.append(svg, value, status);
    cell.append(meter);
    return cell;
  }

  function renderInventoryTable() {
    const query = inventorySearch.value.trim().toLowerCase();
    const products = inventoryProducts.filter(product => `${product.name} ${product.barcode} ${product.supplierName} ${product.category}`.toLowerCase().includes(query));
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
      const quantity = createInventoryMeter(product.quantity);
      const price = document.createElement('td'); price.textContent = product.originalPrice == null ? 'Set at first sale' : formatAmount(product.originalPrice);
      const arrival = document.createElement('td'); arrival.textContent = product.arrivalDate || '—';
      const supplier = document.createElement('td'); supplier.textContent = product.supplierName || '—';
      const action = document.createElement('td');
      const actionButtons = document.createElement('div'); actionButtons.className = 'inventory-row-actions';
      const addCategory = document.createElement('button');
      addCategory.type = 'button'; addCategory.className = 'inventory-action-button';
      addCategory.textContent = product.category ? 'Change category' : 'Add category';
      addCategory.addEventListener('click', () => openInventoryCategoryDialog(product));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'inventory-delete'; remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${product.name} from inventory`);
      remove.addEventListener('click', () => { void deleteInventoryProduct(product, remove); });
      actionButtons.append(addCategory, remove); action.append(actionButtons);
      row.append(name, barcode, quantity, price, arrival, supplier, action);
      inventoryTableBody.append(row);
    });
  }

  async function refreshFinance() {
    const requestId = ++financeRequestId;
    try {
      syncFinanceControls();
      const query = new URLSearchParams({ period: financePeriod, anchor: financeAnchor });
      const data = await api(`/api/finance?${query}`);
      if (requestId !== financeRequestId) return;
      financeProducts = data.products;
      financeStats = data;
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

  function showFinanceDelta(id, current, previous, { cost = false } = {}) {
    const element = document.getElementById(id);
    if (current == null || previous == null || !financeStats?.comparisonLabel) {
      element.textContent = current == null ? 'Current amount unavailable' : 'Previous period unavailable';
      element.className = 'finance-delta unknown';
      return;
    }
    const delta = Math.round((current - previous) * 100) / 100;
    element.textContent = `${delta > 0 ? '↑ +' : delta < 0 ? '↓ −' : '— '}${formatAmount(Math.abs(delta))} ${financeStats.comparisonLabel}`;
    element.className = `finance-delta ${delta === 0 ? 'flat' : cost ? (delta > 0 ? 'cost-up' : 'cost-down') : delta > 0 ? 'good' : 'bad'}`;
  }

  function renderFinanceTrend(data = financeStats) {
    const svg = document.getElementById('financeTrendChart');
    const empty = document.getElementById('financeTrendEmpty');
    const chart = data?.trend || [];
    const series = [
      ['costs', 'Costs', '#4278d0'],
      ['productPurchases', 'Product purchases', '#e87518'],
      ['grossProfit', 'Gross profit', '#17a552'],
      ['netProfit', 'Net profit', '#8565c9'],
    ];
    svg.replaceChildren();
    const values = chart.flatMap(point => series.map(([key]) => point[key]))
      .filter(value => value != null && Number.isFinite(Number(value))).map(Number);
    empty.classList.toggle('hidden', values.length > 0);
    if (!chart.length || !values.length) return;

    const left = 62, right = 850, top = 25, bottom = 260;
    let minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
    if (minimum === maximum) maximum = minimum + 1;
    const padding = (maximum - minimum) * .1;
    if (minimum < 0) minimum -= padding;
    maximum += padding;
    const y = value => bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
    const x = index => chart.length === 1 ? (left + right) / 2 : left + index * (right - left) / (chart.length - 1);
    for (let tick = 0; tick < 5; tick++) {
      const gridY = top + tick * (bottom - top) / 4;
      svg.append(svgNode('line', { x1: left, y1: gridY, x2: right, y2: gridY,
        stroke: '#e8edf0', 'stroke-width': 1 }));
      const label = svgNode('text', { x: left - 10, y: gridY + 4, 'text-anchor': 'end',
        fill: '#95a1ad', 'font-size': 12 });
      label.textContent = compactNumber(maximum - tick * (maximum - minimum) / 4);
      svg.append(label);
    }
    if (minimum <= 0 && maximum >= 0) {
      svg.append(svgNode('line', { x1: left, y1: y(0), x2: right, y2: y(0),
        stroke: '#cbd4dc', 'stroke-width': 1.5 }));
    }
    const runsFor = key => {
      const runs = []; let run = [];
      chart.forEach((point, index) => {
        const value = point[key];
        if (value == null || !Number.isFinite(Number(value))) {
          if (run.length) runs.push(run);
          run = [];
        } else run.push({ x: x(index), y: y(Number(value)) });
      });
      if (run.length) runs.push(run);
      return runs;
    };
    series.forEach(([key, label, color]) => {
      const runs = runsFor(key);
      runs.forEach(run => svg.append(svgNode('path', { d: smoothOverviewPath(run), fill: 'none',
        stroke: color, 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
      chart.forEach((point, index) => {
        const value = point[key];
        if (value == null || !Number.isFinite(Number(value))) return;
        const dot = svgNode('circle', { cx: x(index), cy: y(Number(value)), r: index === chart.length - 1 ? 4.5 : 3,
          fill: color, tabindex: 0 });
        const title = svgNode('title'); title.textContent = `${point.label} ${label}: ${formatAmount(value)}`;
        dot.append(title); svg.append(dot);
      });
    });
    chart.forEach((point, index) => {
      const label = svgNode('text', { x: x(index), y: 292, 'text-anchor': 'middle', fill: '#a7b5c3',
        'font-size': 12 });
      label.textContent = point.label;
      svg.append(label);
    });
    svg.setAttribute('aria-label', `Finance trend for ${data?.trendSubtitle || 'selected period'}`);
  }

  function renderFinanceSummary() {
    const suffix = financePeriod[0].toUpperCase() + financePeriod.slice(1);
    document.getElementById('financeCostsTitle').textContent = `Costs · ${suffix}`;
    document.getElementById('financePurchasesTitle').textContent = `Product purchases · ${suffix}`;
    document.getElementById('financeGrossTitle').textContent = `Gross profit · ${suffix}`;
    document.getElementById('financeNetTitle').textContent = `Net profit · ${suffix}`;
    document.getElementById('financePeriodText').textContent = periodName(financePeriod, financeAnchor);
    document.getElementById('financeTrendSubtitle').textContent = financeStats?.trendSubtitle || 'Finance movement for selected period';
    const metrics = financeStats?.metrics || {};
    const costs = metrics.costs;
    document.getElementById('financeMonthlyTotal').textContent = costs == null ? 'Unavailable' : formatAmount(costs);
    const purchased = metrics.productPurchases;
    document.getElementById('financeProductPurchases').textContent = purchased == null ? 'Unavailable' : formatAmount(purchased);
    const gross = metrics.grossProfit;
    document.getElementById('financeMonthlyGross').textContent = gross == null ? 'Unavailable' : formatAmount(gross);
    const net = metrics.netProfit;
    document.getElementById('financeMonthlyNet').textContent = net == null ? 'Unavailable' : formatAmount(net);
    const previous = financeStats?.previousMetrics;
    showFinanceDelta('financeFixedDelta', costs, previous?.costs, { cost: true });
    showFinanceDelta('financePurchaseDelta', purchased, previous?.productPurchases, { cost: true });
    showFinanceDelta('financeGrossDelta', gross, previous?.grossProfit);
    showFinanceDelta('financeNetDelta', net, previous?.netProfit);
    renderFinanceTrend();
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

  function stopLiveData() {
    stopRetailListener(); stopRetailListener = () => {};
    stopPosListener(); stopPosListener = () => {};
    listenersStarted = false;
  }

  function startLiveData(role) {
    if (listenersStarted) return;
    listenersStarted = true;
    const cashier = role === 'cashier';
    document.querySelectorAll('[data-view="dashboard"], [data-view="orders"], [data-view="inventory"], [data-view="suppliers"], [data-view="finance"]').forEach(button => {
      button.classList.toggle('hidden', cashier);
    });
    if (!cashier) {
      stopRetailListener = watchRetailFlow(() => {
        setDatabaseStatus(true, 'FIREBASE CONNECTED');
        if (currentView === 'dashboard') void refreshDashboard();
        if (currentView === 'orders') void refreshOrderAnalytics();
        if (currentView === 'suppliers') void refreshSupplierDashboard();
        if (currentView === 'inventory') void refreshInventory();
        if (currentView === 'pos') void refreshPosProducts();
        if (currentView === 'finance' && !document.activeElement?.classList.contains('finance-price-input')) void refreshFinance();
      }, error => {
        setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
        dashboardError.textContent = `Firestore is unavailable: ${error.message}`;
        dashboardError.classList.remove('hidden');
        if (currentView === 'suppliers') {
          supplierFrameError = error.message;
          if (supplierFrameReady && supplierDashboardFrame?.contentWindow) {
            supplierDashboardFrame.contentWindow.postMessage({ type: 'supplier-error', message: error.message }, location.origin);
          }
        }
      });
    }
    stopPosListener = watchPos(items => {
      posItems = items;
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      renderPosOrder();
      if (currentView === 'pos') document.getElementById('posConnectionLabel').textContent = 'Live POS order';
    }, error => {
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
      document.getElementById('posConnectionLabel').textContent = 'POS disconnected';
      showPosMessage(`Live order is unavailable: ${error.message}`, true);
    });
    syncOverviewControls();
    void setMainView(cashier ? 'pos' : 'dashboard');
  }

  hubLayout.classList.remove('hidden');
  setDatabaseStatus(false, 'FIREBASE CONNECTING');
  syncFinanceControls();
  syncOrderControls();
  setFinanceExpenseKind(financeExpenseKind);
  startLiveData('owner');
})();
