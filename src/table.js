// Table: wraps a PokerGame with everything real-time — seats, buy-ins,
// timers, bots, power-up routing, throws — and decides what each viewer
// may see. No socket code here: lobby supplies an `io` adapter with
// toUser(userId, event, data) and callbacks.

const PokerGame = require('../poker-game');
const { POWERUPS, STAKES, ECONOMY, ACHIEVEMENTS, THROWABLES, XP, levelFromXp } = require('./catalog');
const economy = require('./economy');
const social = require('./social');
const bots = require('./bots');

const TURN_MS = 30000;
const BOT_MIN_MS = 900;
const BOT_EXTRA_MS = 1800;

let tableCounter = 0;

class Table {
  constructor({ name, stakes, isPrivate, code, maxPlayers, creatorId, io, tournament = null, onEmpty, onChanged, onHumanRemoved }) {
    this.id = `t${++tableCounter}_${Math.floor(Math.random() * 1e6)}`;
    this.name = name || 'Poker Table';
    this.stakes = STAKES[stakes] ? stakes : 'low';
    this.isPrivate = !!isPrivate;
    this.code = isPrivate ? String(code || '').slice(0, 12) : null;
    this.maxPlayers = Math.min(8, Math.max(2, maxPlayers || 8));
    this.creatorId = creatorId;
    this.io = io;
    this.tournament = tournament;
    this.onEmpty = onEmpty || (() => {});
    this.onChanged = onChanged || (() => {});
    this.onHumanRemoved = onHumanRemoved || (() => {});
    this.destroyed = false;

    const s = STAKES[this.stakes];
    this.game = new PokerGame({ smallBlind: s.smallBlind, bigBlind: s.bigBlind });
    this.timers = new Map(); // label -> timeout handle
    this.turnDeadline = null;
    this.streaks = {};       // userId -> consecutive hand wins
    this.missedTurns = {};   // userId -> consecutive timeouts (auto sit-out at 2)
    this.botChatState = {};  // userId -> { lastTs, lastHand } throttle for table talk
    this.spectators = new Set(); // userIds watching without a seat
  }

  addSpectator(userId, username) {
    this.spectators.add(userId);
    if (username) this.systemChat(`👁️ ${username} is watching`);
    this.onChanged();
  }

  removeSpectator(userId) {
    this.spectators.delete(userId);
    this.onChanged();
  }

  get buyIn() {
    return STAKES[this.stakes].buyIn;
  }

  hasHumans() {
    return this.game.players.some(p => !p.isBot && !p.leftTable);
  }

  // Full pacing (bot think time, celebration windows) whenever anyone is
  // actually looking at the table.
  hasAudience() {
    return this.hasHumans() || this.spectators.size > 0;
  }

  summary() {
    return {
      tableId: this.id,
      name: this.name,
      stakes: this.stakes,
      isPrivate: this.isPrivate,
      maxPlayers: this.maxPlayers,
      seated: this.game.players.length,
      bots: this.game.players.filter(p => p.isBot).length,
      watching: this.spectators.size,
      blinds: [this.game.smallBlind, this.game.bigBlind],
      buyIn: this.buyIn,
      inHand: this.game.inHand(),
      handNumber: this.game.handNumber,
      players: this.game.players.filter(p => !p.leftTable)
        .map(p => ({ avatar: p.avatar, name: p.name, isBot: p.isBot })),
      tournamentId: this.tournament ? this.tournament.id : null,
    };
  }

  // ---- seating ---------------------------------------------------------

