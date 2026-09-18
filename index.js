const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const express = require("express");
const cors = require("cors");

// Initialize Firebase Admin and target life-db
const appFirebase = admin.initializeApp();
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
