import express from "express";
import prisma from "../utils/prisma.js";

const router = express.Router();

router.post("/subscribe", async (req, res) => {
  const { endpoint, keys } = req.body;

  try {
    await prisma.subscription.upsert({
      where: { endpoint: endpoint },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        updatedAt: new Date(),
      },
      create: {
        endpoint: endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });

    res.status(201).json({ message: "Subscribed successfully" });
  } catch (error) {
    console.error("Subscription Error:", error.message);
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

export default router;