  addHuman(user) {
    if (this.game.players.length >= this.maxPlayers) return { error: 'Table is full' };
    if (this.game.getPlayer(user.id)) return { error: 'Already seated' };
    if (!this.tournament) {
      try {
        economy.adjustCoins(user.id, -this.buyIn, 'buyin', this.id);
      } catch (err) {
        return { error: err.message };
      }
    }
    const chips = this.tournament ? this.tournament.startingChips : this.buyIn;
    const badge = user.badge && ACHIEVEMENTS[user.badge] ? ACHIEVEMENTS[user.badge].badge : null;
    this.game.addPlayer({
      userId: user.id, name: user.username, avatar: user.avatar, pet: user.pet,
      badge, isBot: false, chips,
    });
    this.game.getPlayer(user.id).level = levelFromXp(user.xp || 0);
    this.systemChat(`${user.username} sat down`);
    // One of the bots may say hi to the newcomer.
    const seatedBots = this.game.players.filter(p => p.isBot && !p.leftTable);
    if (seatedBots.length > 0) {
      const greeter = seatedBots[Math.floor(Math.random() * seatedBots.length)];
      this.botChat(greeter.userId, 'greeting', { name: user.username });
    }
    this.afterSeatingChange();
    return { ok: true };
  }

  addBot() {
    if (this.game.players.length >= this.maxPlayers) return { error: 'Table is full' };
    const used = new Set(this.game.players.map(p => p.name));
    const bot = bots.createBot(used);
    const chips = this.tournament ? this.tournament.startingChips : this.buyIn;
    this.game.addPlayer({ ...bot, chips });
    this.botPersonalities = this.botPersonalities || {};
    this.botPersonalities[bot.userId] = bot.personality;
    this.afterSeatingChange();
    return { ok: true };
  }

  removePlayer(userId, { cashOut = true } = {}) {
    const player = this.game.getPlayer(userId);
    if (!player) return;
    if (!player.isBot && cashOut && !this.tournament && player.chips > 0) {
      economy.adjustCoins(userId, player.chips, 'cashout', this.id);
    }
    if (this.game.inHand()) this.game.markLeft(userId);
    else {
      this.game.players = this.game.players.filter(p => p.userId !== userId);
    }
    if (!player.isBot) {
      this.systemChat(`${player.name} left the table`);
      this.onHumanRemoved(userId);
    }

    const humans = this.game.players.filter(p => !p.isBot && !p.leftTable);
    if (humans.length === 0 && !this.tournament) {
      this.destroy();
      return;
    }
    // A leaver mid-hand may have been the current actor.
    if (this.game.inHand()) this.scheduleTurn();
    this.afterSeatingChange();
  }

  afterSeatingChange() {
    this.onChanged();
    this.broadcastState();
    this.maybeStartHand();
  }

  // ---- hand lifecycle ----------------------------------------------------

  maybeStartHand() {
    if (this.destroyed || this.game.inHand() || this.timers.has('nextHand')) return;
    const ready = this.game.players.filter(p => p.chips > 0 && !p.leftTable);
    if (ready.length < 2) return;
    this.setTimer('nextHand', 2500, () => this.startHand());
  }

  startHand() {
    if (this.destroyed || this.game.inHand()) return;
    if (this.tournament) this.tournament.beforeHand(this);
    const result = this.game.startHand();
    if (!result.success) return;
    this.io.toTable(this.id, 'game:handStarted', {
      handNumber: this.game.handNumber,
      dealerIndex: this.game.dealerIndex,
    });
    this.broadcastState();
    this.scheduleTurn();
  }

  scheduleTurn() {
    this.clearTimer('turn');
    this.clearTimer('bot');
    if (!this.game.inHand()) return;
    const player = this.game.currentPlayer();
    if (!player) return;

    // Frozen players lose this turn: auto check/fold after a beat.
    const pu = this.game.powerUps[player.userId];
    if (pu && pu.frozen) {
      pu.frozen = false;
      this.systemChat(`❄️ ${player.name} is frozen — turn skipped!`);
      this.io.toTable(this.id, 'game:turn', { userId: player.userId, deadline: Date.now() + 1200, frozen: true });
      this.setTimer('bot', 1100, () => this.timeoutAction(player.userId));
      return;
    }

    this.turnDeadline = Date.now() + TURN_MS;
    this.io.toTable(this.id, 'game:turn', { userId: player.userId, deadline: this.turnDeadline });

    if (player.isBot) {
      // No audience → no theater: bots think fast when nobody is watching.
      const delay = process.env.POKER_FAST_TOURNEY ? 60
        : this.hasAudience() ? BOT_MIN_MS + Math.random() * BOT_EXTRA_MS : 150;
      this.setTimer('bot', delay, () => this.botAct(player.userId));
    } else {
      this.setTimer('turn', TURN_MS, () => this.timeoutAction(player.userId));
    }
  }

