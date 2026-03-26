require('dotenv').config();
const bcrypt = require('bcrypt');
const { connectDB, getDB } = require('../db/mongo');

async function createAdmin() {
  await connectDB();

  const username = "admin";
  const password = "motocross123";

  const existing = await getDB().collection("admins").findOne({ username });
  if (existing) {
    console.log("Admin already exists.");
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 10);
  await getDB().collection("admins").insertOne({
    username,
    password: hash,
    created_at: new Date()
  });

  console.log("✅ Admin created successfully.");
  process.exit(0);
}

createAdmin().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});