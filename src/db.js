// SQLite persistence via Node's built-in node:sqlite (no native deps).
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.POKER_DB || path.join(__dirname, '..', 'poker.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    is_guest INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 5000,
    avatar TEXT NOT NULL DEFAULT '🤠',
    pet TEXT,
    daily_streak INTEGER NOT NULL DEFAULT 0,
    last_daily_bonus_at INTEGER,
    last_bailout_at INTEGER,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS inventory (
    user_id INTEGER NOT NULL REFERENCES users(id),
    item_id TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    hands_played INTEGER DEFAULT 0,
    hands_won INTEGER DEFAULT 0,
    biggest_pot INTEGER DEFAULT 0,
    best_hand_rank INTEGER DEFAULT 0,
    tournaments_played INTEGER DEFAULT 0,
    tournaments_won INTEGER DEFAULT 0,
    powerups_used INTEGER DEFAULT 0,
    items_thrown INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

// Additive migrations for existing databases.
try { db.exec('ALTER TABLE users ADD COLUMN celebration TEXT'); } catch { /* already present */ }

// Purge stale guest accounts (older than 7 days) on boot.
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
const staleGuests = db.prepare('SELECT id FROM users WHERE is_guest = 1 AND created_at < ?').all(cutoff);
for (const g of staleGuests) {
  db.prepare('DELETE FROM inventory WHERE user_id = ?').run(g.id);
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(g.id);
  db.prepare('DELETE FROM stats WHERE user_id = ?').run(g.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(g.id);
}

function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// Stable dev secret so restarts don't invalidate sessions; JWT_SECRET wins.
function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let secret = getMeta('jwt_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setMeta('jwt_secret', secret);
  }
  return secret;
}

// node:sqlite has no transaction helper; emulate one that tolerates
// nesting (inner calls join the outer transaction).
let txDepth = 0;
function transaction(fn) {
  return (...args) => {
    if (txDepth > 0) return fn(...args);
    db.exec('BEGIN');
    txDepth++;
    try {
      const out = fn(...args);
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      txDepth--;
    }
  };
}

module.exports = { db, getMeta, setMeta, getJwtSecret, transaction };
