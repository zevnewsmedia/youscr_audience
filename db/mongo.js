const { MongoClient } = require("mongodb");

// MongoDB Atlas Connection
const username = encodeURIComponent(process.env.MONGO_USERNAME || 'insidetheheats'); 
const password = encodeURIComponent(process.env.MONGO_PASSWORD || 'Zevnews_2020'); 
const cluster = process.env.MONGO_CLUSTER || 'cluster0.5qssgli.mongodb.net';
const database = process.env.MONGO_DATABASE || 'racing_votes';

const mongoUri = `mongodb+srv://${username}:${password}@${cluster}/${database}?retryWrites=true&w=majority`;

const client = new MongoClient(mongoUri);

let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db(database);
    console.log(`✅ Connected to MongoDB: ${database}`);

    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments();
      console.log(`Collection "${col.name}" has ${count} documents`);
    }

    return db;
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

function getDB() {
  if (!db) {
    throw new Error("Database not initialized. Call connectDB() first.");
  }
  return db;
}

module.exports = {
  connectDB,
  getDB
};

