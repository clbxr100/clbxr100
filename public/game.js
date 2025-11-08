const socket = io();

let playerId = null;
let currentRoomId = null;
let selectedAvatar = '🤠';
let gameState = null;

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const playerNameInput = document.getElementById('playerName');
const roomIdInput = document.getElementById('roomId');
const joinBtn = document.getElementById('joinBtn');
const startGameBtn = document.getElementById('startGameBtn');
const actionPanel = document.getElementById('actionPanel');
const betSlider = document.getElementById('betSlider');
const betInput = document.getElementById('betInput');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const addBotBtn = document.getElementById('addBotBtn');
const removeBotBtn = document.getElementById('removeBotBtn');
const botDifficulty = document.getElementById('botDifficulty');

// Avatar Selection
document.querySelectorAll('.avatar-option').forEach(option => {
    option.addEventListener('click', () => {
        document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        selectedAvatar = option.dataset.avatar;
    });
});

// Set default avatar as selected
document.querySelector('.avatar-option').classList.add('selected');

// Join Room
joinBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim();

    if (!playerName || !roomId) {
        alert('Please enter your name and room ID');
        return;
    }

    socket.emit('joinRoom', { roomId, playerName, avatar: selectedAvatar });
});

// Start Game
startGameBtn.addEventListener('click', () => {
    socket.emit('startGame');
});

// Bot Controls
addBotBtn.addEventListener('click', () => {
    const difficulty = botDifficulty.value;
    socket.emit('addBot', { difficulty });
});

removeBotBtn.addEventListener('click', () => {
    socket.emit('removeBot');
});

// Bet Controls
betSlider.addEventListener('input', (e) => {
    betInput.value = e.target.value;
});

betInput.addEventListener('input', (e) => {
    betSlider.value = e.target.value;
});

// Action Buttons
document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        let amount = 0;

        if (action === 'raise') {
            amount = parseInt(betInput.value) || 0;
            if (amount <= 0) {
                alert('Please enter a valid raise amount');
                return;
            }
        }

        socket.emit('playerAction', { action, amount });
    });
});

// Chat
sendChatBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chatMessage', { message });
        chatInput.value = '';
    }
}

// Emoji Buttons
document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        socket.emit('emoji', { emoji });
    });
});

// Socket Events
socket.on('joinedRoom', ({ roomId, playerId: pid, gameState: state }) => {
    playerId = pid;
    currentRoomId = roomId;
    gameState = state;

    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    document.getElementById('roomName').textContent = `Room: ${roomId}`;

    // Show start button if first player
    if (state.players.length <= 2 && state.gameState === 'waiting') {
        startGameBtn.classList.remove('hidden');
    }

    updateUI(state);
});

socket.on('playerJoined', ({ player, message }) => {
    addSystemMessage(message);
});

socket.on('playerLeft', ({ playerName, message }) => {
    addSystemMessage(message);
});

socket.on('updateGame', (state) => {
    gameState = state;
    updateUI(state);
});

socket.on('gameStarted', () => {
    addSystemMessage('Game started! Good luck! 🎰');
    startGameBtn.classList.add('hidden');
});

socket.on('actionTaken', ({ playerName, action, amount }) => {
    let message = `${playerName} ${action}`;
    if (amount > 0) {
        message += ` $${amount}`;
    }
    addSystemMessage(message);
});

socket.on('showdown', ({ winners, hand }) => {
    const winnerNames = winners.map(w => w.name).join(', ');
    showWinnerModal(`${winnerNames} wins with ${hand}!`);
});

socket.on('chatMessage', ({ playerId: pid, playerName, message, timestamp }) => {
    addChatMessage(playerName, message, pid === playerId);
});

socket.on('emoji', ({ playerId: pid, playerName, emoji }) => {
    showFloatingEmoji(emoji);
    addSystemMessage(`${playerName} sent ${emoji}`);
});

socket.on('error', ({ message }) => {
    alert(message);
});

// UI Update Functions
function updateUI(state) {
    updatePlayers(state);
    updateCommunityCards(state);
    updatePot(state);
    updateGamePhase(state);
    updateActionPanel(state);
}

