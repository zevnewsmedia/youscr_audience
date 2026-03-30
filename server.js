require('dotenv').config();
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const bodyParser = require("body-parser");
const path = require("path");
const crypto = require("crypto");
const app = express();
const port = process.env.PORT || 3000;

// ======================================================
// Express Setup
// ======================================================
app.use(bodyParser.json());
// Parse HTML form submissions
app.use(bodyParser.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const cookieParser = require("cookie-parser");

app.use(cookieParser());

const bcrypt = require("bcrypt");


const { connectDB, getDB } = require("./db/mongo");


connectDB();

// ======================================================
// Helper: Generate Next Sequential Rider ID
// ======================================================
async function getNextRiderId(db) {
  const riders = await db.collection("riders")
    .find({ rider_id: { $regex: /^r\d+$/ } })
    .project({ rider_id: 1 })
    .toArray();

  if (!riders.length) return "r1";

  const nums = riders.map(r => parseInt(r.rider_id.replace("r", ""), 10));
  return `r${Math.max(...nums) + 1}`;
}


// ====================================================== 
// SOCKET.IO SETUP
// ====================================================== 

// At the top with other requires
const http = require('http');
const socketIo = require('socket.io');

// ====================================================== 
// CREATE HTTP SERVER & SOCKET.IO INSTANCE
// Replace app.listen() at the bottom with this
// ====================================================== 

const server = http.createServer(app);
const io = socketIo(server);

// ====================================================== 
// SOCKET.IO CONNECTION HANDLER
// Handles real-time communication with fans
// ====================================================== 

io.on('connection', (socket) => {
  console.log('✅ Fan connected:', socket.id);

  // --------------------------------------------------
  // LISTEN FOR VALUES FROM CLIENT
  // --------------------------------------------------
  socket.on('send_value', (data) => {
    console.log('📩 Received value:', data);
    
    // --------------------------------------------------
    // BROADCAST TO ALL CONNECTED CLIENTS
    // --------------------------------------------------
    io.emit('new_value', data);
  });

  // --------------------------------------------------
  // SEND RIDERS FROM SENDER TO ALL RECEIVERS
  // --------------------------------------------------
  socket.on('send_riders', (data) => {
    console.log('📩 Received riders from sender:', data);
    
    // Broadcast to ALL connected clients (including receiver)
    io.emit('update_riders', data);
    
    console.log('📤 Broadcasted riders to all receivers');
  });

  // --------------------------------------------------
  // MATCH CREATION NOTIFICATION
  // --------------------------------------------------
  socket.on('match_created', (matchData) => {
    console.log('📩 Received match creation:', matchData);
    
    // Broadcast to ALL connected clients
    io.emit('new_match_notification', matchData);
    
    console.log('📤 Broadcasted match creation to all monitors');
  });

  // --------------------------------------------------
  // HANDLE DISCONNECTION
  // --------------------------------------------------
  socket.on('disconnect', () => {
    console.log('❌ Fan disconnected:', socket.id);
  });
});

// ====================================================== 
// START SERVER WITH SOCKET.IO SUPPORT
// ====================================================== 

server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log(`🔌 Socket.IO enabled`);
});



// ======================================================
// Flash Message Helpers
// One-time messages that survive a single redirect
// Stored as a short-lived cookie, cleared on read
// ======================================================
function setFlash(res, type, message) {
  res.cookie('flash', JSON.stringify({ type, message }), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 5000
  });
}

function getFlash(req, res) {
  const raw = req.cookies.flash;
  if (!raw) return null;
  res.clearCookie('flash');
  try { return JSON.parse(raw); } catch { return null; }
}
// ======================================================
// END Flash Message Helpers
// ======================================================

// ======================================================
// Admin: Protect all /admin routes in one go
// Session validated against MongoDB admin_sessions collection
// ======================================================
app.use("/admin", async (req, res, next) => {
  if (req.path === "/login") return next();

  const adminSession = req.cookies?.admin_session;

  if (!adminSession) {
    return res.redirect("/admin/login");
  }

  const session = await getDB().collection("admin_sessions").findOne({
    session_token: adminSession,
    expires_at: { $gt: new Date() }
  });

  if (!session) {
    return res.redirect("/admin/login");
  }

  next();
});
// ======================================================
// END Admin: Protect all /admin routes
// ======================================================

// ======================================================
// TEST ROUTES: SOCKET SENDER & RECEIVER
// These routes demonstrate real-time Socket.IO communication
// between a sender page and receiver page with voting functionality
// ======================================================

// --------------------------------------------------
// GET: Socket Sender Test Page
// Renders a form to send rider data via Socket.IO
// --------------------------------------------------
//app.get("/test/socket-sender", async (req, res) => {
 app.get("/admin/best-rider/match", async (req, res) => {
  try {
    const events = await getDB().collection("events").find({}).toArray();
    const classes = await getDB().collection("classes").find({}).toArray();
    const riders = await getDB().collection("best_rider_contests").find({}).toArray();
    
    res.render("admin/best_rider_new_match", {
      events,
      classes,
      riders
    });
  } catch (err) {
    console.error("GET socket sender:", err);
    res.status(500).send("Server error");
  }
});








// --------------------------------------------------
// POST: Handle Vote Submission from Receiver
// Logs received votes and displays confirmation
// --------------------------------------------------
app.post("/test/socket-receiver/vote", (req, res) => {
  console.log("📥 Received votes from socket receiver:");
  console.log(req.body);
  
  res.send(`
    <h2>✅ Votes Received!</h2>
    <pre>${JSON.stringify(req.body, null, 2)}</pre>
    <br>
    <a href="/test/socket-receiver">← Back to Receiver</a>
  `);
});

// ======================================================
// END TEST ROUTES
// ======================================================





// ======================================================
// SOCKET SENDER PAGE (Simple Test Page)
// ======================================================
app.get("/socket-sender", (req, res) => {
  res.render("socket_sender");
});

// ============================================================
// GET /matches
// Public page showing all matches grouped by event
// Accessible without login
// ============================================================
app.get("/matches", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    // --------------------------------------------------------
    // Fetch all required data in parallel
    // --------------------------------------------------------
    const [matches, overtakes, riders, events, matchResults] = await Promise.all([
      getDB().collection("matches").find({ deleted: { $ne: true } }).toArray(),
      getDB().collection("overtakes").find().toArray(),
      getDB().collection("riders").find().toArray(),
      getDB().collection("events").find().toArray(),
      getDB().collection("matches_results").find().toArray()
    ]);

    // --------------------------------------------------------
    // Build lookup maps
    // --------------------------------------------------------
    const riderMap = {};
    riders.forEach(r => {
      riderMap[r._id.toString()] = r;
    });

    const overtakeMap = {};
    overtakes.forEach(o => {
      overtakeMap[o._id.toString()] = o;
    });

    const eventMap = {};
    events.forEach(e => {
      eventMap[e._id.toString()] = e;
    });

    const matchResultMap = {};
    matchResults.forEach(r => {
      matchResultMap[r.match_id.toString()] = r;
    });

    // --------------------------------------------------------
    // Helper to get rider display name from overtake
    // --------------------------------------------------------
    const getRiderNames = (overtakeId) => {
      const overtake = overtakeMap[overtakeId?.toString()];
      if (!overtake) return { overtaker: "Unknown", overtaken: "Unknown", heat: "?" };
      const overtaker = riderMap[overtake.overtaker_id?.toString()];
      const overtaken = riderMap[overtake.overtaken_id?.toString()];
      return {
        overtaker: overtaker ? `${overtaker.name} ${overtaker.surname}` : "Unknown",
        overtaken: overtaken ? `${overtaken.name} ${overtaken.surname}` : "Unknown",
        heat: overtake.heat || "?"
      };
    };

    // --------------------------------------------------------
    // Enrich matches with display info
    // --------------------------------------------------------
    const enrichedMatches = matches.map(match => {
      const hotseat = getRiderNames(match.hotseat_overtake_id);
      const challenger = getRiderNames(match.challenger_overtake_id);
      const result = matchResultMap[match._id.toString()];

      let winner = null;
      if (result) {
        if (result.winner_side === "hotseat") winner = "hotseat";
        else if (result.winner_side === "challenger") winner = "challenger";
        else if (result.winner_side === "tie") winner = "tie";
      }

      return {
        _id: match._id,
        event_id: match.event_id?.toString(),
        round: match.round || "—",
        finalized: match.finalized || false,
        hotseat,
        challenger,
        winner
      };
    });

    // --------------------------------------------------------
    // Group matches by event
    // --------------------------------------------------------
    const groupedByEvent = {};
    enrichedMatches.forEach(match => {
      const eventId = match.event_id;
      if (!groupedByEvent[eventId]) {
        const event = eventMap[eventId];
        groupedByEvent[eventId] = {
          event_name: event ? event.name : "Unknown Event",
          event_date: event ? event.date : null,
          matches: []
        };
      }
      groupedByEvent[eventId].matches.push(match);
    });

    res.render("public_matches", {
      groupedByEvent,
      error: null
    });

  } catch (err) {
    console.error("Error loading public matches:", err);
    res.status(500).render("public_matches", {
      groupedByEvent: {},
      error: "Server Error"
    });
  }
});
// ============================================================





// ======================================================
// Fan Login Routes
// ======================================================
app.get("/fan/login", (req, res) => {
  res.render("fan_login", { error: null, name: "", email: "" });
});

// =====================================================
// FAN LOGIN
// =====================================================



