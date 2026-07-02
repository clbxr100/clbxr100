// Who's online and where — bridged from LobbyManager so REST endpoints
// (which have no socket context) can answer friend-status queries.

let lobby = null;

function register(lobbyManager) {
  lobby = lobbyManager;
}

function isOnline(userId) {
  return !!(lobby && lobby.sockets.has(userId));
}

// Returns a joinable table summary if the user is seated at a public
// cash table, else null.
function whereIs(userId) {
  if (!lobby) return null;
  const tableId = lobby.userTable.get(userId);
  const table = tableId && lobby.tables.get(tableId);
  if (!table || table.destroyed || table.tournament || table.isPrivate) return null;
  return { tableId: table.id, name: table.name, stakes: table.stakes };
}

function sendTo(userId, event, data) {
  if (lobby) lobby.io.toUser(userId, event, data);
}

module.exports = { register, isOnline, whereIs, sendTo };
