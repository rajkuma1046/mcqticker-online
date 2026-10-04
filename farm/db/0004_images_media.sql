-- 0004_images_media.sql
-- Add images column to farm_products for multiple image URLs (JSON array)
ALTER TABLE farm_products ADD COLUMN images TEXT DEFAULT '[]';

-- Table to store uploaded images in Cloudflare D1 storage
CREATE TABLE IF NOT EXISTS farm_media (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
