// Cloud backup/restore for the SQLite file over plain HTTPS — built for
// Firebase Realtime Database REST (any endpoint accepting GET/PUT JSON
// works). Solves ephemeral-disk hosts: restore on boot, upload on change.
//
// Env:
//   BACKUP_URL         e.g. https://myproj-default-rtdb.firebaseio.com/holdem.json
//   BACKUP_SECRET      optional; appended as ?auth=... (Firebase database secret)
//   BACKUP_INTERVAL_MS default 60000
//
// IMPORTANT: this module must not require ./db — restore() runs before
// the database file is opened.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.POKER_DB || path.join(__dirname, '..', 'poker.db');
const BASE_URL = process.env.BACKUP_URL || '';
const SECRET = process.env.BACKUP_SECRET || '';
const INTERVAL = Math.max(15000, Number(process.env.BACKUP_INTERVAL_MS) || 60000);
const MAX_BYTES = 8 * 1024 * 1024; // RTDB node limit safety margin

const enabled = !!BASE_URL;

function url() {
  return SECRET ? `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}auth=${encodeURIComponent(SECRET)}` : BASE_URL;
}

// Pull the last backup if there is no usable local database yet.
async function restore() {
  if (!enabled) return false;
  try {
    if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0) {
      console.log('☁️  backup: local database present, skipping restore');
      return false;
    }
  } catch { /* stat failed → treat as missing */ }
  try {
    const res = await fetch(url(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`☁️  backup: restore fetch failed (${res.status})`);
      return false;
    }
    const body = await res.json();
    if (!body || !body.data) {
      console.log('☁️  backup: no backup found upstream (first run?)');
      return false;
    }
    fs.writeFileSync(DB_PATH, Buffer.from(body.data, 'base64'));
    console.log(`☁️  backup: restored database from ${new Date(body.ts).toISOString()} (${body.data.length} b64 bytes)`);
    return true;
  } catch (err) {
    console.error('☁️  backup: restore error —', err.message);
    return false;
  }
}

let lastHash = null;
let uploading = false;

async function uploadIfChanged(db) {
  if (uploading) return;
  uploading = true;
  try {
    // Fold the WAL into the main file so one file is the whole database.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const buf = fs.readFileSync(DB_PATH);
    if (buf.length > MAX_BYTES) {
      console.error(`☁️  backup: database too large to upload (${buf.length} bytes)`);
      return;
    }
    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    if (hash === lastHash) return;
    const res = await fetch(url(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: buf.toString('base64'), ts: Date.now(), v: 1 }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      lastHash = hash;
      console.log(`☁️  backup: uploaded ${buf.length} bytes`);
    } else {
      console.error(`☁️  backup: upload failed (${res.status})`);
    }
  } catch (err) {
    console.error('☁️  backup: upload error —', err.message);
  } finally {
    uploading = false;
  }
}

function startLoop(db) {
  if (!enabled) {
    console.log('☁️  backup: disabled (set BACKUP_URL to enable cloud persistence)');
    return;
  }
  const t = setInterval(() => uploadIfChanged(db), INTERVAL);
  t.unref();
  const first = setTimeout(() => uploadIfChanged(db), 10000);
  first.unref();
  // Best-effort final backup on graceful shutdown.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      uploadIfChanged(db).finally(() => process.exit(0));
    });
  }
  console.log(`☁️  backup: enabled → ${BASE_URL.replace(/\?.*$/, '')} every ${INTERVAL / 1000}s`);
}

module.exports = { enabled, restore, startLoop };
