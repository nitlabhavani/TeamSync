let io = null;

function setSocketServer(server) {
  io = server;
}

function emitToGroup(groupId, event, payload) {
  if (!io || !groupId) return;
  io.to(`group:${groupId}`).emit(event, payload);
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
}

module.exports = { setSocketServer, emitToGroup, emitToUser };
