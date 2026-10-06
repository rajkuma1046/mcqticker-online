-- ============================================================================
-- Farm Direct — Email Verifications & Password Reset
-- ============================================================================

CREATE TABLE IF NOT EXISTS farm_email_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL COLLATE NOCASE,
  code        TEXT    NOT NULL,
  purpose     TEXT    NOT NULL CHECK (purpose IN ('register', 'reset_password')),
  payload     TEXT,                                -- JSON payload (e.g. pending user fields or user_id)
  attempts    INTEGER NOT NULL DEFAULT 0,
  is_used     INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_farm_email_verif_lookup 
ON farm_email_verifications (email, purpose, is_used);
