import { api, watchRetailFlow } from './firebase-store.js';

(() => {
  const dashboardScreen = document.getElementById('dashboardScreen');
  const inventoryScreen = document.getElementById('inventoryScreen');
  const connectionStatus = document.getElementById('connectionStatus');
  const dashboardError = document.getElementById('dashboardError');
  const inventoryTableBody = document.getElementById('inventoryTableBody');
  const inventoryEmpty = document.getElementById('inventoryEmpty');
  const inventorySearch = document.getElementById('inventorySearch');
  let currentView = 'dashboard';
  let inventoryProducts = [];

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
  function todayLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  async function setMainView(view) {
    currentView = view;
    dashboardScreen.classList.toggle('hidden', view !== 'dashboard');
    inventoryScreen.classList.toggle('hidden', view !== 'inventory');
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    if (view === 'dashboard') await refreshDashboard();
    if (view === 'inventory') await refreshInventory();
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
    dashboardError.classList.add('hidden');
    document.getElementById('dashboardUpdated').textContent = 'Updating…';
    try {
      const data = await api('/api/dashboard');
      setDatabaseStatus(true, 'FIREBASE CONNECTED');
      document.getElementById('revenueTotal').textContent = formatAmount(data.totals.revenue);
      document.getElementById('grossProfitTotal').textContent = formatAmount(data.totals.grossProfit);
      document.getElementById('netProfitTotal').textContent = formatAmount(data.totals.netProfit);
      document.getElementById('inventoryUnitsTotal').textContent = Number(data.totals.inventoryUnits || 0).toLocaleString();
      const profitNotice = document.getElementById('profitDataNotice');
      if (data.totals.missingCostData) {
        profitNotice.textContent = 'Profit totals are unavailable because earlier sales have no recorded purchase cost. New receipts and sales will calculate profit.';
        profitNotice.classList.remove('hidden');
      } else {
        profitNotice.classList.add('hidden');
      }
      drawMetricsChart(data.points || []);
      document.getElementById('dashboardUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
      document.getElementById('dashboardUpdated').textContent = 'Waiting for database';
      dashboardError.textContent = `Dashboard data is not available: ${error.message}. Check firebase-config.js and Firestore test mode.`;
      dashboardError.classList.remove('hidden');
      drawMetricsChart([]);
    }
  }

  function drawMetricsChart(points) {
    const svg = document.getElementById('metricsChart');
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs = {}) => {
      const element = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
      return element;
    };
    svg.replaceChildren();
    if (!points.length) {
      const empty = make('text', { x: 460, y: 150, 'text-anchor': 'middle', class: 'chart-axis-label' });
      empty.textContent = 'Firestore data will show your sales and inventory trend.';
      svg.append(empty);
      return;
    }
    const left = 58, right = 854, top = 22, bottom = 256;
    const moneyValues = points.flatMap(point => [point.revenue, point.grossProfit, point.netProfit]).filter(Number.isFinite);
    let moneyMin = Math.min(0, ...moneyValues), moneyMax = Math.max(0, ...moneyValues);
    if (moneyMax === moneyMin) moneyMax = moneyMin + 1;
    const moneyPad = (moneyMax - moneyMin) * 0.08;
    moneyMin -= moneyPad; moneyMax += moneyPad;
    const stockMin = Math.min(0, ...points.map(point => point.inventoryUnits));
    let stockMax = Math.max(0, ...points.map(point => point.inventoryUnits));
    if (stockMax === stockMin) stockMax = stockMin + 1;
    const x = index => left + (points.length === 1 ? 0 : (right - left) * index / (points.length - 1));
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
      { key: 'netProfit', color: '#527cdb', scale: moneyY },
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
    });
    [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach(index => {
      const date = new Date(`${points[index].date}T00:00:00`);
      const label = make('text', { x: x(index), y: 285, 'text-anchor': 'middle', class: 'chart-axis-label' });
      label.textContent = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      svg.append(label);
    });
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

  function renderInventoryTable() {
    const query = inventorySearch.value.trim().toLowerCase();
    const products = inventoryProducts.filter(product => `${product.name} ${product.barcode} ${product.supplierName}`.toLowerCase().includes(query));
    inventoryTableBody.replaceChildren();
    inventoryEmpty.classList.toggle('hidden', products.length > 0);
    if (!products.length) return;
    products.forEach(product => {
      const row = document.createElement('tr');
      const name = document.createElement('td'); const nameText = document.createElement('strong'); nameText.textContent = product.name; name.append(nameText);
      const barcode = document.createElement('td'); barcode.textContent = product.barcode;
      const quantity = document.createElement('td'); quantity.textContent = Number(product.quantity).toLocaleString();
      const price = document.createElement('td'); price.textContent = formatAmount(product.originalPrice);
      const arrival = document.createElement('td'); arrival.textContent = product.arrivalDate || '—';
      const supplier = document.createElement('td'); supplier.textContent = product.supplierName || '—';
      row.append(name, barcode, quantity, price, arrival, supplier);
      inventoryTableBody.append(row);
    });
  }

  watchRetailFlow(() => {
    if (currentView === 'dashboard') void refreshDashboard();
    if (currentView === 'inventory') void refreshInventory();
  }, error => {
    setDatabaseStatus(false, 'FIREBASE DISCONNECTED');
    dashboardError.textContent = `Firestore is unavailable: ${error.message}`;
    dashboardError.classList.remove('hidden');
  });
  void setMainView('dashboard');
})();
