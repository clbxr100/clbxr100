const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PokerGame = require('./poker-game');
const BotAI = require('./bot-ai');

const PORT = 3000;
const games = {};
const botPlayers = {}; // Store bot AI instances

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', ({ roomId, playerName, avatar }) => {
    if (!games[roomId]) {
      games[roomId] = new PokerGame(roomId);
    }

    const game = games[roomId];
    const result = game.addPlayer(socket.id, playerName, avatar);

    if (result.success) {
      socket.join(roomId);
      socket.roomId = roomId;
      socket.playerName = playerName;

      io.to(roomId).emit('playerJoined', {
        player: result.player,
        message: `${playerName} joined the game!`
      });

      socket.emit('joinedRoom', {
        roomId,
        playerId: socket.id,
        gameState: getFilteredGameState(game, socket.id)
      });

      io.to(roomId).emit('updateGame', getFilteredGameState(game, socket.id));
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  socket.on('startGame', () => {
    const roomId = socket.roomId;
    const game = games[roomId];

    if (game) {
      const result = game.startGame();
      if (result.success) {
        io.to(roomId).emit('gameStarted');
        broadcastGameState(roomId);
      } else {
        socket.emit('error', { message: result.message });
      }
    }
  });

  socket.on('playerAction', ({ action, amount }) => {
    const roomId = socket.roomId;
    const game = games[roomId];

    if (game) {
      const result = game.playerAction(socket.id, action, amount);
      if (result.success) {
        io.to(roomId).emit('actionTaken', {
          playerId: socket.id,
          playerName: socket.playerName,
          action,
          amount
        });
        broadcastGameState(roomId);

        if (game.gameState === 'showdown') {
          const winners = game.determineWinner();
          io.to(roomId).emit('showdown', winners);

          setTimeout(() => {
            game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
            const newRound = game.startGame();
            if (newRound.success) {
              broadcastGameState(roomId);
            }
          }, 5000);
        }
      } else {
        socket.emit('error', { message: result.message });
      }
    }
  });

  socket.on('chatMessage', ({ message }) => {
    const roomId = socket.roomId;
    if (roomId) {
      io.to(roomId).emit('chatMessage', {
        playerId: socket.id,
        playerName: socket.playerName,
        message,
        timestamp: Date.now()
      });
    }
  });

  socket.on('emoji', ({ emoji }) => {
    const roomId = socket.roomId;
    if (roomId) {
      io.to(roomId).emit('emoji', {
        playerId: socket.id,
        playerName: socket.playerName,
        emoji
      });
    }
  });

  socket.on('addBot', ({ difficulty }) => {
    const roomId = socket.roomId;
    const game = games[roomId];

    if (game) {
      const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const botNames = ['PokerBot', 'ChipMaster', 'BluffKing', 'AceHunter', 'RiverRat', 'FlopStar', 'AllInAmy', 'CheckMate'];
      const botAvatars = ['🤖', '👾', '🎰', '🎲', '🃏', '🎯', '💎', '⚡'];

      const botName = botNames[Math.floor(Math.random() * botNames.length)];
      const botAvatar = botAvatars[Math.floor(Math.random() * botAvatars.length)];

      const result = game.addPlayer(botId, botName, botAvatar);

      if (result.success) {
        // Store bot AI instance
        botPlayers[botId] = {
          ai: new BotAI(difficulty || 'medium'),
          roomId: roomId,
          name: botName
        };

        io.to(roomId).emit('playerJoined', {
          player: result.player,
          message: `🤖 ${botName} (Bot) joined the game!`
        });

        broadcastGameState(roomId);
      } else {
        socket.emit('error', { message: result.message });
      }
    }
  });

  socket.on('removeBot', () => {
    const roomId = socket.roomId;
    const game = games[roomId];

    if (game) {
      // Find first bot and remove it
      const botPlayer = game.players.find(p => p.id.startsWith('bot_'));
      if (botPlayer) {
        delete botPlayers[botPlayer.id];
        game.removePlayer(botPlayer.id);

        io.to(roomId).emit('playerLeft', {
          playerId: botPlayer.id,
          playerName: botPlayer.name,
          message: `🤖 ${botPlayer.name} (Bot) left the game`
        });

        broadcastGameState(roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const roomId = socket.roomId;

    if (roomId && games[roomId]) {
      const game = games[roomId];
      game.removePlayer(socket.id);

      io.to(roomId).emit('playerLeft', {
        playerId: socket.id,
        playerName: socket.playerName,
        message: `${socket.playerName} left the game`
      });

      if (game.players.length === 0) {
        delete games[roomId];
      } else {
        broadcastGameState(roomId);
      }
    }
  });

  function broadcastGameState(roomId) {
    const game = games[roomId];
    if (game) {
      // Send personalized game state to each player
      game.players.forEach(player => {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (playerSocket) {
          playerSocket.emit('updateGame', getFilteredGameState(game, player.id));
        }
      });

      // Trigger bot turn if current player is a bot
      processBotTurn(roomId);
    }
  }

  function getFilteredGameState(game, playerId) {
    const state = game.getGameState();

    // Hide other players' cards unless it's showdown
    if (state.gameState !== 'showdown') {
      state.players = state.players.map(p => {
        if (p.id !== playerId) {
          return { ...p, cards: p.cards.map(() => ({ hidden: true })) };
        }
        return p;
      });
    }

    return state;
  }

  function processBotTurn(roomId) {
    const game = games[roomId];
    if (!game || game.gameState === 'waiting' || game.gameState === 'showdown') {
      return;
    }

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!currentPlayer || !currentPlayer.id.startsWith('bot_')) {
      return; // Not a bot's turn
    }

    const botData = botPlayers[currentPlayer.id];
    if (!botData) {
      return;
    }

    // Get thinking time
    const thinkingTime = botData.ai.getThinkingTime();

    setTimeout(() => {
      // Make sure game state hasn't changed
      const updatedGame = games[roomId];
      if (!updatedGame || updatedGame.gameState === 'showdown') {
        return;
      }

      const stillCurrentPlayer = updatedGame.players[updatedGame.currentPlayerIndex];
      if (!stillCurrentPlayer || stillCurrentPlayer.id !== currentPlayer.id) {
        return; // Turn changed
      }

      // Get bot decision
      const gameState = updatedGame.getGameState();
      const decision = botData.ai.makeDecision(currentPlayer, gameState);

      // Execute bot action
      const result = updatedGame.playerAction(currentPlayer.id, decision.action, decision.amount || 0);

      if (result.success) {
        io.to(roomId).emit('actionTaken', {
          playerId: currentPlayer.id,
          playerName: currentPlayer.name,
          action: decision.action,
          amount: decision.amount || 0
        });

        broadcastGameState(roomId);

        if (updatedGame.gameState === 'showdown') {
          const winners = updatedGame.determineWinner();
          io.to(roomId).emit('showdown', winners);

          setTimeout(() => {
            updatedGame.dealerIndex = (updatedGame.dealerIndex + 1) % updatedGame.players.length;
            const newRound = updatedGame.startGame();
            if (newRound.success) {
              broadcastGameState(roomId);
            }
          }, 5000);
        }
      }
    }, thinkingTime);
  }
});

http.listen(PORT, () => {
  console.log(`🃏 Poker server running on http://localhost:${PORT}`);
  console.log(`🎮 Share this URL with your friends to play!`);
});
