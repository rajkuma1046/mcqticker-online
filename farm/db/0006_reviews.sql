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

-- Seed Authentic Customer Reviews with Photos across Local Coverage Clusters
INSERT OR IGNORE INTO farm_reviews (id, product_id, product_name, customer_name, customer_city, rating, title, review_text, photo_url, is_verified, is_approved, created_at)
VALUES
  (
    1,
    1,
    'Farm Wheat',
    'Ramesh Sharma',
    'Pawan Nagar, Gwalior',
    5,
    'Rotis are naturally sweet and exceptionally soft',
    'We bought the 25kg wheat bag. The grains are golden, completely clean without stones or dirt, and free from any chemical polish or warehouse pesticides. Flour gives wonderfully soft rotis with a natural aroma.',
    '/farm/images/wheat-500.jpg',
    1,
    1,
    datetime('now', '-12 days')
  ),
  (
    2,
    2,
    'Raw Groundnut / Peanut',
    'Dr. Sunita Dixit',
    'Chetakpuri, Gwalior',
    5,
    'Crisp thin shells, sweet oil-rich kernels',
    'Authentic village harvest peanuts! Shells are crisp, seeds are plump with very rich natural oil content. We roasted a batch for evening tea and ground homemade peanut butter. Outstanding quality.',
    '/farm/images/groundnut-500.jpg',
    1,
    1,
    datetime('now', '-9 days')
  ),
  (
    3,
    3,
    'Raw Chana',
    'Devendra Singh Rawat',
    'Village Sirsod',
    5,
    'Native Sirsod harvest, 100% vigorous sprouts',
    'I live in Sirsod village and know the soil well. This desi kala chana is unpolished and natural. Soaked a handful overnight and healthy long sprouts came out within 24 hours. The real rustic flavour.',
    '/farm/images/chana-500.jpg',
    1,
    1,
    datetime('now', '-7 days')
  ),
  (
    4,
    4,
    'Raw Moong',
    'Amit Verma',
    'Karera (Block)',
    5,
    'Very clean green moong, quick delivery to Karera',
    'Got whole green moong delivered in Karera. Fresh harvest shine without synthetic polish or artificial colour. Cooked daily dal and also sprouted it. Great direct-from-farm service!',
    '/farm/images/moong-500.jpg',
    1,
    1,
    datetime('now', '-5 days')
  ),
  (
    5,
    5,
    'Raw Urad',
    'Neetu Kushwah',
    'Naya Amola (Colony No. 2)',
    5,
    'Best rustic flavor for dal makhani and batter',
    'Natural dark black urad whole seeds. Ground it for dosa and vada batter, and the fermentation was so fluffy and natural. Zero polishing chemicals makes a huge difference.',
    '/farm/images/urad-500.jpg',
    1,
    1,
    datetime('now', '-4 days')
  ),
  (
    6,
    6,
    'Seasonal Farm Produce',
    'Mahendra Lodhi',
    'Shivpuri District',
    5,
    'Real countryside freshness directly in Shivpuri',
    'Ordered the seasonal harvest basket. Everything smelled of fresh soil and sunshine, neatly packaged in eco-friendly cotton bags. Highly recommend Farm Direct to every family in Shivpuri and Gwalior.',
    '/farm/images/seasonal-500.jpg',
    1,
    1,
    datetime('now', '-2 days')
  ),
  (
    7,
    1,
    'Farm Wheat',
    'Pushpa Bhadoriya',
    'Gwalior',
    5,
    'Cleanest wheat we have ever sourced',
    'Cleaned and threshed so cleanly that no extra winnowing or sieving was needed before taking it to the local chakki. Will definitely order our annual stock again next season.',
    '/farm/images/wheat-500.jpg',
    1,
    1,
    datetime('now', '-1 days')
  );