app.post("/fan/login", async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.render("fan_login", {
        error: "Name and email are required",
        name,
        email
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();

    if (!getDB()) {
      return res.render("fan_login", {
        error: "Database not ready",
        name,
        email
      });
    }

    // ----------------------
    // Find or create fan
    // ----------------------
    let fan = await getDB()
      .collection("fans")
      .findOne({ email: normalizedEmail });

    if (!fan) {
      const result = await getDB().collection("fans").insertOne({
        name: normalizedName,
        email: normalizedEmail,
        created_at: new Date()
      });

      fan = {
        _id: result.insertedId,
        name: normalizedName,
        email: normalizedEmail
      };
    }

    // ----------------------
    // Create session token
    // ----------------------
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // ----------------------
    // Load active event automatically
    // ----------------------
    const activeEvent = await getDB()
      .collection("events")
      .findOne({ deleted: { $ne: true } }); // first event where deleted != true

    // ----------------------
    // Prepare session data
    // ----------------------
    const sessionData = {
      fan_id: fan._id,
      fan_name: fan.name,
      session_token: sessionToken,
      created_at: new Date(),
      expires_at: expiresAt
    };

    if (activeEvent) {
      sessionData.event_id = activeEvent._id;
      sessionData.event_name = activeEvent.name;

      console.log("Active event loaded:");
      console.log("ID:", activeEvent._id.toString());
      console.log("Name:", activeEvent.name);
    }

    // ----------------------
    // Save session in DB
    // ----------------------
    await getDB().collection("fan_sessions").insertOne(sessionData);

    // ----------------------
    // Set cookie + redirect
    // ----------------------
    res.cookie("fan_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // false on localhost
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    console.log("Fan session created:", sessionData);

    return res.redirect("/fan/voting");

  } catch (err) {
    console.error("Fan login error:", err);
    res.render("fan_login", {
      error: "Server error. Please try again.",
      name: req.body.name || "",
      email: req.body.email || ""
    });
  }
});





app.get("/fan/get_session", async (req, res) => {
  try {
    const fanSessionToken = req.cookies?.fan_session;

    if (!fanSessionToken) {
      return res.send("No fan session cookie found.");
    }

    // Fetch session from DB
    const sessionData = await getDB()
      .collection("fan_sessions")
      .findOne({ session_token: fanSessionToken });

    if (!sessionData) {
      return res.send("No session found for this token.");
    }

    // Show session data
    res.send(`
      <h2>Fan Session Data</h2>
      <p><strong>Fan ID:</strong> ${sessionData.fan_id}</p>
      <p><strong>Fan Name:</strong> ${sessionData.fan_name}</p>
      <p><strong>Event ID:</strong> ${sessionData.event_id}</p>
      <p><strong>Event Name:</strong> ${sessionData.event_name}</p>
      <p><strong>Session Token:</strong> ${sessionData.session_token}</p>
      <p><strong>Created At:</strong> ${sessionData.created_at}</p>
      <p><strong>Expires At:</strong> ${sessionData.expires_at}</p>
    `);

  } catch (err) {
    console.error("Error fetching fan session:", err);
    res.send("Error fetching fan session.");
  }
});




// =====================================================
// FAN: LIST ACTIVE MATCHES
// Shows non-finalized matches for fan voting
// =====================================================

// =====================================================
// FAN SESSION CHECKER
// =====================================================

function requireFanSession(req, res, next) {
  const fanSession = req.cookies?.fan_session;

  console.log("Fan session cookie:", fanSession);

  if (!fanSession) {
    return res.redirect("/fan/login");
  }

  next();
}


app.get("/fan/voting", requireFanSession, async (req, res) => {
  try {
    const db = getDB();
    if (!db) throw new Error("Database not connected");

    const fanSession = req.cookies.fan_session;

    const sessionData = await db
      .collection("fan_sessions")
      .findOne({ session_token: fanSession });

    if (!sessionData) return res.redirect("/fan/login");

    const [matchesArr, overtakesArr, ridersArr, votesArr] = await Promise.all([
      db.collection("matches").find({ finalized: { $ne: true } }).toArray(),
      db.collection("overtakes").find().toArray(),
      db.collection("riders").find().toArray(),
      db.collection("votes").find({ fan_session: fanSession }).toArray()
    ]);

    const votedMatchIds = new Set(votesArr.map(v => String(v.match_id)));

    const riders = {};
    ridersArr.forEach(r => { riders[String(r._id)] = r; });

    const overtakes = {};
    overtakesArr.forEach(o => {
      overtakes[String(o._id)] = {
        _id: o._id,
        description: o.description,
        heat: o.heat,
        overtaker: riders[o.overtaker_id] || { name: "Unknown", surname: "" },
        overtaken: riders[o.overtaken_id] || { name: "Unknown", surname: "" }
      };
    });

    const matches = matchesArr.map(m => ({
      _id: m._id,
      round: m.round,
      hotseat: overtakes[String(m.hotseat_overtake_id)] || null,
      challenger: overtakes[String(m.challenger_overtake_id)] || null,
      voteStatus: votedMatchIds.has(String(m._id)) ? "Already Voted" : "Allowed to Vote"
    }));

    const activeMatch = matches.length > 0 ? matches[matches.length - 1] : null;

    res.render("fan_voting", {
      session: sessionData,
      activeMatch,
      error: null
    });

  } catch (err) {
    console.error("Error loading fan voting:", err);
    res.render("fan_voting", {
      session: null,
      activeMatch: null,
      error: "Unable to load voting page"
    });
  }
});



app.post("/fan/voting", requireFanSession, async (req, res) => {
  try {
    const db = getDB();
    if (!db) throw new Error("Database not connected");

    const fanSession = req.cookies.fan_session;

    const sessionData = await db
      .collection("fan_sessions")
      .findOne({ session_token: fanSession });

    if (!sessionData) return res.status(401).json({ message: "Invalid session." });

    const { type } = req.body;

    // -----------------------------------
    // MATCH VOTE
    // -----------------------------------
    if (type === "match") {

      const { match_id, overtake_id } = req.body;

      if (!ObjectId.isValid(match_id) || !ObjectId.isValid(overtake_id)) {
        return res.status(400).json({ message: "Invalid vote data." });
      }

      const matchObjectId   = new ObjectId(match_id);
      const overtakeObjectId = new ObjectId(overtake_id);

      const existingVote = await db.collection("votes").findOne({
        fan_session: fanSession,
        match_id: matchObjectId
      });

      if (existingVote) {
        return res.status(400).json({ message: "You already voted on this match." });
      }

      await db.collection("votes").insertOne({
        fan_session: fanSession,
        match_id:    matchObjectId,
        overtake_id: overtakeObjectId,
        created_at:  new Date()
      });

      return res.json({ message: "Vote submitted!" });

    }

    // -----------------------------------
    // BEST RIDER VOTE
    // -----------------------------------
    if (type === "best_rider") {

      const { event_id, votes } = req.body;

      if (!event_id) {
        return res.status(400).json({ message: "Event ID is required." });
      }

      if (!votes || votes.length === 0) {
        return res.status(400).json({ message: "No votes submitted." });
      }

      const votesToInsert = votes.map(vote => ({
        fan_session: fanSession,
        event_id:    new ObjectId(event_id),
        rider_id:    vote.rider_id,
        class_id:    vote.class_id,
        heat:        parseInt(vote.heat),
        score:       parseInt(vote.score)
      }));

      await db.collection("best_rider_votes").insertMany(votesToInsert);

      return res.json({ message: "Votes submitted!" });

    }

    // -----------------------------------
    // UNKNOWN TYPE
    // -----------------------------------
    return res.status(400).json({ message: "Unknown vote type." });

  } catch (err) {
    console.error("Voting error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});



// =====================================================
// FAN: LIST ACTIVE MATCHES
// =====================================================

app.get("/fan/matches", requireFanSession, async (req, res) => {
  try {
    if (!getDB()) {
      throw new Error("Database not connected");
    }

    const fanSession = req.cookies.fan_session;
    if (!fanSession) {
      return res.redirect("/fan/login");
    }

    // Fetch session data from DB
    const sessionData = await getDB()
      .collection("fan_sessions")
      .findOne({ session_token: fanSession });

    const [
      matchesArr,
      overtakesArr,
      ridersArr,
      votesArr
    ] = await Promise.all([
      getDB().collection("matches")
        .find({ finalized: { $ne: true } })
        .toArray(),

      getDB().collection("overtakes").find().toArray(),
      getDB().collection("riders").find().toArray(),

      getDB().collection("votes")
        .find({ fan_session: fanSession })
        .toArray()
    ]);

    // ----------------------
    // Match IDs already voted by this fan
    // ----------------------
    const votedMatchIds = new Set(
      votesArr.map(v => String(v.match_id))
    );

    // ----------------------
    // Riders lookup
    // ----------------------
    const riders = {};
    ridersArr.forEach(r => {
      riders[String(r._id)] = r;
    });

    // ----------------------
    // Overtakes lookup
    // ----------------------
    const overtakes = {};
    overtakesArr.forEach(o => {
      overtakes[String(o._id)] = {
        _id: String(o._id),
        description: o.description,
        heat: o.heat,
        overtaker: riders[o.overtaker_id] || { name: "Unknown", surname: "" },
        overtaken: riders[o.overtaken_id] || { name: "Unknown", surname: "" }
      };
    });

    // ----------------------
    // Build matches with vote status
    // ----------------------
    const matches = matchesArr.map(m => ({
      _id: String(m._id),
      round: m.round,
      hotseat: overtakes[String(m.hotseat_overtake_id)] || null,
      challenger: overtakes[String(m.challenger_overtake_id)] || null,
      voteStatus: votedMatchIds.has(String(m._id))
        ? "Already Voted"
        : "Allowed to Vote"
    }));

    // ----------------------
    // Read flash message if present
    // ----------------------
    const flash = getFlash(req, res);

    res.render("fan_matches", {
      matches,
      session: sessionData,
      flash
    });

  } catch (err) {
    console.error("Error fetching fan matches:", err);

    res.render("fan_matches", {
      matches: [],
      session: null,
      flash: { type: 'error', message: 'Unable to load matches' }
    });
  }
});
// ============================================
// Socket Data Display Route
// ============================================
app.get('/socket-data', requireFanSession, (req, res) => {
  const fanSession = req.cookies?.fan_session;
  console.log('Fan session cookie:', fanSession);
  res.render('socket-data', { session: fanSession });
});
// ============================================


// =====================================================
// FAN: SUBMIT VOTE
// =====================================================

app.post("/fan/vote", requireFanSession, async (req, res) => {
  console.log("FULL BODY:", req.body);
  console.log("match_id:", req.body.match_id);
  console.log("overtake_id:", req.body.overtake_id);
  try {
    const { match_id, overtake_id } = req.body;
    const fanSession = req.cookies.fan_session;

    if (!ObjectId.isValid(match_id) || !ObjectId.isValid(overtake_id)) {
      setFlash(res, 'error', 'Invalid vote data.');
      return res.redirect("/fan/matches");
    }

    const matchObjectId = new ObjectId(match_id);
    const overtakeObjectId = new ObjectId(overtake_id);

    const existingVote = await getDB().collection("votes").findOne({
      fan_session: fanSession,
      match_id: matchObjectId
    });

    if (existingVote) {
      setFlash(res, 'error', 'You have already voted on this match.');
      return res.redirect("/fan/matches");
    }

    await getDB().collection("votes").insertOne({
      fan_session: fanSession,
      match_id: matchObjectId,
      overtake_id: overtakeObjectId,
      created_at: new Date()
    });

    setFlash(res, 'success', 'Vote submitted!');
    res.redirect("/fan/matches");

  } catch (err) {
    console.error("Vote error:", err);
    setFlash(res, 'error', 'Server error. Please try again.');
    res.redirect("/fan/matches");
  }
});

// =====================================================
// FAN: DEBUG VOTE ENDPOINT
// Logs headers and body for debugging
// =====================================================

app.post("/fan/vote/debug", (req, res) => {
  console.log("HEADERS:", req.headers);
  console.log("BODY:", req.body);

  res.json({
    headers: req.headers,
    body: req.body
  });
});


// ==========================
// Fan Best Rider Voting Routes
// ==========================


// ==========================
// Route to return active event ID from fan session
// ==========================
// ==========================
// Get current event ID for fan (show all events)
// ==========================
// ==========================
// Get current active event for fan
// ==========================
// ==========================
// Show active event + best rider contests
// ==========================
// ====================================================== 
// GET ROUTE - BEST RIDER VOTING PAGE
// ====================================================== 
app.get("/fan/best-trick", requireFanSession, async (req, res) => {
    try {
        const db = getDB();
        const fanSessionToken = req.cookies?.fan_session;

        if (!fanSessionToken) return res.redirect("/fan/login");

        const sessionData = await db
            .collection("fan_sessions")
            .findOne({ session_token: fanSessionToken });

        if (!sessionData) return res.redirect("/fan/login");

        // Pass the fan_id specifically so <%= fan_id %> works in EJS
        res.render("fan_best_trick", {
            fan_id: sessionData.fan_id || "No ID Found", 
            session: sessionData
        });

    } catch (err) {
        console.error("Error:", err);
        res.status(500).send("Error loading page.");
    }
});
// ====================================================== 
// POST ROUTE - SUBMIT BEST RIDER VOTES
// ====================================================== 
app.post("/fan/best-trick/vote", requireFanSession, async (req, res) => {
    try {
        const db = getDB();
        const fanSessionToken = req.cookies?.fan_session;

        // 1. Log the incoming data from the Fan's Browser
        console.log("--- STEP 1: Incoming Request Body ---");
        console.log(req.body); 

        const sessionData = await db.collection("fan_sessions").findOne({ 
            session_token: fanSessionToken 
        });

        // 2. Log what we found in the Database for this session
        console.log("--- STEP 2: Session Data from DB ---");
        console.log(sessionData);

        const { match_id, event_id, heat, voted_trick_id } = req.body;

        const voteDoc = {
            match_id: new ObjectId(match_id),
            event_id: new ObjectId(event_id),
            // We use a specific fallback string here to see if the logic triggers
            fan_id: sessionData?.fan_id || "DEBUG_FALLBACK_ANONYMOUS", 
            heat: parseInt(heat) || 0, 
            voted_trick_id: new ObjectId(voted_trick_id),
            timestamp: new Date()
        };

        // 3. Log the final object before it is saved
        console.log("--- STEP 3: Final Document to Save ---");
        console.log(voteDoc);

        await db.collection("best_trick_votes").insertOne(voteDoc);
        res.json({ success: true });

    } catch (err) {
        console.error("CRITICAL ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

// ======================================================
// Admin: Fetch Overtakes by Event (Enriched)
// ======================================================
app.get('/admin/overtakes/by-event/:eventId', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    if (!getDB()) throw new Error('Database not connected');

    const { eventId } = req.params;
    const { class_id } = req.query;

    // 1. Build the initial match filter
    let matchStage = { event_id: new ObjectId(eventId) };
    if (class_id) {
      matchStage.class_id = class_id;
    }

    // 2. Execute Aggregation
    const overtakes = await getDB().collection('overtakes').aggregate([
      { $match: matchStage },
      // Join for Overtaker
      {
        $lookup: {
          from: 'riders',
          let: { riderId: { $toObjectId: "$overtaker_id" } },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$riderId"] } } }
          ],
          as: 'overtaker_info'
        }
      },
      // Join for Overtaken
      {
        $lookup: {
          from: 'riders',
          let: { riderId: { $toObjectId: "$overtaken_id" } },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$riderId"] } } }
          ],
          as: 'overtaken_info'
        }
      },
      // 3. Project fields (CRITICAL: include 'deleted' here)
      {
        $project: {
          _id: 1,
          heat: 1,
          class_id: 1,
          description: 1,
          status: 1,
          deleted: 1,      // <--- This allows EJS to see the true/false value
          deleted_at: 1,   // <--- This allows EJS to see the timestamp
          overtaker_first: { $arrayElemAt: ["$overtaker_info.name", 0] },
          overtaker_last: { $arrayElemAt: ["$overtaker_info.surname", 0] },
          overtaken_first: { $arrayElemAt: ["$overtaken_info.name", 0] },
          overtaken_last: { $arrayElemAt: ["$overtaken_info.surname", 0] }
        }
      },
      { $sort: { heat: 1, _id: -1 } }
    ]).toArray();

    // Debugging: Check the first item in the console to verify 'deleted' is present
    if (overtakes.length > 0) {
      console.log("Sample Data sent to EJS:", overtakes[0]);
    }

    res.json(overtakes);
  } catch (err) {
    console.error('Error fetching overtakes:', err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// FAN: BEST RIDER VOTING
// GET  /fan/best-rider       — renders voting page with active contests
// POST /fan/best-rider/vote  — submits score votes to best_rider_votes
// ======================================================

app.get("/fan/best-rider", requireFanSession, async (req, res) => {
  try {
    const fanSessionToken = req.cookies.fan_session;
    const sessionData = await getDB()
      .collection("fan_sessions")
      .findOne({ session_token: fanSessionToken });

    if (!sessionData) return res.redirect("/fan/login");

    const eventId = sessionData.event_id;

    // Load active contests for this event
    const contests = await getDB()
      .collection("best_rider_contests")
      .find({
        event_id:      new ObjectId(eventId),
        deleted:       { $ne: true },
        status:        { $ne: "inactive" },
        voting_locked: { $ne: true }
      })
      .sort({ class_id: 1, heat: 1 })
      .toArray();

    // Find heats this fan already voted on
    const existingVotes = await getDB()
      .collection("best_rider_votes")
      .find({
        fan_session: fanSessionToken,
        event_id:    new ObjectId(eventId)
      })
      .toArray();

    const alreadyVotedKeys = new Set(
      existingVotes.map(v => `${v.class_id}|${v.heat}`)
    );

    // Group by class → heat
    const grouped = {};
    contests.forEach(c => {
      if (!grouped[c.class_id]) grouped[c.class_id] = {};
      if (!grouped[c.class_id][c.heat]) grouped[c.class_id][c.heat] = [];
      grouped[c.class_id][c.heat].push(c);
    });

    res.render("fan_best_rider", {
      session: sessionData,
      grouped,
      alreadyVotedKeys,
      error: null
    });

  } catch (err) {
    console.error("GET /fan/best-rider error:", err);
    res.status(500).send("Error loading page.");
  }
});

app.post("/fan/best-rider/vote", requireFanSession, async (req, res) => {
  try {
    const fanSessionToken = req.cookies?.fan_session;
    if (!fanSessionToken) return res.status(400).json({ message: "No fan session cookie found." });

    // Fetch session from DB
    const sessionData = await getDB()
      .collection("fan_sessions")
      .findOne({ session_token: fanSessionToken });

    if (!sessionData) return res.status(400).json({ message: "No session found for this token." });

    const { event_id, votes } = req.body;

    if (!event_id) return res.status(400).json({ message: "Event ID is required." });
    if (!votes || votes.length === 0) return res.status(400).json({ message: "No votes submitted." });

    console.log("Submitting best rider votes for event:");
    console.log("ID:", event_id);

    // Duplicate check — reject if fan already voted for any of the submitted class+heat combos
    const incomingKeys = votes.map(v => `${v.class_id}|${parseInt(v.heat)}`);

    const existingVotes = await getDB()
      .collection("best_rider_votes")
      .find({
        fan_session: fanSessionToken,
        event_id:    new ObjectId(event_id)
      })
      .toArray();

    const alreadyVotedKeys = new Set(
      existingVotes.map(v => `${v.class_id}|${v.heat}`)
    );

    const duplicates = incomingKeys.filter(k => alreadyVotedKeys.has(k));
    if (duplicates.length > 0) {
      return res.status(400).json({ message: `You already voted for: ${duplicates.join(", ")}` });
    }

    // Build votes array for insertion
    const votesToInsert = votes.map(vote => ({
      fan_session: fanSessionToken,
      event_id:    new ObjectId(event_id),
      rider_id:    vote.rider_id,
      class_id:    vote.class_id,
      heat:        parseInt(vote.heat),
      score:       parseInt(vote.score)
    }));

    // Insert into best_rider_votes collection
    await getDB().collection("best_rider_votes").insertMany(votesToInsert);

    res.json({ message: "Thank you for voting!" });

  } catch (err) {
    console.error("Error submitting best rider votes:", err);
    res.status(500).json({ message: "Error submitting votes." });
  }
});

// ======================================================
// END FAN: BEST RIDER VOTING
// ======================================================


// ======================================================
// Admin: Fetch Overtakes by Event (Enriched)
// ======================================================
app.get("/admin/overtakes/by-event/:eventId", async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!getDB()) {
      return res.status(500).json({ error: "Database not connected" });
    }

    // Load base data
    const overtakes = await getDB()
      .collection("overtakes")
      .find({ event_id: new ObjectId(eventId) })
      .toArray();

    const riders = await getDB().collection("riders").find().toArray();
    const classes = await getDB().collection("classes").find().toArray();

    // Build lookup maps
    const riderMap = {};
    riders.forEach(r => {
      riderMap[String(r._id)] = `${r.name} ${r.surname}`;
    });

    const classMap = {};
    classes.forEach(c => {
      classMap[String(c._id)] = c.name;
    });

    // Enrich overtakes
    const enriched = overtakes.map(o => ({
      _id: o._id,
      heat: o.heat,
      description: o.description,
      status: o.status,
      class: classMap[o.class_id] || "Unknown class",
      overtaker: riderMap[o.overtaker_id] || "Unknown rider",
      overtaken: riderMap[o.overtaken_id] || "Unknown rider",
      deleted: !!o.deleted,
      deleted_at: o.deleted_at || null
    }));

    res.json(enriched);
  } catch (err) {
    console.error("Error fetching overtakes by event:", err);
    res.status(500).json({ error: "Failed to load overtakes" });
  }
});


// ======================================================
// Admin: Create Overtake Routes
// ======================================================

// GET: Render create overtake form
app.get('/admin/overtake/new', async (req, res) => {
  try {
    if (!getDB()) throw new Error('Database not connected');

    const events  = await getDB().collection('events').find().toArray();
    const classes = await getDB().collection('classes').find().toArray();
    const riders  = await getDB().collection('riders').find().toArray();

    res.render('admin_overtake_form', {
      events,
      classes,
      riders,
      overtake: {},
      error: null,
      success: null
    });
  } catch (err) {
    console.error('Error loading form:', err);

    res.render('admin_overtake_form', {
      events: [],
      classes: [],
      riders: [],
      overtake: {},
      error: 'Error loading form data',
      success: null
    });
  }
});

// POST: Create new overtake
app.post('/admin/overtake/new', async (req, res) => {
  try {
    if (!getDB()) throw new Error('Database not connected');

    const {
      event_id,
      class_id,
      heat,
      overtaker_id,
      overtaken_id,
      description,
      status
    } = req.body;

    const events  = await getDB().collection('events').find().toArray();
    const classes = await getDB().collection('classes').find().toArray();
    const riders  = await getDB().collection('riders').find().toArray();

    // Validate input
    if (!event_id || !class_id || !heat || !overtaker_id || !overtaken_id || !description) {
      return res.render('admin_overtake_form', {
        events,
        classes,
        riders,
        overtake: req.body,
        error: 'All fields are required',
        success: null
      });
    }

    if (overtaker_id === overtaken_id) {
      return res.render('admin_overtake_form', {
        events,
        classes,
        riders,
        overtake: req.body,
        error: 'Overtaker and overtaken must be different riders',
        success: null
      });
    }

    await getDB().collection('overtakes').insertOne({
      event_id: new ObjectId(event_id),
      class_id,
      heat: Number(heat),
      overtaker_id,
      overtaken_id,
      description,
      status: status || 'available',
      created_at: new Date()
    });

    res.render('admin_overtake_form', {
      events,
      classes,
      riders,
      overtake: {},
      error: null,
      success: 'Overtake created successfully!'
    });

  } catch (err) {
    console.error('Error creating overtake:', err);

    const events  = await getDB().collection('events').find().toArray();
    const classes = await getDB().collection('classes').find().toArray();
    const riders  = await getDB().collection('riders').find().toArray();

    res.render('admin_overtake_form', {
      events,
      classes,
      riders,
      overtake: req.body,
      error: 'Server error. Please try again.',
      success: null
    });
  }
});

// ======================================================
// Admin: Soft Delete / Restore Overtake
// ======================================================
// POST: Soft delete overtake
app.post('/admin/overtake/:id/delete', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb'); 
    if (!getDB()) throw new Error('Database not connected');

    const { id } = req.params;

    const result = await getDB().collection('overtakes').updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          deleted: true,
          deleted_at: new Date()
        }
      }
    );

    console.log(`\n--- SOFT DELETE ---`);
    console.log(`ID: ${id}`);
    console.log(`Status: Document marked as deleted.`);

    res.json({ success: true });
  } catch (err) {
    console.error('Error soft deleting overtake:', err);
    res.status(500).json({ success: false });
  }
});

// POST: Restore soft-deleted overtake
app.post('/admin/overtake/:id/restore', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    if (!getDB()) throw new Error('Database not connected');

    const { id } = req.params;

    const result = await getDB().collection('overtakes').updateOne(
      { _id: new ObjectId(id) },
      {
        $unset: {
          deleted: "",
          deleted_at: ""
        }
      }
    );

    console.log(`\n--- RESTORE ---`);
    console.log(`ID: ${id}`);
    console.log(`Status: Fields 'deleted' and 'deleted_at' removed.`);

    res.json({ success: true });
  } catch (err) {
    console.error('Error restoring overtake:', err);
    res.status(500).json({ success: false });
  }
});
// ======================================================
// Admin: Edit Overtake Routes
// ======================================================

