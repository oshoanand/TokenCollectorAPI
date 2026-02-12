// routes/fcm.js (or wherever your routes are)
import express from "express";
import { messaging } from "../lib/firebase.js";
import { prisma } from "../utils/prisma.js";
import "dotenv/config";

const router = express.Router();

router.post("/save-fcm", async (req, res) => {
  try {
    // 1. Validate Input
    const { token } = req.body;
    const { mobile } = req.user;

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    if (!mobile) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    console.log(
      `Saving FCM Token for user ${mobile}: ${token.substring(0, 10)}...`,
    );

    // 2. Update User in Database
    // We use 'upsert' or 'update' to save the token
    const updatedUser = await prisma.user.update({
      where: { mobile: mobile },
      data: {
        fcmToken: token,
        // Optional: Update last active timestamp
        // lastActive: new Date()
      },
    });

    // 3. (Optional) Subscribe to Topic automatically
    // If this user is a collector, subscribe them to the 'collector_jobs' topic immediately
    if (updatedUser.userRole === "COLLECTOR") {
      await messaging.subscribeToTopic(token, process.env.COLLECTOR_FCM_TOPIC);
      console.log("Auto-subscribed collector to 'collector_jobs'");
    } else {
      await messaging.subscribeToTopic(token, process.env.VISITOR_FCM_TOPIC);
    }

    return res.status(200).json({
      success: true,
      message: "FCM Token updated successfully",
    });
  } catch (error) {
    console.error("Error saving FCM token:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

router.post("/subscribe", async (req, res) => {
  const { token, topic } = req.body;

  if (!token || !topic) {
    return res.status(400).json({ error: "Missing token or topic" });
  }

  try {
    // Subscribe the device token to the topic via Admin SDK
    await messaging.subscribeToTopic(token, topic);
    console.log(`Successfully subscribed ${token} to topic: ${topic}`);
    res.status(200).json({ message: "Subscribed successfully" });
  } catch (error) {
    console.error("Error subscribing to topic:", error);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

export default router;
