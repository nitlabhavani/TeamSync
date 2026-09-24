// Must be required first — loads backend/.env by absolute path so it works
// regardless of the directory `npm start` was run from. See src/config/env.js.
require("./src/config/env");
const http = require("http");
const app = require("./src/app");
const connectDB = require("./src/config/db");
const registerSockets = require("./src/sockets");
const { startDeadlineScheduler } = require("./src/services/deadlineService");
const { startReportScheduler } = require("./src/services/reportService");
const { startOrphanCleanupScheduler } = require("./src/utils/orphanFileCleanup");

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();

  const server = http.createServer(app);
  registerSockets(server);
  startDeadlineScheduler();
  startReportScheduler();
  startOrphanCleanupScheduler();

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`TeamSync AI backend listening on http://localhost:${PORT}`);
  });

  const shutdown = (signal) => () => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown("SIGINT"));
  process.on("SIGTERM", shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
