import express from "express";
import { messaging } from "../lib/firebase.js"; // Ensure this exports your admin messaging instance
import prisma from "../utils/prisma.js";
import "dotenv/config";

const router = express.Router();

// Middleware to check auth (Stub - ensure you have your actual auth middleware here)
// const isAuthenticated = (req, res, next) => { ... }

router.post("/save-fcm", async (req, res) => {
  try {
    const { token } = req.body;
    // req.user comes from your Auth Middleware (JWT/Session)
    const { mobile } = req.user;

    if (!token) return res.status(400).json({ message: "Token is required" });
    if (!mobile) return res.status(401).json({ message: "Unauthorized" });

    console.log(`[FCM] Processing token for user ${mobile}`);

    // 1. Update User in Database
    const updatedUser = await prisma.user.update({
      where: { mobile: mobile },
      data: {
        fcmToken: token,
        updatedAt: new Date(), // Good for tracking active devices
      },
    });

    // 2. Define Topics
    const topicsToSubscribe = [];

    // A. Personal Topic (user_9998887777)
    // Ensure mobile is sanitized to 10 digits if needed
    const personalTopic = `user_${mobile}`;
    topicsToSubscribe.push(personalTopic);

    // B. Role-based Topic
    if (updatedUser.role === "COLLECTOR") {
      topicsToSubscribe.push(
        process.env.COLLECTOR_FCM_TOPIC || "garbagecollector_collector_topic",
      );
    } else {
      topicsToSubscribe.push(
        process.env.VISITOR_FCM_TOPIC || "garbagecollector_visitor_topic",
      );
    }

    // 3. Execute Subscriptions in Parallel
    // We use Promise.allSettled so if one fails, others still proceed
    const subscriptionPromises = topicsToSubscribe.map((topic) =>
      messaging
        .subscribeToTopic(token, topic)
        .then(() => ({ status: "fulfilled", topic }))
        .catch((err) => ({ status: "rejected", topic, reason: err })),
    );

    const results = await Promise.allSettled(subscriptionPromises);

    // Log results for debugging
    results.forEach((res) => {
      if (res.status === "fulfilled") {
        // Note: Promise.allSettled returns objects with value/reason, mapped above to include topic
        console.log(`✅ Subscribed to ${res.value.topic}`);
      } else {
        console.error(
          `❌ Failed to subscribe to ${res.reason.topic}:`,
          res.reason.reason,
        );
      }
    });

    return res.status(200).json({
      success: true,
      message: "Token saved and subscriptions updated",
      topics: topicsToSubscribe,
    });
  } catch (error) {
    console.error("Error saving FCM token:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});

// The /subscribe route is no longer strictly needed for initialization
// but can be kept for manual triggers if necessary.
export default router;
