-- ============================================================================
-- Farm Direct — Initial Seed Data
-- ============================================================================

-- 1. Initial Delivery Areas in Gwalior
INSERT OR IGNORE INTO farm_delivery_areas (id, name, city, is_active, delivery_day, delivery_charge_paise, minimum_order_paise, sort_order)
VALUES
  (1, 'Pawan Nagar / Pavan Nagar Colony', 'Gwalior', 1, 'Sunday', 3000, 20000, 1),
  (2, 'Chetakpuri', 'Gwalior', 1, 'Sunday', 3000, 20000, 2);

-- 2. Initial Products & Pricing
-- Money stored in paise (₹1 = 100 paise)
INSERT OR IGNORE INTO farm_products (id, name, slug, local_name, description, label, price_per_kg_paise, unit, quantity_options, max_order_qty, image_url, image_alt, image_credit, category, is_available, is_seasonal, sample_available, sample_max_quantity_grams, sort_order)
VALUES
  (
    1,
    'Farm Wheat',
    'farm-wheat',
    'Gehu',
    'Raw whole wheat grain freshly threshed from our harvest. Sun-dried, unpolished, and minimally handled to preserve all natural nutrients and bran.',
    'Raw / Unprocessed',
    2500, -- ₹25/kg
    'kg',
    '[1, 5, 10, 25]',
    50,
    '/farm/images/wheat-960.jpg',
    'Clean golden raw wheat grains',
    'Wikimedia Commons (CC BY-SA 4.0)',
    'grain',
    1,
    0,
    1,
    200,
    1
  ),
  (
    2,
    'Raw Groundnut / Peanut',
    'raw-groundnut',
    'Mungphali',
    'Raw whole groundnuts in shell. Naturally dried post-harvest with rich oil content and earthy aroma. Unroasted and unseasoned.',
    'Raw / Unprocessed',
    6500, -- ₹65/kg
    'kg',
    '[1, 2, 5, 10]',
    40,
    '/farm/images/groundnut-960.jpg',
    'Raw groundnuts in crisp pod shells',
    'Wikimedia Commons (CC BY 4.0)',
    'oilseed',
    1,
    0,
    1,
    200,
    2
  ),
  (
    3,
    'Raw Chana',
    'raw-chana',
    'Desi Kala Chana',
    'Raw whole desi chickpeas directly from field threshing. High fibre, rustic brown grain ideal for sprouting or traditional slow cooking.',
    'Raw / Unprocessed',
    6000, -- ₹60/kg
    'kg',
    '[1, 5, 10]',
    30,
    '/farm/images/chana-960.jpg',
    'Raw desi kala chana whole seeds',
    'Wikimedia Commons (CC BY 3.0)',
    'pulse',
    1,
    0,
    1,
    200,
    3
  ),
  (
    4,
    'Raw Moong',
    'raw-moong',
    'Sabut Moong',
    'Raw whole green gram seeds. Freshly harvested, clean, unpolished moong with intact seed coat, perfect for nutritious fresh sprouts.',
    'Raw / Unprocessed',
    12000, -- ₹120/kg
    'kg',
    '[1, 2, 5]',
    25,
    '/farm/images/moong-960.jpg',
    'Raw whole green moong seeds',
    'Wikimedia Commons (CC BY-SA 4.0)',
    'pulse',
    1,
    0,
    1,
    200,
    4
  ),
  (
    5,
    'Raw Urad',
    'raw-urad',
    'Sabut Urad',
    'Raw whole black gram with natural seed coat. Unpolished and full-bodied rustic grain. Price is configurable from admin dashboard.',
    'Raw / Unprocessed',
    11500, -- ₹115/kg (configurable in admin panel)
    'kg',
    '[1, 2, 5]',
    25,
    '/farm/images/urad-960.jpg',
    'Raw whole black urad seeds',
    'Wikimedia Commons (CC BY-SA 3.0)',
    'pulse',
    1,
    0,
    1,
    200,
    5
  ),
  (
    6,
    'Seasonal Farm Produce',
    'seasonal-farm-produce',
    'Mausami Upaj',
    'Fresh seasonal agricultural produce straight from current field cuttings. Availability and selection vary dynamically with weekly harvest conditions.',
    'Seasonal',
    5000, -- ₹50/kg
    'kg',
    '[1, 2, 5]',
    20,
    '/farm/images/seasonal-960.jpg',
    'Freshly harvested rustic seasonal farm produce basket',
    'Wikimedia Commons (CC BY 2.0)',
    'vegetable',
    1,
    1,
    1,
    200,
    6
  );

-- 3. Initial Inventory Levels (in whole kg and sample grams)
INSERT OR IGNORE INTO farm_inventory (product_id, quantity_available, quantity_reserved, quantity_sold, sample_stock_grams)
VALUES
  (1, 250, 0, 0, 5000),  -- 250 kg wheat available, 5000g sample stock
  (2, 100, 0, 0, 4000),  -- 100 kg groundnut available, 4000g sample stock
  (3, 80,  0, 0, 3000),  -- 80 kg chana
  (4, 50,  0, 0, 2000),  -- 50 kg moong
  (5, 50,  0, 0, 2000),  -- 50 kg urad
  (6, 60,  0, 0, 2000);  -- 60 kg seasonal produce

-- 4. Initial System Settings
INSERT OR REPLACE INTO farm_settings (key, value)
VALUES
  ('admin_whatsapp_number', '8770767272'),
  ('farm_name', 'Farm Direct'),
  ('farm_tagline', 'Raw Produce, Direct from the Farm'),
  ('farm_origin', 'Village Farm near Gwalior, Madhya Pradesh'),
  ('default_city', 'Gwalior'),
  ('currency_symbol', '₹'),
  ('low_stock_threshold_kg', '15'),
  ('max_samples_per_customer_per_round', '2'),
  ('max_samples_per_product_per_customer', '1'),
  ('sample_cooldown_days', '14');

-- 5. Initial Sample Delivery Round for Gwalior
INSERT OR IGNORE INTO farm_sample_delivery_rounds (id, round_name, delivery_date, delivery_area_id, status, notes)
VALUES
  (1, 'Upcoming Chetakpuri & Pawan Nagar Sample Round', '2026-10-18', 2, 'OPEN', 'Scheduled Sunday batch run for free samples.');

-- 6. Initial Administrator Account
-- Phone: 8770767272 (Rajkumar / Farm Direct WhatsApp)
-- Email: admin@farmdirect.gwalior
-- Password: FarmDirect@8770
INSERT OR IGNORE INTO farm_users (id, name, phone, email, password_hash, role, is_active)
VALUES
  (
    1,
    'Rajkumar (Farm Direct Admin)',
    '8770767272',
    'admin@farmdirect.gwalior',
    'pbkdf2$100000$oIZoEA2xsBrGP7pdEk90rQ$HSGfOuM4vLm2iQG8HieXTAMq9nQWQp2chRNN7RzxD0o',
    'ADMIN',
    1
  );