  timeoutAction(userId) {
    const player = this.game.getPlayer(userId);
    if (!player || this.game.currentPlayer() !== player) return;
    const toCall = this.game.currentBet - player.bet;
    const action = toCall > 0 ? 'fold' : 'check';
    this.systemChat(`${player.name} timed out`);
    if (!player.isBot) {
      this.missedTurns[userId] = (this.missedTurns[userId] || 0) + 1;
      if (this.missedTurns[userId] >= 2 && !this.tournament) {
        player.sittingOut = true;
        this.systemChat(`⏸️ ${player.name} is sitting out (missed 2 turns)`);
        this.io.toUser(userId, 'table:sitOut', { sittingOut: true, auto: true });
      }
    }
    this.applyAction(userId, action, 0);
  }

  handleSitOut(userId, sitOut) {
    const player = this.game.getPlayer(userId);
    if (!player) return { error: 'Not seated' };
    if (this.tournament) return { error: 'No sitting out in tournaments — blinds wait for no one' };
    player.sittingOut = !!sitOut;
    if (sitOut && this.game.inHand() && !player.folded) {
      // finish this hand as a fold if it's ever their turn; mark now if acting
      if (this.game.currentPlayer() === player) this.applyAction(userId, this.game.currentBet - player.bet > 0 ? 'fold' : 'check', 0);
    }
    if (!sitOut) this.missedTurns[userId] = 0;
    this.systemChat(sitOut ? `⏸️ ${player.name} is sitting out` : `▶️ ${player.name} is back`);
    this.io.toUser(userId, 'table:sitOut', { sittingOut: !!sitOut });
    this.broadcastState();
    this.maybeStartHand();
    return { ok: true };
  }

  botAct(userId) {
    if (this.destroyed) return;
    const player = this.game.getPlayer(userId);
    if (!player || this.game.currentPlayer() !== player || !this.game.inHand()) return;

    const personality = (this.botPersonalities || {})[userId] || { aggression: 0.5, bluffRate: 0.08, jitter: 0.1 };
    const view = this.botView(player);

    // Maybe burn the free power-up first.
    const pu = this.game.powerUps[userId];
    if (pu && pu.free && !pu.usedThisHand) {
      const use = bots.maybeUsePowerUp(view, pu.free, personality);
      if (use) {
        const result = this.game.usePowerUp(userId, use.type, { ...use, source: 'free' });
        if (result.success) {
          this.announcePowerUp(userId, use.type, result);
          if (result.handEnded) return this.onHandEnd();
          this.broadcastState();
          // Re-check: force fold may have completed the round.
          if (!this.game.inHand()) return;
          if (this.game.currentPlayer() !== player) return this.scheduleTurn();
        }
      }
    }

    const decision = bots.decideAction(this.botView(player), personality);
    this.applyAction(userId, decision.action, decision.amount || 0);
  }

  botView(player) {
    return {
      holeCards: player.cards,
      communityCards: this.game.communityCards,
      phase: this.game.phase,
      pot: this.game.pot,
      currentBet: this.game.currentBet,
      minRaise: this.game.minRaise,
      myBet: player.bet,
      myChips: player.chips,
      bigBlind: this.game.bigBlind,
      numLive: this.game.livePlayers().length,
      opponents: this.game.players
        .filter(p => p !== player)
        .map(p => ({ userId: p.userId, folded: p.folded, allIn: p.allIn, bet: p.bet, chips: p.chips })),
    };
  }

