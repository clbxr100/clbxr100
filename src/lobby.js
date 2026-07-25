// LobbyManager: owns sockets (one per user), tables, tournaments, and all
// websocket event wiring. Provides the io adapter tables/tournaments use.

const Table = require('./table');
const Tournament = require('./tournament');
const { getUser, publicProfile } = require('./auth');
const economy = require('./economy');
const social = require('./social');

const DISCONNECT_GRACE_MS = 180000; // 3 minutes to come back to a cash table

class LobbyManager {
  constructor() {
    this.sockets = new Map();       // userId -> WSClient
    this.tables = new Map();        // tableId -> Table
    this.tournaments = new Map();   // tournamentId -> Tournament
    this.userTable = new Map();     // userId -> tableId
    this.userSpectate = new Map();  // userId -> tableId being watched
    this.subscribers = new Set();   // userIds watching the lobby list
    this.graceTimers = new Map();   // userId -> timeout

    // Keep lobby "live hand" indicators fresh for anyone watching the list.
    const ticker = setInterval(() => {
      if (this.subscribers.size > 0) this.broadcastLobby();
    }, 5000);
    ticker.unref();

    this.io = {
      toUser: (userId, event, data) => {
        const sock = this.sockets.get(userId);
        if (sock) sock.send(event, data);
      },
      toTable: (tableId, event, data) => {
        const table = this.tables.get(tableId);
        if (!table) return;
        for (const p of table.game.players) {
          if (!p.isBot && !p.leftTable) this.io.toUser(p.userId, event, data);
        }
        for (const userId of table.spectators) this.io.toUser(userId, event, data);
      },
    };
  }

  // ---- connection lifecycle ------------------------------------------------

  handleConnection(client, user) {
    const userId = user.id;
    const existing = this.sockets.get(userId);
    if (existing && existing !== client) {
      existing.send('session:replaced', {});
      existing.destroy();
    }
    this.sockets.set(userId, client);
    client.data.userId = userId;

    const grace = this.graceTimers.get(userId);
    if (grace) { clearTimeout(grace); this.graceTimers.delete(userId); }

    client.send('hello', { profile: publicProfile(getUser(userId)) });

    // Reconnect straight into a live table.
    const tableId = this.userTable.get(userId);
    const table = tableId && this.tables.get(tableId);
    if (table && !table.destroyed && table.game.getPlayer(userId)) {
      client.send('table:joined', { tableId: table.id, state: table.filterFor(userId) });
    } else if (tableId) {
      this.userTable.delete(userId);
    }

    this.wireEvents(client, userId);
  }

