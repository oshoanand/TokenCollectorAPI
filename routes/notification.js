import express from "express";
import { messaging, sendPushNotification } from "../lib/firebase.js";
import prisma from "../utils/prisma.js"; //

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

// POST Send
router.post("/send", async (req, res) => {
  // console.log(req.body);
  const { type, target, title, body } = req.body;

  // Validation
  if (!type || !target || !title || !body) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // 1. Send via Firebase
    const response = await sendPushNotification(
      type,
      title,
      body,
      target,
      target,
    );

    // 2. ✅ Log Success to PostgreSQL via Prisma
    await prisma.notificationLog.create({
      data: {
        title,
        body,
        targetType: type, // Prisma matches the string 'topic'/'token' to the Enum automatically
        target,
        status: "SENT",
        messageId: response,
      },
    });

    return res.status(200).json({ success: true, messageId: response });
  } catch (error) {
    console.error("FCM Error:", error);

    // 3. ✅ Log Failure to PostgreSQL
    // We wrap this in a try/catch so logging failure doesn't crash the response
    try {
      await prisma.notificationLog.create({
        data: {
          title,
          body,
          targetType: type,
          target,
          status: "FAILED",
          errorDetails: error.message,
        },
      });
    } catch (logError) {
      console.error("Failed to write error log to DB:", logError);
    }

    return res
      .status(500)
      .json({ error: "Failed to send notification", details: error.message });
  }
});

export default router;