// GET: Render edit overtake form
app.get("/admin/overtake/edit/:id", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const { id } = req.params;

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      console.error("Invalid ObjectId:", id);
      return res.status(400).send(`Invalid overtake ID: ${id}`);
    }

    // Fetch overtake
    const overtake = await getDB().collection("overtakes").findOne({ _id: new ObjectId(id) });
    if (!overtake) {
      console.error("Overtake not found for ID:", id);
      return res.status(404).send(`Overtake not found with ID: ${id}`);
    }

    // Load supporting data
    const [events, classes, riders] = await Promise.all([
      getDB().collection("events").find().toArray(),
      getDB().collection("classes").find().toArray(),
      getDB().collection("riders").find().toArray()
    ]);

    res.render("admin_overtake_edit", {
      overtake,
      events,
      classes,
      riders,
      error: null,
      success: null
    });

  } catch (err) {
    console.error("Error loading overtake for edit:", err);
    res.status(500).send(`Server error loading overtake: ${err.message}`);
  }
});

// POST: Update overtake
app.post('/admin/overtake/edit/:id', async (req, res) => {
  try {
    const overtakeId = req.params.id;

    const {
      event_id,
      class_id,
      heat,
      overtaker_id,
      overtaken_id,
      description,
      status
    } = req.body;

    // Validate input
    if (!event_id || !class_id || !overtaker_id || !overtaken_id) {
      console.error("Missing required fields:", req.body);
      return res.redirect(`/admin/overtake/edit/${overtakeId}`);
    }

    if (overtaker_id === overtaken_id) {
      return res.redirect(`/admin/overtake/edit/${overtakeId}`);
    }

    await getDB().collection('overtakes').updateOne(
      { _id: new ObjectId(overtakeId) },
      {
        $set: {
          event_id: new ObjectId(event_id),
          class_id,
          heat: Number(heat),
          overtaker_id,
          overtaken_id,
          description,
          status,
          updated_at: new Date()
        }
      }
    );

    res.redirect(`/admin/overtake/new?event_id=${event_id}`);

  } catch (err) {
    console.error('Error updating overtake:', err);
    res.redirect('/admin/overtake/new');
  }
});


// ======================================================
// Helper: Get and Log Current Hot Seat (With Rider Names)
// ======================================================
async function getCurrentHotSeat(eventId) {
  if (!eventId) return null;

  // Find latest finalized match for event
  const lastMatchArr = await getDB().collection("matches_results")
    .find({ event_id: new ObjectId(eventId) })
    .sort({ finalized_at: -1 })
    .limit(1)
    .toArray();

  if (!lastMatchArr || lastMatchArr.length === 0) {
    console.log("No matches found for this event yet.");
    return null;
  }

  const match = lastMatchArr[0];

  const winnerOvertakeId = match.winner_overtake_id;
  if (!winnerOvertakeId) return null;

  const winnerOvertake = await getDB().collection("overtakes")
    .findOne({ _id: new ObjectId(winnerOvertakeId) });

  if (!winnerOvertake) return null;

  const overtaker = await getDB().collection("riders")
    .findOne({ _id: new ObjectId(winnerOvertake.overtaker_id) });
  const overtaken = await getDB().collection("riders")
    .findOne({ _id: new ObjectId(winnerOvertake.overtaken_id) });

  if (!overtaker || !overtaken) return null;

  const winnerNames = `${overtaker.name} ${overtaker.surname} → ${overtaken.name} ${overtaken.surname}`;

  // Console log
  console.log("=== Winner of Latest Match ===");
  console.log("Event ID:", eventId);
  console.log("Match ID:", match.match_id.toString());
  console.log("Winner Overtake ID:", winnerOvertake._id.toString());
  console.log("Winner Names:", winnerNames);
  console.log("Winner Side:", match.winner_side);
  console.log("==============================");

  // Return full object including _id
  return {
    _id: winnerOvertake._id.toString(),
    riderNames: winnerNames,
    winnerNames,
    heat: winnerOvertake.heat || "?",
    description: winnerOvertake.description || "Unknown",
    votes: match.votes,
    winnerSide: match.winner_side,
    finalizedAt: match.finalized_at,
  };
}



// ======================================================
// Admin: Render Match Creation Page
// ======================================================
app.get("/admin/matches/new", async (req, res) => {
  try {
    // Load base data
    const events = await getDB().collection("events").find().toArray();
    const riders = await getDB().collection("riders").find().toArray();
    const classes = await getDB().collection("classes").find().toArray();

    const selectedEvent = req.query.event_id;

    let overtakes = [];
    let matches = [];
    let currentHotSeat = null;

    if (selectedEvent) {
      console.log("Selected Event ID:", selectedEvent);

      // Load current hot seat
      currentHotSeat = await getCurrentHotSeat(selectedEvent);

      // Load overtakes for event
      overtakes = await getDB().collection("overtakes")
        .find({ event_id: new ObjectId(selectedEvent) })
        .toArray();

      // Load matches for event
      matches = await getDB().collection("matches")
        .find({ event_id: new ObjectId(selectedEvent) })
        .toArray();

      // Enrich matches with display info
      matches = matches.map(match => {
        const hotseat = overtakes.find(o => o._id.toString() === match.hotseat_overtake_id.toString());
        const challenger = overtakes.find(o => o._id.toString() === match.challenger_overtake_id.toString());

        const getRiderNames = (overtake) => {
          if (!overtake) return "Unknown";
          const overtaker = riders.find(r => r._id.toString() === overtake.overtaker_id.toString());
          const overtaken = riders.find(r => r._id.toString() === overtake.overtaken_id.toString());
          return overtaker && overtaken
            ? `${overtaker.name} ${overtaker.surname} → ${overtaken.name} ${overtaken.surname}`
            : "Unknown";
        };

        return {
          ...match,
          hotseatInfo: {
            riderNames: getRiderNames(hotseat),
            heat: hotseat ? hotseat.heat : "?",
            description: hotseat ? hotseat.description : "Unknown"
          },
          challengerInfo: {
            riderNames: getRiderNames(challenger),
            heat: challenger ? challenger.heat : "?",
            description: challenger ? challenger.description : "Unknown"
          }
        };
      });
    }

    // Render page
    res.render("admin_match_form", {
      events,
      riders,
      classes,
      selectedEvent: selectedEvent || null,
      overtakes,
      matches,
      currentHotSeat,
      error: null,
      success: null,
    });

  } catch (err) {
    console.error("Error loading match form:", err);
    res.render("admin_match_form", {
      events: [],
      riders: [],
      classes: [],
      selectedEvent: null,
      overtakes: [],
      matches: [],
      currentHotSeat: null,
      error: "Failed to load data",
      success: null,
    });
  }
});
// ======================================================
// Admin: Create New Match
// ======================================================

// ======================================================
// Admin: Create New Match
// ======================================================
app.post("/admin/matches/new", async (req, res) => {
  try {
    const { event_id, hotseat_overtake_id, challenger_overtake_id } = req.body;
    const db = getDB();

    // Validation: Ensure IDs are valid ObjectIds
    if (!ObjectId.isValid(hotseat_overtake_id) || !ObjectId.isValid(challenger_overtake_id)) {
      return res.status(400).send("Invalid overtake ID provided");
    }
    
    if (hotseat_overtake_id === challenger_overtake_id) {
      return res.status(400).send("Hotseat and challenger cannot be the same overtake");
    }
    
    // 1. Insert the match into the database
    const result = await db.collection("matches").insertOne({
      event_id: new ObjectId(event_id),
      hotseat_overtake_id: new ObjectId(hotseat_overtake_id),
      challenger_overtake_id: new ObjectId(challenger_overtake_id),
      finalized: false,
      deleted: false,
      created_at: new Date()
    });
    
    // 2. Fetch full details for both overtakes to build the display strings
    const hotseatOvertake = await db.collection("overtakes").findOne({ _id: new ObjectId(hotseat_overtake_id) });
    const challengerOvertake = await db.collection("overtakes").findOne({ _id: new ObjectId(challenger_overtake_id) });
    
    // Helper function to fetch and format rider names
    const getRiderName = async (id) => {
      if (!id) return "Unknown";
      const r = await db.collection("riders").findOne({ _id: new ObjectId(id) });
      return r ? `${r.name} ${r.surname}` : "Unknown";
    };

    // 3. Construct the "Pretty" strings
    let hotseatDisplay = "Unknown Hotseat";
    if (hotseatOvertake) {
      const hNames = `${await getRiderName(hotseatOvertake.overtaker_id)} → ${await getRiderName(hotseatOvertake.overtaken_id)}`;
      hotseatDisplay = `Heat ${hotseatOvertake.heat}: ${hNames} - ${hotseatOvertake.description || 'No description'}`;
    }

    let challengerDisplay = "Unknown Challenger";
    if (challengerOvertake) {
      const cNames = `${await getRiderName(challengerOvertake.overtaker_id)} → ${await getRiderName(challengerOvertake.overtaken_id)}`;
      challengerDisplay = `Heat ${challengerOvertake.heat}: ${cNames} - ${challengerOvertake.description || 'No description'}`;
    }

    // 4. Emit socket event (This is the "Single Source of Truth" broadcast)
    io.emit('new_match_notification', {
      match_id: result.insertedId.toString(),
      event_id: event_id,
      // FIXED: Added class_id to the broadcast
      class_id: hotseatOvertake ? hotseatOvertake.class_id : "Active Match",
      hotseat_overtake_id: hotseat_overtake_id,
      challenger_overtake_id: challenger_overtake_id,
      hotseat_display: hotseatDisplay,
      challenger_display: challengerDisplay,
      timestamp: new Date().toISOString()
    });
    
    console.log('Match broadcasted successfully with descriptions:', result.insertedId.toString());
    
    // Redirect back to the setup page
    res.redirect(`/admin/matches/new?event_id=${event_id}`);
    
  } catch (err) {
    console.error("Error creating match:", err);
    res.status(500).send("Internal Server Error");
  }
});
// ======================================================
// Admin: Edit Match
// ======================================================
app.get("/admin/matches/edit/:id", async (req, res) => {
  try {
    const matchId = req.params.id;
    const match = await getDB().collection("matches").findOne({ _id: new ObjectId(matchId) });

    if (!match) return res.redirect("/admin/matches/new");

    const events = await getDB().collection("events").find().toArray();
    const riders = await getDB().collection("riders").find().toArray();
    const classes = await getDB().collection("classes").find().toArray();
    const overtakes = await getDB().collection("overtakes").find({ event_id: new ObjectId(match.event_id) }).toArray();

    res.render("admin_match_edit", {
      match,
      overtakes,
      events,
      riders,
      classes,
      error: null
    });

  } catch (err) {
    console.error("Error loading match edit:", err);
    res.redirect("/admin/matches/new");
  }
});

// ======================================================
// Admin: Update Match
// ======================================================
app.post("/admin/matches/update/:id", async (req, res) => {
  try {
    const matchId = req.params.id;
    const { hotseat_overtake_id, challenger_overtake_id, event_id } = req.body;

    if (hotseat_overtake_id === challenger_overtake_id) {
      return res.redirect(`/admin/matches/edit/${matchId}`);
    }

    await getDB().collection("matches").updateOne(
      { _id: new ObjectId(matchId) },
      {
        $set: {
          hotseat_overtake_id: new ObjectId(hotseat_overtake_id),
          challenger_overtake_id: new ObjectId(challenger_overtake_id),
          updated_at: new Date()
        }
      }
    );

    res.redirect(`/admin/matches/new?event_id=${event_id}`);

  } catch (err) {
    console.error("Error updating match:", err);
    res.redirect("/admin/matches/new");
  }
});


// ======================================================
// Admin: Soft Delete Match
// ======================================================
app.post("/admin/matches/:id/delete", async (req, res) => {
  try {
    const matchId = req.params.id;

    await getDB().collection("matches").updateOne(
      { _id: new ObjectId(matchId) },
      {
        $set: {
          deleted: true,
          deleted_at: new Date()
        }
      }
    );

    res.redirect(`/admin/matches/new?event_id=${req.query.event_id || ""}`);
  } catch (err) {
    console.error("Error soft deleting match:", err);
    res.status(500).send("Failed to delete match");
  }
});

// ======================================================
// Admin: Restore Match
// ======================================================
app.post("/admin/matches/:id/restore", async (req, res) => {
  try {
    const matchId = req.params.id;

    await getDB().collection("matches").updateOne(
      { _id: new ObjectId(matchId) },
      {
        $set: { deleted: false },
        $unset: { deleted_at: "" }
      }
    );

    res.redirect(`/admin/matches/new?event_id=${req.query.event_id || ""}`);
  } catch (err) {
    console.error("Error restoring match:", err);
    res.status(500).send("Failed to restore match");
  }
});

