// Friends, private messages, weekly seasons, achievements.
const { db, getMeta, setMeta, transaction } = require('./db');
const { authed } = require('./shop');
const { ACHIEVEMENTS, SEASON, XP } = require('./catalog');
const economy = require('./economy');
const presence = require('./presence');

// ---- weeks -----------------------------------------------------------------

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekEndsAt() {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (8 - day)));
  return end.getTime();
}

function bumpWeeklyWin(userId) {
  db.prepare(`
    INSERT INTO weekly_stats (user_id, week, wins) VALUES (?, ?, 1)
    ON CONFLICT(user_id, week) DO UPDATE SET wins = wins + 1
  `).run(userId, isoWeek());
}

// Pay out any finished, unsettled weeks. Cheap enough to call on boot and
// on a daily-ish tick.
const settleSeasons = transaction(() => {
  const current = isoWeek();
  const unsettled = db.prepare(`
    SELECT DISTINCT week FROM weekly_stats WHERE week != ? AND week NOT IN (
      SELECT value FROM meta WHERE key LIKE 'season_settled_%'
    )
  `).all(current);
  for (const { week } of unsettled) {
    const top = db.prepare(`
      SELECT w.user_id AS userId, w.wins, u.username, u.avatar
      FROM weekly_stats w JOIN users u ON u.id = w.user_id
      WHERE w.week = ? ORDER BY w.wins DESC, u.created_at ASC LIMIT 3
    `).all(week);
    const podium = top.map((row, i) => {
      const prize = SEASON.prizes[i] || 0;
      if (prize > 0) economy.adjustCoins(row.userId, prize, 'season_prize', week);
      return { ...row, prize, place: i + 1 };
    });
    setMeta(`season_settled_${week}`, week);
    setMeta('season_last_podium', JSON.stringify({ week, podium }));
  }
});

// ---- achievements ------------------------------------------------------------

// Evaluate a user's stats against every locked achievement; unlock and
// return anything new so callers can toast it.
function checkAchievements(userId) {
  const stats = db.prepare('SELECT * FROM stats WHERE user_id = ?').get(userId);
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId);
  if (!stats || !user) return [];
  const have = new Set(db.prepare('SELECT achievement_id FROM achievements WHERE user_id = ?').all(userId).map(r => r.achievement_id));
  const fresh = [];
  for (const ach of Object.values(ACHIEVEMENTS)) {
    if (have.has(ach.id)) continue;
    const value = ach.stat === 'coins' ? user.coins : (stats[ach.stat] || 0);
    if (value >= ach.gte) {
      db.prepare('INSERT INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').run(userId, ach.id, Date.now());
      fresh.push(ach);
    }
  }
  for (const ach of fresh) {
    presence.sendTo(userId, 'achievement:unlocked', { id: ach.id, name: ach.name, badge: ach.badge, desc: ach.desc });
    economy.addXp(userId, XP.rewards.achievement);
  }
  return fresh;
}

function getAchievements(userId) {
  const have = new Map(db.prepare('SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?').all(userId).map(r => [r.achievement_id, r.unlocked_at]));
  return Object.values(ACHIEVEMENTS).map(a => ({ ...a, unlocked: have.has(a.id) }));
}

// ---- friends ------------------------------------------------------------------

