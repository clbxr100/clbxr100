# 🃏 Multiplayer Texas Hold'em Poker Game

A fun and interactive multiplayer Texas Hold'em poker game with live chat, avatars, and exciting animations! Perfect for playing with friends on localhost.

## ✨ Features

- **Full Texas Hold'em Rules**: Complete implementation of traditional poker rules
- **Multiplayer Support**: Up to 8 players can join a game
- **AI Bot Players**: Add intelligent bots with 3 difficulty levels (Easy, Medium, Hard)
- **Solo Play**: Practice against bots when friends aren't available
- **Live Chat**: Real-time chat with your friends while playing
- **Fun Avatars**: Choose from 12 different avatar emojis
- **Emoji Reactions**: Send emoji reactions that animate on screen
- **Beautiful UI**: Gorgeous poker table design with smooth animations
- **Sound Effects**: Audio feedback for actions and messages
- **Real-time Updates**: Instant game state synchronization using Socket.io
- **Responsive Design**: Works on different screen sizes

## 🎮 Game Rules

This game follows standard Texas Hold'em rules:

1. **Blinds**: Small blind and big blind are posted before each hand
2. **Hole Cards**: Each player receives 2 private cards
3. **Betting Rounds**:
   - **Pre-flop**: After receiving hole cards
   - **Flop**: After 3 community cards are dealt
   - **Turn**: After the 4th community card
   - **River**: After the 5th community card
4. **Actions**: Fold, Check, Call, Raise, or All-In
5. **Showdown**: Best 5-card hand wins (using any combination of hole cards and community cards)

### Hand Rankings (Highest to Lowest)
1. Royal Flush
2. Straight Flush
3. Four of a Kind
4. Full House
5. Flush
6. Straight
7. Three of a Kind
8. Two Pair
9. One Pair
10. High Card

## 🚀 Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   ```

   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

3. **Open Your Browser**
   - Navigate to `http://localhost:3000`
   - Share this URL with your friends on the same network!

## 👥 How to Play

### Starting a Game

1. **Choose Your Avatar**: Select your favorite emoji avatar
2. **Enter Your Name**: Type in a username
3. **Enter Room ID**: Use the same room ID as your friends (default: "room1")
4. **Click "Join Game"**: Join the poker room
5. **Start Game**: Once at least 2 players have joined, click "Start Game"

### During the Game

- **Your Turn**: When it's your turn, the action panel appears at the bottom
- **Make Your Move**: Choose from available actions:
  - **Fold**: Give up your hand
  - **Check**: Pass if no bet is required
  - **Call**: Match the current bet
  - **Raise**: Increase the bet (use slider to set amount)
  - **All In**: Bet all your chips

- **Chat**: Use the chat sidebar to talk with other players
- **Emoji Reactions**: Click emoji buttons to send animated reactions

### Game Flow

1. Dealer button rotates clockwise each hand
2. Small and big blinds are posted
3. Each player receives 2 hole cards
4. Betting round (Pre-flop)
5. Flop: 3 community cards revealed
6. Betting round
7. Turn: 4th community card revealed
8. Betting round
9. River: 5th community card revealed
10. Final betting round
11. Showdown: Best hand wins!
12. Next hand begins automatically

## 🤖 Playing with Bots

### Adding Bot Players

The game features intelligent AI bot players that you can add to fill seats or practice your skills!

**How to Add Bots:**
1. After joining a room, look for the bot controls in the game header
2. Select difficulty level from dropdown:
   - **Easy**: More random decisions, easier to beat
   - **Medium**: Balanced play with some strategy
   - **Hard**: Smart decisions based on hand strength and pot odds
3. Click "Add Bot" to add a bot player
4. Bots will automatically play their turns with realistic thinking delays (1-3 seconds)

**How to Remove Bots:**
- Click "Remove Bot" to remove the most recently added bot

### Bot Features

