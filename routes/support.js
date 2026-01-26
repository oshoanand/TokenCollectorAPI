import express from "express";
import prisma from "../utils/prisma.js";
import { sendPushNotification } from "../lib/firebase.js";
import { createUploader } from "../utils/multer.js";

const router = express.Router();

const supportUpload = createUploader("supports");

router.post("/create", supportUpload.single("proof"), async (req, res) => {
  try {
    //  Extract text fields (req.body contains the text parts)
    const { mobile, support_type, description } = req.body;

    //  Construct the image URL (accessible via static serve)
    // Ensure you configure express.static to serve the 'uploads' folder
    const imageUrl = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/supports/${req.file.filename}`
      : null;

    const result = await prisma.support.create({
      data: {
        message: description,
        queryType: support_type,
        photo: imageUrl,
        postedById: mobile,
        mobile: mobile,
      },
    });

    if (result) {
      sendPushNotification(
        "topic",
        "Query received",
        "Thank you for contacting us, we will try to resolve your issue at utmost priority basis",
        null,
        `user_${result.mobile}`,
      );
    }
    return res.status(200).json({ message: "success" });
  } catch (error) {
    console.error("Error creating job:", error.message);
    res.status(500).json({ message: "Server error" });
  } finally {
    async () => {
      await prisma.$disconnect();
    };
  }
});

// 1. GET: Fetch all support queries (with pagination/filtering)
router.get("/all", async (req, res) => {
  try {
    const supports = await prisma.support.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        postedBy: {
          select: {
            name: true,
          },
        },
      },
    });
    res.json(supports);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch queries" });
  }
});

// 2. POST: Resolve/Update a query
router.post("/resolve", async (req, res) => {
  const { id, status, adminReply, userMobile } = req.body;

  if (!id || !status) {
    return res.status(400).json({ error: "ID and Status are required" });
  }

  try {
    // A. Update Database
    const updatedTicket = await prisma.support.update({
      where: { id },
      data: {
        status: status,
        adminReply: adminReply,
        resolvedAt: new Date(),
      },
    });

    // B. Send Notification to User
    // We send to topic `user_{mobile}` assuming your app subscribes users to their own mobile topic
    if (userMobile) {
      let title = "Support Update 🎧";
      let body = `Your query status has been updated to: ${status}`;

      if (status === "RESOLVED") {
        title = "Query Resolved ✅";
        body = "Your support request has been resolved. Tap to view details.";
      } else if (status === "REJECTED") {
        title = "Query Update ⚠️";
      }

      // Send (Fire & Forget)
      sendPushNotification("topic", title, body, null, `user_${userMobile}`);
    }

    res.json({ success: true, data: updatedTicket });
  } catch (error) {
    console.error("Support Resolution Error:", error);
    res.status(500).json({ error: "Failed to resolve query" });
  }
});

export default router;
