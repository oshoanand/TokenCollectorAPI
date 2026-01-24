import express from "express";
import prisma from "../utils/prisma.js";
import { createUploader } from "../utils/multer.js";
import { messaging } from "../lib/firebase.js";

const router = express.Router();

// Initialize specific uploader for profiles
const profileUpload = createUploader("profiles");
const supportUpload = createUploader("supports");

const sendPushNotificationToTopic = async (topic, title, body) => {
  if (!topic) return;
  try {
    return await messaging.send({
      notification: { title, body },
      topic: topic,
    });
  } catch (err) {
    console.error("FCM Error:", err.message);
  }
};

router.put(
  "/update-profile",
  profileUpload.single("profile_image"),
  async (req, res) => {
    try {
      const { mobile, name } = req.body;

      if (!mobile) {
        return res
          .status(400)
          .json({ message: "User mobile is required to identify user." });
      }
      if (name) {
        const result = await prisma.user.update({
          where: {
            mobile: mobile,
          },
          data: {
            name: name,
          },
        });
        return res.status(200).json({
          message: "Profile updated successfully",
          name: result.name,
        });
      } else {
        return res.status(400).json({ message: "Name must be provided !" });
      }
    } catch (error) {
      console.error("Update error:", error.message);
      res.status(500).json({ message: "Server error during update" });
    } finally {
      async () => {
        await prisma.$disconnect();
      };
    }
  },
);

router.put(
  "/update-profile-image",
  profileUpload.single("profile_image"),
  async (req, res) => {
    try {
      const { mobile } = req.body;
      if (!mobile) {
        return res
          .status(400)
          .json({ message: "User mobile is required to identify user" });
      }

      if (req.file) {
        const imageUrl = `${req.protocol}://${req.get(
          "host",
        )}/uploads/profiles/${req.file.filename}`;

        const result = await prisma.user.update({
          where: {
            mobile: mobile,
          },
          data: {
            image: imageUrl,
          },
        });
        return res.status(200).json({
          message: "Profile Image updated successfully",
          image: result.image,
        });
      }
    } catch (error) {
      console.error("Update error:", error.message);
      res.status(500).json({ message: "Server error during update" });
    } finally {
      async () => {
        await prisma.$disconnect();
      };
    }
  },
);

router.post(
  "/support/create",
  supportUpload.single("proof"),
  async (req, res) => {
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
        // Send Notification
        await sendPushNotificationToTopic(
          `user_${mobile}`,
          "Query received",
          "Thank you for contacting us, we will try to resolve your issue at utmost priority basis",
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
  },
);

export default router;
