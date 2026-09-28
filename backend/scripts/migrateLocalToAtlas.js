require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const LOCAL_URI = process.env.LOCAL_MONGO_URI || "mongodb://127.0.0.1:27017/teamsync_ai";
const ATLAS_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!ATLAS_URI) {
  console.error("❌ No MongoDB Atlas URI found in environment variables (MONGO_URI / MONGODB_URI).");
  process.exit(1);
}

async function migrate() {
  console.log("==================================================");
  console.log("🚀 Starting TeamSync AI Database Migration to Atlas");
  console.log("==================================================");
  console.log(`Source (Local) : ${LOCAL_URI}`);
  console.log(`Target (Atlas) : ${ATLAS_URI.replace(/\/\/[^@]*@/, "//<credentials>@")}`);
  console.log("");

  let localConn;
  let atlasConn;

  try {
    console.log("Connecting to Local MongoDB...");
    localConn = await mongoose.createConnection(LOCAL_URI, {
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    console.log(" Connected to Local MongoDB!");

    console.log("Connecting to MongoDB Atlas...");
    atlasConn = await mongoose.createConnection(ATLAS_URI, {
      serverSelectionTimeoutMS: 15000,
    }).asPromise();
    console.log(" Connected to MongoDB Atlas!");

    const localDb = localConn.db;
    const atlasDb = atlasConn.db;

    const collections = await localDb.listCollections().toArray();
    console.log(`\nFound ${collections.length} collections to transfer:\n`);

    let totalMigratedDocs = 0;

    for (const colInfo of collections) {
      const colName = colInfo.name;
      if (colName.startsWith("system.")) continue;

      const localCol = localDb.collection(colName);
      const atlasCol = atlasDb.collection(colName);

      const count = await localCol.countDocuments();
      process.stdout.write(` Transferring '${colName}' (${count} documents)... `);

      if (count === 0) {
        console.log("⏭️ Empty (Skipped)");
        continue;
      }

      // Fetch all docs from local
      const docs = await localCol.find({}).toArray();

      // Clear existing in Atlas target to prevent duplicate key conflicts
      await atlasCol.deleteMany({});

      // Insert in chunks of 500
      const CHUNK_SIZE = 500;
      for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
        const chunk = docs.slice(i, i + CHUNK_SIZE);
        await atlasCol.insertMany(chunk, { ordered: false });
      }

      const atlasCount = await atlasCol.countDocuments();
      console.log(` Done (${atlasCount}/${count} verified)`);
      totalMigratedDocs += atlasCount;
    }

    console.log("\n==================================================");
    console.log(` Migration completed successfully! Total documents copied: ${totalMigratedDocs}`);
    console.log("==================================================");
  } catch (error) {
    console.error("\n❌ Migration failed with error:", error.message);
    if (error.message.includes("whitelist") || error.message.includes("timed out") || error.message.includes("buffering timed out") || error.message.includes("Could not connect to any servers")) {
      console.error("\n👉 Action needed: Please ensure your current IP address (or 0.0.0.0/0) is added to MongoDB Atlas Network Access whitelist.");
    }
  } finally {
    if (localConn) await localConn.close();
    if (atlasConn) await atlasConn.close();
  }
}

migrate();
