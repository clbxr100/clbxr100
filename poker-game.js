// Texas Hold'em Poker Game Logic

class PokerGame {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = [];
    this.deck = [];
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.dealerIndex = 0;
    this.currentPlayerIndex = 0;
    this.smallBlind = 10;
    this.bigBlind = 20;
    this.gameState = 'waiting'; // waiting, preflop, flop, turn, river, showdown
    this.roundBets = {};
  }

  addPlayer(playerId, playerName, avatar) {
    if (this.players.length >= 8) {
      return { success: false, message: 'Room is full' };
    }

    const player = {
      id: playerId,
      name: playerName,
      avatar: avatar,
      chips: 1000,
      cards: [],
      bet: 0,
      folded: false,
      allIn: false,
      isActive: true
    };

    this.players.push(player);
    return { success: true, player };
  }

  removePlayer(playerId) {
    const index = this.players.findIndex(p => p.id === playerId);
    if (index !== -1) {
      this.players.splice(index, 1);
      if (this.players.length < 2 && this.gameState !== 'waiting') {
        this.endGame();
      }
    }
  }

  startGame() {
    if (this.players.length < 2) {
      return { success: false, message: 'Need at least 2 players' };
    }

    this.gameState = 'preflop';
    this.createDeck();
    this.shuffleDeck();
    this.resetRound();
    this.dealHoleCards();
    this.postBlinds();

    return { success: true };
  }

  createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    this.deck = [];

    for (let suit of suits) {
      for (let rank of ranks) {
        this.deck.push({ rank, suit });
      }
    }
  }

  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  dealHoleCards() {
    this.players.forEach(player => {
      player.cards = [this.deck.pop(), this.deck.pop()];
      player.folded = false;
      player.bet = 0;
    });
  }

  postBlinds() {
    const smallBlindPlayer = this.players[(this.dealerIndex + 1) % this.players.length];
    const bigBlindPlayer = this.players[(this.dealerIndex + 2) % this.players.length];

    smallBlindPlayer.bet = this.smallBlind;
    smallBlindPlayer.chips -= this.smallBlind;
    this.pot += this.smallBlind;

    bigBlindPlayer.bet = this.bigBlind;
    bigBlindPlayer.chips -= this.bigBlind;
    this.pot += this.bigBlind;

    this.currentBet = this.bigBlind;
    this.currentPlayerIndex = (this.dealerIndex + 3) % this.players.length;
  }

  resetRound() {
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.roundBets = {};
    this.players.forEach(player => {
      player.bet = 0;
      player.folded = false;
      player.allIn = false;
    });
  }

  playerAction(playerId, action, amount = 0) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.folded) {
      return { success: false, message: 'Invalid player or already folded' };
    }

    if (this.players[this.currentPlayerIndex].id !== playerId) {
      return { success: false, message: 'Not your turn' };
    }

    switch (action) {
      case 'fold':
        player.folded = true;
        break;

      case 'call':
        const callAmount = this.currentBet - player.bet;
        if (callAmount >= player.chips) {
          this.pot += player.chips;
          player.bet += player.chips;
          player.chips = 0;
          player.allIn = true;
        } else {
          player.chips -= callAmount;
          player.bet += callAmount;
          this.pot += callAmount;
        }
        break;

      case 'raise':
        const totalBet = this.currentBet + amount;
        const raiseAmount = totalBet - player.bet;
        if (raiseAmount >= player.chips) {
          this.pot += player.chips;
          player.bet += player.chips;
          player.chips = 0;
          player.allIn = true;
        } else {
          player.chips -= raiseAmount;
          player.bet += raiseAmount;
          this.pot += raiseAmount;
          this.currentBet = totalBet;
        }
        break;

      case 'check':
        if (player.bet < this.currentBet) {
          return { success: false, message: 'Cannot check, must call or fold' };
        }
        break;

      case 'allin':
        this.pot += player.chips;
        player.bet += player.chips;
        player.chips = 0;
        player.allIn = true;
        if (player.bet > this.currentBet) {
          this.currentBet = player.bet;
        }
        break;
    }

    this.moveToNextPlayer();

    if (this.isBettingRoundComplete()) {
      this.advanceGameState();
    }

    return { success: true };
  }

  moveToNextPlayer() {
    let moved = 0;
    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      moved++;
      if (moved > this.players.length) break;
    } while (this.players[this.currentPlayerIndex].folded || this.players[this.currentPlayerIndex].allIn);
  }

  isBettingRoundComplete() {
    const activePlayers = this.players.filter(p => !p.folded && !p.allIn);
    if (activePlayers.length === 0) return true;

    const allBetsEqual = activePlayers.every(p => p.bet === this.currentBet);
    return allBetsEqual;
  }

  advanceGameState() {
    this.players.forEach(p => p.bet = 0);
    this.currentBet = 0;

    switch (this.gameState) {
      case 'preflop':
        this.gameState = 'flop';
        this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length;
        break;

      case 'flop':
        this.gameState = 'turn';
        this.communityCards.push(this.deck.pop());
        this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length;
        break;

      case 'turn':
        this.gameState = 'river';
        this.communityCards.push(this.deck.pop());
        this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length;
        break;

      case 'river':
        this.gameState = 'showdown';
        this.determineWinner();
        break;
    }
  }

  determineWinner() {
    const activePlayers = this.players.filter(p => !p.folded);

    if (activePlayers.length === 1) {
      activePlayers[0].chips += this.pot;
      return { winners: [activePlayers[0]], reason: 'All others folded' };
    }

    const playerHands = activePlayers.map(player => ({
      player,
      hand: this.evaluateHand(player.cards, this.communityCards)
    }));

    playerHands.sort((a, b) => this.compareHands(b.hand, a.hand));

    const winners = [playerHands[0]];
    for (let i = 1; i < playerHands.length; i++) {
      if (this.compareHands(playerHands[i].hand, playerHands[0].hand) === 0) {
        winners.push(playerHands[i]);
      } else {
        break;
      }
    }

    const winAmount = Math.floor(this.pot / winners.length);
    winners.forEach(w => w.player.chips += winAmount);

    return {
      winners: winners.map(w => w.player),
      hand: playerHands[0].hand.name
    };
  }

  evaluateHand(holeCards, communityCards) {
    const allCards = [...holeCards, ...communityCards];
    const combinations = this.getCombinations(allCards, 5);

    let bestHand = null;
    for (let combo of combinations) {
      const hand = this.scoreHand(combo);
      if (!bestHand || this.compareHands(hand, bestHand) > 0) {
        bestHand = hand;
      }
    }

    return bestHand;
  }

  getCombinations(arr, k) {
    if (k === 1) return arr.map(el => [el]);

    const combinations = [];
    for (let i = 0; i <= arr.length - k; i++) {
      const head = arr[i];
      const tailCombos = this.getCombinations(arr.slice(i + 1), k - 1);
      for (let combo of tailCombos) {
        combinations.push([head, ...combo]);
      }
    }
    return combinations;
  }

  scoreHand(cards) {
    const rankValues = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const sortedCards = cards.sort((a, b) => rankValues[b.rank] - rankValues[a.rank]);

    const ranks = sortedCards.map(c => rankValues[c.rank]);
    const suits = sortedCards.map(c => c.suit);
    const rankCounts = {};
    ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);

    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = this.isStraight(ranks);
    const counts = Object.values(rankCounts).sort((a, b) => b - a);

    // Royal Flush
    if (isFlush && isStraight && ranks[0] === 14) {
      return { rank: 10, name: 'Royal Flush', tiebreaker: ranks };
    }

    // Straight Flush
    if (isFlush && isStraight) {
      return { rank: 9, name: 'Straight Flush', tiebreaker: ranks };
    }

    // Four of a Kind
    if (counts[0] === 4) {
      return { rank: 8, name: 'Four of a Kind', tiebreaker: ranks };
    }

    // Full House
    if (counts[0] === 3 && counts[1] === 2) {
      return { rank: 7, name: 'Full House', tiebreaker: ranks };
    }

    // Flush
    if (isFlush) {
      return { rank: 6, name: 'Flush', tiebreaker: ranks };
    }

    // Straight
    if (isStraight) {
      return { rank: 5, name: 'Straight', tiebreaker: ranks };
    }

    // Three of a Kind
    if (counts[0] === 3) {
      return { rank: 4, name: 'Three of a Kind', tiebreaker: ranks };
    }

    // Two Pair
    if (counts[0] === 2 && counts[1] === 2) {
      return { rank: 3, name: 'Two Pair', tiebreaker: ranks };
    }

    // One Pair
    if (counts[0] === 2) {
      return { rank: 2, name: 'One Pair', tiebreaker: ranks };
    }

    // High Card
    return { rank: 1, name: 'High Card', tiebreaker: ranks };
  }

  isStraight(ranks) {
    for (let i = 0; i < ranks.length - 1; i++) {
      if (ranks[i] - ranks[i + 1] !== 1) {
        // Check for A-2-3-4-5 straight
        if (!(ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2)) {
          return false;
        }
      }
    }
    return true;
  }

  compareHands(hand1, hand2) {
    if (hand1.rank !== hand2.rank) {
      return hand1.rank - hand2.rank;
    }

    for (let i = 0; i < hand1.tiebreaker.length; i++) {
      if (hand1.tiebreaker[i] !== hand2.tiebreaker[i]) {
        return hand1.tiebreaker[i] - hand2.tiebreaker[i];
      }
    }

    return 0;
  }

  endGame() {
    this.gameState = 'waiting';
    this.communityCards = [];
    this.pot = 0;
  }

  getGameState() {
    return {
      roomId: this.roomId,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        cards: p.cards // Will be filtered by server for other players
      })),
      communityCards: this.communityCards,
      pot: this.pot,
      currentBet: this.currentBet,
      currentPlayerIndex: this.currentPlayerIndex,
      dealerIndex: this.dealerIndex,
      gameState: this.gameState
    };
  }
}

module.exports = PokerGame;
