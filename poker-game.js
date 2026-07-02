// Texas Hold'em engine with side pots, correct betting rounds, and power-ups.
// Framework-free: no timers, no sockets. The Table layer drives it and
// decides what each viewer is allowed to see.

const { POWERUPS, rollFreePowerUp } = require('./src/catalog');

const RANK_VALUES = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const HAND_NAMES = {
  1: 'High Card', 2: 'One Pair', 3: 'Two Pair', 4: 'Three of a Kind', 5: 'Straight',
  6: 'Flush', 7: 'Full House', 8: 'Four of a Kind', 9: 'Straight Flush', 10: 'Royal Flush',
};

class PokerGame {
  constructor(opts = {}) {
    this.smallBlind = opts.smallBlind || 10;
    this.bigBlind = opts.bigBlind || 20;
    this.players = []; // seat order
    this.deck = [];
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.dealerIndex = -1;
    this.currentPlayerIndex = -1;
    this.phase = 'waiting'; // waiting | preflop | flop | turn | river | handEnded
    this.actedThisRound = new Set(); // userIds
    this.handNumber = 0;
    this.powerUps = {}; // userId -> per-hand power-up state
    this.pendingBlindSkips = new Set(); // survives between hands
    this.lastHandResult = null;
    this.rand = opts.rand || Math.random;
  }

  setBlinds(sb, bb) {
    this.smallBlind = sb;
    this.bigBlind = bb;
  }

  addPlayer({ userId, name, avatar, pet, isBot, chips }) {
    if (this.players.some(p => p.userId === userId)) {
      return { success: false, message: 'Already seated' };
    }
    const player = {
      userId, name, avatar, pet: pet || null, isBot: !!isBot,
      chips, cards: [], bet: 0, totalContributed: 0,
      folded: true, allIn: false, leftTable: false,
    };
    this.players.push(player);
    return { success: true, player };
  }

  getPlayer(userId) {
    return this.players.find(p => p.userId === userId);
  }

  // Mid-hand leavers are folded and reaped between hands so seat indexes
  // stay stable while a hand is running.
  markLeft(userId) {
    const p = this.getPlayer(userId);
    if (!p) return;
    p.leftTable = true;
    if (this.inHand() && !p.folded) this.foldPlayer(p);
  }

  reapLeavers() {
    this.players = this.players.filter(p => !p.leftTable);
  }

  inHand() {
    return ['preflop', 'flop', 'turn', 'river'].includes(this.phase);
  }

  livePlayers() {
    return this.players.filter(p => !p.folded);
  }

  // Live players who can still put chips in.
  actionablePlayers() {
    return this.players.filter(p => !p.folded && !p.allIn);
  }

  // ---- Hand lifecycle -------------------------------------------------

  startHand(opts = {}) {
    this.reapLeavers();
    const eligible = this.players.filter(p => p.chips > 0);
    if (eligible.length < 2) return { success: false, message: 'Need at least 2 players with chips' };

    this.handNumber++;
    this.phase = 'preflop';
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.actedThisRound = new Set();
    this.lastHandResult = null;
    this.deck = opts.deck ? opts.deck.slice() : this.shuffledDeck();

    this.powerUps = {};
    for (const p of this.players) {
      p.cards = [];
      p.bet = 0;
      p.totalContributed = 0;
      p.allIn = false;
      p.folded = p.chips <= 0; // zero-stack players sit the hand out
      if (p.chips > 0) {
        this.powerUps[p.userId] = {
          free: opts.noPowerUps ? null : rollFreePowerUp(this.rand),
          usedThisHand: false,
          shield: false,
          doubleDown: false,
          frozen: false,
          insurance: false,
          blindfoldedFrom: null, // community index the victim stops seeing from
        };
      }
    }

    this.dealerIndex = this.nextEligibleIndex(this.dealerIndex);
    for (const p of this.players) {
      if (!p.folded) p.cards = [this.deck.pop(), this.deck.pop()];
    }
    this.postBlinds();
    return { success: true };
  }

