import express from "express";
import prisma from "../utils/prisma.js";
import { createUploader } from "../utils/multer.js";
import { redis, fetchCached, invalidatePattern } from "../services/redis.js"; // Adjust path to your redis service

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

        if (result) {
          await invalidatePattern("users:*");
        }
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
        const imageUrl = `${process.env.PHOTO_UPLOAD_URL}/uploads/profiles/${req.file.filename}`;

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

// GET ALL USERS (Server-Side Paginated, Searched, & Redis Cached)
router.get("/admin/list", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // FIX 1: Prevent Express Array Crash.
    // If search is an array like ?search=a&search=b, this safely extracts a string.
    const rawSearch = req.query.search;
    const search = typeof rawSearch === "string" ? rawSearch.trim() : "";

    // Create a highly specific cache ID
    const cacheId = `page_${page}:limit_${limit}:search_${search}`;

    // FIX 2: Reduced TTL for Real-Time Chat Context
    // Changed from 600s (10 mins) to 10s. Admins MUST see new users almost instantly.
    const paginatedData = await fetchCached(
      "users",
      cacheId,
      async () => {
        const skip = (page - 1) * limit;

        // Build the query conditions
        const whereClause = {
          userRole: { not: "ADMINISTRATOR" },
          ...(search && {
            OR: [
              // NOTE: If you use MySQL, remove `mode: "insensitive"` as it will crash Prisma.
              // If you use PostgreSQL or MongoDB, keep it!
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { mobile: { contains: search } },
            ],
          }),
        };

        // Run both queries concurrently for maximum performance
        const [users, total] = await Promise.all([
          prisma.user.findMany({
            where: whereClause,
            select: {
              id: true, // Crucial: This CUID string powers the socket.io chat room!
              name: true,
              email: true,
              mobile: true,
              userRole: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            skip: skip,
            take: limit,
          }),
          prisma.user.count({ where: whereClause }),
        ]);

        // Return the exact structure expected by the React Query hook
        return {
          data: users,
          meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
          },
        };
      },
      10, // <-- REDUCED TTL TO 10 SECONDS
    );

    res.status(200).json(paginatedData);
  } catch (error) {
    console.error("Error fetching paginated users:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// // 2. GET ONLINE USERS
// // We don't use read-through cache here because presence relies on the live Redis SET
// router.get("/online", async (req, res) => {
//   try {
//     const onlineUsers = await redis.smembers("online_users");
//     res.json(onlineUsers.map(Number));
//   } catch (error) {
//     res.json([]);
//   }
// });

// 2. GET ONLINE USERS
// We don't use read-through cache here because presence relies on the live Redis SET
router.get("/online", async (req, res) => {
  try {
    const onlineUsers = await redis.smembers("online_users");

    // CHANGED: Removed .map(Number) to keep the CUIDs as strings
    res.json(onlineUsers);
  } catch (error) {
    console.error("Failed to fetch online users from Redis:", error);
    res.json([]);
  }
});

// 3. UPDATE USER
router.put("/admin/:id", async (req, res) => {
  try {
    const { name, email, mobile, role } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { name, email, mobile, role },
    });

    // 🔴 CACHE INVALIDATION: A user changed, wipe all cached user pages
    await invalidatePattern("users:*");

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Failed to update user" });
  }
});

// 4. DELETE USER
router.delete("/admin/:id", async (req, res) => {
  try {
    await prisma.user.delete({
      where: { id: parseInt(req.params.id) },
    });

    // 🔴 CACHE INVALIDATION: A user was removed, wipe all cached user pages
    await invalidatePattern("users:*");

    res.json({ success: true, message: "User deleted" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

export default router;