// ======================================================
// Admin: Match Results
// ======================================================
app.get("/admin/matches/results", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const event_id = req.query.event_id || null;

    const [matches, overtakes, riders, votes, matchResults, events] = await Promise.all([
      getDB().collection("matches").find(event_id ? { event_id: new ObjectId(event_id) } : {}).toArray(),
      getDB().collection("overtakes").find().toArray(),
      getDB().collection("riders").find().toArray(),
      getDB().collection("votes").find().toArray(),
      getDB().collection("matches_results").find().toArray(),
      getDB().collection("events").find().toArray()
    ]);

    const normalizeId = id => (id ? String(id) : null);

    const ridersMap = {};
    riders.forEach(r => {
      ridersMap[normalizeId(r._id)] = r;
    });

    const overtakesMap = {};
    overtakes.forEach(o => {
      overtakesMap[normalizeId(o._id)] = {
        _id: o._id,
        description: o.description,
        heat: o.heat,
        // --- FIX 1: CAPTURE CLASS_ID FROM OVERTAKE COLLECTION ---
        class_id: o.class_id || "N/A", 
        // -------------------------------------------------------
        overtaker: ridersMap[normalizeId(o.overtaker_id)] || { name: "Unknown", surname: "" },
        overtaken: ridersMap[normalizeId(o.overtaken_id)] || { name: "Unknown", surname: "" }
      };
    });

    const matchResultsMap = {};
    matchResults.forEach(r => {
      matchResultsMap[normalizeId(r.match_id)] = r;
    });

    const results = matches.map(m => {
      const matchVotes = votes.filter(v => normalizeId(v.match_id) === normalizeId(m._id));
      const hotseatVotes = matchVotes.filter(v => normalizeId(v.overtake_id) === normalizeId(m.hotseat_overtake_id));
      const challengerVotes = matchVotes.filter(v => normalizeId(v.overtake_id) === normalizeId(m.challenger_overtake_id));
      const matchResult = matchResultsMap[normalizeId(m._id)];
      
      // Access the hotseat data from the map we built above
      const hotseatData = overtakesMap[normalizeId(m.hotseat_overtake_id)];

      return {
        _id: m._id,
        // --- FIX 2: ACCESS CLASS_ID VIA THE OVERTAKE DATA ---
        class_id: hotseatData ? hotseatData.class_id : "N/A",
        round: m.round || null,
        // ----------------------------------------------------
        hotseat: hotseatData,
        challenger: overtakesMap[normalizeId(m.challenger_overtake_id)],
        votes: {
          total: matchVotes.length,
          hotseat: hotseatVotes.length,
          challenger: challengerVotes.length
        },
        voters: matchVotes,
        finalized: m.finalized || false,
        champion: matchResult ? matchResult.champion === true : false
      };
    });

    res.render("admin_match_results", { results, events, event_id, error: null });
  } catch (err) {
    console.error("Error loading admin results:", err);
    res.render("admin_match_results", { results: [], events: [], event_id: null, error: "Failed to load match results" });
  }
});

// ======================================================
// Admin: List All Events
// ======================================================
app.get("/admin/events/list", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const events = await getDB()
      .collection("events")
      .find()
      .sort({ created_at: -1 })
      .toArray();

    res.render("admin_events_list", {
      events,
      error: null
    });

  } catch (err) {
    console.error("Error listing events:", err);
    res.render("admin_events_list", {
      events: [],
      error: "Failed to load events"
    });
  }
});



// GET: Render create event form
app.get("/admin/events/new", async (req, res) => {
  try {
    res.render("admin_event_form", { event: {}, error: null, success: null });
  } catch (err) {
    console.error("Error loading event form:", err);
    res.render("admin_event_form", { event: {}, error: "Failed to load form", success: null });
  }
});

// POST: Create a new event
app.post("/admin/events/new", async (req, res) => {
  try {
    const { name, location, date } = req.body;

    if (!name || !location || !date) {
      return res.render("admin_event_form", { event: req.body, error: "All fields are required", success: null });
    }

    await getDB().collection("events").insertOne({
      name: name.trim(),
      location: location.trim(),
      date: new Date(date),
      created_at: new Date()
    });

    res.render("admin_event_form", { event: {}, error: null, success: "Event created successfully!" });
  } catch (err) {
    console.error("Error creating event:", err);
    res.render("admin_event_form", { event: req.body, error: "Server error. Please try again.", success: null });
  }
});


// ======================================================
// Admin: Render Edit Event Form
// ======================================================
app.get("/admin/events/edit/:id", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const event = await getDB().collection("events").findOne({
      _id: new ObjectId(req.params.id)
    });

    if (!event) {
      return res.render("admin_event_edit", {
        event: null,
        error: "Event not found",
        success: null
      });
    }

    res.render("admin_event_edit", {
      event,
      error: null,
      success: null
    });

  } catch (err) {
    console.error("Error loading edit event:", err);
    res.render("admin_event_edit", {
      event: null,
      error: "Failed to load event",
      success: null
    });
  }
});

// ======================================================
// Admin: Update Event
// ======================================================
app.post("/admin/events/edit/:id", async (req, res) => {
  try {
    const { name, location, date } = req.body;

    if (!name || !location || !date) {
      return res.render("admin_event_edit", {
        event: { _id: req.params.id, ...req.body },
        error: "All fields are required",
        success: null
      });
    }

    await getDB().collection("events").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          name: name.trim(),
          location: location.trim(),
          date: new Date(date),
          updated_at: new Date()
        }
      }
    );

    const updatedEvent = await getDB().collection("events").findOne({
      _id: new ObjectId(req.params.id)
    });

    res.render("admin_event_edit", {
      event: updatedEvent,
      error: null,
      success: "Event updated successfully!"
    });

  } catch (err) {
    console.error("Error updating event:", err);
    res.render("admin_event_edit", {
      event: { _id: req.params.id, ...req.body },
      error: "Server error. Please try again.",
      success: null
    });
  }
});

// ======================================================
// Admin: Soft Delete Event (Cascade)
// ======================================================
app.post("/admin/events/:id/delete", async (req, res) => {
  const eventId = req.params.id;

  try {
    // Soft delete event
    await getDB().collection("events").updateOne(
      { _id: new ObjectId(eventId) },
      {
        $set: {
          deleted: true,
          deleted_at: new Date()
        }
      }
    );

    // Deactivate related matches
    await getDB().collection("matches").updateMany(
      { event_id: new ObjectId(eventId) },
      {
        $set: {
          status: "inactive",
          updated_at: new Date()
        }
      }
    );

    // Deactivate related overtakes
    await getDB().collection("overtakes").updateMany(
      { event_id: new ObjectId(eventId) },
      {
        $set: {
          status: "inactive",
          updated_at: new Date()
        }
      }
    );

    res.redirect("/admin/events/list");

  } catch (err) {
    console.error("Error soft deleting event with cascade:", err);
    res.status(500).send("Failed to delete event");
  }
});
// ======================================================
// Admin: Restore Event (Cascade)
// ======================================================
app.post("/admin/events/:id/restore", async (req, res) => {
  const eventId = req.params.id;

  try {
    // Restore event
    await getDB().collection("events").updateOne(
      { _id: new ObjectId(eventId) },
      {
        $set: { deleted: false },
        $unset: { deleted_at: "" }
      }
    );

    // Reactivate non-finalized matches
    await getDB().collection("matches").updateMany(
      {
        event_id: new ObjectId(eventId),
        finalized: { $ne: true }
      },
      {
        $set: {
          status: "active",
          updated_at: new Date()
        }
      }
    );

    // Reactivate overtakes
    await getDB().collection("overtakes").updateMany(
      {
        event_id: new ObjectId(eventId),
        status: "inactive"
      },
      {
        $set: {
          status: "available",
          updated_at: new Date()
        }
      }
    );

    res.redirect("/admin/events/list");

  } catch (err) {
    console.error("Error restoring event with cascade:", err);
    res.status(500).send("Failed to restore event");
  }
});


// ======================================================
// Admin: Finalize / Unfinalize Match
// ======================================================
app.post("/admin/matches/:matchId/finalize", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const matchId = new ObjectId(req.params.matchId);

    // Load match
    const match = await getDB().collection("matches").findOne({ _id: matchId });
    if (!match) return res.status(404).send("Match not found");

    // Ensure finalized flag exists
    if (typeof match.finalized === "undefined") match.finalized = false;

    console.log("Match loaded:", match);

    if (!match.finalized) {
      // Finalize match
      const summary = await finalizeMatchAndStoreResult(matchId);
      console.log("Match finalized:", summary);

      // --- ESSENTIAL SOCKET LOGIC START ---
      let winnerName = "Draw";
      let marginPct = "0.0";
      let className = "Open"; // Default fallback

      if (summary.winner_overtake_id) {
        // Find the overtake to get the class_id and overtaker_id
        const overtake = await getDB().collection("overtakes").findOne({ _id: new ObjectId(summary.winner_overtake_id) });
        if (overtake) {
          // Capture class_id from the overtake document
          className = overtake.class_id || "Open";

          const rider = await getDB().collection("riders").findOne({ _id: new ObjectId(overtake.overtaker_id) });
          if (rider) winnerName = `${rider.name} ${rider.surname}`;
        }
      }

      const total = summary.votes.total || 0;
      if (total > 0) {
        const diff = Math.abs(summary.votes.hotseat - summary.votes.challenger);
        marginPct = ((diff / total) * 100).toFixed(1);
      }

      const emitData = {
        match_id:    matchId.toString(),
        class_name:  className, // Added class from overtake
        winner_name: winnerName,
        margin_pct:  marginPct,
        votes:       summary.votes,
        winner_side: summary.winner_side
      };

      console.log("SERVER LOG: Emitting to fans:", emitData);
      io.emit('match_winner_announced', emitData);
      // --- ESSENTIAL SOCKET LOGIC END ---

    } else {
      // Roll back finalization
      await getDB().collection("matches_results").deleteOne({ match_id: matchId });
      await getDB().collection("matches").updateOne(
        { _id: matchId },
        { $set: { finalized: false, updated_at: new Date() } }
      );
      console.log("Match unfinalized:", matchId.toString());
      
      // Essential: Tell fans to reset their screens
      io.emit('match_unfinalized', { match_id: matchId.toString() });
    }

    res.redirect("/admin/matches/results");

  } catch (err) {
    console.error("Finalize error:", err);
    res.status(500).send(err.message || "Failed to finalize match");
  }
});

// ======================================================
// Helper: Finalize Match and Store Result
// ======================================================
async function finalizeMatchAndStoreResult(matchId) {
  if (!getDB()) throw new Error("Database not connected");

  // Load match
  const match = await getDB().collection("matches").findOne({ _id: matchId });
  if (!match) throw new Error("Match not found");
  if (match.finalized) throw new Error("Match already finalized");

  console.log("Finalizing match:", matchId.toString());

  // Normalize ID helper
  const normalizeId = id => (id ? String(id) : null);

  // Load votes (ObjectId or string)
  const votes = await getDB().collection("votes")
    .find({
      $or: [
        { match_id: match._id },
        { match_id: String(match._id) }
      ]
    })
    .toArray();

  console.log(`Loaded ${votes.length} votes for match ${matchId.toString()}`);
  console.log("Votes:", votes);

  // Count votes
  const hotseatVotes = votes.filter(
    v => normalizeId(v.overtake_id) === normalizeId(match.hotseat_overtake_id)
  ).length;

  const challengerVotes = votes.filter(
    v => normalizeId(v.overtake_id) === normalizeId(match.challenger_overtake_id)
  ).length;

  const totalVotes = votes.length;

  console.log("Vote counts:", { totalVotes, hotseatVotes, challengerVotes });

  // Determine winner
  let winnerOvertakeId = null;
  let winnerSide = "tie";

  if (hotseatVotes > challengerVotes) {
    winnerOvertakeId = match.hotseat_overtake_id;
    winnerSide = "hotseat";
  } else if (challengerVotes > hotseatVotes) {
    winnerOvertakeId = match.challenger_overtake_id;
    winnerSide = "challenger";
  }

  console.log("Winner decided:", { winnerOvertakeId, winnerSide });

  // Build result document
  const resultDoc = {
    event_id: match.event_id,
    match_id: match._id,
    hotseat_overtake_id: match.hotseat_overtake_id,
    challenger_overtake_id: match.challenger_overtake_id,
    winner_overtake_id: winnerOvertakeId,
    winner_side: winnerSide,
    votes: {
      total: totalVotes,
      hotseat: hotseatVotes,
      challenger: challengerVotes
    },
    round: match.round || null,
    finalized_at: new Date(),
    created_at: new Date()
  };

  // Insert result
  const insertResult = await getDB().collection("matches_results").insertOne(resultDoc);
  console.log("Result inserted:", insertResult.insertedId.toString());

  // Update match
  await getDB().collection("matches").updateOne(
    { _id: match._id },
    {
      $set: {
        finalized: true,
        winner_overtake_id: winnerOvertakeId,
        winner_side: winnerSide,
        votes: {
          total: totalVotes,
          hotseat: hotseatVotes,
          challenger: challengerVotes
        },
        updated_at: new Date()
      }
    }
  );

  console.log("Match updated with finalized info:", matchId.toString());

  return {
    match_id: match._id,
    winner_overtake_id: winnerOvertakeId,
    winner_side: winnerSide,
    votes: {
      total: totalVotes,
      hotseat: hotseatVotes,
      challenger: challengerVotes
    }
  };
}



// ======================================================
// Admin: Set / Unset Match Champion
// ======================================================
app.post("/admin/matches/:matchId/champion", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const matchId = new ObjectId(req.params.matchId);
    const match_number = parseInt(req.body.match_number) || null;

    const matchResult = await getDB().collection("matches_results").findOne({ match_id: matchId });
    if (!matchResult) return res.status(404).send("Match result not found");

    const isChampion = matchResult.champion === true;

    // Toggle the champion status in the DB
    await getDB().collection("matches_results").updateOne(
      { match_id: matchId },
      { $set: { champion: !isChampion, updated_at: new Date() } }
    );

    // LOGGING: If we just UNSET a champion
    if (isChampion) {
      console.log(`↩️  Champion UNSET: Match #${match_number} (ID: ${matchId})`);
    }

    if (!isChampion) {
      const match = await getDB().collection("matches").findOne({ _id: matchId });

      // --- Data gathering for Hotseat and Challenger (including class_id) ---
      let hotseatData = null;
      let hsClass = null; 
      if (match.hotseat_overtake_id) {
        const hotseatOvertake = await getDB().collection("overtakes").findOne({ _id: new ObjectId(match.hotseat_overtake_id) });
        if (hotseatOvertake) {
          hsClass = hotseatOvertake.class_id; // Capture class from overtake
          const hsOvertaker = await getDB().collection("riders").findOne({ _id: new ObjectId(hotseatOvertake.overtaker_id) });
          const hsOvertaken = await getDB().collection("riders").findOne({ _id: new ObjectId(hotseatOvertake.overtaken_id) });
          hotseatData = {
            _id: hotseatOvertake._id.toString(),
            description: hotseatOvertake.description || '',
            overtaker: { name: hsOvertaker.name, surname: hsOvertaker.surname },
            overtaken: { name: hsOvertaken.name, surname: hsOvertaken.surname }
          };
        }
      }

      let challengerData = null;
      let chClass = null;
      if (match.challenger_overtake_id) {
        const challengerOvertake = await getDB().collection("overtakes").findOne({ _id: new ObjectId(match.challenger_overtake_id) });
        if (challengerOvertake) {
          chClass = challengerOvertake.class_id; // Capture class from overtake
          const chOvertaker = await getDB().collection("riders").findOne({ _id: new ObjectId(challengerOvertake.overtaker_id) });
          const chOvertaken = await getDB().collection("riders").findOne({ _id: new ObjectId(challengerOvertake.overtaken_id) });
          challengerData = {
            _id: challengerOvertake._id.toString(),
            description: challengerOvertake.description || '',
            overtaker: { name: chOvertaker.name, surname: chOvertaker.surname },
            overtaken: { name: chOvertaken.name, surname: chOvertaken.surname }
          };
        }
      }

      const votes = matchResult.votes || { hotseat: 0, challenger: 0, total: 0 };
      const totalVotes = votes.total || 0;
      const marginVotes = Math.abs(votes.hotseat - votes.challenger);
      const marginPct = totalVotes > 0 ? ((marginVotes / totalVotes) * 100).toFixed(1) : '0.0';

      let winnerName = "Tie/None";
      let finalClassName = "Open"; // Default fallback

      // Determine the winner's class based on which side won
      if (matchResult.winner_side === 'hotseat' && hotseatData) {
        winnerName = `${hotseatData.overtaker.name} ${hotseatData.overtaker.surname}`;
        finalClassName = hsClass || "Open";
      } else if (matchResult.winner_side === 'challenger' && challengerData) {
        winnerName = `${challengerData.overtaker.name} ${challengerData.overtaker.surname}`;
        finalClassName = chClass || "Open";
      }

      const voterDocs = await getDB().collection("votes").find({ match_id: matchId }).toArray();
      const voters = await Promise.all(voterDocs.map(async (v) => {
        const session = await getDB().collection("fan_sessions").findOne({ session_token: v.fan_session });
        return {
          fan_name: session ? session.fan_name : 'Anonymous',
          fan_email: session ? session.fan_email : '—',
          overtake_id: v.overtake_id?.toString()
        };
      }));

      // BROADCAST TO FANS
      io.emit('match_champion', {
        match_id: matchId.toString(),
        match_number: match_number,
        class_name: finalClassName, // Class is now sent here
        round: match.round || null,
        hotseat: hotseatData,
        challenger: challengerData,
        votes: votes,
        voters: voters,
        winner_side: matchResult.winner_side || 'tie',
        winner_name: winnerName,
        margin_votes: marginVotes,
        margin_pct: marginPct
      });

      // SUCCESS LOG
      console.log(`🏆 CHAMPION CROWNED: Match #${match_number} | Class: ${finalClassName} | Winner: ${winnerName} | Margin: ${marginVotes} votes`);
    }

    res.redirect("/admin/matches/results");
  } catch (err) {
    console.error("❌ Champion error:", err);
    res.status(500).send(err.message || "Failed to set champion");
  }
});
// ======================================================