function updatePlayers(state) {
    const container = document.getElementById('playersContainer');
    container.innerHTML = '';

    state.players.forEach((player, index) => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-spot';
        playerDiv.innerHTML = `
            <div class="player-card ${player.id === state.players[state.currentPlayerIndex]?.id ? 'active' : ''} ${player.folded ? 'folded' : ''}">
                ${state.dealerIndex === index ? '<div class="dealer-button">D</div>' : ''}
                <div class="player-avatar">${player.avatar}</div>
                <div class="player-name">${player.name}</div>
                <div class="player-chips">$${player.chips}</div>
                ${player.bet > 0 ? `<div class="player-bet">Bet: $${player.bet}</div>` : ''}
                ${renderPlayerCards(player)}
            </div>
        `;
        container.appendChild(playerDiv);
    });
}

function renderPlayerCards(player) {
    if (!player.cards || player.cards.length === 0) return '';

    const cardsHtml = player.cards.map(card => {
        if (card.hidden) {
            return '<div class="mini-card hidden">🂠</div>';
        }
        const color = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
        return `<div class="mini-card" style="color: ${color}">${card.rank}${card.suit}</div>`;
    }).join('');

    return `<div class="player-cards-display">${cardsHtml}</div>`;
}

function updateCommunityCards(state) {
    const container = document.getElementById('communityCards');
    container.innerHTML = '';

    state.communityCards.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        const color = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
        cardDiv.className = `card ${color}`;
        cardDiv.innerHTML = `
            <div>${card.rank}</div>
            <div style="font-size: 1.5em">${card.suit}</div>
        `;
        cardDiv.style.animationDelay = `${index * 0.1}s`;
        container.appendChild(cardDiv);
    });
}

function updatePot(state) {
    document.getElementById('potAmount').textContent = `$${state.pot}`;
}

function updateGamePhase(state) {
    const phases = {
        'waiting': 'Waiting for players...',
        'preflop': 'Pre-Flop',
        'flop': 'Flop',
        'turn': 'Turn',
        'river': 'River',
        'showdown': 'Showdown!'
    };
    document.getElementById('gamePhase').textContent = phases[state.gameState] || state.gameState;
}

function updateActionPanel(state) {
    if (!state || state.gameState === 'waiting' || state.gameState === 'showdown') {
        actionPanel.style.display = 'none';
        return;
    }

    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer && currentPlayer.id === playerId && !currentPlayer.folded) {
        actionPanel.style.display = 'block';

        const callAmount = state.currentBet - currentPlayer.bet;
        document.getElementById('callAmount').textContent = callAmount > 0 ? `($${callAmount})` : '';

        // Update bet slider max
        betSlider.max = currentPlayer.chips;
        betInput.max = currentPlayer.chips;

        // Enable/disable buttons
        document.querySelector('[data-action="check"]').disabled = callAmount > 0;
        document.querySelector('[data-action="call"]').disabled = callAmount === 0;
    } else {
        actionPanel.style.display = 'none';
    }
}

// Chat Functions
function addChatMessage(author, message, isMe) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    messageDiv.innerHTML = `
        <div class="message-author">${author}${isMe ? ' (You)' : ''}</div>
        <div>${message}</div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message system';
    messageDiv.textContent = message;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showFloatingEmoji(emoji) {
    const floatingEmoji = document.createElement('div');
    floatingEmoji.className = 'floating-emoji';
    floatingEmoji.textContent = emoji;
    floatingEmoji.style.left = Math.random() * (window.innerWidth - 100) + 'px';
    floatingEmoji.style.top = window.innerHeight - 100 + 'px';
    document.body.appendChild(floatingEmoji);

    setTimeout(() => {
        floatingEmoji.remove();
    }, 2000);
}

function showWinnerModal(message) {
    const modal = document.getElementById('winnerModal');
    const winnerInfo = document.getElementById('winnerInfo');
    winnerInfo.innerHTML = `<h3>${message}</h3>`;
    modal.classList.remove('hidden');

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 4000);
}

// Sound effects (using Web Audio API)
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playSound(frequency, duration) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
}

// Add sound effects to actions
const originalEmit = socket.emit.bind(socket);
socket.emit = function(event, data) {
    if (event === 'playerAction') {
        playSound(440, 0.1); // A4 note
    } else if (event === 'chatMessage') {
        playSound(523, 0.05); // C5 note
    }
    return originalEmit(event, data);
};
