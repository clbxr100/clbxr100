// Bootstrap: HTTP (static + REST) + WebSocket + LobbyManager.
// Zero external dependencies — runs on Node >= 22.5.

const path = require('path');
const { createApp } = require('./src/webserver');
const ws = require('./src/ws');
const shop = require('./src/shop');
const { verifyToken, getUser } = require('./src/auth');
const LobbyManager = require('./src/lobby');

const PORT = process.env.PORT || 3000;

const { server, route } = createApp({ staticDir: path.join(__dirname, 'public') });
shop.mount(route);

const lobby = new LobbyManager();

ws.attach(server, {
  path: '/ws',
  onConnection: (client) => {
    const payload = verifyToken(client.query.get('token'));
    const user = payload && getUser(payload.userId);
    if (!user) {
      client.send('error', { message: 'Please sign in again', code: 'auth' });
      client.close(4001);
      return;
    }
    lobby.handleConnection(client, user);
  },
});

server.listen(PORT, () => {
  console.log(`🃏 Hold'em Blitz running on http://localhost:${PORT}`);
  console.log('   Share the URL on your network to play with friends!');
});