function friendRow(a, b) {
  return db.prepare('SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(a, b, b, a);
}

function areFriends(a, b) {
  const row = friendRow(a, b);
  return !!(row && row.status === 'accepted');
}

function friendsOf(userId) {
  return db.prepare(`
    SELECT u.id AS userId, u.username, u.avatar,
      (SELECT COUNT(*) FROM dms WHERE from_id = u.id AND to_id = ? AND read = 0) AS unread
    FROM friends f
    JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
    WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
    ORDER BY u.username COLLATE NOCASE
  `).all(userId, userId, userId, userId);
}

// ---- REST -----------------------------------------------------------------------

function mount(route) {
  route('GET', '/api/friends', authed((req, res, { sendJson }) => {
    const me = req.user.id;
    const friends = friendsOf(me).map(f => ({
      ...f,
      online: presence.isOnline(f.userId),
      table: presence.whereIs(f.userId),
    }));
    const incoming = db.prepare(`
      SELECT u.id AS userId, u.username, u.avatar FROM friends f
      JOIN users u ON u.id = f.user_id WHERE f.friend_id = ? AND f.status = 'pending'
    `).all(me);
    const sent = db.prepare(`
      SELECT u.id AS userId, u.username, u.avatar FROM friends f
      JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? AND f.status = 'pending'
    `).all(me);
    sendJson(200, { friends, incoming, sent });
  }));

  route('POST', '/api/friends/request', authed((req, res, { sendJson }) => {
    const me = req.user.id;
    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(String(req.body.username || '').trim());
    if (!target) return sendJson(404, { error: 'No player with that username' });
    if (target.id === me) return sendJson(400, { error: 'That is you' });
    const existing = friendRow(me, target.id);
    if (existing) {
      return sendJson(400, { error: existing.status === 'accepted' ? 'Already friends' : 'Request already pending' });
    }
    db.prepare('INSERT INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, ?, ?)').run(me, target.id, 'pending', Date.now());
    presence.sendTo(target.id, 'friend:request', { userId: me, username: req.user.username, avatar: req.user.avatar });
    sendJson(200, { ok: true, username: target.username });
  }));

  route('POST', '/api/friends/respond', authed((req, res, { sendJson }) => {
    const me = req.user.id;
    const from = Number(req.body.userId);
    const row = db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?').get(from, me, 'pending');
    if (!row) return sendJson(404, { error: 'No such request' });
    if (req.body.accept) {
      db.prepare('UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?').run('accepted', from, me);
      presence.sendTo(from, 'friend:accepted', { userId: me, username: req.user.username, avatar: req.user.avatar });
    } else {
      db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(from, me);
    }
    sendJson(200, { ok: true });
  }));

  route('POST', '/api/friends/remove', authed((req, res, { sendJson }) => {
    const other = Number(req.body.userId);
    db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
      .run(req.user.id, other, other, req.user.id);
    sendJson(200, { ok: true });
  }));

  route('GET', '/api/dm', authed((req, res, { sendJson }) => {
    const me = req.user.id;
    const other = Number(req.query.get('with'));
    if (!areFriends(me, other)) return sendJson(403, { error: 'Not friends' });
    const messages = db.prepare(`
      SELECT id, from_id AS fromId, to_id AS toId, text, created_at AS ts FROM dms
      WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
      ORDER BY created_at DESC LIMIT 100
    `).all(me, other, other, me).reverse();
    db.prepare('UPDATE dms SET read = 1 WHERE from_id = ? AND to_id = ?').run(other, me);
    sendJson(200, { messages });
  }));

  route('GET', '/api/achievements', authed((req, res, { sendJson }) => {
    sendJson(200, { achievements: getAchievements(req.user.id) });
  }));

  route('GET', '/api/season', authed((req, res, { sendJson }) => {
    settleSeasons();
    const week = isoWeek();
    const rows = db.prepare(`
      SELECT w.user_id AS userId, w.wins AS value, u.username, u.avatar, u.is_guest AS isGuest
      FROM weekly_stats w JOIN users u ON u.id = w.user_id
      WHERE w.week = ? ORDER BY w.wins DESC, u.created_at ASC LIMIT 20
    `).all(week);
    const mine = db.prepare('SELECT wins FROM weekly_stats WHERE user_id = ? AND week = ?').get(req.user.id, week);
    const lastPodium = JSON.parse(getMeta('season_last_podium') || 'null');
    sendJson(200, {
      week,
      endsAt: weekEndsAt(),
      prizes: SEASON.prizes,
      rows,
      me: { value: mine ? mine.wins : 0 },
      lastPodium,
    });
  }));
}

// Socket-side DM delivery, wired by lobby.
function sendDm(fromUser, toUserId, text) {
  const clean = String(text || '').slice(0, 300).trim();
  if (!clean) return { error: 'Empty message' };
  if (!areFriends(fromUser.id, toUserId)) return { error: 'You can only message friends' };
  const ts = Date.now();
  db.prepare('INSERT INTO dms (from_id, to_id, text, created_at) VALUES (?, ?, ?, ?)').run(fromUser.id, toUserId, clean, ts);
  const payload = { fromId: fromUser.id, toId: toUserId, fromName: fromUser.username, fromAvatar: fromUser.avatar, text: clean, ts };
  presence.sendTo(toUserId, 'dm:message', payload);
  presence.sendTo(fromUser.id, 'dm:message', payload); // echo for sender UI
  return { ok: true };
}

module.exports = { mount, sendDm, bumpWeeklyWin, settleSeasons, checkAchievements, areFriends, isoWeek };
