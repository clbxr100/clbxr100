// Table: wraps a PokerGame with everything real-time — seats, buy-ins,
// timers, bots, power-up routing, throws — and decides what each viewer
// may see. No socket code here: lobby supplies an `io` adapter with
// toUser(userId, event, data) and callbacks.

const PokerGame = require('../poker-game');
const { POWERUPS, STAKES, ECONOMY } = require('./catalog');
const economy = require('./economy');
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
  }

  get buyIn() {
    return STAKES[this.stakes].buyIn;
  }

  hasHumans() {
    return this.game.players.some(p => !p.isBot && !p.leftTable);
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
      blinds: [this.game.smallBlind, this.game.bigBlind],
      buyIn: this.buyIn,
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
    this.game.addPlayer({
      userId: user.id, name: user.username, avatar: user.avatar, pet: user.pet,
      isBot: false, chips,
    });
    this.systemChat(`${user.username} sat down`);
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

    this.turnDeadline = Date.now() + TURN_MS;
    this.io.toTable(this.id, 'game:turn', { userId: player.userId, deadline: this.turnDeadline });

    if (player.isBot) {
      // No spectators → no theater: bots think fast when only bots remain.
      const delay = process.env.POKER_FAST_TOURNEY ? 60
        : this.hasHumans() ? BOT_MIN_MS + Math.random() * BOT_EXTRA_MS : 150;
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
    this.applyAction(userId, action, 0);
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
    return this.applyAction(userId, action, amount);
  }

  applyAction(userId, action, amount) {
    const result = this.game.playerAction(userId, action, amount);
    if (!result.success) return { error: result.message };
    this.io.toTable(this.id, 'game:action', { userId, action, amount: amount || 0 });
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

    if (!player.isBot) economy.addStats(userId, { powerups_used: 1 });
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
  }

  // ---- throws / chat -------------------------------------------------------

  handleThrow(userId, { itemId, targetUserId }) {
    const thrower = this.game.getPlayer(userId);
    const target = this.game.getPlayer(targetUserId);
    if (!thrower || !target) return { error: 'Invalid throw' };
    if (thrower.isBot) return { error: 'Nope' };
    if (!economy.consumeItem(userId, itemId)) return { error: 'You have none left — visit the shop!' };
    economy.addStats(userId, { items_thrown: 1 });
    this.io.toTable(this.id, 'throw:item', { fromUserId: userId, targetUserId, itemId });
    return { ok: true };
  }

  systemChat(text) {
    this.io.toTable(this.id, 'chat:message', { system: true, text, ts: Date.now() });
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
    }
    for (const [userId, won] of Object.entries(result.totalWonBy || {})) {
      const p = this.game.getPlayer(userId);
      if (!p || p.isBot) continue;
      economy.addStats(userId, { hands_won: 1 });
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

    this.io.toTable(this.id, 'game:handEnded', { result });
    this.broadcastState();

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
      : this.hasHumans() ? 3500 + Math.min(6000, winnerRank * 600) : 600;
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

    return {
      tableId: this.id,
      name: this.name,
      stakes: this.stakes,
      isPrivate: this.isPrivate,
      phase: g.phase,
      pot: g.pot,
      currentBet: g.currentBet,
      minRaise: g.minRaise,
      dealerIndex: g.dealerIndex,
      currentPlayerIndex: g.currentPlayerIndex,
      communityCards: g.communityCards,
      handNumber: g.handNumber,
      smallBlind: g.smallBlind,
      bigBlind: g.bigBlind,
      turnDeadline: this.turnDeadline,
      tournament: this.tournament ? this.tournament.publicInfo() : null,
      lastHandResult: g.phase === 'handEnded' ? g.lastHandResult : null,
      players: g.players.filter(p => !p.leftTable).map(p => {
        const ppu = g.powerUps[p.userId];
        let cards;
        if (p.userId === viewerId) cards = p.cards;
        else if (revealed.has(p.userId)) cards = revealed.get(p.userId).cards;
        else cards = p.cards.map(() => ({ hidden: true }));
        return {
          userId: p.userId, name: p.name, avatar: p.avatar, pet: p.pet, isBot: p.isBot,
          chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn, cards,
          shield: !!(ppu && ppu.shield),
          usedPowerUp: !!(ppu && ppu.usedThisHand),
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
    this.onEmpty(this);
  }
}

module.exports = Table;
