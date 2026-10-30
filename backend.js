import mysql from 'mysql2/promise';

let pool;

function getPool() {
  if (!pool) {
    const required = ['TIDB_HOST', 'TIDB_USER', 'TIDB_PASSWORD', 'TIDB_DATABASE'];
    const missing = required.filter(name => !process.env[name]);
    if (missing.length) throw new Error(`Missing server environment variables: ${missing.join(', ')}`);

    pool = mysql.createPool({
      host: process.env.TIDB_HOST,
      port: Number(process.env.TIDB_PORT || 4000),
      user: process.env.TIDB_USER,
      password: process.env.TIDB_PASSWORD,
      database: process.env.TIDB_DATABASE,
      waitForConnections: true,
      connectionLimit: 3,
      queueLimit: 0,
      enableKeepAlive: true,
      ssl: { rejectUnauthorized: true },
      timezone: 'Z',
      decimalNumbers: true,
    });
  }
  return pool;
}

function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function allowMethods(req, res, methods) {
  res.setHeader('Allow', methods.join(', '));
  if (!methods.includes(req.method)) {
    sendJson(res, 405, { error: `Use ${methods.join(' or ')}.` });
    return false;
  }
  return true;
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function fail(res, error) {
  console.error('RetailFlow API error:', error);
  const message = error?.message || 'Unexpected server error.';
  const status = error?.statusCode || 500;
  return sendJson(res, status, { error: status === 500 ? 'Database request failed. Check server configuration.' : message });
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function finiteNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw httpError(`${label} must be between ${min} and ${max}.`);
  return number;
}

function text(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw httpError(`${label} is required and must be no longer than ${maxLength} characters.`);
  }
  return value.trim();
}

function productShape(row) {
  if (!row) return null;
  return {
    barcode: row.barcode,
    name: row.name,
    quantity: Number(row.quantity),
    originalPrice: Number(row.original_price),
    unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
    arrivalDate: row.arrival_date instanceof Date ? row.arrival_date.toISOString().slice(0, 10) : String(row.arrival_date).slice(0, 10),
    supplierName: row.supplier_name,
  };
}



async function dashboardHandler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  try {
    const db = getPool();
    const [[totals]] = await db.query(`
      SELECT
        (SELECT COALESCE(SUM(total_original_price), 0) FROM sales) AS revenue,
        (SELECT COALESCE(SUM((original_price - COALESCE(unit_cost, 0)) * quantity), 0) FROM sale_items) AS grossProfit,
        (SELECT COUNT(*) FROM sale_items WHERE unit_cost IS NULL) AS missingCostData,
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory) AS inventoryUnits,
        (SELECT COALESCE(SUM(amount), 0) FROM operating_expenses) AS expenses
    `);
    const [revenueRows] = await db.query(`
      SELECT DATE(sold_at) AS day, COALESCE(SUM(total_original_price), 0) AS revenue
      FROM sales
      WHERE sold_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY DATE(sold_at)
    `);
    const [profitRows] = await db.query(`
      SELECT DATE(s.sold_at) AS day,
             COALESCE(SUM((si.original_price - COALESCE(si.unit_cost, 0)) * si.quantity), 0) AS grossProfit,
             COALESCE(SUM(CASE WHEN si.unit_cost IS NULL THEN 1 ELSE 0 END), 0) AS missingCostData,
             COALESCE(SUM(si.quantity), 0) AS unitsSold
      FROM sales s JOIN sale_items si ON si.sale_id = s.id
      WHERE s.sold_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY DATE(s.sold_at)
    `);
    const [expenseRows] = await db.query(`
      SELECT expense_date AS day, COALESCE(SUM(amount), 0) AS expenses
      FROM operating_expenses
      WHERE expense_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY expense_date
    `);
    const [receiptRows] = await db.query(`
      SELECT arrival_date AS day, COALESCE(SUM(quantity), 0) AS received
      FROM inventory_receipts
      WHERE arrival_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY arrival_date
    `);

    const today = new Date();
    const dates = [];
    for (let offset = 29; offset >= 0; offset--) {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
      dates.push(date.toISOString().slice(0, 10));
    }
    const byDay = new Map(dates.map(date => [date, { date, revenue: 0, grossProfit: 0, netProfit: 0, inventoryUnits: 0, missingCostData: false, unitsSold: 0, received: 0, expenses: 0 }]));
    for (const row of revenueRows) {
      const point = byDay.get(String(row.day).slice(0, 10));
      if (!point) continue;
      point.revenue = Number(row.revenue);
    }
    for (const row of profitRows) {
      const point = byDay.get(String(row.day).slice(0, 10));
      if (!point) continue;
      point.missingCostData = Number(row.missingCostData) > 0;
      point.grossProfit = point.missingCostData ? null : Number(row.grossProfit);
      point.unitsSold = Number(row.unitsSold);
    }
    for (const row of expenseRows) { const point = byDay.get(String(row.day).slice(0, 10)); if (point) point.expenses = Number(row.expenses); }
    for (const row of receiptRows) { const point = byDay.get(String(row.day).slice(0, 10)); if (point) point.received = Number(row.received); }

    const points = [...byDay.values()];
    let stock = Number(totals.inventoryUnits);
    for (let index = points.length - 1; index >= 0; index--) {
      points[index].inventoryUnits = stock;
      points[index].netProfit = points[index].grossProfit === null ? null : points[index].grossProfit - points[index].expenses;
      stock -= points[index].received;
      stock += points[index].unitsSold;
    }
    return sendJson(res, 200, {
      totals: {
        revenue: Number(totals.revenue),
        grossProfit: Number(totals.missingCostData) > 0 ? null : Number(totals.grossProfit),
        netProfit: Number(totals.missingCostData) > 0 ? null : Number(totals.grossProfit) - Number(totals.expenses),
        inventoryUnits: Number(totals.inventoryUnits),
        missingCostData: Number(totals.missingCostData) > 0,
      },
      points,
    });
  } catch (error) { return fail(res, error); }
}


