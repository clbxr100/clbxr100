const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PokerGame = require('./poker-game');

const PORT = 3000;
const games = {};

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
});

http.listen(PORT, () => {
  console.log(`🃏 Poker server running on http://localhost:${PORT}`);
  console.log(`🎮 Share this URL with your friends to play!`);
});
