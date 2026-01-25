import express from "express";
import { messaging } from "../lib/firebase.js";
import prisma from "../utils/prisma.js";

const router = express.Router();

// GET History
router.get("/history", async (req, res) => {
  try {
    const logs = await prisma.notificationLog.findMany({
      take: 50,
      orderBy: {
        sentAt: "desc",
      },
    });
    res.json(logs);
  } catch (error) {
    console.error("Prisma Error:", error);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.post("/send", async (req, res) => {
  const { type, target, title, body } = req.body;

  // 1. Basic Validation
  if (!type || !target || !title || !body) {
    return res.status(400).json({
      error:
        "Missing required fields: type, target, title, and body are required.",
    });
  }

  try {
    let message = {
      notification: {
        title: title,
        body: body,
      },
      // Optional: Add data payload for background handling or custom logic in the app
      data: {
        click_action: "FLUTTER_NOTIFICATION_CLICK", // Or your Android/iOS specific action
        sentAt: new Date().toISOString(),
      },
      // Platform specific configurations
      android: {
        priority: "high",
        notification: {
          icon: "stock_ticker_update",
          color: "#4D96FF", // Matches your Tech Blue theme
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: "default",
          },
        },
      },
    };

    // 2. Set Destination based on Type
    if (type === "topic") {
      // Broadcasting to a Firebase Topic (e.g., "all_users")
      message.topic = target;
    } else if (type === "token") {
      // Sending to a specific device's FCM Token
      message.token = target;
    } else {
      return res
        .status(400)
        .json({ error: "Invalid type. Must be 'topic' or 'token'." });
    }

    // 3. Send via Firebase Admin SDK
    const response = await messaging.send(message);

    console.log(`Successfully sent message: ${response}`);
    return res.status(200).json({
      success: true,
      messageId: response,
    });
  } catch (error) {
    console.error("Error sending FCM message:", error);

    // Handle specific Firebase errors (e.g., expired tokens)
    if (error.code === "messaging/registration-token-not-registered") {
      return res.status(410).json({
        error: "Token is no longer valid. Remove it from your database.",
      });
    }

    return res.status(500).json({
      error: "Failed to send notification",
      details: error.message,
    });
  }
});

export default router;
