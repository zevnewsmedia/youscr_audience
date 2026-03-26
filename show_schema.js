require('dotenv').config();
const { MongoClient } = require("mongodb");

const username = encodeURIComponent(process.env.MONGO_USERNAME || 'insidetheheats'); 
const password = encodeURIComponent(process.env.MONGO_PASSWORD || 'Zevnews_2020'); 
const cluster = process.env.MONGO_CLUSTER || 'cluster0.5qssgli.mongodb.net';
const database = process.env.MONGO_DATABASE || 'racing_votes';
const mongoUri = `mongodb+srv://${username}:${password}@${cluster}/${database}?retryWrites=true&w=majority`;

async function inspectCollections() {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(database);
    const collections = await db.listCollections().toArray();

    for (const col of collections) {
      const doc = await db.collection(col.name).findOne();
      console.log(`Collection: ${col.name}`);
      console.log("Fields:", doc ? Object.keys(doc) : "Empty");
      console.log("----------------------------");
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.close();
  }
}

inspectCollections();