// ======================================================
// Admin: List Riders
// ======================================================
app.get("/admin/riders/list", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const riders = await getDB().collection("riders").find().toArray();

    res.render("admin_riders_list", {
      riders,
      error: null
    });
  } catch (err) {
    console.error("Error fetching riders:", err);
    res.render("admin_riders_list", {
      riders: [],
      error: "Unable to load riders"
    });
  }
});

// ======================================================
// Admin: Render Edit Rider Form
// ======================================================
app.get("/admin/riders/edit/:id", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const rider = await getDB().collection("riders").findOne({
      _id: new ObjectId(req.params.id)
    });

    if (!rider) {
      return res.render("admin_rider_edit", {
        rider: null,
        error: "Rider not found",
        success: null
      });
    }

    res.render("admin_rider_edit", {
      rider,
      error: null,
      success: null
    });

  } catch (err) {
    console.error("Error loading rider:", err);
    res.render("admin_rider_edit", {
      rider: null,
      error: "Failed to load rider",
      success: null
    });
  }
});

// ======================================================
// Admin: Update Rider
// ======================================================
app.post("/admin/riders/edit/:id", async (req, res) => {
  try {
    const { name, surname, country, number } = req.body;

    if (!name || !surname) {
      return res.render("admin_rider_edit", {
        rider: { _id: req.params.id, ...req.body },
        error: "Name and surname are required",
        success: null
      });
    }

    await getDB().collection("riders").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          name: name.trim(),
          surname: surname.trim(),
          country: country?.trim() || "",
          number: number ? Number(number) : null,
          updated_at: new Date()
        }
      }
    );

    const updatedRider = await getDB().collection("riders").findOne({
      _id: new ObjectId(req.params.id)
    });

    res.render("admin_rider_edit", {
      rider: updatedRider,
      error: null,
      success: "Rider updated successfully!"
    });

  } catch (err) {
    console.error("Error updating rider:", err);
    res.render("admin_rider_edit", {
      rider: { _id: req.params.id, ...req.body },
      error: "Server error. Please try again.",
      success: null
    });
  }
});

// ======================================================
// Admin: Soft Delete Rider (Cascade)
// ======================================================
app.post("/admin/riders/delete/:id", async (req, res) => {
  try {
    const riderId = req.params.id;
    if (!ObjectId.isValid(riderId)) {
      return res.status(400).send("Invalid rider ID");
    }

    const riderObjectId = new ObjectId(riderId);

    // Soft delete rider
    await getDB().collection("riders").updateOne(
      { _id: riderObjectId },
      { $set: { active: false, deleted_at: new Date(), updated_at: new Date() } }
    );

    // Find related overtakes
    const riderOvertakes = await getDB().collection("overtakes")
      .find({
        $or: [
          { overtaker_id: riderId },
          { overtaken_id: riderId }
        ]
      })
      .project({ _id: 1 })
      .toArray();

    const overtakeIds = riderOvertakes.map(o => o._id);

    // Deactivate overtakes and matches
    if (overtakeIds.length > 0) {
      await getDB().collection("overtakes").updateMany(
        { _id: { $in: overtakeIds } },
        { $set: { status: "inactive", updated_at: new Date() } }
      );

      await getDB().collection("matches").updateMany(
        {
          $or: [
            { hotseat_overtake_id: { $in: overtakeIds } },
            { challenger_overtake_id: { $in: overtakeIds } }
          ]
        },
        { $set: { status: "inactive", updated_at: new Date() } }
      );
    }

    res.redirect("/admin/riders/list");

  } catch (err) {
    console.error("Error soft deleting rider:", err);
    res.status(500).send("Failed to delete rider");
  }
});

// ======================================================
// Admin: Restore Rider (Cascade)
// ======================================================
app.post("/admin/riders/restore/:id", async (req, res) => {
  try {
    const riderId = req.params.id;
    if (!ObjectId.isValid(riderId)) {
      return res.redirect("/admin/riders/list");
    }

    const riderObjectId = new ObjectId(riderId);

    // Restore rider
    await getDB().collection("riders").updateOne(
      { _id: riderObjectId },
      { $set: { active: true, updated_at: new Date() } }
    );

    // Find related overtakes
    const riderOvertakes = await getDB().collection("overtakes")
      .find({
        $or: [
          { overtaker_id: riderId },
          { overtaken_id: riderId }
        ]
      })
      .project({ _id: 1 })
      .toArray();

    const overtakeIds = riderOvertakes.map(o => o._id);

    // Reactivate overtakes and matches
    if (overtakeIds.length > 0) {
      await getDB().collection("overtakes").updateMany(
        { _id: { $in: overtakeIds } },
        { $set: { status: "available", updated_at: new Date() } }
      );

      await getDB().collection("matches").updateMany(
        {
          $or: [
            { hotseat_overtake_id: { $in: overtakeIds } },
            { challenger_overtake_id: { $in: overtakeIds } }
          ],
          status: "inactive"
        },
        { $set: { status: "available", updated_at: new Date() } }
      );
    }

    res.redirect("/admin/riders/list");

  } catch (err) {
    console.error("Error restoring rider:", err);
    res.redirect("/admin/riders/list");
  }
});


// =====================================================
// ADMIN: CREATE RIDER (GET)
// Renders the new rider form
// =====================================================

app.get("/admin/riders/new", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    res.render("admin_rider_form", {
      rider: {},
      error: null,
      success: null
    });

  } catch (err) {
    console.error("Error loading rider form:", err);
    res.render("admin_rider_form", {
      rider: {},
      error: "Failed to load form",
      success: null
    });
  }
});


// =====================================================
// ADMIN: CREATE RIDER (POST)
// Auto-generates sequential rider_id (r1, r2, r3…)
// =====================================================

app.post("/admin/riders/new", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const {
      name,
      surname,
      team,
      bio,
      photo
    } = req.body;

    // Basic validation
    if (!name || !surname) {
      return res.render("admin_rider_form", {
        rider: req.body,
        error: "Name and surname are required",
        success: null
      });
    }

    // Generate next sequential rider_id
    const rider_id = await getNextRiderId(getDB());

    await getDB().collection("riders").insertOne({
      rider_id,
      name: name.trim(),
      surname: surname.trim(),
      team: team || null,
      bio: bio || null,
      photo: photo || null,
      created_at: new Date()
    });

    res.render("admin_rider_form", {
      rider: {},
      error: null,
      success: `Rider created successfully (${rider_id})`
    });

  } catch (err) {
    console.error("Error creating rider:", err);
    res.render("admin_rider_form", {
      rider: req.body,
      error: "Server error. Please try again.",
      success: null
    });
  }
});


// =======================================
// ADMIN – BEST RIDER OF THE HEAT ROUTES
// =======================================

// ==========================================
// ROUTE: GET /admin/best-riders/competing-list
// PURPOSE: Returns an HTML fragment (EJS Partial) of riders registered 
//          for a specific Event and Class for the Best Rider competition.
// ==========================================
// ==========================================
// ROUTE: GET /admin/best-riders/competing-list
// ==========================================
app.get('/admin/best-riders/competing-list', async (req, res) => {
  try {
    const { event_id, class_id } = req.query;

    // 1. Build the Query Filter
    // We strictly only pull riders who are NOT marked as deleted
    const query = {
      deleted: { $ne: true }
    };

    // Only convert to ObjectId if event_id actually exists
    if (event_id && event_id.trim() !== "") {
      query.event_id = new ObjectId(event_id);
    }

    // Only filter by class if one is selected
    if (class_id && class_id.trim() !== "") {
      query.class_id = class_id;
    }

    // 2. Fetch data from DB using Aggregation
    // This connects the raw contest data to the rider details for the EJS
    const contestants = await getDB().collection("best_rider_contests").aggregate([
      { $match: query },
      {
        $addFields: {
          // This creates the object your EJS expects: item.rider_details.name
          rider_details: {
            name: "$rider_name",
            surname: "$rider_surname"
          }
        }
      },
      { $sort: { heat: 1 } }
    ]).toArray();

    // Debugging logs to your terminal
    console.log(`--- UI Refresh ---`);
    console.log(`Event: ${event_id}`);
    console.log(`Class: ${class_id || "All"}`);
    console.log(`Found: ${contestants.length} active riders`);

    // 3. Render the Partial
    // layout: false ensures we ONLY send the table HTML, not the whole website header/footer
    res.render('admin/best_riders_table', { 
      contestants, 
      selectedClass: class_id, 
      layout: false 
    });

  } catch (err) {
    console.error("CRITICAL ERROR in competing-list route:", err);
    // Send a friendly error instead of crashing the browser
    res.status(500).send("<td><font color='red'>Error loading table data</font></td>");
  }
});
// ==========================================
// END ROUTE
// ==========================================



// -----------------------------
// GET – New Best Rider Form
// -----------------------------
app.get("/admin/best-rider/new", async (req, res) => {
  try {
    const events = await getDB().collection("events").find({}).toArray();
    const classes = await getDB().collection("classes").find({}).toArray();
    const riders = await getDB().collection("riders").find({}).toArray();

    res.render("admin/best_rider_new", {
      events,
      classes,
      riders
    });
  } catch (err) {
    console.error("GET best rider new:", err);
    res.status(500).send("Server error");
  }
});


// GET - Fetch riders by event + class (AJAX for best rider form)
app.get("/api/riders-by-event-class", async (req, res) => {
  try {
    const { event_id, class_id } = req.query;
    if (!event_id || !class_id) return res.json([]);

    const eventRiders = await getDB()
      .collection("event_riders")
      .find({
        event_id: new ObjectId(event_id),
        class_id: class_id
      })
      .toArray();

    const riderIds = eventRiders.map(er => new ObjectId(er.rider_id));

    if (!riderIds.length) return res.json([]);

    const riders = await getDB()
      .collection("riders")
      .find({ _id: { $in: riderIds } })
      .toArray();

    res.json(riders);
  } catch (err) {
    console.error("API riders-by-event-class:", err);
    res.status(500).json([]);
  }
});

// -----------------------------
// POST – Create Best Rider
// -----------------------------
app.post("/admin/best-rider/new", async (req, res) => {
  try {
    const { event_id, class_id, heat, rider_id } = req.body;

    if (!event_id || !class_id || !heat || !rider_id) {
      return res.send("All fields are required");
    }

    const rider = await getDB().collection("riders").findOne({
      _id: new ObjectId(rider_id)
    });

    if (!rider) return res.send("Rider not found");

    await getDB().collection("best_rider_contests").insertOne({
      event_id: new ObjectId(event_id),
      class_id,
      heat: Number(heat),
      rider_id,
      rider_name: rider.name,
      rider_surname: rider.surname,
      status: "active",
      finalized: false,
      deleted: false,
      created_at: new Date(),
      updated_at: new Date()
    });

    res.redirect(`/admin/best-rider/list?event_id=${event_id}`);
  } catch (err) {
    console.error("POST best rider new:", err);
    res.status(500).send("Server error");
  }
});
// -----------------------------
// GET – List Best Riders
// -----------------------------
// Store filter in memory (simple but resets on server restart)
let bestRiderFilter = {};

app.post("/admin/best-rider/list", async (req, res) => {
  try {
    const { event_id } = req.body;
    bestRiderFilter.event_id = event_id || null;
    res.redirect("/admin/best-rider/list");
  } catch (err) {
    console.error("POST best rider list:", err);
    res.status(500).send("Server error");
  }
});

// ==========================================
// ROUTE: GET /admin/best-rider/list
// UPDATED: Added AJAX Support and Class Filtering
// ==========================================

// ==========================================
// ROUTE: GET /admin/best-rider/list
// ==========================================
app.get("/admin/best-rider/list", async (req, res) => {
  try {
    const event_id = req.query.event_id || bestRiderFilter.event_id;

    const query = event_id ? { event_id: new ObjectId(event_id) } : {};
    const contests = await getDB()
      .collection("best_rider_contests")
      .find(query)
      .sort({ class_id: 1, heat: 1 })
      .toArray();

    console.log("event_id:", event_id);
    console.log("query:", query);
    console.log("contests found:", contests.length);
    console.log("contests:", JSON.stringify(contests, null, 2));

    const events = await getDB().collection("events").find({}).toArray();
    res.render("admin/best_rider_list", { contests, event_id, events });
  } catch (err) {
    console.error("GET best rider list:", err);
    res.status(500).send("Server error");
  }
});
// -----------------------------
// GET – Edit Best Rider
// -----------------------------
app.get("/admin/best-rider/edit/:id", async (req, res) => {
  try {
    const contest = await getDB().collection("best_rider_contests").findOne({
      _id: new ObjectId(req.params.id)
    });

    if (!contest) return res.send("Contest not found");

    const events = await getDB().collection("events").find({}).toArray();
    const classes = await getDB().collection("classes").find({}).toArray();
    const riders = await getDB().collection("riders").find({}).toArray();

    res.render("admin/best_rider_edit", {
      contest,
      events,
      classes,
      riders
    });
  } catch (err) {
    console.error("GET best rider edit:", err);
    res.status(500).send("Server error");
  }
});

// -----------------------------
// POST – Update Best Rider
// -----------------------------
app.post("/admin/best-rider/edit/:id", async (req, res) => {
  try {
    const { event_id, class_id, heat, rider_id, status, finalized } = req.body;

    if (!event_id || !class_id || !heat || !rider_id) {
      return res.send("All fields are required");
    }

    const rider = await getDB().collection("riders").findOne({
      _id: new ObjectId(rider_id)
    });

    if (!rider) return res.send("Rider not found");

    await getDB().collection("best_rider_contests").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          event_id: new ObjectId(event_id),
          class_id,
          heat: Number(heat),
          rider_id,
          rider_name: rider.name,
          rider_surname: rider.surname,
          status: status || "active",
          finalized: finalized === "true" || finalized === true,
          updated_at: new Date()
        }
      }
    );

    res.redirect(`/admin/best-rider/list?event_id=${event_id}`);
  } catch (err) {
    console.error("POST best rider edit:", err);
    res.status(500).send("Server error");
  }
});

// -----------------------------
// POST – Soft Delete Best Rider
// -----------------------------
app.post("/admin/best-rider/:id/delete", async (req, res) => {
  try {
    await getDB().collection("best_rider_contests").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          deleted: true,
          status: "inactive",
          deleted_at: new Date()
        }
      }
    );

    res.redirect("/admin/best-rider/list");
  } catch (err) {
    console.error("DELETE best rider:", err);
    res.status(500).send("Server error");
  }
});


// -----------------------------
// POST – Restore Best Rider
// -----------------------------
app.post("/admin/best-rider/:id/restore", async (req, res) => {
  try {
    await getDB().collection("best_rider_contests").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          deleted: false,
          status: "active",
          updated_at: new Date()
        }
      }
    );

    res.redirect("/admin/best-rider/list");
  } catch (err) {
    console.error("RESTORE best rider:", err);
    res.status(500).send("Server error");
  }
});


// ============================================================
// ============================================================



// ============================================================

// ============================================================

// ============================================================
// POST /admin/best-rider/set-champion
// Sets a rider as the champion for a specific class/event
// Also locks voting for that class/event
// ============================================================
// ============================================================
// POST /admin/best-rider/set-champion
// Sets a rider as the champion for a specific class/event/heat
// Writes to best_rider_champions collection
// ============================================================

