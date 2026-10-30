-- Run this file in the PostgreSQL SQL editor. It also adds the new cost columns
-- when upgrading the earlier scanner schema.
CREATE TABLE IF NOT EXISTS inventory (
  barcode TEXT PRIMARY KEY CHECK (length(barcode) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  original_price NUMERIC(12, 2) NOT NULL CHECK (original_price >= 0),
  unit_cost NUMERIC(12, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  arrival_date DATE NOT NULL,
  supplier_name TEXT NOT NULL CHECK (length(supplier_name) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2);

CREATE TABLE IF NOT EXISTS inventory_receipts (
  id BIGSERIAL PRIMARY KEY,
  barcode TEXT NOT NULL REFERENCES inventory(barcode),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  original_price NUMERIC(12, 2) NOT NULL CHECK (original_price >= 0),
  unit_cost NUMERIC(12, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  arrival_date DATE NOT NULL,
  supplier_name TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE inventory_receipts ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2);
CREATE INDEX IF NOT EXISTS inventory_receipts_barcode_received_idx
  ON inventory_receipts (barcode, received_at DESC);

CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_original_price NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_original_price >= 0)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL REFERENCES inventory(barcode),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  original_price NUMERIC(12, 2) NOT NULL CHECK (original_price >= 0),
  unit_cost NUMERIC(12, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0)
);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2);
CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sales_sold_at_idx ON sales (sold_at DESC);

CREATE TABLE IF NOT EXISTS operating_expenses (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  expense_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operating_expenses_date_idx
  ON operating_expenses (expense_date DESC);
