// Bot AI for Poker Game

class BotAI {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty; // easy, medium, hard
    this.personality = this.generatePersonality();
  }

  generatePersonality() {
    const styles = ['tight', 'loose', 'aggressive', 'passive', 'balanced'];
    return {
      style: styles[Math.floor(Math.random() * styles.length)],
      bluffFrequency: Math.random() * 0.3, // 0-30% chance to bluff
      aggression: Math.random() * 0.5 + 0.3 // 0.3-0.8 aggression
    };
  }

  makeDecision(player, gameState) {
    const { players, communityCards, currentBet, pot, gameState: phase } = gameState;
    const callAmount = currentBet - player.bet;

    // Calculate hand strength
    const handStrength = this.evaluateHandStrength(player.cards, communityCards, phase);

    // Calculate pot odds
    const potOdds = callAmount > 0 ? callAmount / (pot + callAmount) : 0;

    // Position factor (later position = more aggressive)
    const playerIndex = players.findIndex(p => p.id === player.id);
    const position = playerIndex / players.length;

    // Make decision based on difficulty
    return this.decideAction(handStrength, callAmount, potOdds, position, player.chips, pot);
  }

  evaluateHandStrength(holeCards, communityCards, phase) {
    if (!holeCards || holeCards.length < 2) return 0;

    const rankValues = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

    const card1Value = rankValues[holeCards[0].rank];
    const card2Value = rankValues[holeCards[1].rank];
    const isPair = card1Value === card2Value;
    const isSuited = holeCards[0].suit === holeCards[1].suit;
    const highCard = Math.max(card1Value, card2Value);
    const gap = Math.abs(card1Value - card2Value);

    let strength = 0;

    // Pre-flop hand strength
    if (phase === 'preflop') {
      // Premium pairs
      if (isPair && card1Value >= 10) strength = 0.9;
      else if (isPair && card1Value >= 7) strength = 0.7;
      else if (isPair) strength = 0.5;
      // High cards
      else if (highCard === 14) strength = 0.6; // Ace
      else if (highCard >= 12) strength = 0.5; // K or Q
      else if (highCard >= 10) strength = 0.4;
      else strength = 0.3;

      // Suited bonus
      if (isSuited) strength += 0.1;

      // Connected cards bonus
      if (gap <= 1 && highCard >= 10) strength += 0.1;

      return Math.min(strength, 1);
    }

    // Post-flop evaluation (simplified)
    const allCards = [...holeCards, ...communityCards];
    const ranks = allCards.map(c => rankValues[c.rank]);
    const suits = allCards.map(c => c.suit);

    // Count pairs, suits, etc.
    const rankCounts = {};
    ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
    const suitCounts = {};
    suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);

    const maxRankCount = Math.max(...Object.values(rankCounts));
    const maxSuitCount = Math.max(...Object.values(suitCounts));

    // Estimate hand strength
    if (maxRankCount >= 4) strength = 0.95; // Four of a kind or better
    else if (maxRankCount === 3) strength = 0.75; // Three of a kind or full house
    else if (maxRankCount === 2) {
      const pairs = Object.values(rankCounts).filter(c => c === 2).length;
      strength = pairs >= 2 ? 0.6 : 0.5; // Two pair or one pair
    } else {
      strength = 0.3; // High card
    }

    // Flush potential
    if (maxSuitCount >= 5) strength = Math.max(strength, 0.85);
    else if (maxSuitCount >= 4) strength += 0.1; // Flush draw

    // Straight potential (simplified check)
    const sortedRanks = [...new Set(ranks)].sort((a, b) => a - b);
    let consecutive = 1;
    let maxConsecutive = 1;
    for (let i = 1; i < sortedRanks.length; i++) {
      if (sortedRanks[i] - sortedRanks[i - 1] === 1) {
        consecutive++;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      } else {
        consecutive = 1;
      }
    }
    if (maxConsecutive >= 5) strength = Math.max(strength, 0.8);
    else if (maxConsecutive >= 4) strength += 0.1; // Straight draw

    return Math.min(strength, 1);
  }

  decideAction(handStrength, callAmount, potOdds, position, chips, pot) {
    // Add randomness based on difficulty
    let threshold = handStrength;

    if (this.difficulty === 'easy') {
      threshold += (Math.random() - 0.5) * 0.4; // More random
    } else if (this.difficulty === 'medium') {
      threshold += (Math.random() - 0.5) * 0.2;
    } else {
      threshold += (Math.random() - 0.5) * 0.1; // Less random
    }

    // Apply personality
    if (this.personality.style === 'aggressive') {
      threshold += 0.1;
    } else if (this.personality.style === 'tight') {
      threshold -= 0.1;
    }

    // If no bet to call, might check or bet
    if (callAmount === 0) {
      if (threshold > 0.6) {
        // Strong hand - bet/raise
        const raiseAmount = Math.floor(pot * 0.5 * this.personality.aggression);
        return { action: 'raise', amount: Math.min(raiseAmount, chips) };
      } else if (threshold > 0.4 && Math.random() < this.personality.bluffFrequency) {
        // Bluff
        const bluffAmount = Math.floor(pot * 0.3);
        return { action: 'raise', amount: Math.min(bluffAmount, chips) };
      } else {
        return { action: 'check' };
      }
    }

    // There's a bet to call
    const callRatio = callAmount / chips;

    // Very strong hand
    if (threshold > 0.8) {
      if (callRatio < 0.5 && Math.random() < this.personality.aggression) {
        const raiseAmount = Math.floor(callAmount * 2 + pot * 0.3);
        return { action: 'raise', amount: Math.min(raiseAmount, chips - callAmount) };
      }
      return { action: 'call' };
    }

    // Strong hand
    if (threshold > 0.6) {
      if (callRatio < 0.3 && Math.random() < 0.3) {
        const raiseAmount = Math.floor(callAmount * 1.5);
        return { action: 'raise', amount: Math.min(raiseAmount, chips - callAmount) };
      }
      return { action: 'call' };
    }

    // Medium hand - check pot odds
    if (threshold > 0.4) {
      if (potOdds < 0.3 || callRatio < 0.2) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // Weak hand - mostly fold, sometimes bluff
    if (Math.random() < this.personality.bluffFrequency && callRatio < 0.1) {
      return { action: 'call' };
    }

    return { action: 'fold' };
  }

  // Get thinking time (more realistic)
  getThinkingTime() {
    const base = 1000; // 1 second base
    const variance = Math.random() * 2000; // 0-2 seconds variance
    return base + variance;
  }
}

module.exports = BotAI;
