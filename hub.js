import { api, watchPos, watchRetailFlow } from './firebase-store.js';

(() => {
  const dashboardScreen = document.getElementById('dashboardScreen');
  const inventoryScreen = document.getElementById('inventoryScreen');
  const posScreen = document.getElementById('posScreen');
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
  const trendMetric = document.getElementById('trendMetric');
  let { from: trendFrom, to: trendTo } = lastMonthRange();
  let calendarTarget = null;
  let calendarMonthDate = null;
  let chartPoints = [];
  let comparisonPoints = [];
  let comparisonRange = null;
  let currentPointIndex = -1;
  let dashboardRequestId = 0;
  let currentView = 'dashboard';
  let inventoryProducts = [];
  let financeProducts = [];
  let financePlan = null;
  let financeStats = null;
  let financePlanDirty = false;
  let financeRequestId = 0;
  let posProducts = [];
  let posItems = [];
  let posFilter = 'all';
  let posPayment = 'cash';
  let posBusy = false;
  let posProductsReady = false;
  let posProductRequestId = 0;

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
    ({ from: trendFrom, to: trendTo } = lastMonthRange());
    trendRangeError.classList.add('hidden');
    closeCalendar();
    showTrendRange();
    void refreshDashboard();
  });
  trendMetric.addEventListener('change', () => drawMetricsChart(chartPoints, comparisonRange));
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
    posScreen.classList.toggle('hidden', view !== 'pos');
    financeScreen.classList.toggle('hidden', view !== 'finance');
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    if (view === 'dashboard') await refreshDashboard();
    if (view === 'inventory') await refreshInventory();
    if (view === 'pos') await refreshPosProducts();
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
        'Cash basis: gross less monthly bills and one-time expenses';
      document.getElementById('inventoryUnitsTotal').textContent = Number(data.totals.inventoryUnits || 0).toLocaleString();
      const profitNotice = document.getElementById('profitDataNotice');
      profitNotice.textContent = data.totals.missingCostData
        ? 'Some older sales have no purchase cost, so all-time gross profit is unavailable.'
        : 'Net profit uses cash after bills, including the full mortgage payment. Monthly bills appear on the first day; past periods need a saved monthly plan.';
      profitNotice.classList.remove('hidden');
      drawMetricsChart(data.points || [], data.comparison);
      document.getElementById('dashboardUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      if (requestId !== dashboardRequestId) return;
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
      document.getElementById('dashboardUpdated').textContent = 'Waiting for database';
      dashboardError.textContent = `Dashboard data is not available: ${error.message}. Check firebase-config.js and Firestore rules.`;
      dashboardError.classList.remove('hidden');
      drawMetricsChart([], null);
    }
  }

  function drawMetricsChart(points, comparison) {
    chartPoints = points;
    comparisonPoints = comparison?.points || [];
    comparisonRange = comparison;
    currentPointIndex = -1;
    const metric = trendMetric.value;
    const stockMetric = metric === 'inventoryUnits';
    const metricLabel = trendMetric.selectedOptions[0].textContent;
    document.getElementById('profitDataNotice').classList.toggle('hidden',
      metric !== 'netProfit' && !(metric === 'grossProfit' && points.some(point => point.missingCostData)));
    const isLastMonth = trendFrom === lastMonthRange().from && trendTo === lastMonthRange().to;
    const selectedLabel = isLastMonth ? 'Last month' : comparison?.wholeMonth ? 'Selected month' : 'Selected dates';
    const previousLabel = comparison?.wholeMonth ? 'Previous month' : 'Previous dates';
    document.getElementById('selectedPeriodLabel').textContent = selectedLabel;
    document.getElementById('previousPeriodLabel').textContent = previousLabel;
    document.getElementById('selectedPeriodDates').textContent = `${englishDate(trendFrom)} – ${englishDate(trendTo)}`;
    document.getElementById('previousPeriodDates').textContent = comparison
      ? `${englishDate(comparison.from)} – ${englishDate(comparison.to)}` : '';
    const total = entries => {
      if (!entries.length || entries.some(entry => entry[metric] == null || !Number.isFinite(Number(entry[metric])))) return null;
      return stockMetric ? Number(entries.at(-1)[metric])
        : entries.reduce((sum, entry) => sum + Number(entry[metric]), 0);
    };
    const displayTotal = value => value == null ? 'Unavailable'
      : stockMetric ? `${Number(value).toLocaleString('en-US')} units` : formatAmount(value);
    document.getElementById('selectedPeriodValue').textContent = displayTotal(total(points));
    document.getElementById('previousPeriodValue').textContent = displayTotal(total(comparisonPoints));
    metricsChart.setAttribute('aria-label', `${metricLabel}: ${selectedLabel} versus ${previousLabel} area chart`);
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs = {}) => {
      const element = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
      return element;
    };
    metricsChart.replaceChildren();
    if (!points.length) {
      chartDayDetails.textContent = 'No trend data for these dates.';
      const empty = make('text', { x: 460, y: 150, 'text-anchor': 'middle', class: 'chart-axis-label' });
      empty.textContent = 'Firestore data will show your period comparison.';
      metricsChart.append(empty);
      return;
    }
    const left = 58, right = 874, top = 22, bottom = 256;
    const values = [...points, ...comparisonPoints].map(point => point[metric])
      .filter(value => value != null && Number.isFinite(Number(value))).map(Number);
    if (!values.length) {
      const empty = make('text', { x: 460, y: 150, 'text-anchor': 'middle', class: 'chart-axis-label' });
      empty.textContent = metric === 'netProfit'
        ? 'Save monthly costs for these months to see net profit.'
        : 'No values are available for this comparison.';
      metricsChart.append(empty);
      chartDayDetails.textContent = 'Data is unavailable for these dates.';
      return;
    }
    let min = Math.min(0, ...values), max = Math.max(0, ...values);
    if (min === max) max = min + 1;
    const pad = (max - min) * 0.08;
    if (min < 0) min -= pad;
    if (max > 0) max += pad;
    const x = index => points.length === 1 ? (left + right) / 2 : left + (right - left) * index / (points.length - 1);
    const seriesX = (index, count) => count === 1 ? (left + right) / 2 : left + (right - left) * index / (count - 1);
    const yFor = value => bottom - (value - min) / (max - min) * (bottom - top);
    const zeroY = yFor(0);
    const format = value => Number(value.toFixed(1));
    // Monotone cubic curves pass through recorded points without overshooting
    // peaks, dips, or a flat run of zero sales.
    const smoothPath = coordinates => {
      if (!coordinates.length) return '';
      let path = `M ${format(coordinates[0].x)} ${format(coordinates[0].y)}`;
      if (coordinates.length === 1) return path;
      const slopes = coordinates.slice(1).map((point, index) =>
        (point.y - coordinates[index].y) / (point.x - coordinates[index].x));
      const tangents = coordinates.map((_, index) => {
        if (index === 0) return slopes[0];
        if (index === coordinates.length - 1) return slopes.at(-1);
        const before = slopes[index - 1], after = slopes[index];
        if (before * after <= 0) return 0;
        const previousWidth = coordinates[index].x - coordinates[index - 1].x;
        const nextWidth = coordinates[index + 1].x - coordinates[index].x;
        const w1 = 2 * nextWidth + previousWidth, w2 = nextWidth + 2 * previousWidth;
        return (w1 + w2) / (w1 / before + w2 / after);
      });
      for (let index = 1; index < coordinates.length; index++) {
        const start = coordinates[index - 1], end = coordinates[index];
        const third = (end.x - start.x) / 3;
        path += ` C ${format(start.x + third)} ${format(start.y + tangents[index - 1] * third)}` +
          ` ${format(end.x - third)} ${format(end.y - tangents[index] * third)}` +
          ` ${format(end.x)} ${format(end.y)}`;
      }
      return path;
    };
    for (let tick = 0; tick <= 4; tick++) {
      const ratio = tick / 4;
      const y = top + ratio * (bottom - top);
      metricsChart.append(make('line', { x1: left, y1: y, x2: right, y2: y, class: 'chart-grid' }));
      const value = max - ratio * (max - min);
      const leftLabel = make('text', { x: left - 9, y: y + 3, 'text-anchor': 'end', class: 'chart-axis-label' });
      leftLabel.textContent = compactNumber(value);
      metricsChart.append(leftLabel);
    }
    metricsChart.append(make('line', { x1: left, y1: bottom + 8, x2: right, y2: bottom + 8, class: 'comparison-baseline' }));
    if (points.length <= 62) points.forEach((_, index) => {
      metricsChart.append(make('line', { x1: x(index), y1: bottom + 8, x2: x(index), y2: bottom + 12,
        class: 'comparison-tick' }));
    });
    const defs = make('defs');
    [['selected', '#f5873c', '0.3'], ['previous', '#f6cbb3', '0.15']].forEach(([name, color, opacity]) => {
      const gradient = make('linearGradient', { id: `${name}-comparison-fill`, x1: '0', x2: '0', y1: '0', y2: '1' });
      gradient.append(make('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': opacity }));
      gradient.append(make('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0.01' }));
      defs.append(gradient);
    });
    metricsChart.prepend(defs);
    const series = [
      { entries: points, color: '#e87518', css: 'comparison-selected', gradient: 'selected-comparison-fill' },
      { entries: comparisonPoints, color: '#f6cbb3', css: 'comparison-previous', gradient: 'previous-comparison-fill' },
    ].map(item => {
      const runs = [];
      let run = [];
      item.entries.forEach((point, index) => {
        const value = point[metric];
        if (value == null || !Number.isFinite(Number(value))) {
          if (run.length) runs.push(run);
          run = [];
        } else run.push({ x: seriesX(index, item.entries.length), y: yFor(Number(value)) });
      });
      if (run.length) runs.push(run);
      return { ...item, runs };
    });
    // Areas sit behind both traces. Missing days break the area as well as the line.
    [...series].reverse().forEach(({ runs, gradient }) => runs.forEach(run => {
      if (run.length < 2) return;
      const start = run[0], end = run.at(-1);
      metricsChart.append(make('path', {
        d: `${smoothPath(run)} L ${format(end.x)} ${format(zeroY)} L ${format(start.x)} ${format(zeroY)} Z`,
        class: 'comparison-area', fill: `url(#${gradient})`,
      }));
    }));
    // The narrow previous trace is drawn last, so a zero period is still visible
    // when it lies exactly on top of the selected period.
    series.forEach(({ entries, color, css, runs }) => {
      runs.forEach(run => metricsChart.append(make('path', { d: smoothPath(run), class: `chart-line ${css}` })));
      const lastIndex = entries.findLastIndex(entry => entry[metric] != null && Number.isFinite(Number(entry[metric])));
      if (lastIndex !== -1) metricsChart.append(make('circle', {
        cx: seriesX(lastIndex, entries.length), cy: yFor(Number(entries[lastIndex][metric])), r: 5, fill: color,
      }));
    });
    [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].forEach(index => {
      const label = make('text', { x: x(index), y: 285, 'text-anchor': 'middle', class: 'chart-axis-label' });
      label.textContent = englishDate(points[index].date, { month: 'short', day: 'numeric', year: '2-digit' });
      metricsChart.append(label);
    });
    showChartPoint(points.length - 1);
  }

  function showChartPoint(index) {
    const point = chartPoints[index];
    if (!point || index === currentPointIndex) return;
    currentPointIndex = index;
    const metric = trendMetric.value;
    const metricLabel = trendMetric.selectedOptions[0].textContent;
    const previousIndex = comparisonPoints.length === 1 ? 0
      : Math.round(index / Math.max(chartPoints.length - 1, 1) * (comparisonPoints.length - 1));
    const previous = comparisonPoints[previousIndex];
    const displayValue = entry => !entry || entry[metric] == null ? 'Unavailable'
      : metric === 'inventoryUnits' ? `${Number(entry[metric]).toLocaleString('en-US')} units` : formatAmount(entry[metric]);
    chartDayDetails.textContent = `${metricLabel} · ${englishDate(point.date)}: ${displayValue(point)}` +
      (previous ? ` · ${englishDate(previous.date)}: ${displayValue(previous)}` : '');
  }

  function showChartPointAtPointer(event) {
    if (!chartPoints.length) return;
    const rect = metricsChart.getBoundingClientRect();
    const chartX = (event.clientX - rect.left) * 920 / rect.width;
    const index = chartPoints.length === 1 ? 0 : Math.round((chartX - 58) / (874 - 58) * (chartPoints.length - 1));
    showChartPoint(Math.max(0, Math.min(chartPoints.length - 1, index)));
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
      const costed = product.unitCost != null && Number.isFinite(Number(product.unitCost));
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

  function showFinanceDelta(id, current, previous, { cost = false } = {}) {
    const element = document.getElementById(id);
    if (current == null || previous == null || !financeStats?.comparisonMonth) {
      element.textContent = current == null ? 'Current amount unavailable' : 'Previous month unavailable';
      element.className = 'finance-delta unknown';
      return;
    }
    const delta = Math.round((current - previous) * 100) / 100;
    const month = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${financeStats.comparisonMonth}-01T12:00:00Z`));
    element.textContent = `${delta > 0 ? '↑ +' : delta < 0 ? '↓ −' : '— '}${formatAmount(Math.abs(delta))} vs ${month}`;
    element.className = `finance-delta ${delta === 0 ? 'flat' : cost ? (delta > 0 ? 'cost-up' : 'cost-down') : delta > 0 ? 'good' : 'bad'}`;
  }

  function renderFinanceSummary() {
    const fixed = financePlan?.cashCommitments ?? null;
    document.getElementById('financeMonthlyTotal').textContent = fixed == null ? 'Not entered' : formatAmount(fixed);
    const purchased = financeStats?.metrics?.productPurchases;
    document.getElementById('financeProductPurchases').textContent = purchased == null ? 'Unavailable' : formatAmount(purchased);
    const gross = financeStats?.metrics?.grossProfit;
    document.getElementById('financeMonthlyGross').textContent = gross == null ? 'Unavailable' : formatAmount(gross);
    const net = financePlan && gross != null
      ? gross - financePlan.cashCommitments - (financeStats?.monthOneTimeExpenses || 0) : null;
    document.getElementById('financeMonthlyNet').textContent = net === null ? 'Unavailable' : formatAmount(net);
    const previous = financeStats?.previousMetrics;
    showFinanceDelta('financeFixedDelta', fixed, previous?.fixedCosts, { cost: true });
    showFinanceDelta('financePurchaseDelta', purchased, previous?.productPurchases, { cost: true });
    showFinanceDelta('financeGrossDelta', gross, previous?.grossProfit);
    showFinanceDelta('financeNetDelta', net, previous?.netProfit);
    document.getElementById('financePlanStatus').textContent = financePlanDirty ? 'Unsaved monthly cost changes.'
      : !financePlan ? 'Monthly costs have not been entered. Gross profit is available; net profit is unavailable.'
        : 'Monthly costs saved. Net profit is ready on a cash basis.';
    document.getElementById('financeCashResult').textContent = !financePlan
      ? 'Gross profit is available; enter monthly costs to see net profit on a cash basis.'
      : 'Net profit = gross profit − utilities − salaries − full mortgage payment − one-time expenses. Cash basis includes loan principal and differs from formal accounting net income.';
    if (financePlan && financeStats && !financeStats.currentPlanSnapshotExists) {
      document.getElementById('financeCashResult').textContent += ' Save monthly costs once to record this month for future comparisons.';
    }
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
      if (financeStats) financeStats.currentPlanSnapshotExists = true;
      renderFinanceSummary();
      renderFinanceTable();
      showFinanceMessage('financePlanMessage', 'Monthly costs saved. Net profit has been updated.');
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
    if (currentView === 'pos') void refreshPosProducts();
    if (currentView === 'finance' && !financePlanDirty && !document.activeElement?.classList.contains('finance-price-input')) void refreshFinance();
  }, error => {
    setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
    dashboardError.textContent = `Firestore is unavailable: ${error.message}`;
    dashboardError.classList.remove('hidden');
  });
  try {
    watchPos(items => {
      posItems = items;
      renderPosOrder();
      if (currentView === 'pos') document.getElementById('posConnectionLabel').textContent = 'Live POS order';
    }, error => {
      document.getElementById('posConnectionLabel').textContent = 'POS disconnected';
      showPosMessage(`Live order is unavailable: ${error.message}`, true);
    });
  } catch (error) {
    document.getElementById('posConnectionLabel').textContent = 'POS disconnected';
    showPosMessage(`Live order is unavailable: ${error.message}`, true);
  }
  showTrendRange();
  void setMainView('dashboard');
})();