  // Human action entry point.
  handleAction(userId, action, amount) {
    const player = this.game.getPlayer(userId);
    if (!player) return { error: 'Not seated' };
    this.missedTurns[userId] = 0; // acted on their own — not AFK
    return this.applyAction(userId, action, amount);
  }

  applyAction(userId, action, amount) {
    const actor = this.game.getPlayer(userId);
    const facing = actor ? this.game.currentBet - actor.bet : 0; // before the action mutates bets
    const result = this.game.playerAction(userId, action, amount);
    if (!result.success) return { error: result.message };
    this.io.toTable(this.id, 'game:action', { userId, action, amount: amount || 0 });
    if (actor && actor.isBot) {
      if (action === 'allin') this.botChat(userId, 'allin');
      else if (action === 'fold' && facing >= this.game.bigBlind * 6) this.botChat(userId, 'fold_grumble');
    }
    if (actor && !actor.isBot && action === 'allin') economy.bumpQuest(userId, 'q_allin1');
    if (result.handEnded || !this.game.inHand()) {
      this.onHandEnd();
    } else {
      this.broadcastState();
      this.scheduleTurn();
    }
    return { ok: true };
  }

  // ---- power-ups ---------------------------------------------------------

  handleUsePowerUp(userId, { type, source, targetUserId, cardIndex }) {
    const def = POWERUPS[type];
    if (!def) return { error: 'Unknown power-up' };
    const player = this.game.getPlayer(userId);
    if (!player) return { error: 'Not seated' };

    const src = source === 'owned' ? 'owned' : 'free';
    if (src === 'owned') {
      if (player.isBot) return { error: 'Bots cannot own power-ups' };
      const gate = this.game.canUsePowerUp(userId);
      if (!gate.ok) return { error: gate.message };
      if (!economy.consumeItem(userId, type)) return { error: 'You do not own that power-up' };
    }

    const result = this.game.usePowerUp(userId, type, { targetUserId, cardIndex, source: src });
    if (!result.success) {
      if (src === 'owned') economy.addItem(userId, type, 1); // refund the consumable
      return { error: result.message };
    }

    if (!player.isBot) {
      economy.addStats(userId, { powerups_used: 1 });
      economy.bumpQuest(userId, 'q_power2');
    }
    this.announcePowerUp(userId, type, result);
    if (result.handEnded) this.onHandEnd();
    else {
      this.broadcastState();
      this.scheduleTurn(); // actor still owns the turn; refresh timer state
    }
    return { ok: true };
  }

  announcePowerUp(userId, type, result) {
    this.io.toTable(this.id, 'game:powerUpUsed', result.publicEvent);
    for (const priv of result.privateResults) {
      this.io.toUser(priv.userId, 'game:powerUpResult', priv.payload);
    }
    // Persistent record in chat so nobody argues about what happened.
    const def = POWERUPS[type];
    const actor = this.game.getPlayer(userId);
    const ev = result.publicEvent;
    const target = ev.targetUserId ? this.game.getPlayer(ev.targetUserId) : null;
    let text = `${def.emoji} ${actor ? actor.name : '?'} used ${def.name}`;
    if (target) text += ` on ${target.name}`;
    if (ev.blocked) text += ' — blocked by a Shield 🛡️';
    else if (type === 'pu_steal') text += ` and took ${ev.amount} (pot is now ${this.game.pot})`;
    this.systemChat(text);
  }

  // ---- throws / chat -------------------------------------------------------

  handleThrow(userId, { itemId, targetUserId }) {
    const thrower = this.game.getPlayer(userId);
    const target = this.game.getPlayer(targetUserId);
    if (!thrower || !target) return { error: 'Invalid throw' };
    if (thrower.isBot) return { error: 'Nope' };
    if (!economy.consumeItem(userId, itemId)) return { error: 'You have none left — visit the shop!' };
    economy.addStats(userId, { items_thrown: 1 });
    economy.bumpQuest(userId, 'q_throw1');
    if (THROWABLES[itemId] && THROWABLES[itemId].kind === 'gift') economy.bumpQuest(userId, 'q_gift1');
    this.io.toTable(this.id, 'throw:item', { fromUserId: userId, targetUserId, itemId });
    if (target.isBot) {
      const def = THROWABLES[itemId];
      this.botChat(targetUserId, 'hit_by_item', { item: def ? def.emoji : 'that' });
    }
    return { ok: true };
  }