- **Intelligent Decision Making**: Bots evaluate hand strength, calculate pot odds, and consider position
- **Personality Traits**: Each bot has a unique personality (tight, loose, aggressive, passive, balanced)
- **Bluffing**: Bots can bluff based on their personality and difficulty level
- **Realistic Timing**: Bots "think" for 1-3 seconds before making decisions
- **8 Unique Names**: PokerBot, ChipMaster, BluffKing, AceHunter, RiverRat, FlopStar, AllInAmy, CheckMate
- **Cool Avatars**: 🤖 👾 🎰 🎲 🃏 🎯 💎 ⚡

### Bot Strategy

Bots make decisions based on:
- **Pre-flop**: Evaluates pocket cards (pairs, high cards, suited, connected)
- **Post-flop**: Analyzes pairs, two pairs, three of a kind, flush draws, straight draws
- **Pot Odds**: Calculates if calling is profitable
- **Position**: Plays more aggressively from later positions
- **Aggression Level**: Based on personality and difficulty

### Best Uses for Bots

- **Solo Practice**: Play alone to practice strategies
- **Fill Empty Seats**: Need 2+ players to start - add a bot!
- **Test Hands**: See how different situations play out
- **Learn the Game**: Practice without the pressure of real opponents
- **Mixed Games**: Combine human players and bots for varied gameplay

## 🎨 Avatar Options

Choose from these fun avatars:
- 🤠 Cowboy
- 😎 Cool
- 🤖 Robot
- 👑 King
- 🦊 Fox
- 🐼 Panda
- 🦁 Lion
- 🐯 Tiger
- 🎃 Pumpkin
- 👻 Ghost
- 🎭 Theater
- 🎪 Circus

## 💬 Chat Features

- **Live Messaging**: Send text messages to all players
- **Emoji Reactions**: Quick emoji buttons for common reactions
- **System Messages**: Game events are announced in chat
- **Floating Animations**: Emoji reactions animate across the screen

## 🎯 Tips for Fun Gameplay

1. **Bluff**: Try to bluff your friends! The chat makes it more fun
2. **Use Emojis**: React to big wins or bad beats with emoji reactions
3. **Starting Chips**: Each player starts with $1,000 in chips
4. **Blinds**: Small blind: $10, Big blind: $20
5. **All-In Drama**: Going all-in creates exciting moments!

## 🔧 Configuration

You can customize the game by editing `poker-game.js`:

- **Starting Chips**: Change `chips: 1000` in the `addPlayer` method
- **Blind Amounts**: Modify `smallBlind` and `bigBlind` in the constructor
- **Max Players**: Change the limit in `addPlayer` (currently 8)

## 📁 Project Structure

```
.
├── server.js           # Express + Socket.io server
├── poker-game.js       # Texas Hold'em game logic
├── package.json        # Dependencies
├── public/
│   ├── index.html      # Main game interface
│   ├── style.css       # Styling and animations
│   └── game.js         # Client-side game logic
└── POKER_README.md     # This file
```

## 🐛 Troubleshooting

### Port Already in Use
If port 3000 is already in use, you can change it in `server.js`:
```javascript
const PORT = 3001; // Change to any available port
```

### Players Can't Connect
- Make sure all players are on the same network
- Check your firewall settings
- Ensure the server is running

### Game Not Starting
- Need at least 2 players to start
- Make sure you're in the same room (same Room ID)

## 🎮 Network Play

### Playing on Same Computer
- Open multiple browser tabs to `http://localhost:3000`
- Each tab can be a different player

### Playing on Local Network
- Find your local IP address:
  - **Windows**: Run `ipconfig` in command prompt
  - **Mac/Linux**: Run `ifconfig` or `ip addr`
- Share your IP with friends: `http://YOUR_IP:3000`
- Example: `http://192.168.1.100:3000`

## 🌟 Future Enhancements

Potential features to add:
- Tournament mode
- Player statistics
- Customizable blinds structure
- Different poker variants
- Player avatars upload
- Voice chat integration
- More sound effects and music

## 🤝 Credits

Created with ❤️ for fun poker nights with friends!

Built with:
- Node.js
- Express
- Socket.io
- Pure HTML/CSS/JavaScript

## 📝 License

MIT License - Feel free to modify and share!

---

**Have fun playing! May the best hand win! 🎰🃏**
