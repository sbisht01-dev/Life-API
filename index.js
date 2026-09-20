const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const express = require("express");
const cors = require("cors");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { analyzeSleepForDate } = require("./sleepEngine");

// 1. Safe Initialization
if (!admin.apps.length) {
    admin.initializeApp();
}
const appFirebase = admin.app();
const db = getFirestore(appFirebase, "life-db");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Health check route
app.get("/ping", (req, res) => {
    res.status(200).send({ status: "success", message: "Live Life API is awake!" });
});

// Event logging route
app.post("/log", async (req, res) => {
    try {
        const payload = req.body;
        payload.createdAt = FieldValue.serverTimestamp();

        await db.collection("phone_events").add(payload);

        res.status(200).send({ status: "success", message: "Event written to life-db!" });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).send({ status: "error", message: error.message });
    }
});

// Fetch latest events and compute basic metrics
app.get("/events", async (req, res) => {
    try {
        const snapshot = await db.collection("phone_events")
            .orderBy("createdAt", "desc")
            .limit(100)
            .get();

        const events = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                event: data.event || "Unknown",
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
            };
        });

        res.status(200).json({ status: "success", count: events.length, data: events });
    } catch (error) {
        console.error("Fetch error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

exports.api = functions.https.onRequest(app);

// ------------------------------------------------------------------
// SLEEP ENGINE ARCHIVING
// ------------------------------------------------------------------

async function processSleepForDate(targetDateStr) {
 
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  
 const snapshot = await db.collection("phone_events")
    .where("createdAt", ">=", twoDaysAgo)
    .get();

  const events = [];
  snapshot.forEach(doc => {
      const data = doc.data();
     
      events.push({
          id: doc.id,
          event: data.event || "Unknown",
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
      });
  });

  const sleepData = analyzeSleepForDate(events, targetDateStr, []);

  if (sleepData && sleepData.hasSleep) {
    
    await db.collection("sleep").doc(targetDateStr).set({
      date: targetDateStr,
      bedTime: sleepData.bedTime,
      wakeTime: sleepData.wakeTime,
      timeInBedMs: sleepData.timeInBedMs,
      actualSleepMs: sleepData.actualSleepMs,
      totalAwakeMs: sleepData.totalAwakeMs,
      efficiency: sleepData.efficiency,
      interruptions: sleepData.interruptions,
      lastUpdated: FieldValue.serverTimestamp(),
    });
    return { status: "success", date: targetDateStr, data: sleepData };
  } else {
    return { status: "skipped", date: targetDateStr, message: "No sleep session found" };
  }
}


exports.archiveDailySleep = onSchedule({
  schedule: "30 9 * * *", // 9:30 AM UTC = 3:00 PM IST
  timeZone: "UTC"
}, async (event) => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  await processSleepForDate(todayStr);
  console.log(`Automated sleep archive completed for ${todayStr}`);
});


exports.forceArchiveSleep = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  const SECRET_KEY = process.env.CRON_SECRET; 
  if (req.query.secret !== SECRET_KEY) {
    return res.status(403).json({ status: "error", message: "Unauthorized" });
  }

  try {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const targetDate = req.query.date || todayStr;

    const result = await processSleepForDate(targetDate);
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: error.message });
  }
});