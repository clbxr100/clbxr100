// Single-table sit-n-go: entry fees, escalating blinds, eliminations, payouts.
const { TOURNAMENT, ECONOMY } = require('./catalog');
const economy = require('./economy');

let tournamentCounter = 0;

class Tournament {
  constructor({ name, entryFee, maxPlayers, fillBots, creatorId, io, onChanged, onFinished, createTable }) {
    this.id = `sng${++tournamentCounter}_${Math.floor(Math.random() * 1e6)}`;
    this.name = name || 'Sit & Go';
    this.entryFee = ECONOMY.tournamentFees.includes(entryFee) ? entryFee : ECONOMY.tournamentFees[0];
    this.maxPlayers = Math.min(8, Math.max(2, maxPlayers || 6));
    this.fillBots = !!fillBots;
    this.creatorId = creatorId;
    this.io = io;
    this.onChanged = onChanged || (() => {});
    this.onFinished = onFinished || (() => {});
    this.createTable = createTable;

    this.state = 'registering'; // registering | running | finished
    this.finished = false;
    this.entrants = []; // {userId, username, avatar, pet, isBot}
    this.placements = []; // filled bottom-up; index not meaningful until finish
    this.handsPlayed = 0;
    this.level = 0;
    this.table = null;
    this.startingChips = TOURNAMENT.startingChips;
  }

  summary() {
    return {
      tournamentId: this.id,
      name: this.name,
      entryFee: this.entryFee,
      maxPlayers: this.maxPlayers,
      fillBots: this.fillBots,
      state: this.state,
      entrants: this.entrants.map(e => ({ username: e.username, avatar: e.avatar, isBot: e.isBot })),
      creatorId: this.creatorId,
      prizePool: this.entryFee * (this.state === 'registering' ? this.maxPlayers : this.entrants.length),
    };
  }

  publicInfo() {
    const [sb, bb] = TOURNAMENT.blindLevels[Math.min(this.level, TOURNAMENT.blindLevels.length - 1)];
    return {
      tournamentId: this.id,
      name: this.name,
      level: this.level + 1,
      blinds: [sb, bb],
      handsPerLevel: TOURNAMENT.handsPerLevel,
      handsIntoLevel: this.handsPlayed % TOURNAMENT.handsPerLevel,
      remaining: this.table ? this.table.game.players.filter(p => !p.leftTable).length : this.entrants.length,
      prizePool: this.entryFee * this.entrants.length,
    };
  }

  join(user) {
    if (this.state !== 'registering') return { error: 'Tournament already started' };
    if (this.entrants.some(e => e.userId === user.id)) return { error: 'Already registered' };
    if (this.entrants.length >= this.maxPlayers) return { error: 'Tournament is full' };
    try {
      economy.adjustCoins(user.id, -this.entryFee, 'tourney_entry', this.id);
    } catch (err) {
      return { error: err.message };
    }
    this.entrants.push({ userId: user.id, username: user.username, avatar: user.avatar, pet: user.pet, isBot: false });
    economy.addStats(user.id, { tournaments_played: 1 });
    this.onChanged();
    if (this.entrants.length >= this.maxPlayers) this.start();
    return { ok: true, started: this.state === 'running' };
  }

  leave(userId) {
    if (this.state !== 'registering') return { error: 'Cannot leave a running tournament' };
    const idx = this.entrants.findIndex(e => e.userId === userId);
    if (idx < 0) return { error: 'Not registered' };
    this.entrants.splice(idx, 1);
    economy.adjustCoins(userId, this.entryFee, 'tourney_refund', this.id);
    this.onChanged();
    return { ok: true };
  }

  start(byUserId = null) {
    if (this.state !== 'registering') return { error: 'Already started' };
    if (byUserId && byUserId !== this.creatorId) return { error: 'Only the host can start' };
    const humans = this.entrants.length;
    if (humans < 1) return { error: 'Nobody registered' };
    if (!this.fillBots && humans < 2) return { error: 'Need at least 2 players' };

    this.state = 'running';
    this.table = this.createTable(this);
    for (const e of this.entrants) {
      this.table.game.addPlayer({
        userId: e.userId, name: e.username, avatar: e.avatar, pet: e.pet,
        isBot: false, chips: this.startingChips,
      });
    }
    for (const e of this.entrants) {
      this.io.toUser(e.userId, 'tournament:started', { tournamentId: this.id, tableId: this.table.id });
      this.io.toUser(e.userId, 'table:joined', { tableId: this.table.id, state: this.table.filterFor(e.userId) });
    }
    if (this.fillBots) {
      while (this.table.game.players.length < this.maxPlayers) {
        this.table.addBot();
        const bot = this.table.game.players[this.table.game.players.length - 1];
        this.entrants.push({ userId: bot.userId, username: bot.name, avatar: bot.avatar, isBot: true });
      }
    }
    this.onChanged();
    this.table.afterSeatingChange();
    return { ok: true, tableId: this.table.id };
  }

  beforeHand(table) {
    const next = Math.floor(this.handsPlayed / TOURNAMENT.handsPerLevel);
    if (next !== this.level) {
      this.level = next;
      const [sb, bb] = TOURNAMENT.blindLevels[Math.min(this.level, TOURNAMENT.blindLevels.length - 1)];
      table.game.setBlinds(sb, bb);
      this.io.toTable(table.id, 'tournament:blindsUp', { level: this.level + 1, blinds: [sb, bb] });
    }
  }

  onHandEnd(table, result) {
    this.handsPlayed++;

    // Eliminate busted players — shortest pre-hand stack gets the worse place.
    const busted = table.game.players.filter(p => p.chips <= 0 && !p.leftTable);
    for (const p of busted) {
      const remainingBefore = table.game.players.filter(x => !x.leftTable).length;
      const place = remainingBefore; // last of those still seated
      this.placements.push({ userId: p.userId, username: p.name, isBot: p.isBot, place });
      this.io.toTable(table.id, 'tournament:eliminated', { userId: p.userId, username: p.name, place });
      table.removePlayer(p.userId, { cashOut: false });
      if (!p.isBot) this.io.toUser(p.userId, 'tournament:yourPlace', { tournamentId: this.id, place });
    }

    const remaining = table.game.players.filter(p => !p.leftTable);
    if (remaining.length <= 1) this.finish(remaining[0] || null);
  }

  finish(winner) {
    if (this.finished) return;
    this.finished = true;
    this.state = 'finished';
    if (winner) {
      this.placements.push({ userId: winner.userId, username: winner.name, isBot: winner.isBot, place: 1 });
      if (!winner.isBot) economy.addStats(winner.userId, { tournaments_won: 1 });
    }
    this.placements.sort((a, b) => a.place - b.place);

    // House covers bot entries so the advertised pool is always real.
    const pool = this.entryFee * this.entrants.length;
    const n = this.entrants.length;
    const split = n >= 6 ? [0.6, 0.3, 0.1] : n >= 4 ? [0.7, 0.3] : [1];
    const payouts = [];
    split.forEach((frac, i) => {
      const row = this.placements[i];
      if (!row) return;
      const amount = Math.floor(pool * frac);
      payouts.push({ ...row, amount });
      if (!row.isBot) {
        economy.adjustCoins(row.userId, amount, 'tourney_payout', this.id);
        this.io.toUser(row.userId, 'profile:update', { coinsDelta: amount });
      }
    });

    if (this.table) {
      this.io.toTable(this.table.id, 'tournament:finished', {
        tournamentId: this.id,
        placements: this.placements,
        payouts,
      });
      this.table.destroy();
    }
    this.onChanged();
    this.onFinished(this);
  }
}

module.exports = Tournament;
