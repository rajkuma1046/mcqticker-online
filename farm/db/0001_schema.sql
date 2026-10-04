-- ============================================================================
-- Farm Direct — D1 schema (migration 0001)
-- Lives in the EXISTING Cloudflare D1 database bound as `DB`
-- (mcqticker-reviews). Every table is prefixed `farm_` so it never collides
-- with the MCQ Ticker tables (e.g. the existing `users` table).
--
-- Money is stored as INTEGER paise (₹1 = 100 paise) to avoid float errors.
-- Bulk quantities are stored as INTEGER kilograms; samples as INTEGER grams.
-- CHECK constraints on inventory make overselling impossible: any UPDATE that
-- would push stock below zero fails, which rolls back the whole D1 batch.
-- ============================================================================

CREATE TABLE IF NOT EXISTS farm_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  phone         TEXT    NOT NULL UNIQUE,              -- 10-digit Indian mobile
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,                     -- pbkdf2$iter$salt$hash
  role          TEXT    NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS farm_products (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  name                      TEXT    NOT NULL,
  slug                      TEXT    NOT NULL UNIQUE,
  local_name                TEXT,
  description               TEXT    NOT NULL DEFAULT '',
  label                     TEXT    NOT NULL DEFAULT 'Raw / Unprocessed',
  price_per_kg_paise        INTEGER CHECK (price_per_kg_paise IS NULL OR price_per_kg_paise > 0),
  unit                      TEXT    NOT NULL DEFAULT 'kg',
  quantity_options          TEXT    NOT NULL DEFAULT '[1,5,10]',  -- JSON array of kg presets
  max_order_qty             INTEGER NOT NULL DEFAULT 100 CHECK (max_order_qty >= 1),
  image_url                 TEXT,
  image_alt                 TEXT,
  image_credit              TEXT,
  category                  TEXT    NOT NULL DEFAULT 'grain',
  is_available              INTEGER NOT NULL DEFAULT 1,
  is_seasonal               INTEGER NOT NULL DEFAULT 0,
  is_archived               INTEGER NOT NULL DEFAULT 0,
  sample_available          INTEGER NOT NULL DEFAULT 1,
  sample_max_quantity_grams INTEGER NOT NULL DEFAULT 200 CHECK (sample_max_quantity_grams IN (100,200)),
  sort_order                INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS farm_inventory (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id         INTEGER NOT NULL UNIQUE REFERENCES farm_products(id) ON DELETE CASCADE,
  quantity_available INTEGER NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  quantity_reserved  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved  >= 0),
  quantity_sold      INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sold      >= 0),
  sample_stock_grams INTEGER NOT NULL DEFAULT 0 CHECK (sample_stock_grams >= 0),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Audit trail for every stock movement (admin adjustments, orders, samples).