app.post("/admin/best-rider/set-champion", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const { rider_id, event_id, class_id, heat } = req.body;

    if (!rider_id || !event_id || !class_id || !heat) {
      return res.redirect("/admin/best-rider/results?error=Missing required fields");
    }

    const rider = await getDB().collection("best_rider_contests").findOne({
      _id: new ObjectId(rider_id)
    });

    if (!rider) {
      return res.redirect("/admin/best-rider/results?error=Rider not found");
    }

    // Reset champion flag for all riders in this heat
    await getDB().collection("best_rider_contests").updateMany(
      { event_id: new ObjectId(event_id), class_id, heat: parseInt(heat) },
      { $set: { champion: false, voting_locked: true, updated_at: new Date() } }
    );

    // Set champion flag on winner
    await getDB().collection("best_rider_contests").updateOne(
      { _id: new ObjectId(rider_id) },
      { $set: { champion: true, updated_at: new Date() } }
    );

    // --------------------------------------------------------
    // Fetch winner stats for socket emit
    // --------------------------------------------------------
    const winnerVotes = await getDB().collection("best_rider_votes").aggregate([
      {
        $match: {
          event_id: new ObjectId(event_id),
          class_id: class_id,
          heat: parseInt(heat),
          rider_id: rider_id
        }
      },
      {
        $group: {
          _id: null,
          totalScore: { $sum: "$score" },
          voteCount: { $sum: 1 },
          averageScore: { $avg: "$score" }
        }
      }
    ]).toArray();

    const totalVotesAll = await getDB().collection("best_rider_votes").countDocuments({
      event_id: new ObjectId(event_id),
      class_id: class_id,
      heat: parseInt(heat)
    });

    const winnerStats = winnerVotes[0] || { totalScore: 0, voteCount: 0, averageScore: 0 };
    const votePct = totalVotesAll > 0
      ? ((winnerStats.voteCount / totalVotesAll) * 100).toFixed(1)
      : 0;

    // --------------------------------------------------------
    // Emit heat winner to all connected fans via socket
    // --------------------------------------------------------
    io.emit('heat_winner', {
      rider_name: rider.rider_name,
      rider_surname: rider.rider_surname,
      class_id: class_id,
      heat: heat,
      event_id: event_id,
      avg_score: parseFloat(winnerStats.averageScore).toFixed(2),
      total_votes: winnerStats.voteCount,
      vote_percentage: votePct
    });

    res.redirect(`/admin/best-rider/results?event_id=${event_id}&success=Champion set successfully`);

  } catch (err) {
    console.error("Error setting champion:", err);
    res.redirect("/admin/best-rider/results?error=Failed to set champion");
  }
});
// ============================================================
// ============================================================

// =====================================================
// POST /admin/best-rider/unset-champion
// Removes champion flag from a rider for a specific class/heat
// =====================================================
app.post("/admin/best-rider/unset-champion", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const { rider_id, event_id, class_id, heat } = req.body;

    if (!rider_id || !event_id || !class_id || !heat) {
      return res.redirect(`/admin/best-rider/results?event_id=${event_id || ''}&error=Missing required fields`);
    }

    // Remove champion flag from the specific rider
    await getDB().collection("best_rider_contests").updateOne(
      { _id: new ObjectId(rider_id) },
      { $set: { champion: false, updated_at: new Date() } }
    );

    // Unlock voting for that heat
    await getDB().collection("best_rider_contests").updateMany(
      { event_id: new ObjectId(event_id), class_id, heat: parseInt(heat) },
      { $set: { voting_locked: false, updated_at: new Date() } }
    );

    console.log(`🏆 Champion unset for rider ${rider_id}, class ${class_id}, heat ${heat}`);

    return res.redirect(`/admin/best-rider/results?event_id=${event_id}&success=Champion removed successfully`);
  } catch (err) {
    console.error("Error unsetting champion:", err);
    return res.redirect(`/admin/best-rider/results?error=Failed to unset champion`);
  }
});




// ============================================================
// GET /best-rider/results
// Public page showing champions and top 3 riders per class
// Accessible without login
// ============================================================
// ============================================================
// GET /best-rider/results
// Public page showing champions and top 3 riders per class/heat
// Accessible without login
// ============================================================
app.get("/admin/best-rider/results", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const { event_id } = req.query;

    // Fetch events for dropdown
    const events = await getDB().collection("events").find().toArray();

    // Build aggregation pipeline
    const pipeline = [
      {
        $addFields: {
          rider_id_obj: { $toObjectId: "$rider_id" }
        }
      },
      {
        $lookup: {
          from: "events",
          localField: "event_id",
          foreignField: "_id",
          as: "event"
        }
      },
      {
        $lookup: {
          from: "best_rider_contests",
          localField: "rider_id_obj",
          foreignField: "_id",
          as: "contest"
        }
      },
      {
        $unwind: "$event"
      },
      {
        $unwind: "$contest"
      }
    ];

    // Add event filter if provided
    if (event_id) {
      pipeline.push({
        $match: {
          event_id: new ObjectId(event_id)
        }
      });
    }

    // Add grouping and projection
    pipeline.push(
      {
        $group: {
          _id: {
            rider_id: "$rider_id",
            event_id: "$event_id",
            class_id: "$class_id",
            heat: "$heat"
          },
          rider_id: { $first: "$rider_id_obj" },
          event_id: { $first: "$event_id" },
          rider_name: { $first: "$contest.rider_name" },
          rider_surname: { $first: "$contest.rider_surname" },
          event_name: { $first: "$event.name" },
          class_id: { $first: "$class_id" },
          heat: { $first: "$heat" },
          finalized: { $first: "$contest.finalized" },
          status: { $first: "$contest.status" },
          voteCount: { $sum: 1 },
          totalScore: { $sum: "$score" },
          averageScore: { $avg: "$score" }
        }
      },
      {
        $project: {
          _id: 0,
          rider_id: 1,
          event_id: 1,
          rider_name: 1,
          rider_surname: 1,
          event_name: 1,
          class_id: 1,
          heat: 1,
          finalized: 1,
          status: 1,
          voteCount: 1,
          totalScore: 1,
          averageScore: { $round: ["$averageScore", 2] }
        }
      },
      {
        $sort: { class_id: 1, heat: 1, averageScore: -1 }
      }
    );

    // Execute aggregation
    const results = await getDB()
      .collection("best_rider_votes")
      .aggregate(pipeline)
      .toArray();

    // --------------------------------------------------------
    // Build championMap from best_rider_contests directly
    // --------------------------------------------------------
    const championQuery = event_id
      ? { event_id: new ObjectId(event_id), champion: true }
      : { champion: true };

    const championContests = await getDB()
      .collection("best_rider_contests")
      .find(championQuery)
      .toArray();

    const championMap = {};
    championContests.forEach(c => {
      const key = c.event_id.toString() + c.class_id + String(c.heat);
      championMap[key] = c._id.toString(); // ← FIXED: _id matches row.rider_id
    });

    // --------------------------------------------------------
    // Calculate total votes per class/event
    // --------------------------------------------------------
    const totalVotesPerClass = {};
    results.forEach(row => {
      const classKey = (row.event_id ? row.event_id.toString() : '') + row.class_id;
      if (!totalVotesPerClass[classKey]) totalVotesPerClass[classKey] = 0;
      totalVotesPerClass[classKey] += row.voteCount;
    });

    // --------------------------------------------------------
    // Determine top eligible rider per class/event/heat
    // --------------------------------------------------------
    const topRiderPerHeat = {};
    results.forEach(row => {
      const classKey = (row.event_id ? row.event_id.toString() : '') + row.class_id;
      const heatKey = classKey + row.heat;
      const minVotes = Math.ceil(totalVotesPerClass[classKey] * 0.10);
      const isEligible = row.voteCount >= minVotes;

      if (isEligible && !topRiderPerHeat[heatKey]) {
        topRiderPerHeat[heatKey] = row.rider_id.toString();
      }
    });

    // --------------------------------------------------------
    // Compute Overall Best Rider ranking
    // --------------------------------------------------------
    const overallMap = {};
    results.forEach(row => {
      const classKey = (row.event_id ? row.event_id.toString() : '') + row.class_id;
      const minVotes = Math.ceil(totalVotesPerClass[classKey] * 0.10);
      const isEligible = row.voteCount >= minVotes;

      if (!isEligible) return;

      const riderId = row.rider_id.toString();
      if (!overallMap[riderId]) {
        overallMap[riderId] = {
          rider_name:    row.rider_name,
          rider_surname: row.rider_surname,
          heatAvgs:      [],
          heatVoters:    [],
          totalVoters:   0,
          bestHeatAvg:   0,
          eligibleHeats: 0,
          classes:       new Set()
        };
      }

      const entry = overallMap[riderId];
      const avg   = parseFloat(row.averageScore) || 0;
      entry.heatAvgs.push(avg);
      entry.heatVoters.push(row.voteCount);
      entry.totalVoters   += row.voteCount;
      entry.eligibleHeats += 1;
      if (avg > entry.bestHeatAvg) entry.bestHeatAvg = avg;
      entry.classes.add(row.class_id);
    });

    const overallRankings = Object.values(overallMap).map(entry => ({
      rider_name:        entry.rider_name,
      rider_surname:     entry.rider_surname,
      bestHeatAvg:       entry.bestHeatAvg,
      avgVotersPerHeat:  Math.round((entry.heatVoters.reduce((s, v) => s + v, 0) / entry.heatVoters.length) * 10) / 10,
      totalVoters:       entry.totalVoters,
      overallAvg:        Math.round((entry.heatAvgs.reduce((s, v) => s + v, 0) / entry.heatAvgs.length) * 100) / 100,
      eligibleHeats:     entry.eligibleHeats,
      classes:           [...entry.classes].sort().join(', ')
    }));

    overallRankings.sort((a, b) => {
      if (b.bestHeatAvg      !== a.bestHeatAvg)      return b.bestHeatAvg      - a.bestHeatAvg;
      if (b.avgVotersPerHeat !== a.avgVotersPerHeat) return b.avgVotersPerHeat - a.avgVotersPerHeat;
      if (b.overallAvg       !== a.overallAvg)       return b.overallAvg       - a.overallAvg;
      if (a.eligibleHeats    !== b.eligibleHeats)    return a.eligibleHeats    - b.eligibleHeats;
      return 0;
    });

    res.render("admin/best_rider_results", {
      results,
      events,
      championMap,
      topRiderPerHeat,
      totalVotesPerClass,
      overallRankings,
      selectedEvent: event_id,
      error: req.query.error || null,
      success: req.query.success || null
    });

  } catch (err) {
    console.error("Error loading results:", err);
    res.status(500).render("admin/best_rider_results", {
      results: [],
      events: [],
      championMap: {},
      topRiderPerHeat: {},
      totalVotesPerClass: {},
      overallRankings: [],
      selectedEvent: null,
      error: req.query.error || "Server Error",
      success: null
    });
  }
});

// ============================================================
// POST /admin/best-rider/announce-overall-champion
// Emits the overall best rider to all connected fans via socket
// Does not write to DB — announcement only
// ============================================================
app.post("/admin/best-rider/announce-overall-champion", async (req, res) => {
  try {
    const {
      rider_name,
      rider_surname,
      classes,
      best_heat_avg,
      avg_voters_per_heat,
      total_voters,
      eligible_heats,
      event_id
    } = req.body;

    if (!rider_name || !rider_surname) {
      return res.redirect(`/admin/best-rider/results?event_id=${event_id || ''}&error=Missing rider data`);
    }

    // --------------------------------------------------------
    // Emit overall winner to all connected clients
    // Matches the same pattern as 'heat_winner'
    // --------------------------------------------------------
    io.emit('overall_winner', {
      rider_name,
      rider_surname,
      classes,
      best_heat_avg:       parseFloat(best_heat_avg),
      avg_voters_per_heat: parseFloat(avg_voters_per_heat),
      total_voters:        parseInt(total_voters),
      eligible_heats:      parseInt(eligible_heats),
      event_id
    });

    console.log('📤 Overall winner announced:', `${rider_name} ${rider_surname}`);

    return res.redirect(`/admin/best-rider/results?event_id=${event_id || ''}&success=Overall champion announced!`);

  } catch (err) {
    console.error("Error announcing overall champion:", err);
    return res.redirect(`/admin/best-rider/results?error=Failed to announce overall champion`);
  }
});
// ============================================================


// ============================================================



// ======================================================
// Admin: Event Riders
// ======================================================

// GET - Render event riders page
app.get("/admin/event-riders", async (req, res) => {
  try {
    const events  = await getDB().collection("events").find().toArray();
    const classes = await getDB().collection("classes").find().toArray();
    const riders  = await getDB().collection("riders").find().toArray();

    res.render("admin/event_riders", {
      events,
      classes,
      riders
    });
  } catch (err) {
    console.error("GET event riders:", err);
    res.status(500).send("Server error");
  }
});

// GET - Fetch enrolled riders for a specific event (AJAX)
app.get("/admin/event-riders/:eventId/list", async (req, res) => {
  try {
    const { eventId } = req.params;

    const enrolled = await getDB()
      .collection("event_riders")
      .find({ event_id: new ObjectId(eventId) })
      .toArray();

    if (!enrolled.length) return res.json([]);

    // rider_id is already stored as ObjectId — no need to wrap again
    const riderIds = enrolled.map(e => e.rider_id);

    const riders = await getDB()
      .collection("riders")
      .find({ _id: { $in: riderIds } })
      .toArray();

    // class_id is a plain string in classes collection — no ObjectId wrap needed
    const classIds = [...new Set(enrolled.map(e => e.class_id))];
    const classes  = await getDB()
      .collection("classes")
      .find({ _id: { $in: classIds } })
      .toArray();

    const classMap = {};
    classes.forEach(c => { classMap[c._id.toString()] = c.name; });

    const result = enrolled.map(e => {
      const rider = riders.find(r => r._id.toString() === e.rider_id.toString());
      return {
        enrollment_id: e._id,
        rider_id:      e.rider_id,
        class_id:      e.class_id,
        class_name:    classMap[e.class_id] || e.class_id,
        name:          rider ? rider.name    : "Unknown",
        surname:       rider ? rider.surname : ""
      };
    });

    res.json(result);
  } catch (err) {
    console.error("GET event riders list:", err);
    res.status(500).json([]);
  }
});

