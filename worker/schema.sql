PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  balance_kobo INTEGER NOT NULL DEFAULT 0 CHECK(balance_kobo >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS vip_packages (
  id INTEGER PRIMARY KEY,
  level INTEGER NOT NULL UNIQUE CHECK(level BETWEEN 1 AND 6),
  name TEXT NOT NULL,
  daily_earning_kobo INTEGER NOT NULL CHECK(daily_earning_kobo >= 0),
  price_kobo INTEGER CHECK(price_kobo IS NULL OR price_kobo > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


CREATE TABLE IF NOT EXISTS payment_orders (
  reference TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  package_id INTEGER NOT NULL REFERENCES vip_packages(id),
  amount_kobo INTEGER NOT NULL CHECK(amount_kobo > 0),
  currency TEXT NOT NULL CHECK(currency = 'NGN'),
  status TEXT NOT NULL CHECK(status IN ('pending','processed','failed','cancelled')),
  checkout_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_orders_user_created_idx ON payment_orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_status_idx ON payment_orders(status,created_at);
\nCREATE TABLE IF NOT EXISTS payment_events (
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  package_id INTEGER NOT NULL REFERENCES vip_packages(id),
  amount_kobo INTEGER NOT NULL CHECK(amount_kobo > 0),
  status TEXT NOT NULL CHECK(status IN ('verified','processed','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(provider, provider_reference)
);

CREATE TABLE IF NOT EXISTS user_vip_packages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  package_id INTEGER NOT NULL REFERENCES vip_packages(id),
  payment_provider TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','paused')),
  activated_at TEXT NOT NULL,
  last_credited_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(payment_provider, payment_reference) REFERENCES payment_events(provider, provider_reference),
  UNIQUE(payment_provider, payment_reference)
);
CREATE INDEX IF NOT EXISTS vip_user_status_idx ON user_vip_packages(user_id,status);
CREATE INDEX IF NOT EXISTS vip_due_credit_idx ON user_vip_packages(status,last_credited_at,expires_at);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  activation_id TEXT REFERENCES user_vip_packages(id),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('vip_earning','deposit','withdrawal','adjustment')),
  amount_kobo INTEGER NOT NULL CHECK(amount_kobo != 0),
  period_number INTEGER,
  reference TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK((entry_type = 'vip_earning' AND activation_id IS NOT NULL AND period_number IS NOT NULL) OR entry_type != 'vip_earning'),
  UNIQUE(activation_id,period_number)
);
CREATE INDEX IF NOT EXISTS ledger_user_created_idx ON wallet_ledger(user_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS ledger_balance_after_insert
AFTER INSERT ON wallet_ledger
BEGIN
  UPDATE users SET balance_kobo = balance_kobo + NEW.amount_kobo
  WHERE id = NEW.user_id AND balance_kobo + NEW.amount_kobo >= 0;
END;

INSERT OR IGNORE INTO vip_packages (id,level,name,daily_earning_kobo,price_kobo,enabled) VALUES
  (1,1,'VIP 1',20000,NULL,0),
  (2,2,'VIP 2',45000,NULL,0),
  (3,3,'VIP 3',120000,NULL,0),
  (4,4,'VIP 4',220000,NULL,0),
  (5,5,'VIP 5',840000,NULL,0),
  (6,6,'VIP 6',1450000,NULL,0);