# 🃏 Hold'em Blitz

Mobile-first multiplayer Texas Hold'em with **power-ups**, bots, tournaments,
a coin economy, table pets, throwable cakes, and Rocket-League-style win
celebrations. **Zero npm dependencies** — pure Node.js and vanilla JS.

## 🚀 Run it

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`).

```bash
npm start          # or: node --no-warnings server.js
```

Open `http://localhost:3000` — share your LAN IP with friends to play
together. Works great on phones (portrait).

```bash
npm test           # poker engine simulation suite
```

## ✨ What's inside

### Accounts & economy
- **Sign up / sign in** (username + password, scrypt-hashed, SQLite) or play
  as a **guest** (kept for 7 days)
- **Coins**: start with 5,000 (guests 2,000), earn a **daily bonus** with
  streaks, win bonuses each hand, big-hand jackpots (Royal Flush +5,000),
  and a bailout when you're broke
- **Shop**: premium avatars (💰 🤑 💎 👽 😈 🐲), table **pets** that perch on
  your seat (🐕 🐈 🐢 🦜 🦄 🐉), throwable item packs, and power-up credits
- Every coin movement is recorded in a `transactions` ledger

### Playing
- **Lobby**: host public or private (code-protected) tables at three stakes
  (10/20, 50/100, 250/500) with **0–7 bots**
- **Bots** play real poker — Chen-formula preflop, Monte Carlo hand strength
  postflop, individual personalities, and they use power-ups too
- **Sit & Go tournaments**: entry fees, prize pools, blinds up every 8
  hands, eliminations and podium payouts (60/30/10)
- Full rules: side pots for all-ins, correct betting rounds, kickers,
  turn timer, reconnect grace (your seat is held for 60s)

### ⚡ Power-ups (the twist)
Every hand each player is dealt **one free random power-up**, and you can
stock more from the shop. **Max one use per hand, only on your turn.**

| Power-up | Effect | Rarity |
|---|---|---|
| 🔄 Card Swap | Replace one of your hole cards | Common |
| 🛡️ Shield | Blocks the next offensive power-up aimed at you | Common |
| 🕶️ Blind Skip | House covers your blinds next hand | Common |
| 👁️ Peek | Secretly see an opponent's hole cards | Rare |
| 🔮 Future Sight | Secretly preview the next community card | Rare |
| 💥 Double Down | Win at showdown → house pays +50% pot bonus | Epic |
| 🪤 Pot Steal | Snatch 25% of the pot (any Shield blocks it) | Epic |
| 💀 Force Fold | Force an opponent to fold — free deal only, never sold | Legendary |

### 🎉 Spectacle
- Win celebrations scale with your hand: chip flights → confetti → cannons
  + screen shake → fireworks → lightning → **explosion card blast** →
  **Royal Flush hurricane** that sweeps the cards off the table with coin
  rain and fireworks
- **Throw or gift items**: cakes and tomatoes splat on players, confetti
  bombs burst, drinks/cookies/roses land gently
- Live chat bottom-sheet with floating emoji reactions
- Synth sound effects (WebAudio — no audio files, mute toggle on dashboard)

## 🏗️ Architecture

Zero dependencies; everything is Node built-ins + vanilla ES modules.

```
server.js              bootstrap: HTTP + WebSocket + lobby
src/
  webserver.js         static files + JSON REST routing (node:http)
  ws.js                RFC 6455 WebSocket server (replaces socket.io)
  db.js                node:sqlite schema + transactions
  auth.js              scrypt passwords, HMAC session tokens
  catalog.js           single source of truth for items/power-ups/stakes
  economy.js           coins ledger, daily bonus, bailout, stats
  shop.js              REST endpoints (auth, shop, profile)
  bots.js              bot AI
  table.js             seats, timers, bots, power-up routing, state filtering
  lobby.js             connections, tables, tournaments, reconnect
  tournament.js        sit-n-go lifecycle
poker-game.js          pure hold'em engine (side pots, power-up hooks)
public/                the client (no build step)
  js/app.js            store + screen router
  js/screens/*         auth, dashboard, lobby, shop, tournaments
  js/table/*           table renderer, action bar, chat
  js/effects/*         canvas FX engine + celebrations
tests/engine-sim.js    engine verification suite
```

**Security model**: the server never trusts the client — hole cards are
filtered per player, Peek results are sent only to the peeker's socket,
and all coin movements happen server-side inside SQL transactions.

## ☁️ Hosting note (Render free tier)

Render's **free** instances have an ephemeral disk: every deploy and every
sleep/wake cycle resets `poker.db`, which wipes accounts and coins. Two
ways to keep data forever:

### Free: cloud backup to Firebase (recommended)

The server can back up the database to a Firebase Realtime Database every
minute and restore it automatically on boot (worst case you lose the last
~60 seconds). Setup, once:

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   → **Add project** (any name, Analytics off is fine)
2. **Build → Realtime Database → Create database** → choose **locked mode**
3. **Project settings (gear) → Service accounts → Database secrets** →
   copy the secret
4. On your host set two env vars:
   - `BACKUP_URL` = `https://<your-project>-default-rtdb.firebaseio.com/holdem.json`
   - `BACKUP_SECRET` = the secret you copied
5. Redeploy. The logs will show `☁️ backup: enabled`.

Any endpoint that answers GET/PUT with JSON works — Firebase is just the
easiest free one. `JWT_SECRET` should also be set so sessions survive
restarts.

### Paid: Render disk

Upgrade the service to a paid instance, attach a **Disk** (mount path
`/data`), and set `POKER_DB=/data/poker.db`.

## 🔧 Handy env vars

| Var | Effect |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `POKER_DB` | SQLite path (default `./poker.db`) |
| `JWT_SECRET` | Session token secret (auto-generated otherwise) |
| `POKER_FAST_TOURNEY` | Tiny stacks + rapid pacing, for testing |
| `BACKUP_URL` | Cloud backup endpoint (Firebase RTDB `.json` URL) |
| `BACKUP_SECRET` | Auth secret appended to backup requests |
| `BACKUP_INTERVAL_MS` | Backup frequency (default 60000) |
| `ADMIN_USERS` | Comma-separated admin usernames (default `breezyonda1`) |

## 📝 License

MIT — deal 'em up! 🎰
