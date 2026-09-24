const mongoose = require("mongoose");

/**
 * Connects to MongoDB. Set MONGO_URI in backend/.env:
 *  - local:  mongodb://127.0.0.1:27017/teamsync_ai
 *  - Atlas:  mongodb+srv://<user>:<password>@<cluster>.mongodb.net/teamsync_ai
 */
module.exports = async function connectDB() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/teamsync_ai";
  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  } catch (err) {
    console.error(
      [
        "",
        "MongoDB connection failed.",
        `  URI used: ${uri.replace(/\/\/[^@]*@/, "//<credentials>@")}`,
        "  Fix: set MONGO_URI in backend/.env (copy backend/.env.example),",
        "  make sure the local mongod is running, or that your Atlas IP allowlist",
        "  includes this machine.",
        "",
      ].join("\n")
    );
    throw err;
  }

  mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected"));
  mongoose.connection.on("error", (e) => console.error("MongoDB error:", e.message));

  console.log(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
};