  shuffledDeck() {
    const deck = [];
    for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  nextEligibleIndex(fromIndex) {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (fromIndex + step + n) % n;
      if (this.players[i].chips > 0) return i;
    }
    return fromIndex;
  }

  // Next index of a player still in the hand, searching from fromIndex+1.
  nextLiveIndex(fromIndex) {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (fromIndex + step) % n;
      if (!this.players[i].folded) return i;
    }
    return -1;
  }

  postBlinds() {
    const n = this.players.length;
    const headsUp = this.livePlayers().length === 2;
    // Heads-up: dealer is the small blind and acts first preflop.
    const sbIndex = headsUp ? this.liveIndexAtOrAfter(this.dealerIndex) : this.nextLiveIndex(this.dealerIndex);
    const bbIndex = this.nextLiveIndex(sbIndex);

    this.postBlind(this.players[sbIndex], this.smallBlind);
    this.postBlind(this.players[bbIndex], this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    this.currentPlayerIndex = this.nextActionableIndex(bbIndex);
    // Everyone all-in from blinds alone → run it out.
    if (this.actionablePlayers().length <= 1 && this.allBetsMatched()) {
      this.runOutBoard();
    }
  }

  liveIndexAtOrAfter(index) {
    const n = this.players.length;
    for (let step = 0; step < n; step++) {
      const i = (index + step) % n;
      if (!this.players[i].folded) return i;
    }
    return -1;
  }

  postBlind(player, amount) {
    const skip = this.pendingBlindSkips.delete(player.userId);
    const posted = Math.min(amount, skip ? amount : player.chips);
    if (!skip) {
      player.chips -= posted;
      if (player.chips === 0) player.allIn = true;
    }
    // With Blind Skip the house covers the chips: the pot and the player's
    // contribution grow but their stack is untouched.
    player.bet += posted;
    player.totalContributed += posted;
    this.pot += posted;
  }

  nextActionableIndex(fromIndex) {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (fromIndex + step) % n;
      const p = this.players[i];
      if (!p.folded && !p.allIn) return i;
    }
    return -1;
  }

  currentPlayer() {
    return this.players[this.currentPlayerIndex] || null;
  }

  // ---- Actions --------------------------------------------------------

  playerAction(userId, action, amount = 0) {
    const player = this.getPlayer(userId);
    if (!player) return { success: false, message: 'Not at this table' };
    if (!this.inHand()) return { success: false, message: 'No hand in progress' };
    if (this.currentPlayer() !== player) return { success: false, message: 'Not your turn' };
    if (player.folded || player.allIn) return { success: false, message: 'You cannot act' };

    const toCall = this.currentBet - player.bet;

    switch (action) {
      case 'fold':
        this.foldPlayer(player);
        break;

      case 'check':
        if (toCall > 0) return { success: false, message: 'Cannot check, there is a bet' };
        this.actedThisRound.add(userId);
        break;

      case 'call': {
        if (toCall <= 0) return { success: false, message: 'Nothing to call' };
        this.commitChips(player, Math.min(toCall, player.chips));
        this.actedThisRound.add(userId);
        break;
      }

      case 'raise': {
        // amount = total bet the player is raising TO
        const raiseTo = Math.floor(amount);
        const maxTo = player.bet + player.chips;
        if (raiseTo >= maxTo) return this.playerAction(userId, 'allin');
        if (raiseTo < this.currentBet + this.minRaise) {
          return { success: false, message: `Minimum raise is to ${this.currentBet + this.minRaise}` };
        }
        this.commitChips(player, raiseTo - player.bet);
        this.minRaise = raiseTo - this.currentBet;
        this.currentBet = raiseTo;
        this.actedThisRound = new Set([userId]); // reopen action
        break;
      }

      case 'allin': {
        if (player.chips <= 0) return { success: false, message: 'No chips' };
        this.commitChips(player, player.chips);
        if (player.bet > this.currentBet) {
          this.minRaise = Math.max(this.minRaise, player.bet - this.currentBet);
          this.currentBet = player.bet;
          this.actedThisRound = new Set([userId]);
        } else {
          this.actedThisRound.add(userId);
        }
        break;
      }

      default:
        return { success: false, message: 'Unknown action' };
    }

    const ended = this.afterAction();
    return { success: true, handEnded: ended };
  }

  commitChips(player, amount) {
    const chips = Math.min(amount, player.chips);
    player.chips -= chips;
    player.bet += chips;
    player.totalContributed += chips;
    this.pot += chips;
    if (player.chips === 0) player.allIn = true;
  }

  foldPlayer(player) {
    player.folded = true;
    this.actedThisRound.delete(player.userId);
  }

  // Advance turn / street / hand after any state change. Returns true if
  // the hand ended.
  afterAction() {
    if (this.livePlayers().length === 1) {
      this.endHandByFold();
      return true;
    }
    if (this.isBettingRoundComplete()) {
      return this.advanceStreet();
    }
    this.currentPlayerIndex = this.nextActionableIndex(this.currentPlayerIndex);
    return false;
  }

  allBetsMatched() {
    return this.actionablePlayers().every(p => p.bet === this.currentBet);
  }

  isBettingRoundComplete() {
    const actionable = this.actionablePlayers();
    if (actionable.length === 0) return true;
    return actionable.every(p => this.actedThisRound.has(p.userId) && p.bet === this.currentBet);
  }

  advanceStreet() {
    for (const p of this.players) p.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.actedThisRound = new Set();

    // Nobody (or only one player) can still bet → run the board out.
    if (this.actionablePlayers().length <= 1) {
      this.runOutBoard();
      return true;
    }

    switch (this.phase) {
      case 'preflop':
        this.phase = 'flop';
        this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        break;
      case 'flop':
        this.phase = 'turn';
        this.communityCards.push(this.deck.pop());
        break;
      case 'turn':
        this.phase = 'river';
        this.communityCards.push(this.deck.pop());
        break;
      case 'river':
        this.showdown();
        return true;
    }
    this.currentPlayerIndex = this.nextActionableIndex(this.dealerIndex);
    return false;
  }

  runOutBoard() {
    while (this.communityCards.length < 5) this.communityCards.push(this.deck.pop());
    this.showdown();
  }

  // ---- Hand end -------------------------------------------------------

  endHandByFold() {
    const winner = this.livePlayers()[0];
    this.refundUncalled();
    const amount = this.pot;
    winner.chips += amount;
    this.pot = 0;
    this.phase = 'handEnded';
    this.currentPlayerIndex = -1;
    const totalWonBy = { [winner.userId]: amount };
    const houseBonuses = {};
    this.payInsurance(totalWonBy, houseBonuses);
    this.lastHandResult = {
      byFold: true,
      pots: [{ amount, winners: [{ userId: winner.userId, amount }] }],
      reveals: [],
      winningHand: { rank: 0, name: 'Last one standing', userIds: [winner.userId] },
      totalWonBy,
      houseBonuses,
    };
    return this.lastHandResult;
  }

  // Insurance: losers who armed it get half their contribution back from
  // the house.
  payInsurance(totalWonBy, houseBonuses) {
    for (const p of this.players) {
      const pu = this.powerUps[p.userId];
      if (!pu || !pu.insurance || totalWonBy[p.userId] || p.totalContributed <= 0) continue;
      const refund = Math.floor(p.totalContributed * 0.5);
      if (refund > 0) {
        p.chips += refund;
        houseBonuses[p.userId] = (houseBonuses[p.userId] || 0) + refund;
      }
    }
  }

  // If the biggest contribution is not matched by anyone else still live,
  // the excess goes back to its owner before pots are built.
  refundUncalled() {
    const sorted = [...this.players].sort((a, b) => b.totalContributed - a.totalContributed);
    const top = sorted[0];
    if (!top || top.folded) return; // a folded player forfeits any excess
    const secondHighest = sorted.length > 1 ? sorted[1].totalContributed : 0;
    const excess = top.totalContributed - secondHighest;
    if (excess > 0) {
      top.totalContributed -= excess;
      top.chips += excess;
      this.pot -= excess;
      top.bet = Math.max(0, top.bet - excess);
    }
  }

  buildPots() {
    // Layered side pots from per-player total contributions.
    const contributors = this.players.filter(p => p.totalContributed > 0);
    const levels = [...new Set(contributors.map(p => p.totalContributed))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of contributors) {
        amount += Math.max(0, Math.min(p.totalContributed, level) - prev);
      }
      const eligible = contributors.filter(p => !p.folded && p.totalContributed >= level).map(p => p.userId);
      if (amount > 0) {
        const last = pots[pots.length - 1];
        // Merge layers with identical eligibility (e.g. after a steal).
        if (last && last.eligible.join(',') === eligible.join(',')) last.amount += amount;
        else pots.push({ amount, eligible });
      }
      prev = level;
    }
    // A layer nobody can win (a folded player contributed above every live
    // player) rolls down into the previous pot instead of vanishing.
    const result = [];
    let carry = 0;
    for (const pot of pots) {
      if (pot.eligible.length === 0) {
        if (result.length) result[result.length - 1].amount += pot.amount;
        else carry += pot.amount;
      } else {
        pot.amount += carry;
        carry = 0;
        result.push(pot);
      }
    }
    return result;
  }

  showdown() {
    this.refundUncalled();
    const live = this.livePlayers();
    const pots = this.buildPots();

    const evals = new Map();
    for (const p of live) {
      evals.set(p.userId, this.evaluateHand(p.cards, this.communityCards));
    }

    const potResults = [];
    const totalWonBy = {};
    let best = null;

    for (const pot of pots) {
      const contenders = pot.eligible
        .map(id => ({ userId: id, hand: evals.get(id) }))
        .filter(c => c.hand);
      if (contenders.length === 0) continue;
      contenders.sort((a, b) => compareHands(b.hand, a.hand));
      const winners = contenders.filter(c => compareHands(c.hand, contenders[0].hand) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      const winnerRows = winners.map(w => {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        const amount = share + extra;
        const player = this.getPlayer(w.userId);
        player.chips += amount;
        totalWonBy[w.userId] = (totalWonBy[w.userId] || 0) + amount;
        return { userId: w.userId, amount };
      });
      potResults.push({ amount: pot.amount, winners: winnerRows });
      if (!best || compareHands(contenders[0].hand, best.hand) > 0) {
        best = { hand: contenders[0].hand, userIds: winners.map(w => w.userId) };
      }
    }

    // Double Down: house pays winners a 50% bonus on what they dragged.
    const houseBonuses = {};
    for (const [userId, won] of Object.entries(totalWonBy)) {
      const pu = this.powerUps[userId];
      if (pu && pu.doubleDown && won > 0) {
        const bonus = Math.floor(won * 0.5);
        this.getPlayer(userId).chips += bonus;
        houseBonuses[userId] = bonus;
      }
    }
    this.payInsurance(totalWonBy, houseBonuses);

    this.pot = 0;
    this.phase = 'handEnded';
    this.currentPlayerIndex = -1;
    this.lastHandResult = {
      byFold: false,
      pots: potResults,
      reveals: live.map(p => ({
        userId: p.userId,
        cards: p.cards,
        handName: evals.get(p.userId).name,
        rank: evals.get(p.userId).rank,
      })),
      winningHand: best ? { rank: best.hand.rank, name: best.hand.name, userIds: best.userIds } : null,
      totalWonBy,
      houseBonuses,
    };
    return this.lastHandResult;
  }

  // ---- Power-ups --------------------------------------------------------

  canUsePowerUp(userId) {
    const player = this.getPlayer(userId);
    const pu = this.powerUps[userId];
    if (!player || !pu) return { ok: false, message: 'Not in this hand' };
    if (!this.inHand()) return { ok: false, message: 'No hand in progress' };
    if (this.currentPlayer() !== player) return { ok: false, message: 'Only on your turn' };
    if (pu.usedThisHand) return { ok: false, message: 'You already used a power-up this hand' };
    return { ok: true };
  }

  // source: 'free' | 'owned'. Table validates owned inventory before calling.
  usePowerUp(userId, type, { targetUserId, cardIndex, source = 'free' } = {}) {
    const def = POWERUPS[type];
    if (!def) return { success: false, message: 'Unknown power-up' };
    const gate = this.canUsePowerUp(userId);
    if (!gate.ok) return { success: false, message: gate.message };
    const pu = this.powerUps[userId];
    if (source === 'free' && pu.free !== type) return { success: false, message: 'That is not your free power-up' };

    const actor = this.getPlayer(userId);
    let target = null;
    if (def.needsTarget) {
      target = this.getPlayer(targetUserId);
      if (!target || target === actor || target.folded) {
        return { success: false, message: 'Invalid target' };
      }
    }

    const result = {
      success: true,
      handEnded: false,
      blocked: false,
      publicEvent: { userId, type, targetUserId: target ? target.userId : null },
      privateResults: [], // [{userId, payload}] routed to single sockets by Table
    };

    const consume = () => {
      pu.usedThisHand = true;
      if (source === 'free') pu.free = null;
    };

    const shieldBlocks = (victimId) => {
      const vpu = this.powerUps[victimId];
      if (vpu && vpu.shield) {
        vpu.shield = false; // consumed on block
        result.blocked = true;
        result.publicEvent.blocked = true;
        result.publicEvent.blockedBy = victimId;
        return true;
      }
      return false;
    };

    switch (type) {
      case 'pu_swap': {
        const idx = cardIndex === 1 ? 1 : 0;
        const old = actor.cards[idx];
        // Draw from the FRONT of the deck so upcoming community cards
        // (dealt from the back) are never disturbed.
        const fresh = this.deck.shift();
        actor.cards[idx] = fresh;
        consume();
        result.privateResults.push({ userId, payload: { type, swappedOut: old, swappedIn: fresh, cardIndex: idx } });
        break;
      }

      case 'pu_shield':
        pu.shield = true;
        consume();
        break;

      case 'pu_blindskip':
        this.pendingBlindSkips.add(userId);
        consume();
        break;

      case 'pu_peek': {
        consume();
        if (!shieldBlocks(target.userId)) {
          result.privateResults.push({ userId, payload: { type, targetUserId: target.userId, cards: target.cards } });
        }
        break;
      }

      case 'pu_xray': {
        if (this.phase === 'river') return { success: false, message: 'No more cards coming' };
        consume();
        const next = this.deck[this.deck.length - 1];
        result.privateResults.push({ userId, payload: { type, card: next } });
        break;
      }

      case 'pu_double':
        pu.doubleDown = true;
        consume();
        break;

      case 'pu_steal': {
        consume();
        // Any live opponent's shield guards the pot.
        const guard = this.livePlayers().find(p => p !== actor && this.powerUps[p.userId] && this.powerUps[p.userId].shield);
        if (guard && shieldBlocks(guard.userId)) break;
        const stolen = Math.floor(this.pot * 0.25);
        if (stolen > 0) this.stealFromPot(actor, stolen);
        result.publicEvent.amount = stolen;
        break;
      }

      case 'pu_freeze': {
        if (target.allIn) return { success: false, message: 'They are all-in — nothing to freeze' };
        consume();
        if (!shieldBlocks(target.userId)) {
          const tpu = this.powerUps[target.userId];
          if (tpu) tpu.frozen = true;
          result.publicEvent.frozen = true;
        }
        break;
      }

      case 'pu_insurance':
        pu.insurance = true;
        consume();
        break;

      case 'pu_blindfold': {
        if (this.phase === 'river') return { success: false, message: 'No more cards coming' };
        consume();
        if (!shieldBlocks(target.userId)) {
          const tpu = this.powerUps[target.userId];
          if (tpu && tpu.blindfoldedFrom === null) tpu.blindfoldedFrom = this.communityCards.length;
          result.publicEvent.blindfolded = true;
        }
        break;
      }

      case 'pu_forcefold': {
        if (target.allIn) return { success: false, message: 'Cannot force an all-in player to fold' };
        consume();
        if (!shieldBlocks(target.userId)) {
          this.foldPlayer(target);
          result.publicEvent.folded = true;
          result.handEnded = this.resolveAfterForcedFold(target);
        }
        break;
      }

      default:
        return { success: false, message: 'Unhandled power-up' };
    }

    return result;
  }

  // Remove chips from the pot, reducing contributions proportionally so
  // side-pot math stays truthful.
  stealFromPot(actor, amount) {
    let remaining = amount;
    const contributors = this.players.filter(p => p.totalContributed > 0);
    const total = contributors.reduce((s, p) => s + p.totalContributed, 0);
    for (const p of contributors) {
      const cut = Math.min(p.totalContributed, Math.floor(amount * (p.totalContributed / total)));
      p.totalContributed -= cut;
      remaining -= cut;
    }
    // Distribute rounding leftovers from the deepest stacks.
    contributors.sort((a, b) => b.totalContributed - a.totalContributed);
    for (const p of contributors) {
      if (remaining <= 0) break;
      const cut = Math.min(p.totalContributed, remaining);
      p.totalContributed -= cut;
      remaining -= cut;
    }
    this.pot -= amount;
    actor.chips += amount;
  }

  // A forced fold can end the hand or complete the betting round; it never
  // advances the actor's own turn (they still act after using it).
  resolveAfterForcedFold(target) {
    if (this.livePlayers().length === 1) {
      this.endHandByFold();
      return true;
    }
    if (this.isBettingRoundComplete() && this.currentPlayer() && this.actedThisRound.has(this.currentPlayer().userId)) {
      return this.advanceStreet();
    }
    return false;
  }

  // ---- Hand evaluation (static-ish helpers) -----------------------------

  evaluateHand(holeCards, communityCards) {
    const all = [...holeCards, ...communityCards];
    let best = null;
    for (const combo of combinations(all, 5)) {
      const hand = scoreHand(combo);
      if (!best || compareHands(hand, best) > 0) best = hand;
    }
    return best;
  }

  getState() {
    return {
      phase: this.phase,
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerIndex: this.dealerIndex,
      currentPlayerIndex: this.currentPlayerIndex,
      communityCards: this.communityCards,
      handNumber: this.handNumber,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      players: this.players.map(p => ({
        userId: p.userId, name: p.name, avatar: p.avatar, pet: p.pet, isBot: p.isBot,
        chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn, cards: p.cards,
      })),
      lastHandResult: this.lastHandResult,
    };
  }
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  const out = [];
  for (let i = 0; i <= arr.length - k; i++) {
    for (const tail of combinations(arr.slice(i + 1), k - 1)) {
      out.push([arr[i], ...tail]);
    }
  }
  return out;
}