  wireEvents(client, userId) {
    const freshUser = () => getUser(userId);
    const myTable = () => {
      const id = this.userTable.get(userId);
      const t = id && this.tables.get(id);
      return t && !t.destroyed ? t : null;
    };
    const fail = (message) => client.send('error', { message });

    client.on('lobby:subscribe', () => {
      this.subscribers.add(userId);
      client.send('lobby:state', this.lobbyState());
    });
    client.on('lobby:unsubscribe', () => this.subscribers.delete(userId));

    client.on('lobby:createTable', (opts = {}) => {
      if (myTable()) return fail('Leave your current table first');
      stopSpectating();
      const table = this.createTable({ ...opts, creatorId: userId });
      const result = table.addHuman(freshUser());
      if (result.error) { table.destroy(); return fail(result.error); }
      this.userTable.set(userId, table.id);
      const botCount = Math.max(0, Math.min(7, Math.floor(opts.botCount || 0)));
      for (let i = 0; i < botCount && table.game.players.length < table.maxPlayers; i++) table.addBot();
      client.send('table:joined', { tableId: table.id, state: table.filterFor(userId) });
      this.broadcastLobby();
    });

    const stopSpectating = () => {
      const specId = this.userSpectate.get(userId);
      if (!specId) return;
      const st = this.tables.get(specId);
      if (st && !st.destroyed) st.removeSpectator(userId);
      this.userSpectate.delete(userId);
    };

    client.on('lobby:joinTable', ({ tableId, code } = {}) => {
      if (myTable()) return fail('Leave your current table first');
      stopSpectating();
      const table = this.tables.get(tableId);
      if (!table || table.destroyed) return fail('Table not found');
      if (table.tournament) return fail('That is a tournament table');
      if (table.isPrivate && table.code !== String(code || '')) return fail('Wrong table code');
      const result = table.addHuman(freshUser());
      if (result.error) return fail(result.error);
      this.userTable.set(userId, table.id);
      client.send('table:joined', { tableId: table.id, state: table.filterFor(userId) });
      this.broadcastLobby();
    });

    client.on('lobby:spectate', ({ tableId } = {}) => {
      if (myTable()) return fail('You are already playing');
      stopSpectating();
      const table = this.tables.get(tableId);
      if (!table || table.destroyed) return fail('Table not found');
      if (table.isPrivate) return fail('Private tables cannot be watched');
      const user = freshUser();
      table.addSpectator(userId, user.username);
      this.userSpectate.set(userId, table.id);
      client.send('table:joined', { tableId: table.id, state: table.filterFor(userId), spectating: true });
      this.broadcastLobby();
    });

    client.on('table:sitOut', ({ sitOut } = {}) => {
      const table = myTable();
      if (!table) return;
      const result = table.handleSitOut(userId, !!sitOut);
      if (result.error) fail(result.error);
    });

    client.on('table:leave', () => {
      stopSpectating();
      const table = myTable();
      this.userTable.delete(userId);
      if (table) table.removePlayer(userId);
      client.send('table:left', {}); // always respond so the client never sticks
      this.broadcastLobby();
    });

    client.on('game:action', ({ action, amount } = {}) => {
      const table = myTable();
      if (!table) return fail('Not at a table');
      const result = table.handleAction(userId, String(action), Number(amount) || 0);
      if (result.error) fail(result.error);
    });

    client.on('game:usePowerUp', (opts = {}) => {
      const table = myTable();
      if (!table) return fail('Not at a table');
      const result = table.handleUsePowerUp(userId, {
        type: String(opts.type || ''),
        source: opts.source,
        targetUserId: opts.targetUserId,
        cardIndex: opts.cardIndex,
      });
      if (result.error) fail(result.error);
    });

    client.on('throw:item', ({ itemId, targetUserId } = {}) => {
      const table = myTable();
      if (!table) return fail('Not at a table');
      const result = table.handleThrow(userId, { itemId: String(itemId || ''), targetUserId });
      if (result.error) fail(result.error);
    });

    // Spectators share the table chat room.
    const myRoom = () => {
      const t = myTable();
      if (t) return t;
      const specId = this.userSpectate.get(userId);
      const st = specId && this.tables.get(specId);
      return st && !st.destroyed ? st : null;
    };

    client.on('chat:message', ({ text } = {}) => {
      const table = myRoom();
      const clean = String(text || '').slice(0, 200).trim();
      if (!table || !clean) return;
      const user = freshUser();
      this.io.toTable(table.id, 'chat:message', {
        userId, username: user.username, avatar: user.avatar, text: clean, ts: Date.now(),
      });
    });

    client.on('dm:send', ({ toUserId, text } = {}) => {
      const result = social.sendDm(freshUser(), Number(toUserId), text);
      if (result.error) fail(result.error);
    });

    client.on('chat:emoji', ({ emoji } = {}) => {
      const table = myRoom();
      if (!table) return;
      const user = freshUser();
      this.io.toTable(table.id, 'chat:emoji', { userId, username: user.username, emoji: String(emoji || '').slice(0, 8) });
    });

    // ---- tournaments ----
    client.on('tournament:create', (opts = {}) => {
      if (myTable()) return fail('Leave your current table first');
      const tournament = new Tournament({
        name: String(opts.name || '').slice(0, 30),
        entryFee: Number(opts.entryFee),
        maxPlayers: Number(opts.maxPlayers) || 6,
        fillBots: !!opts.fillBots,
        creatorId: userId,
        io: this.io,
        onChanged: () => this.broadcastLobby(),
        onFinished: (t) => this.onTournamentFinished(t),
        createTable: (t) => this.createTournamentTable(t),
      });
      this.tournaments.set(tournament.id, tournament);
      const result = tournament.join(freshUser());
      if (result.error) { this.tournaments.delete(tournament.id); return fail(result.error); }
      client.send('tournament:registered', { tournamentId: tournament.id });
      this.broadcastLobby();
    });

    client.on('tournament:join', ({ tournamentId } = {}) => {
      if (myTable()) return fail('Leave your current table first');
      const tournament = this.tournaments.get(tournamentId);
      if (!tournament) return fail('Tournament not found');
      const result = tournament.join(freshUser());
      if (result.error) return fail(result.error);
      client.send('tournament:registered', { tournamentId: tournament.id });
      this.broadcastLobby();
    });

    client.on('tournament:leave', ({ tournamentId } = {}) => {
      const tournament = this.tournaments.get(tournamentId);
      if (!tournament) return;
      const result = tournament.leave(userId);
      if (result.error) return fail(result.error);
      client.send('tournament:unregistered', { tournamentId });
      this.broadcastLobby();
    });

    client.on('tournament:start', ({ tournamentId } = {}) => {
      const tournament = this.tournaments.get(tournamentId);
      if (!tournament) return fail('Tournament not found');
      const result = tournament.start(userId);
      if (result.error) return fail(result.error);
    });

    client.on('_close', () => {
      if (this.sockets.get(userId) === client) this.sockets.delete(userId);
      this.subscribers.delete(userId);
      // Spectators just stop watching.
      const specId = this.userSpectate.get(userId);
      if (specId) {
        const st = this.tables.get(specId);
        if (st && !st.destroyed) st.removeSpectator(userId);
        this.userSpectate.delete(userId);
      }
      const tableId = this.userTable.get(userId);
      if (!tableId) return;
      const table = this.tables.get(tableId);
      // Tournaments: the seat is held until elimination — blinds eat the
      // stack while they're away, and they can reconnect any time.
      if (table && table.tournament) {
        table.systemChat(`📡 ${getUser(userId)?.username || 'A player'} disconnected — seat held, blinds continue`);
        return;
      }
      // Cash tables: hold the seat for the grace window.
      const timer = setTimeout(() => {
        this.graceTimers.delete(userId);
        if (this.sockets.has(userId)) return; // reconnected
        const t = this.tables.get(tableId);
        if (t && !t.destroyed) t.removePlayer(userId);
        this.userTable.delete(userId);
        this.broadcastLobby();
      }, DISCONNECT_GRACE_MS);
      timer.unref();
      this.graceTimers.set(userId, timer);
    });
  }