  systemChat(text) {
    this.io.toTable(this.id, 'chat:message', { system: true, text, ts: Date.now() });
  }

  // Bot table talk. Rolls the bot's chattiness (inside bots.chatLine), applies
  // a per-bot throttle so nobody spams, and sends the line after a human-ish
  // pause as a regular player chat message.
  botChat(userId, event, ctx = {}) {
    if (this.destroyed || !this.hasHumans()) return;
    const player = this.game.getPlayer(userId);
    if (!player || !player.isBot || player.leftTable) return;
    const personality = (this.botPersonalities || {})[userId];
    if (!personality) return;

    // At most ~1 line per bot per couple of hands (greetings only skip the
    // hand gate — the table may be brand new).
    const st = this.botChatState[userId] || { lastTs: 0, lastHand: -10 };
    const now = Date.now();
    if (event !== 'greeting' && this.game.handNumber - st.lastHand < 2) return;
    if (now - st.lastTs < 20000) return;

    const text = bots.chatLine(event, ctx, personality);
    if (!text) return;
    this.botChatState[userId] = { lastTs: now, lastHand: this.game.handNumber };

    const delay = 600 + Math.random() * 1900;
    this.setTimer(`chat_${userId}`, delay, () => {
      if (this.destroyed || !this.hasHumans()) return;
      this.io.toTable(this.id, 'chat:message', {
        userId, username: player.name, avatar: player.avatar, text, ts: Date.now(),
      });
    });
  }

  // ---- hand end ------------------------------------------------------------

