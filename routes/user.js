import express from "express";
import prisma from "../utils/prisma.js";
import { createUploader } from "../utils/multer.js";

const router = express.Router();

const profileUpload = createUploader("profiles");

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
    }
  },
);

router.get("/list", async (req, res) => {
  let page = req.query.page || 1;
  let limit = req.query.limit || 50;

  try {
    const result = await prisma.user.findMany({
      skip: page == 1 ? 0 : Number(page) * 50,
      take: Number(limit),
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      totalCount: result.length,
      users: result,
    });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ error: error.message });
  }
});

export default router;
