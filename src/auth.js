// Accounts + stateless auth tokens, using only node:crypto.
// Passwords: scrypt with per-user salt. Tokens: HMAC-SHA256 signed JSON
// (JWT-style payload.signature, base64url).

const crypto = require('crypto');
const { db, getJwtSecret } = require('./db');
const { ECONOMY, AVATARS, levelFromXp, xpForLevel, titleForLevel } = require('./catalog');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET = getJwtSecret();

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signToken(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function publicProfile(user) {
  const inventory = {};
  for (const row of db.prepare('SELECT item_id, qty FROM inventory WHERE user_id = ?').all(user.id)) {
    inventory[row.item_id] = row.qty;
  }
  const stats = db.prepare('SELECT * FROM stats WHERE user_id = ?').get(user.id) || {};
  return {
    userId: user.id,
    username: user.username,
    isGuest: !!user.is_guest,
    coins: user.coins,
    avatar: user.avatar,
    pet: user.pet,
    celebration: user.celebration,
    badge: user.badge,
    tableTheme: user.table_theme,
    cardBack: user.card_back,
    xp: user.xp,
    level: levelFromXp(user.xp),
    nextLevelXp: xpForLevel(levelFromXp(user.xp) + 1),
    levelStartXp: xpForLevel(levelFromXp(user.xp)),
    rank: titleForLevel(levelFromXp(user.xp)),
    isAdmin: isAdmin(user),
    dailyStreak: user.daily_streak,
    lastDailyBonusAt: user.last_daily_bonus_at,
    lastBailoutAt: user.last_bailout_at,
    inventory,
    stats,
    freeAvatars: AVATARS.free,
  };
}

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// Ephemeral-disk hosts (e.g. Render free tier) wipe the database on every
// restart. A valid signed token is proof of account ownership, so rather
// than bouncing the player to the signup screen we quietly recreate their
// account (fresh starting coins — the old data is gone either way).
function getOrRestoreUser(payload) {
  if (!payload || !payload.userId) return null;
  const existing = getUser(payload.userId);
  if (existing) return existing;
  if (!payload.username) return null;
  const clash = db.prepare('SELECT id FROM users WHERE username = ?').get(payload.username);
  if (clash) return null; // name re-registered by someone else since the wipe
  const now = Date.now();
  const coins = payload.isGuest ? ECONOMY.guestStartCoins : ECONOMY.startCoins;
  db.prepare(`
    INSERT INTO users (id, username, password_hash, is_guest, coins, created_at, last_login_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?)
  `).run(payload.userId, payload.username, payload.isGuest ? 1 : 0, coins, now, now);
  db.prepare('INSERT INTO stats (user_id) VALUES (?)').run(payload.userId);
  db.prepare('INSERT INTO transactions (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(payload.userId, coins, 'account_restored', null, now);
  return getUser(payload.userId);
}

function createUserRow({ username, passwordHash, isGuest }) {
  const now = Date.now();
  const coins = isGuest ? ECONOMY.guestStartCoins : ECONOMY.startCoins;
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, is_guest, coins, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(username, passwordHash, isGuest ? 1 : 0, coins, now, now);
  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO stats (user_id) VALUES (?)').run(id);
  db.prepare('INSERT INTO transactions (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, coins, 'starting_coins', null, now);
  return getUser(id);
}

// Admins are named in config (survives ephemeral-disk wipes). Extend or
// override with ADMIN_USERS="name1,name2".
const ADMIN_USERS = new Set(
  (process.env.ADMIN_USERS || 'breezyonda1')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);

// Guests can't be admins — the suffixed guest names can't collide with
// real usernames anyway, but belt and braces.
function isAdmin(user) {
  return !!user && !user.is_guest && ADMIN_USERS.has(String(user.username).toLowerCase());
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function signup(username, password) {
  if (!USERNAME_RE.test(username || '')) {
    return { error: 'Username must be 3-16 letters, numbers or underscores' };
  }
  if (typeof password !== 'string' || password.length < 4) {
    return { error: 'Password must be at least 4 characters' };
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return { error: 'Username already taken' };
  const user = createUserRow({ username, passwordHash: hashPassword(password), isGuest: false });
  return { user };
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_guest = 0').get(username || '');
  if (!user || !checkPassword(password || '', user.password_hash)) {
    return { error: 'Wrong username or password' };
  }
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  return { user };
}

function guest(name) {
  const base = String(name || 'Player').replace(/[^A-Za-z0-9_]/g, '').slice(0, 10) || 'Player';
  let username;
  for (let tries = 0; tries < 20; tries++) {
    username = `${base}_${crypto.randomBytes(2).toString('hex')}`;
    if (!db.prepare('SELECT id FROM users WHERE username = ?').get(username)) break;
  }
  const user = createUserRow({ username, passwordHash: null, isGuest: true });
  return { user };
}

function tokenFor(user) {
  return signToken({ userId: user.id, username: user.username, isGuest: !!user.is_guest });
}

module.exports = { signToken, verifyToken, signup, login, guest, tokenFor, getUser, getOrRestoreUser, publicProfile, isAdmin };