  onHandEnd() {
    this.clearTimer('turn');
    this.clearTimer('bot');
    const result = this.game.lastHandResult;
    if (!result) return;

    const winnerRank = result.winningHand ? result.winningHand.rank : 0;

    // Economy + stats for humans (cash tables only pay coin bonuses).
    for (const p of this.game.players) {
      if (p.isBot || p.cards.length === 0) continue;
      economy.addStats(p.userId, { hands_played: 1 });
      economy.bumpQuest(p.userId, 'q_play10');
      economy.bumpQuest(p.userId, 'q_hands25');
      economy.addXp(p.userId, XP.rewards.handPlayed);
    }
    // Win streaks: winners heat up, everyone else dealt in cools off.
    const wonIds = new Set(Object.keys(result.totalWonBy || {}).map(String));
    for (const p of this.game.players) {
      if (p.cards.length === 0) continue;
      if (wonIds.has(String(p.userId))) {
        this.streaks[p.userId] = (this.streaks[p.userId] || 0) + 1;
        if (this.streaks[p.userId] === 3) this.systemChat(`🔥 ${p.name} is on a 3-hand heater!`);
        if (this.streaks[p.userId] === 5) this.systemChat(`🔥🔥 ${p.name} is UNSTOPPABLE — 5 in a row!`);
        if (!p.isBot) {
          economy.maxStat(p.userId, 'best_streak', this.streaks[p.userId]);
          social.bumpWeeklyWin(p.userId);
        }
      } else {
        this.streaks[p.userId] = 0;
      }
    }
    // Hand recap for the chat log.
    const recapNames = Object.keys(result.totalWonBy || {})
      .map(id => { const p = this.game.getPlayer(id); return p ? p.name : '?'; }).join(', ');
    const recapTotal = Object.values(result.totalWonBy || {}).reduce((s, x) => s + x, 0);
    const how = result.byFold ? 'everyone folded' : (result.winningHand ? result.winningHand.name : '');
    this.systemChat(`🏁 Hand #${this.game.handNumber}: ${recapNames} won ${recapTotal} (${how})`);

    // Bot table talk about how the hand went (throttled inside botChat).
    const bigPot = recapTotal >= this.game.bigBlind * 15;
    for (const p of this.game.players) {
      if (!p.isBot || p.leftTable || p.cards.length === 0) continue;
      const won = (result.totalWonBy || {})[p.userId];
      if (won) this.botChat(p.userId, 'win', { amount: won });
      else if (bigPot && !p.folded && !result.byFold) this.botChat(p.userId, 'lose_big', { amount: recapTotal });
      else if (winnerRank >= 8) this.botChat(p.userId, 'big_hand', {});
    }

    for (const [userId, won] of Object.entries(result.totalWonBy || {})) {
      const p = this.game.getPlayer(userId);
      if (!p || p.isBot) continue;
      economy.addStats(userId, { hands_won: 1 });
      economy.bumpQuest(userId, 'q_win3');
      economy.bumpQuest(userId, 'q_win5');
      if (won >= 1000) economy.bumpQuest(userId, 'q_bigpot1k');
      economy.addXp(userId, XP.rewards.handWon);
      if (result.winningHand && result.winningHand.rank >= 8 && result.winningHand.userIds.map(String).includes(String(userId))) {
        economy.addXp(userId, XP.rewards.bigHand);
      }
      economy.maxStat(userId, 'biggest_pot', won);
      if (!this.tournament) {
        let bonus = ECONOMY.handWinBonus;
        const reveal = (result.reveals || []).find(r => r.userId === userId);
        if (reveal) {
          economy.maxStat(userId, 'best_hand_rank', reveal.rank);
          if (result.winningHand && result.winningHand.userIds.includes(userId)) {
            bonus += ECONOMY.bigHandBonus[result.winningHand.rank] || 0;
          }
        }
        economy.adjustCoins(userId, bonus, 'win_bonus', this.id);
        this.io.toUser(userId, 'profile:update', { coinsDelta: bonus });
      }
    }

    // Winners' equipped celebration themes ride along for the client FX.
    const celebrations = {};
    for (const userId of Object.keys(result.totalWonBy || {})) {
      const p = this.game.getPlayer(userId);
      if (p && !p.isBot) {
        const theme = economy.getEquippedCelebration(userId);
        if (theme) celebrations[userId] = theme;
      }
    }
    this.io.toTable(this.id, 'game:handEnded', { result, celebrations });
    this.broadcastState();

    // Stats just moved — see if anyone crossed an achievement threshold.
    for (const p of this.game.players) {
      if (!p.isBot && p.cards.length > 0) social.checkAchievements(p.userId);
    }

    if (this.tournament) {
      this.tournament.onHandEnd(this, result);
      if (this.destroyed || this.tournament.finished) return;
    } else {
      // Busted bots re-buy from the house; busted humans go back to the lobby.
      for (const p of [...this.game.players]) {
        if (p.chips > 0 || p.leftTable) continue;
        if (p.isBot) {
          p.chips = this.buyIn;
          this.systemChat(`${p.name} re-bought for ${this.buyIn}`);
        } else {
          this.io.toUser(p.userId, 'table:busted', { tableId: this.id });
          this.removePlayer(p.userId, { cashOut: false });
        }
      }
    }

    // Celebration window scales with the winning hand.
    const delay = process.env.POKER_FAST_TOURNEY ? 500
      : this.hasAudience() ? 3500 + Math.min(6000, winnerRank * 600) : 600;
    this.setTimer('nextHand', delay, () => {
      this.clearTimer('nextHand');
      this.startHand();
    });
    // maybeStartHand guard: timer set above covers restart
  }

  // ---- state fan-out --------------------------------------------------------