// POST - Add rider to event
app.post("/admin/event-riders/:eventId/add", async (req, res) => {
  try {
    const { eventId }            = req.params;
    const { rider_id, class_id } = req.body;

    if (!rider_id || !class_id) {
      return res.status(400).json({ error: "rider_id and class_id are required" });
    }

    // Prevent duplicate enrollment
    const existing = await getDB()
      .collection("event_riders")
      .findOne({
        event_id: new ObjectId(eventId),
        rider_id: new ObjectId(rider_id),
        class_id
      });

    if (existing) {
      return res.status(400).json({ error: "Rider already enrolled in this class for this event" });
    }

    await getDB().collection("event_riders").insertOne({
      event_id:   new ObjectId(eventId),
      rider_id:   new ObjectId(rider_id),
      class_id,
      created_at: new Date()
    });

    res.json({ success: true });
  } catch (err) {
    console.error("POST event riders add:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST - Remove rider from event
app.post("/admin/event-riders/:eventId/remove/:enrollmentId", async (req, res) => {
  try {
    const { enrollmentId } = req.params;

    await getDB()
      .collection("event_riders")
      .deleteOne({ _id: new ObjectId(enrollmentId) });

    res.json({ success: true });
  } catch (err) {
    console.error("POST event riders remove:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =====================================================



// ======================================================
// Admin: Match Creation V2 — Class-aware challenger list
// ======================================================
app.get("/admin/matches/new-v2", async (req, res) => {
  try {
    const events = await getDB().collection("events").find().toArray();
    const riders = await getDB().collection("riders").find().toArray();
    const classes = await getDB().collection("classes").find().toArray();

    const selectedEvent = req.query.event_id;

    let overtakes = [];
    let matches = [];
    let currentHotSeat = null;

    if (selectedEvent) {
      currentHotSeat = await getCurrentHotSeat(selectedEvent);

      overtakes = await getDB().collection("overtakes")
        .find({ event_id: new ObjectId(selectedEvent) })
        .toArray();

      matches = await getDB().collection("matches")
        .find({ event_id: new ObjectId(selectedEvent) })
        .toArray();

      matches = matches.map(match => {
        const hotseat = overtakes.find(o => o._id.toString() === match.hotseat_overtake_id.toString());
        const challenger = overtakes.find(o => o._id.toString() === match.challenger_overtake_id.toString());

        const getRiderNames = (overtake) => {
          if (!overtake) return "Unknown";
          const overtaker = riders.find(r => r._id.toString() === overtake.overtaker_id.toString());
          const overtaken = riders.find(r => r._id.toString() === overtake.overtaken_id.toString());
          return overtaker && overtaken
            ? `${overtaker.name} ${overtaker.surname} → ${overtaken.name} ${overtaken.surname}`
            : "Unknown";
        };

        return {
          ...match,
          hotseatInfo: {
            riderNames: getRiderNames(hotseat),
            heat: hotseat ? hotseat.heat : "?",
            description: hotseat ? hotseat.description : "Unknown"
          },
          challengerInfo: {
            riderNames: getRiderNames(challenger),
            heat: challenger ? challenger.heat : "?",
            description: challenger ? challenger.description : "Unknown"
          }
        };
      });
    }

    res.render("admin_match_form_v2", {
      events,
      riders,
      classes,
      selectedEvent: selectedEvent || null,
      overtakes,
      matches,
      currentHotSeat,
      error: null,
      success: null,
    });

  } catch (err) {
    console.error("Error loading match form v2:", err);
    res.render("admin_match_form_v2", {
      events: [],
      riders: [],
      classes: [],
      selectedEvent: null,
      overtakes: [],
      matches: [],
      currentHotSeat: null,
      error: "Failed to load data",
      success: null,
    });
  }
});


// ======================================================
// Admin Auth Middleware
// ======================================================
function requireAdminSession(req, res, next) {
  const adminSession = req.cookies?.admin_session;
  if (!adminSession || adminSession !== process.env.ADMIN_SECRET) {
    return res.redirect("/admin/login");
  }
  next();
}

// ======================================================
// Admin: Login GET
// ======================================================
app.get("/admin/login", (req, res) => {
  res.render("admin_login", { error: null });
});

// ======================================================
// Admin: Login POST
// ======================================================
app.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.render("admin_login", { error: "Username and password are required" });
    }

    const admin = await getDB().collection("admins").findOne({ username });

    if (!admin) {
      return res.render("admin_login", { error: "Invalid username or password" });
    }

    const match = await bcrypt.compare(password, admin.password);

    if (!match) {
      return res.render("admin_login", { error: "Invalid username or password" });
    }

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 8);

    await getDB().collection("admin_sessions").insertOne({
      username: admin.username,
      session_token: sessionToken,
      created_at: new Date(),
      expires_at: expiresAt
    });

    res.cookie("admin_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    });

    res.redirect("/admin/events/list");

  } catch (err) {
    console.error("Admin login error:", err);
    res.render("admin_login", { error: "Server error. Please try again." });
  }
});

// ======================================================
// Admin: Logout
// ======================================================
app.get("/admin/logout", async (req, res) => {
  const adminSession = req.cookies?.admin_session;

  if (adminSession) {
    await getDB().collection("admin_sessions").deleteOne({ 
      session_token: adminSession 
    });
  }

  res.clearCookie("admin_session");
  res.redirect("/admin/login");
});




// ==========================================
// YOUSCR BEST TRICK - INTEGRATED BACKEND
// ==========================================

// =============================================================================
// ADMIN RESULT VIEW: Renders the Best Trick Leaderboard within Admin Panel
// Location: server.js or routes/admin.js
// =============================================================================
app.get("/admin/results/best-trick", async (req, res) => {
    const db = getDB();
    const { event_id, heat, status } = req.query;
    const current_heat = parseInt(heat) || 1;

    try {
        const [events] = await Promise.all([
            db.collection("events").find().toArray()
        ]);

        let results = [];
        let currentEvent = null;

        if (event_id) {
            currentEvent = await db.collection("events").findOne({ _id: new ObjectId(event_id) });

            // Handle both String and ObjectId for event_id
            const searchIds = [event_id.trim()];
            try { searchIds.push(new ObjectId(event_id.trim())); } catch(e) {}

            results = await db.collection("best_trick_votes").aggregate([
                { 
                    $match: { 
                        event_id: { $in: searchIds }, 
                        heat: current_heat 
                    } 
                },
                { $group: { _id: "$voted_trick_id", voteCount: { $sum: 1 } } },
                { $addFields: { trick_oid: { $toObjectId: "$_id" } } },
                { $lookup: { from: "event_tricks", localField: "trick_oid", foreignField: "_id", as: "p" } },
                { $unwind: "$p" },
                { $lookup: { from: "riders", localField: "p.rider_id", foreignField: "_id", as: "r" } },
                { $lookup: { from: "tricks", localField: "p.trick_id", foreignField: "_id", as: "t" } },
                { $unwind: "$r" }, 
                { $unwind: "$t" },
                { 
                    $project: { 
                        _id: 0, 
                        voteCount: 1, 
                        // --- THE FIX IS HERE ---
                        // Combines name and surname with a space in between
                        rider: { $concat: ["$r.name", " ", "$r.surname"] }, 
                        trick: "$t.trick_name",
                        rider_id: "$r._id" 
                    } 
                },
                { $sort: { voteCount: -1 } }
            ]).toArray();
        }

        res.render("admin/best_trick_results", {
            events,
            event_id,
            current_heat,
            results,
            status,
            currentEvent
        });

    } catch (error) {
        console.error("Error loading admin results:", error);
        res.status(500).send("Error loading admin results view.");
    }
});



// 1. ADMIN PANEL: LOAD INTERFACE
app.get("/admin/best-trick", async (req, res) => {
    const { event_id, heat } = req.query;
    const db = getDB();
    const current_heat = parseInt(heat) || 1;
    try {
        const [riders, library, events] = await Promise.all([
            db.collection("riders").find().toArray(),
            db.collection("tricks").find().toArray(),
            db.collection("events").find().toArray()
        ]);

        let eventTricks = [];
        let hotSeat = null;

        if (event_id) {
            eventTricks = await db.collection("event_tricks")
                .find({ event_id: new ObjectId(event_id) })
                .sort({ created_at: -1 }).toArray();

            for (let et of eventTricks) {
                const r = riders.find(r => r._id.toString() === et.rider_id.toString());
                const t = library.find(t => t._id.toString() === et.trick_id.toString());
                const heatLabel = et.heat ? `H${et.heat}` : `H1`;
                const firstName = r ? (r.name || r.firstName || "") : "???";
                const lastName = r ? (r.surname || "") : "";
                const fullName = `${firstName} ${lastName}`.trim();
                et.display = `${heatLabel} | ${fullName} - ${t ? t.trick_name : '???'}`;
            }

            const searchIds = [event_id.trim()];
            try { searchIds.push(new ObjectId(event_id.trim())); } catch(e) {}

            const hotSeatResult = await db.collection("best_trick_votes").aggregate([
                { $match: { event_id: { $in: searchIds }, heat: current_heat } },
                { $group: { _id: "$voted_trick_id", voteCount: { $sum: 1 } } },
                { $addFields: { trick_oid: { $toObjectId: "$_id" } } },
                { $lookup: { from: "event_tricks", localField: "trick_oid", foreignField: "_id", as: "p" } },
                { $unwind: "$p" },
                { $lookup: { from: "riders", localField: "p.rider_id", foreignField: "_id", as: "r" } },
                { $lookup: { from: "tricks", localField: "p.trick_id", foreignField: "_id", as: "t" } },
                { $unwind: "$r" },
                { $unwind: "$t" },
                { $project: { _id: 0, voteCount: 1, rider: { $concat: ["$r.name", " ", "$r.surname"] }, trick: "$t.trick_name" } },
                { $sort: { voteCount: -1 } },
                { $limit: 1 }
            ]).toArray();

            hotSeat = hotSeatResult[0] || null;
        }

        res.render("admin/best_trick_panel", { 
            event_id, 
            riders, 
            library, 
            events, 
            eventTricks,
            current_heat,
            hotSeat
        });
    } catch (err) {
        console.error("Error loading best-trick panel:", err);
        res.status(500).send("Internal Server Error");
    }
});



// 2. REGISTER PERFORMANCE
app.post("/admin/register-performance", async (req, res) => {
    const { event_id, rider_id, trick_id, heat } = req.body;
    
    await getDB().collection("event_tricks").insertOne({
        event_id: new ObjectId(event_id),
        rider_id: new ObjectId(rider_id),
        trick_id: new ObjectId(trick_id),
        heat: parseInt(heat) || 1, // Store the heat specifically
        created_at: new Date()
    });
    
    // Redirect back to the same event AND heat
    res.redirect(`/admin/best-trick?event_id=${event_id}&heat=${heat}`);
});

// 3. BROADCAST DUEL
app.post("/admin/broadcast-duel", async (req, res) => {
    const { event_id, heat, trick_a_id, trick_b_id } = req.body;
    const db = getDB();

    try {
        // 1. Insert the match record first
        const result = await db.collection("best_trick_matches").insertOne({
            event_id: new ObjectId(event_id),
            heat: parseInt(heat),
            trick_a_id: new ObjectId(trick_a_id),
            trick_b_id: new ObjectId(trick_b_id),
            is_active: true,
            created_at: new Date()
        });

        // 2. Fetch details for both riders/tricks concurrently
        const [pA, pB] = await Promise.all([
            db.collection("event_tricks").aggregate([
                { $match: { _id: new ObjectId(trick_a_id) } },
                { $lookup: { from: "riders", localField: "rider_id", foreignField: "_id", as: "r" } },
                { $lookup: { from: "tricks", localField: "trick_id", foreignField: "_id", as: "t" } },
                { $unwind: "$r" }, 
                { $unwind: "$t" }
            ]).next(),
            db.collection("event_tricks").aggregate([
                { $match: { _id: new ObjectId(trick_b_id) } },
                { $lookup: { from: "riders", localField: "rider_id", foreignField: "_id", as: "r" } },
                { $lookup: { from: "tricks", localField: "trick_id", foreignField: "_id", as: "t" } },
                { $unwind: "$r" }, 
                { $unwind: "$t" }
            ]).next()
        ]);

        // 3. Safety check: Ensure both lookups returned data
        if (!pA || !pB) {
            console.error("Could not find trick details for broadcast");
            return res.status(404).send("Trick details not found.");
        }

        // 4. Construct Full Names (Fixes the "Last Name Only" issue)
        const riderAFullName = `${pA.r.name || ""} ${pA.r.surname || ""}`.trim();
        const riderBFullName = `${pB.r.name || ""} ${pB.r.surname || ""}`.trim();

        // 5. Emit to Socket.io using the correct variables
        io.emit("new_trick_duel", {
            match_id: result.insertedId, // Using 'result' from step 1
            event_id,
            heat,
            trick_a_id,
            trick_b_id,
            trick_a: { rider: riderAFullName, name: pA.t.trick_name },
            trick_b: { rider: riderBFullName, name: pB.t.trick_name }
        });

        // 6. Redirect back to the panel
        res.redirect(`/admin/best-trick?event_id=${event_id}&heat=${heat}`);

    } catch (err) {
        console.error("Error in broadcast-duel:", err);
        res.status(500).send("Internal Server Error");
    }
});

// =============================================================================
// ADMIN BROADCAST ROUTE: Send Global Standings to Fan Devices
// This route calculates the current leaderboard and pushes it to all fans
// via the "show_leaderboard" socket event.
// =============================================================================
app.post("/admin/broadcast-standings", async (req, res) => {
    const { event_id, heat } = req.body;
    const db = getDB();
    const current_heat = parseInt(heat) || 1;

    try {
        const results = await db.collection("best_trick_votes").aggregate([
            { $match: { event_id: new ObjectId(event_id), heat: current_heat } },
            { $group: { _id: "$voted_trick_id", voteCount: { $sum: 1 } } },
            { $addFields: { trick_oid: { $toObjectId: "$_id" } } },
            { $lookup: { from: "event_tricks", localField: "trick_oid", foreignField: "_id", as: "p" } },
            { $unwind: "$p" },
            { $lookup: { from: "riders", localField: "p.rider_id", foreignField: "_id", as: "r" } },
            { $lookup: { from: "tricks", localField: "p.trick_id", foreignField: "_id", as: "t" } },
            { $unwind: "$r" }, 
            { $unwind: "$t" },
            { 
                $project: { 
                    _id: 0, 
                    voteCount: 1, 
                    // --- THE FIX: Concatenate Name + Surname ---
                    rider: { $concat: ["$r.name", " ", "$r.surname"] }, 
                    trick: "$t.trick_name"
                } 
            },
            { $sort: { voteCount: -1 } }
        ]).toArray();

        // Push the full list to the fans via Socket.io
        io.emit("show_leaderboard", {
            event_id,
            heat: current_heat,
            standings: results // This now contains full names in the 'rider' field
        });

        res.redirect(`/admin/results/best-trick?event_id=${event_id}&heat=${current_heat}&status=broadcast_success`);

    } catch (err) {
        console.error("Error pushing leaderboard:", err);
        res.status(500).send("Error pushing leaderboard");
    }
});
// =============================================================================
// END OF ADMIN BROADCAST ROUTE
// =============================================================================

// 4. DEFINE CHAMPION
// =========================================================================
// ROUTE: POST /admin/results/set-champion
// =========================================================================
// =========================================================================
// ROUTE: POST /admin/results/set-champion
// =========================================================================
app.post("/admin/results/set-champion", async (req, res) => {
    const { event_id, rider_id, heat } = req.body;
    const db = getDB();
    const current_heat = parseInt(heat) || 1;

    try {
        // 1. Fetch the rider details to get the full name
        const rider = await db.collection("riders").findOne({ _id: new ObjectId(rider_id) });
        
        // --- THE FIX: Create the full name for the broadcast ---
        const fullName = rider ? `${rider.name || ""} ${rider.surname || ""}`.trim() : "Unknown Rider";

        // 2. Update the event to record the champion
        await db.collection("events").updateOne(
            { _id: new ObjectId(event_id) },
            { 
                $set: { 
                    champion_rider_id: new ObjectId(rider_id),
                    champion_heat: current_heat,
                    winner_announced_at: new Date()
                } 
            }
        );

        // 3. Broadcast the "Champion Crowned" event to all fans
        if (typeof io !== 'undefined') {
            io.emit("champion_crowned", {
                rider_name: fullName, // Now sends "José Gaspar" instead of just "Gaspar"
                heat: current_heat,
                event_id: event_id
            });
        }

        res.redirect(`/admin/results/best-trick?event_id=${event_id}&heat=${current_heat}&status=champion_set`);

    } catch (err) {
        console.error("Error setting champion:", err);
        res.status(500).send("Error setting champion");
    }
});

// 5. CROSSING RESULTS
app.get("/results/debug-types", async (req, res) => {
    const { event_id, heat } = req.query;
    
    // 1. Get one raw document from the collection
    const sampleDoc = await getDB().collection("best_trick_votes").findOne({});
    
    // 2. See what the types actually are
    const diagnostics = {
        query_received: { event_id, heat },
        transformed_query: { 
            event_id: new ObjectId(event_id), 
            heat: parseInt(heat),
            heat_type: typeof parseInt(heat)
        },
        database_sample: {
            event_id_type: typeof sampleDoc.event_id,
            heat_type: typeof sampleDoc.heat,
            full_doc: sampleDoc
        }
    };
    
    res.json(diagnostics);
});

app.get("/results/all-votes-debug", async (req, res) => {
    try {
        const results = await getDB().collection("best_trick_votes").aggregate([
            // 1. Group all votes by the trick ID string
            { $group: { 
                _id: "$voted_trick_id", 
                voteCount: { $sum: 1 },
                event: { $first: "$event_id" },
                heat: { $first: "$heat" }
            } },
            // 2. Convert the voted_trick_id string to an ObjectId for the join
            {
                $addFields: {
                    trick_oid: { $toObjectId: "$_id" }
                }
            },
            // 3. Join with event_tricks to find the rider_id and trick_id
            { 
                $lookup: { 
                    from: "event_tricks", 
                    localField: "trick_oid", 
                    foreignField: "_id", 
                    as: "p" 
                } 
            },
            { $unwind: "$p" },
            // 4. Join with riders and tricks
            { $lookup: { from: "riders", localField: "p.rider_id", foreignField: "_id", as: "r" } },
            { $lookup: { from: "tricks", localField: "p.trick_id", foreignField: "_id", as: "t" } },
            { $unwind: "$r" }, 
            { $unwind: "$t" },
            // 5. Project a clean summary
            { $project: { 
                _id: 0, 
                event_id: "$event",
                heat: 1,
                voteCount: 1, 
                rider: "$r.surname", 
                trick: "$t.trick_name" 
            } }
        ]).toArray();

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// ROUTE: Admin Duels Results
// GET /admin/results/duels
// Displays all head-to-head match results for a given event/heat,
// including vote counts and winner for each duel.
// ============================================================
app.get("/admin/results/duels", async (req, res) => {
    const db = getDB();
    const { event_id, heat, status } = req.query;
    const current_heat = parseInt(heat) || 1;

    try {
        // Fetch all events for the event selector dropdown
        const events = await db.collection("events").find().toArray();

        let duels = [];
        let currentEvent = null;

        if (event_id) {
            // Fetch the selected event details
            currentEvent = await db.collection("events").findOne({ _id: new ObjectId(event_id) });

            // Fetch all matches for this event/heat, ordered oldest → newest
            // to reflect the natural progression of the tournament
            const matches = await db.collection("best_trick_matches").find(
                {
                    event_id: new ObjectId(event_id),
                    heat: current_heat
                },
                { sort: { created_at: 1 } }
            ).toArray();

            // For each match, aggregate votes and determine the winner
            duels = await Promise.all(matches.map(async (match) => {

                // Aggregate votes for this specific match using match_id as the source of truth.
                // Joins event_tricks → riders → tricks to get rider name and trick name.
                // Results are sorted by voteCount descending so index 0 = leader.
                const votes = await db.collection("best_trick_votes").aggregate([
                    {
                        // Only consider votes that belong to this match
                        $match: { match_id: match._id }
                    },
                    // Count votes per trick
                    { $group: { _id: "$voted_trick_id", voteCount: { $sum: 1 } } },
                    // Convert string trick id to ObjectId for lookup
                    { $addFields: { trick_oid: { $toObjectId: "$_id" } } },
                    // Join with event_tricks to get trick/rider references
                    { $lookup: { from: "event_tricks", localField: "trick_oid", foreignField: "_id", as: "p" } },
                    { $unwind: "$p" },
                    // Join with riders to get rider name
                    { $lookup: { from: "riders", localField: "p.rider_id", foreignField: "_id", as: "r" } },
                    // Join with tricks to get trick name
                    { $lookup: { from: "tricks", localField: "p.trick_id", foreignField: "_id", as: "t" } },
                    { $unwind: "$r" },
                    { $unwind: "$t" },
                    {
                        $project: {
                            _id: 0,
                            trickId: "$trick_oid",
                            voteCount: 1,
                            rider: { $concat: ["$r.name", " ", "$r.surname"] },
                            trick: "$t.trick_name",
                            rider_id: "$r._id"
                        }
                    },
                    // Leader first
                    { $sort: { voteCount: -1 } }
                ]).toArray();

                // Map votes back to trick_a and trick_b sides of the match
                // so the view always renders both slots even if one has 0 votes
                const trick_a = votes.find(v => v.trickId.equals(match.trick_a_id)) || null;
                const trick_b = votes.find(v => v.trickId.equals(match.trick_b_id)) || null;

                // Determine winner:
                // - null if no votes have been cast yet
                // - null if it's a tie (both sides equal)
                // - otherwise the trick with the most votes
                const winner = votes.length === 2 && votes[0].voteCount !== votes[1].voteCount
                    ? votes[0]
                    : null;

                return {
                    match_id: match._id,
                    created_at: match.created_at,
                    is_active: match.is_active,
                    trick_a,
                    trick_b,
                    winner
                };
            }));
        }

        // Render the duels results view with all match data
        res.render("admin/duels_results", {
            events,
            event_id,
            current_heat,
            duels,
            status,
            currentEvent
        });

    } catch (error) {
        console.error("Error loading duels results:", error);
        res.status(500).send("Error loading duels results view.");
    }
});

// POST /admin/results/duels/submit — push duel results to all fans in the event room
app.post('/admin/results/duels/submit', (req, res) => {
    const { event_id, heat, duels } = req.body;

    console.log("📡 Pushing duel results:", JSON.stringify({ event_id, heat, duels }, null, 2));

    // Emit duel results to all fans joined to this event's socket room
    io.to(event_id).emit('duel_results', {
        event_id,
        heat,
        duels
    });

    // Trigger admin page reload
    io.to(event_id).emit('refresh_results', {
        event_id,
        heat
    });

    res.redirect('back');
});
// END /admin/results/duels/submit


// =============================================================================
// END OF ADMIN RESULT VIEW
// =============================================================================



app.get("/results/best-trick", async (req, res) => {
    try {
        const { event_id, heat } = req.query;
        const heatNum = parseInt(heat) || 0;

        if (!event_id) return res.status(400).json({ error: "event_id required" });

        // Create a search array to handle both String and ObjectId types
        const searchIds = [event_id.trim()]; 
        try { 
            searchIds.push(new ObjectId(event_id.trim())); 
        } catch(e) { /* ignore if not valid ObjectId */ }

        const results = await getDB().collection("best_trick_votes").aggregate([
            { 
                $match: { 
                    event_id: { $in: searchIds }, // Matches if it's the string OR the ObjectId
                    heat: heatNum 
                } 
            },
            { $group: { _id: "$voted_trick_id", voteCount: { $sum: 1 } } },
            // Ensure the trick ID is converted to ObjectId for the join
            { $addFields: { trick_oid: { $toObjectId: "$_id" } } },
            { 
                $lookup: { 
                    from: "event_tricks", 
                    localField: "trick_oid", 
                    foreignField: "_id", 
                    as: "p" 
                } 
            },
            { $unwind: "$p" },
            { $lookup: { from: "riders", localField: "p.rider_id", foreignField: "_id", as: "r" } },
            { $lookup: { from: "tricks", localField: "p.trick_id", foreignField: "_id", as: "t" } },
            { $unwind: "$r" }, 
            { $unwind: "$t" },
            { $project: { _id: 0, voteCount: 1, rider: "$r.surname", trick: "$t.trick_name" } },
            { $sort: { voteCount: -1 } }
        ]).toArray();

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ==========================================
// FAN UI ROUTE: THE PUBLIC INTERFACE
// ==========================================
// This serves the page the audience sees on their phones.
app.get("/fan/best-trick-vote", async (req, res) => {
    try {
        const fanSessionToken = req.cookies?.fan_session;

        // 1. If no cookie, they aren't logged in. Send them to login.
        if (!fanSessionToken) {
            return res.redirect("/fan/login");
        }

        // 2. Fetch the session from your DB collection
        const sessionData = await getDB().collection("fan_sessions").findOne({ 
            session_token: fanSessionToken 
        });

        // 3. If the token is invalid or expired
        if (!sessionData) {
            return res.redirect("/fan/login");
        }

        // 4. Success! Render the page and pass the data
        // Use the event_id from the session or hardcode it
        const event_id = sessionData.event_id || "69aeb1c6332d8447ca24f222"; 

        res.render("best_trick_vote", { 
            event_id: event_id,
            fan_id: sessionData.fan_id,
            fan_name: sessionData.fan_name
        });

    } catch (err) {
        console.error("Error loading Best Trick page:", err);
        res.status(500).send("Internal Server Error");
    }
});



/* =====================================================
   SIMPLE RESULT BROADCASTER 
   Purpose: Capture 4 values and push them to fans
===================================================== */

// 1. Display the Form
app.get('/admin/results/simple', (req, res) => {
    const event_id = "12345"; // In a real app, get this from a database or slug
    res.render('admin_simple_form', { event_id });
});


/* =====================================================
   1. SOCKET.IO CONNECTION HANDLER (The Fix)
===================================================== */
io.on('connection', (socket) => {
    console.log('🔌 New connection:', socket.id);

    // CRITICAL: This puts the fan into the specific event room
    socket.on('join_event', (eventId) => {
        if (eventId) {
            socket.join(eventId);
            console.log(`✅ Socket ${socket.id} joined room: ${eventId}`);
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ User disconnected');
    });
});

/* =====================================================
   2. THE POST ROUTE (The Broadcaster)
===================================================== */
app.post('/admin/results/simple/submit', (req, res) => {
    const { event_id, v1, v2, v3, v4, v5, v6, v7, v8 } = req.body;
    const resultsArray = [v1, v2, v3, v4, v5, v6, v7, v8];

    // Debug logs to verify room population
    const room = io.sockets.adapter.rooms.get(event_id);
    const numClients = room ? room.size : 0;

    console.log("-----------------------------------------");
    console.log(`📡 BROADCASTING TO ROOM: ${event_id}`);
    console.log(`👥 FANS IN ROOM: ${numClients}`);
    console.log(`📦 DATA:`, resultsArray);
    console.log("-----------------------------------------");

    // Emit the data
    io.to(event_id).emit('simple_update', {
        event_id: event_id,
        results: resultsArray
    });

    res.redirect('back');
});



/* =====================================================
   NEW ROUTE: FETCH DB STANDINGS & BROADCAST TO FANS
   Path: GET /admin/broadcast-best-trick
===================================================== */
/* =====================================================
   SERVER: BULLETPROOF SOCKET HANDLER
===================================================== */
io.on('connection', (socket) => {
    console.log('🔌 Connection:', socket.id);

    socket.on('join_event', (eventId) => {
        // FORCE EVERYTHING TO STRING
        const roomName = String(eventId).trim(); 
        
        socket.join(roomName);
        
        // --- VERIFICATION LOGS ---
        const room = io.sockets.adapter.rooms.get(roomName);
        console.log(`✅ SUCCESS: ${socket.id} joined [${roomName}]`);
        console.log(`👥 Total Fans now in [${roomName}]: ${room ? room.size : 0}`);
    });
});

/* =====================================================
   SERVER: UPDATED BROADCAST ROUTE
===================================================== */
app.get('/admin/broadcast-best-trick', async (req, res) => {
    try {
        const { event_id, heat } = req.query;
        const roomName = String(event_id).trim();
        const heatNum = parseInt(heat) || 0;

        // 1. Get the DB Data
        const searchIds = [roomName];
        try { searchIds.push(new ObjectId(roomName)); } catch(e) {}

        const standings = await getDB().collection("best_trick_votes").aggregate([
            { $match: { event_id: { $in: searchIds }, heat: heatNum } },
            { $group: { _id: "$voted_trick_id", voteCount: { $sum: 1 } } },
            { $addFields: { trick_oid: { $toObjectId: "$_id" } } },
            { $lookup: { from: "event_tricks", localField: "trick_oid", foreignField: "_id", as: "p" } },
            { $unwind: { path: "$p", preserveNullAndEmptyArrays: false } }, // If this fails, the whole row vanishes
            { $lookup: { from: "riders", localField: "p.rider_id", foreignField: "_id", as: "r" } },
            { $lookup: { from: "tricks", localField: "p.trick_id", foreignField: "_id", as: "t" } },
            { $unwind: "$r" }, 
            { $unwind: "$t" },
            { $project: { _id: 0, voteCount: 1, rider: "$r.surname", trick: "$t.trick_name" } },
            { $sort: { voteCount: -1 } }
        ]).toArray();

        console.log(`🔎 DB Found ${standings.length} rows for Event ${roomName}`);

        // 2. Format with a "Safety Net"
        let formattedResults;
        if (standings.length === 0) {
            formattedResults = ["No votes found in database for this Heat."];
        } else {
            formattedResults = standings.map(item => 
                `${item.rider || 'Unknown Rider'}: ${item.trick || 'Unknown Trick'} (${item.voteCount || 0} votes)`
            );
        }

        // 3. Emit
        io.to(roomName).emit('simple_update', {
            event_id: roomName,
            results: formattedResults
        });

        res.send(`Broadcast complete. Found ${standings.length} items.`);

    } catch (error) {
        console.error("Aggregation Error:", error);
        res.status(500).send("DB Error: " + error.message);
    }
});

/* ==========================================================================
   ROUTE: BROADCAST DUEL WINNERS
   URL: /admin/broadcast-duel-winners?event_id=69aeb1c6332d8447ca24f222&heat=1
   ========================================================================== */
/* ==========================================================================
   ROUTE: BROADCAST DUEL WINNERS (Match-ID Specific)
   ========================================================================== */
app.get('/admin/broadcast-duel-winners', async (req, res) => {
    try {
        const { event_id, heat } = req.query;
        if (!event_id || !heat) return res.status(400).send("Missing event_id or heat");

        const db = getDB();
        const roomName = String(event_id).trim();
        const heatNum = parseInt(heat);

        // 1. Get the official matches for this heat, sorted by time
        const matches = await db.collection("best_trick_matches")
            .find({ event_id: new ObjectId(roomName), heat: heatNum })
            .sort({ created_at: 1 })
            .toArray();

        if (matches.length === 0) return res.send("No matches found.");

        console.log(`\n--- 🏁 STARTING MATCH-SPECIFIC BROADCAST (Heat ${heatNum}) ---`);

        // 2. Map through each match and count votes ONLY for that match_id
        const results = await Promise.all(matches.map(async (match, index) => {
            
            // Count votes for Trick A IN THIS MATCH
            const votesA = await db.collection("best_trick_votes").countDocuments({ 
                match_id: match._id, 
                voted_trick_id: { $in: [String(match.trick_a_id), match.trick_a_id] } 
            });

            // Count votes for Trick B IN THIS MATCH
            const votesB = await db.collection("best_trick_votes").countDocuments({ 
                match_id: match._id, 
                voted_trick_id: { $in: [String(match.trick_b_id), match.trick_b_id] } 
            });

            // Winner Logic (Mirroring your Dashboard: null/tie check)
            let winnerName = "Tied/No Votes";
            let winningVotes = 0;

            // Fetch names for the console log
            const trickA = await db.collection("event_tricks").findOne({ _id: match.trick_a_id });
            const trickB = await db.collection("event_tricks").findOne({ _id: match.trick_b_id });
            const rA = await db.collection("riders").findOne({ _id: trickA?.rider_id });
            const rB = await db.collection("riders").findOne({ _id: trickB?.rider_id });
            
            const nameA = rA ? rA.surname : "Rider A";
            const nameB = rB ? rB.surname : "Rider B";

            if (votesA > votesB) {
                winnerName = `🏆 ${nameA}`;
                winningVotes = votesA;
            } else if (votesB > votesA) {
                winnerName = `🏆 ${nameB}`;
                winningVotes = votesB;
            }

            // 🟢 CONSOLE LOG: Now isolated by match_id
            console.log(`Duel #${index + 1} [ID: ${match._id}]: (${nameA}: ${votesA}) vs (${nameB}: ${votesB}) -> Winner: ${winnerName}`);

            return `Duel ${index + 1}: ${winnerName} (${winningVotes} votes)`;
        }));

        console.log("-----------------------------------\n");

        // 3. Broadcast
        io.to(roomName).emit('simple_update', {
            event_id: roomName,
            results: results
        });

        res.send(`Broadcasted ${results.length} matches correctly.`);

    } catch (error) {
        console.error("❌ Match Broadcast Error:", error);
        res.status(500).send(error.message);
    }
});
/* ======================== END BROADCAST ROUTE ============================ */


// =====================================================
// TEST & HEALTH ROUTES
// =====================================================


app.get('/test-hub', (req, res) => {
    // Ensure this matches the ID you use in the broadcast URL
    const debugID = "69aeb1c6332d8447ca24f222"; 
    res.render('test_hub', { event_id: debugID });
});


// Basic test route
app.get("/test", (req, res) => {
  res.send("✅ Test route works!");
});

// Health check with collection counts
app.get("/health", async (req, res) => {
  try {
    if (!getDB()) throw new Error("Database not connected");

    const collectionsList = await getDB().listCollections().toArray();
    const status = {};

    for (const col of collectionsList) {
      const count = await getDB().collection(col.name).countDocuments();
      status[col.name] = count;
    }

    res.json({
      status: "ok",
      database: "connected",
      collections: status,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