function scoreHand(cards) {
  const ranks = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;

  const isFlush = suits.every(s => s === suits[0]);
  let straightHigh = 0;
  const uniq = [...new Set(ranks)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // wheel
  }

  // Groups sorted by count desc then rank desc give correct kicker order
  // for pairs / trips / quads / full houses.
  const groups = Object.entries(counts)
    .map(([r, c]) => ({ rank: Number(r), count: c }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  const tiebreaker = [];
  for (const g of groups) for (let i = 0; i < g.count; i++) tiebreaker.push(g.rank);
  const groupSizes = groups.map(g => g.count);

  let rank;
  if (isFlush && straightHigh === 14) rank = 10;
  else if (isFlush && straightHigh) rank = 9;
  else if (groupSizes[0] === 4) rank = 8;
  else if (groupSizes[0] === 3 && groupSizes[1] === 2) rank = 7;
  else if (isFlush) rank = 6;
  else if (straightHigh) rank = 5;
  else if (groupSizes[0] === 3) rank = 4;
  else if (groupSizes[0] === 2 && groupSizes[1] === 2) rank = 3;
  else if (groupSizes[0] === 2) rank = 2;
  else rank = 1;

  return {
    rank,
    name: HAND_NAMES[rank],
    tiebreaker: straightHigh ? [straightHigh] : tiebreaker,
    cards,
  };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const len = Math.max(a.tiebreaker.length, b.tiebreaker.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreaker[i] || 0) - (b.tiebreaker[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

module.exports = PokerGame;
module.exports.scoreHand = scoreHand;
module.exports.compareHands = compareHands;
module.exports.HAND_NAMES = HAND_NAMES;