  // ---- table factory ---------------------------------------------------------

  createTable(opts) {
    const table = new Table({
      name: String(opts.name || '').slice(0, 30) || 'Poker Table',
      stakes: opts.stakes,
      isPrivate: opts.isPrivate,
      code: opts.code,
      maxPlayers: Number(opts.maxPlayers) || 8,
      creatorId: opts.creatorId,
      io: this.io,
      tournament: opts.tournament || null,
      onEmpty: (t) => {
        this.tables.delete(t.id);
        for (const [uid, tid] of this.userTable) if (tid === t.id) this.userTable.delete(uid);
        this.broadcastLobby();
      },
      onChanged: () => this.broadcastLobby(),
      onHumanRemoved: (userId) => {
        if (this.userTable.get(userId)) this.userTable.delete(userId);
      },
    });
    this.tables.set(table.id, table);
    return table;
  }

  createTournamentTable(tournament) {
    const table = this.createTable({
      name: tournament.name,
      stakes: 'low',
      maxPlayers: tournament.maxPlayers,
      creatorId: tournament.creatorId,
      tournament,
    });
    for (const e of tournament.entrants) {
      if (!e.isBot) this.userTable.set(e.userId, table.id);
    }
    return table;
  }

  onTournamentFinished(tournament) {
    // Keep it visible as 'finished' briefly, then drop it.
    const timer = setTimeout(() => {
      this.tournaments.delete(tournament.id);
      this.broadcastLobby();
    }, 60000);
    timer.unref();
  }

  // ---- lobby list --------------------------------------------------------------

  lobbyState() {
    return {
      tables: [...this.tables.values()]
        .filter(t => !t.destroyed && !t.tournament)
        .map(t => t.summary()),
      tournaments: [...this.tournaments.values()].map(t => t.summary()),
    };
  }

  broadcastLobby() {
    const state = this.lobbyState();
    for (const userId of this.subscribers) {
      this.io.toUser(userId, 'lobby:state', state);
    }
  }
}

module.exports = LobbyManager;
