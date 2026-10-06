-- ============================================================================
-- Farm Direct — Customer Reviews with Written Content & Photos
-- ============================================================================

CREATE TABLE IF NOT EXISTS farm_reviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER REFERENCES farm_users(id) ON DELETE SET NULL,
  order_id        INTEGER REFERENCES farm_orders(id) ON DELETE SET NULL,
  product_id      INTEGER REFERENCES farm_products(id) ON DELETE SET NULL,
  product_name    TEXT,
  customer_name   TEXT    NOT NULL,
  customer_phone  TEXT,
  customer_city   TEXT,
  rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title           TEXT,
  review_text     TEXT    NOT NULL,
  photo_url       TEXT,
  is_verified     INTEGER NOT NULL DEFAULT 1,
  is_approved     INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_farm_reviews_prod ON farm_reviews(product_id, is_approved);
CREATE INDEX IF NOT EXISTS idx_farm_reviews_created ON farm_reviews(created_at DESC);

-- No seed data: reviews are created only by real customers via POST /farm/api/reviews.