  broadcastState() {
    if (this.destroyed) return;
    for (const p of this.game.players) {
      if (!p.isBot && !p.leftTable) {
        this.io.toUser(p.userId, 'table:state', this.filterFor(p.userId));
      }
    }
    for (const userId of this.spectators) {
      this.io.toUser(userId, 'table:state', this.filterFor(userId));
    }
  }

  filterFor(viewerId) {
    const g = this.game;
    const showdown = g.phase === 'handEnded' && g.lastHandResult && !g.lastHandResult.byFold;
    const revealed = new Map();
    if (showdown) {
      for (const r of g.lastHandResult.reveals) revealed.set(r.userId, r);
    }

    const viewer = g.getPlayer(viewerId);
    const pu = g.powerUps[viewerId];

    // Blindfolded viewers see later community cards face-down until showdown.
    let community = g.communityCards;
    if (pu && pu.blindfoldedFrom !== null && g.phase !== 'handEnded') {
      community = g.communityCards.map((c, i) => (i >= pu.blindfoldedFrom ? { hidden: true } : c));
    }

    return {
      tableId: this.id,
      name: this.name,
      stakes: this.stakes,
      isPrivate: this.isPrivate,
      code: this.code, // seated players may share invite links
      phase: g.phase,
      pot: g.pot,
      currentBet: g.currentBet,
      minRaise: g.minRaise,
      dealerIndex: g.dealerIndex,
      currentPlayerIndex: g.currentPlayerIndex,
      communityCards: community,
      handNumber: g.handNumber,
      smallBlind: g.smallBlind,
      bigBlind: g.bigBlind,
      turnDeadline: this.turnDeadline,
      tournament: this.tournament ? this.tournament.publicInfo() : null,
      lastHandResult: g.phase === 'handEnded' ? g.lastHandResult : null,
      blindfolded: !!(pu && pu.blindfoldedFrom !== null && g.phase !== 'handEnded'),
      players: g.players.filter(p => !p.leftTable).map(p => {
        const ppu = g.powerUps[p.userId];
        let cards;
        if (p.userId === viewerId) cards = p.cards;
        else if (revealed.has(p.userId)) cards = revealed.get(p.userId).cards;
        else cards = p.cards.map(() => ({ hidden: true }));
        return {
          userId: p.userId, name: p.name, avatar: p.avatar, pet: p.pet, badge: p.badge, level: p.level || null, isBot: p.isBot,
          chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn, cards,
          shield: !!(ppu && ppu.shield),
          usedPowerUp: !!(ppu && ppu.usedThisHand),
          sittingOut: p.sittingOut,
          streak: this.streaks[p.userId] || 0,
        };
      }),
      you: viewer ? {
        userId: viewerId,
        seatIndex: g.players.filter(p => !p.leftTable).findIndex(p => p.userId === viewerId),
        freePowerUp: pu ? pu.free : null,
        usedPowerUp: !!(pu && pu.usedThisHand),
        canAct: g.inHand() && g.currentPlayer() === viewer,
        toCall: viewer ? Math.max(0, g.currentBet - viewer.bet) : 0,
      } : null,
    };
  }

  // ---- timers ----------------------------------------------------------------

  setTimer(label, ms, fn) {
    this.clearTimer(label);
    this.timers.set(label, setTimeout(() => {
      this.timers.delete(label);
      if (!this.destroyed) fn();
    }, ms));
  }

  clearTimer(label) {
    const t = this.timers.get(label);
    if (t) clearTimeout(t);
    this.timers.delete(label);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    // Cash out any remaining humans defensively.
    for (const p of this.game.players) {
      if (!p.isBot && !this.tournament && p.chips > 0 && !p.leftTable) {
        try { economy.adjustCoins(p.userId, p.chips, 'cashout', this.id); } catch { /* logged elsewhere */ }
        this.io.toUser(p.userId, 'table:closed', { tableId: this.id });
      }
    }
    for (const userId of this.spectators) {
      this.io.toUser(userId, 'table:closed', { tableId: this.id });
    }
    this.spectators.clear();
    this.onEmpty(this);
  }
}

module.exports = Table;
