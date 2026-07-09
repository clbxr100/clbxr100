// Device vault: a server-signed snapshot of one player's progress that the
// client stores in localStorage. After a database wipe (ephemeral-disk
// hosts) the client presents its vault and the server restores the data.
// HMAC-signed so it can't be forged; only applies to fresh accounts so it
// can't overwrite live progress.

const crypto = require('crypto');
const { db, getJwtSecret, transaction } = require('./db');
const { ECONOMY } = require('./catalog');
const { authed } = require('./shop');
const { getUser, publicProfile } = require('./auth');

const SECRET = getJwtSecret();

function sign(blob) {
  return crypto.createHmac('sha256', `${SECRET}|vault`).update(blob).digest('base64url');
}

function buildVault(userId) {
  const user = getUser(userId);
  if (!user) return null;
  const stats = db.prepare('SELECT * FROM stats WHERE user_id = ?').get(userId) || {};
  delete stats.user_id;
  const inventory = {};
  for (const row of db.prepare('SELECT item_id, qty FROM inventory WHERE user_id = ?').all(userId)) {
    inventory[row.item_id] = row.qty;
  }
  const achievements = db.prepare('SELECT achievement_id FROM achievements WHERE user_id = ?').all(userId).map(r => r.achievement_id);
  const season = new Date().toISOString().slice(0, 7);
  const sxp = db.prepare('SELECT xp FROM season_xp WHERE user_id = ? AND season = ?').get(userId, season);
  const bpGold = !!db.prepare('SELECT 1 FROM bp_premium WHERE user_id = ? AND season = ?').get(userId, season);
  const bpClaims = db.prepare('SELECT tier, track FROM bp_claims WHERE user_id = ? AND season = ?').all(userId, season);
  const data = {
    v: 1,
    ts: Date.now(),
    username: user.username,
    isGuest: !!user.is_guest,
    coins: user.coins,
    xp: user.xp,
    avatar: user.avatar,
    pet: user.pet,
    badge: user.badge,
    celebration: user.celebration,
    tableTheme: user.table_theme,
    cardBack: user.card_back,
    soundPack: user.sound_pack,
    frame: user.frame,
    dailyStreak: user.daily_streak,
    stats,
    inventory,
    achievements,
    bp: { season, xp: sxp ? sxp.xp : 0, gold: bpGold, claims: bpClaims },
  };
  const blob = Buffer.from(JSON.stringify(data)).toString('base64url');
  return { blob, sig: sign(blob) };
}

// A vault only applies to an account that hasn't played yet — either just
// auto-restored from a token or freshly re-registered after a wipe.
function accountIsFresh(user) {
  const stats = db.prepare('SELECT hands_played, tournaments_played FROM stats WHERE user_id = ?').get(user.id);
  const untouched = !stats || (stats.hands_played === 0 && stats.tournaments_played === 0);
  const startCoins = user.is_guest ? ECONOMY.guestStartCoins : ECONOMY.startCoins;
  return untouched && user.coins <= startCoins;
}

const applyVault = transaction((user, data) => {
  db.prepare(`
    UPDATE users SET coins = ?, xp = ?, avatar = ?, pet = ?, badge = ?,
      celebration = ?, table_theme = ?, card_back = ?, sound_pack = ?, frame = ?, daily_streak = ?
    WHERE id = ?
  `).run(
    data.coins, data.xp || 0, data.avatar || '🤠', data.pet || null, data.badge || null,
    data.celebration || null, data.tableTheme || null, data.cardBack || null,
    data.soundPack || null, data.frame || null, data.dailyStreak || 0, user.id
  );
  const statCols = ['hands_played', 'hands_won', 'biggest_pot', 'best_hand_rank',
    'tournaments_played', 'tournaments_won', 'powerups_used', 'items_thrown', 'best_streak'];
  const sets = statCols.map(c => `${c} = ?`).join(', ');
  db.prepare(`UPDATE stats SET ${sets} WHERE user_id = ?`)
    .run(...statCols.map(c => Number(data.stats?.[c]) || 0), user.id);
  db.prepare('DELETE FROM inventory WHERE user_id = ?').run(user.id);
  const insInv = db.prepare('INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, ?)');
  for (const [itemId, qty] of Object.entries(data.inventory || {})) {
    if (typeof itemId === 'string' && Number(qty) > 0) insInv.run(user.id, itemId, Math.floor(Number(qty)));
  }
  const insAch = db.prepare('INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)');
  for (const ach of data.achievements || []) insAch.run(user.id, String(ach), data.ts);
  // Battle pass progress rides along (only for the still-current season).
  const nowSeason = new Date().toISOString().slice(0, 7);
  if (data.bp && data.bp.season === nowSeason) {
    if (data.bp.xp > 0) {
      db.prepare(`
        INSERT INTO season_xp (user_id, season, xp) VALUES (?, ?, ?)
        ON CONFLICT(user_id, season) DO UPDATE SET xp = MAX(xp, excluded.xp)
      `).run(user.id, nowSeason, Math.floor(data.bp.xp));
    }
    if (data.bp.gold) {
      db.prepare('INSERT OR IGNORE INTO bp_premium (user_id, season) VALUES (?, ?)').run(user.id, nowSeason);
    }
    const insClaim = db.prepare('INSERT OR IGNORE INTO bp_claims (user_id, season, tier, track) VALUES (?, ?, ?, ?)');
    for (const c of data.bp.claims || []) {
      if (Number.isInteger(c.tier) && (c.track === 'free' || c.track === 'gold')) insClaim.run(user.id, nowSeason, c.tier, c.track);
    }
  }
  db.prepare('INSERT INTO transactions (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, 0, 'vault_restore', String(data.ts), Date.now());
});

function mount(route) {
  route('GET', '/api/vault', authed((req, res, { sendJson }) => {
    const vault = buildVault(req.user.id);
    if (!vault) return sendJson(404, { error: 'No account' });
    sendJson(200, vault);
  }));

  route('POST', '/api/vault/restore', authed((req, res, { sendJson }) => {
    const { blob, sig } = req.body;
    if (typeof blob !== 'string' || typeof sig !== 'string' || blob.length > 256 * 1024) {
      return sendJson(400, { error: 'Bad vault' });
    }
    const expected = sign(blob);
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return sendJson(400, { error: 'Vault signature invalid' });
    }
    let data;
    try { data = JSON.parse(Buffer.from(blob, 'base64url').toString()); } catch { return sendJson(400, { error: 'Bad vault' }); }
    if (data.username !== req.user.username) {
      return sendJson(400, { error: 'Vault belongs to a different account' });
    }
    if (!accountIsFresh(req.user)) {
      return sendJson(409, { error: 'Account already has progress', code: 'not_fresh' });
    }
    applyVault(req.user, data);
    sendJson(200, { restored: true, profile: publicProfile(getUser(req.user.id)) });
  }));
}

module.exports = { mount, buildVault };
