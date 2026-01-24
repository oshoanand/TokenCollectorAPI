import express from "express";
import prisma from "../utils/prisma.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";

// --- Setup Directory Helper & Multer (Reuse existing setup) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- 1. Multer Configuration ---
// Define where to save the uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure this directory exists or create it
    const uploadDir = "uploads/profiles/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create a unique filename: fieldname-timestamp.jpg
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

const upload = multer({ storage: storage });
const router = express.Router();

router.put(
  "/update-profile",
  upload.single("profile_image"),
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
  upload.single("profile_image"),
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

export default router;
