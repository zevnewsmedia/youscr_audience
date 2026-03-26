const { MongoClient } = require("mongodb");

const uri = "mongodb+srv://insidetheheats:Zevnews_2020@cluster0.5qssgli.mongodb.net/youscr";
const dbName = "racing_votes";

async function run() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);

    // Filtered list: 'events' and 'event_riders' have been removed.
    const collections = [
      "best_rider_contests",
      "best_rider_votes",
      "best_trick_matches",
      "best_trick_votes",
      "event_tricks",
      "fan_sessions",
      "fan_votes_best_trick",
      "fans",
      "matches",
      "matches_results",
      "overtakes",
      "votes"
    ];

    console.log(`🚀 Starting cleanup for: ${dbName}...`);
    console.log(`🛡️ Preserving: 'events' and 'event_riders'\n`);

    for (const name of collections) {
      try {
        await db.collection(name).drop();
        console.log(`✅ ${name} dropped successfully.`);
      } catch (err) {
        // Error code 26 means the collection doesn't exist.
        if (err.code === 26) {
          console.log(`ℹ️ ${name} was already empty or not found.`);
        } else {
          console.log(`❌ Error dropping ${name}: ${err.message}`);
        }
      }
    }

  } catch (err) {
    console.error("Critical Connection Error:", err);
  } finally {
    await client.close();
    console.log("\nProcess complete. Connection closed.");
  }
}

run();