CREATE TABLE IF NOT EXISTS farm_inventory_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     INTEGER NOT NULL REFERENCES farm_products(id) ON DELETE CASCADE,
  change_type    TEXT    NOT NULL,   -- ADD_STOCK | ADJUST | ORDER_RESERVE | ORDER_CANCEL | ORDER_DELIVERED | SAMPLE_STOCK
  delta_kg       INTEGER NOT NULL DEFAULT 0,
  delta_sample_g INTEGER NOT NULL DEFAULT 0,
  reference      TEXT,
  note           TEXT,
  admin_user_id  INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS farm_delivery_areas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT    NOT NULL UNIQUE,
  city                  TEXT    NOT NULL DEFAULT 'Gwalior',
  is_active             INTEGER NOT NULL DEFAULT 1,
  delivery_day          TEXT,                                   -- e.g. "Sunday"; NULL = to be confirmed
  delivery_charge_paise INTEGER NOT NULL DEFAULT 0 CHECK (delivery_charge_paise >= 0),
  minimum_order_paise   INTEGER NOT NULL DEFAULT 0 CHECK (minimum_order_paise   >= 0),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS farm_user_addresses (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES farm_users(id) ON DELETE CASCADE,
  full_name             TEXT    NOT NULL,
  phone                 TEXT    NOT NULL,
  house_number          TEXT    NOT NULL,
  street                TEXT    NOT NULL DEFAULT '',
  delivery_area_id      INTEGER NOT NULL REFERENCES farm_delivery_areas(id),
  locality              TEXT    NOT NULL,                       -- snapshot of the area name
  city                  TEXT    NOT NULL DEFAULT 'Gwalior',
  pincode               TEXT    NOT NULL DEFAULT '',
  landmark              TEXT    NOT NULL DEFAULT '',
  delivery_instructions TEXT    NOT NULL DEFAULT '',
  is_default            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_farm_addr_user ON farm_user_addresses(user_id);

CREATE TABLE IF NOT EXISTS farm_orders (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number                TEXT    NOT NULL UNIQUE,
  user_id                     INTEGER REFERENCES farm_users(id) ON DELETE SET NULL,
  customer_name               TEXT    NOT NULL,
  customer_phone              TEXT    NOT NULL,
  customer_email              TEXT,
  delivery_area_id            INTEGER NOT NULL REFERENCES farm_delivery_areas(id),
  delivery_area_name_snapshot TEXT    NOT NULL,
  delivery_address            TEXT    NOT NULL,
  customer_note               TEXT,
  status                      TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN
                                ('PENDING','CONFIRMED','PREPARING','READY_FOR_DELIVERY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  -- RESERVED: stock moved available→reserved; SOLD: reserved→sold; RELEASED: reserved→available
  inventory_state             TEXT    NOT NULL DEFAULT 'RESERVED' CHECK (inventory_state IN ('RESERVED','SOLD','RELEASED')),
  subtotal_paise              INTEGER NOT NULL CHECK (subtotal_paise >= 0),
  delivery_charge_paise       INTEGER NOT NULL DEFAULT 0 CHECK (delivery_charge_paise >= 0),
  discount_paise              INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  grand_total_paise           INTEGER NOT NULL CHECK (grand_total_paise >= 0),
  payment_method              TEXT    NOT NULL DEFAULT 'PAY_ON_DELIVERY' CHECK (payment_method IN ('PAY_ON_DELIVERY','MANUAL_UPI','RAZORPAY')),
  payment_status              TEXT    NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PAID','REFUNDED','FAILED')),
  admin_note                  TEXT,
  whatsapp_status             TEXT    NOT NULL DEFAULT 'NOT_SENT',   -- SENT | FAILED | NOT_CONFIGURED | NOT_SENT
  idempotency_key             TEXT    UNIQUE,
  created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_farm_orders_user    ON farm_orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_farm_orders_phone   ON farm_orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_farm_orders_status  ON farm_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_farm_orders_area    ON farm_orders(delivery_area_id, created_at);
CREATE INDEX IF NOT EXISTS idx_farm_orders_created ON farm_orders(created_at);

CREATE TABLE IF NOT EXISTS farm_order_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              INTEGER NOT NULL REFERENCES farm_orders(id) ON DELETE CASCADE,
  product_id            INTEGER NOT NULL REFERENCES farm_products(id),
  product_name_snapshot TEXT    NOT NULL,
  price_snapshot_paise  INTEGER NOT NULL CHECK (price_snapshot_paise > 0),
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  unit                  TEXT    NOT NULL DEFAULT 'kg',
  line_total_paise      INTEGER NOT NULL CHECK (line_total_paise >= 0),
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_farm_items_order   ON farm_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_farm_items_product ON farm_order_items(product_id);

CREATE TABLE IF NOT EXISTS farm_order_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES farm_orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT    NOT NULL,
  changed_by  INTEGER,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_farm_hist_order ON farm_order_status_history(order_id);

-- Daily sequence for human-readable order numbers: FD-GWL-YYYYMMDD-NNNN
CREATE TABLE IF NOT EXISTS farm_order_counters (
  day TEXT    PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0
);

-- Logged-in customers' carts (product_id + quantity only — never prices).
CREATE TABLE IF NOT EXISTS farm_carts (
  user_id    INTEGER PRIMARY KEY REFERENCES farm_users(id) ON DELETE CASCADE,
  items_json TEXT    NOT NULL DEFAULT '[]',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS farm_sample_delivery_rounds (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  round_name       TEXT    NOT NULL,
  delivery_date    TEXT    NOT NULL,                     -- YYYY-MM-DD
  delivery_area_id INTEGER NOT NULL REFERENCES farm_delivery_areas(id),
  status           TEXT    NOT NULL DEFAULT 'PLANNED' CHECK (status IN
                     ('PLANNED','OPEN','CLOSED','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')),
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_farm_rounds_area ON farm_sample_delivery_rounds(delivery_area_id, delivery_date);

CREATE TABLE IF NOT EXISTS farm_sample_requests (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER REFERENCES farm_users(id) ON DELETE SET NULL,
  customer_name         TEXT    NOT NULL,
  phone                 TEXT    NOT NULL,
  email                 TEXT,
  product_id            INTEGER NOT NULL REFERENCES farm_products(id),
  product_name_snapshot TEXT    NOT NULL,
  sample_quantity_grams INTEGER NOT NULL CHECK (sample_quantity_grams IN (100,200)),
  delivery_area_id      INTEGER NOT NULL REFERENCES farm_delivery_areas(id),
  delivery_address      TEXT    NOT NULL,
  customer_note         TEXT,
  status                TEXT    NOT NULL DEFAULT 'REQUESTED' CHECK (status IN
                          ('REQUESTED','APPROVED','SCHEDULED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED','DECLINED')),
  -- RESERVED: grams held from sample stock; USED: delivered; RELEASED: returned to sample stock
  stock_state           TEXT    NOT NULL DEFAULT 'RESERVED' CHECK (stock_state IN ('RESERVED','USED','RELEASED')),
  requested_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  scheduled_round_id    INTEGER REFERENCES farm_sample_delivery_rounds(id) ON DELETE SET NULL,
  admin_note            TEXT,
  fulfilled_at          TEXT,
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_farm_samples_phone  ON farm_sample_requests(phone, product_id);
CREATE INDEX IF NOT EXISTS idx_farm_samples_user   ON farm_sample_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_farm_samples_status ON farm_sample_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_farm_samples_round  ON farm_sample_requests(scheduled_round_id);

CREATE TABLE IF NOT EXISTS farm_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fixed-window rate limiting (login, register, orders, samples, tracking).
CREATE TABLE IF NOT EXISTS farm_rate_limits (
  key          TEXT    PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0
);

-- Log of every WhatsApp notification attempt (API or click-to-chat fallback).
CREATE TABLE IF NOT EXISTS farm_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,          -- ORDER | SAMPLE
  reference  TEXT NOT NULL,          -- order number / sample id
  channel    TEXT NOT NULL,          -- WHATSAPP_API | CLICK_TO_CHAT
  status     TEXT NOT NULL,          -- SENT | FAILED | LINK_GENERATED
  message    TEXT NOT NULL,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