async function inventoryHandler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  const db = getPool();
  try {
    if (req.method === 'GET') {
      const barcode = typeof req.query?.barcode === 'string' ? req.query.barcode.trim() : '';
      if (barcode) {
        const [rows] = await db.execute('SELECT barcode, name, quantity, original_price, unit_cost, arrival_date, supplier_name FROM inventory WHERE barcode = ?', [barcode]);
        return sendJson(res, 200, { product: productShape(rows[0]) });
      }
      const [rows] = await db.query('SELECT barcode, name, quantity, original_price, unit_cost, arrival_date, supplier_name FROM inventory ORDER BY updated_at DESC, name ASC');
      return sendJson(res, 200, { products: rows.map(productShape) });
    }

    const body = parseJsonBody(req);
    const barcode = text(body.barcode, 'Barcode', 128);
    const name = text(body.name, 'Product name', 200);
    const quantity = Math.floor(finiteNumber(body.quantity, 'Quantity', { min: 1, max: 2147483647 }));
    const originalPrice = finiteNumber(body.originalPrice, 'Sale price');
    const unitCost = finiteNumber(body.unitCost, 'Unit cost');
    const arrivalDate = body.arrivalDate;
    if (!validDate(arrivalDate)) throw httpError('Arrival date must be a valid YYYY-MM-DD date.');
    const supplierName = text(body.supplierName, 'Supplier name', 200);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`
        INSERT IGNORE INTO inventory (barcode, name, quantity, original_price, unit_cost, arrival_date, supplier_name)
        VALUES (?, ?, 0, ?, NULL, ?, ?)
      `, [barcode, name, originalPrice, arrivalDate, supplierName]);
      const [existingRows] = await connection.execute('SELECT barcode, name, quantity, original_price, unit_cost FROM inventory WHERE barcode = ? FOR UPDATE', [barcode]);
      const existing = existingRows[0];
      if (!existing) throw new Error('Could not create inventory record.');
      const oldQuantity = Number(existing.quantity);
      const nextQuantity = oldQuantity + quantity;
      const averageCost = existing.unit_cost === null || oldQuantity === 0
        ? unitCost
        : ((Number(existing.unit_cost) * oldQuantity) + (unitCost * quantity)) / nextQuantity;
      await connection.execute(`
        UPDATE inventory
        SET name = ?, quantity = ?, unit_cost = ?, arrival_date = ?, supplier_name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE barcode = ?
      `, [name, nextQuantity, averageCost, arrivalDate, supplierName, barcode]);
      const [receiptResult] = await connection.execute(`
        INSERT INTO inventory_receipts (barcode, product_name, quantity, original_price, unit_cost, arrival_date, supplier_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [barcode, name, quantity, Number(existing.original_price), unitCost, arrivalDate, supplierName]);
      await connection.commit();
      const [rows] = await db.execute('SELECT barcode, name, quantity, original_price, unit_cost, arrival_date, supplier_name FROM inventory WHERE barcode = ?', [barcode]);
      return sendJson(res, 201, { product: productShape(rows[0]), receipt: { id: String(receiptResult.insertId), quantity, supplierName, arrivalDate } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  } catch (error) { return fail(res, error); }
}


async function salesHandler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  try {
    const body = parseJsonBody(req);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 200) throw httpError('Add between 1 and 200 products to the cart.');
    const quantities = new Map();
    for (const item of body.items) {
      if (typeof item?.barcode !== 'string' || !item.barcode.trim() || item.barcode.trim().length > 128) throw httpError('Each sale item needs a valid barcode.');
      const barcode = item.barcode.trim();
      const quantity = Math.floor(finiteNumber(item.quantity, 'Item quantity', { min: 1, max: 2147483647 }));
      quantities.set(barcode, (quantities.get(barcode) || 0) + quantity);
    }
    const db = getPool();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const items = [];
      for (const barcode of [...quantities.keys()].sort()) {
        const [rows] = await connection.execute('SELECT barcode, name, quantity, original_price, unit_cost FROM inventory WHERE barcode = ? FOR UPDATE', [barcode]);
        const product = rows[0];
        const quantity = quantities.get(barcode);
        if (!product) throw httpError(`Barcode ${barcode} is not in inventory.`, 409);
        if (Number(product.quantity) < quantity) throw httpError(`Only ${product.quantity} ${product.name} in stock.`, 409);
        if (product.unit_cost === null) throw httpError(`Purchase cost is missing for ${product.name}. Receive it with a unit cost before selling.`, 409);
        items.push({ ...product, quantity });
      }
      const totalCents = items.reduce((sum, item) => sum + Math.round(Number(item.original_price) * 100) * item.quantity, 0);
      const total = totalCents / 100;
      const [saleResult] = await connection.execute('INSERT INTO sales (total_original_price) VALUES (?)', [total]);
      for (const item of items) {
        await connection.execute(`
          INSERT INTO sale_items (sale_id, barcode, product_name, quantity, original_price, unit_cost)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [saleResult.insertId, item.barcode, item.name, item.quantity, item.original_price, item.unit_cost]);
        await connection.execute('UPDATE inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE barcode = ?', [item.quantity, item.barcode]);
      }
      await connection.commit();
      return sendJson(res, 201, { sale: { id: String(saleResult.insertId), totalOriginalPrice: total } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  } catch (error) { return fail(res, error); }
}


async function expensesHandler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  try {
    const body = parseJsonBody(req);
    const title = text(body.title, 'Expense title', 200);
    const amount = finiteNumber(body.amount, 'Expense amount');
    if (!validDate(body.expenseDate)) throw httpError('Expense date must be a valid YYYY-MM-DD date.');
    const [result] = await getPool().execute('INSERT INTO operating_expenses (title, amount, expense_date) VALUES (?, ?, ?)', [title, amount, body.expenseDate]);
    return sendJson(res, 201, { expense: { id: String(result.insertId), title, amount, expenseDate: body.expenseDate } });
  } catch (error) { return fail(res, error); }
}


export default async function handler(req, res) {
  const endpoint = String(req.query?.route || '').split('/').filter(Boolean).pop();
  if (endpoint === 'dashboard') return dashboardHandler(req, res);
  if (endpoint === 'inventory') return inventoryHandler(req, res);
  if (endpoint === 'sales') return salesHandler(req, res);
  if (endpoint === 'expenses') return expensesHandler(req, res);
  return sendJson(res, 404, { error: 'API endpoint not found.' });
}
