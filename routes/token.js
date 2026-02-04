import express from "express";
import { sendPushNotification } from "../lib/firebase.js";
import {
  fetchCached,
  prisma,
  generateUniqueCode,
  invalidateKeys,
  invalidatePattern,
} from "../middleware/redis.js";
import webpush from "../utils/web-push.js";
import "dotenv/config";

const router = express.Router();

// router.post("/create", async (req, res) => {
//   const { mobileNumber, orderNumber, orderCode, fcmToken } = req.body;

//   // Retrieve the Socket.io instance setup in app.js
//   const io = req.app.get("socketio");

//   try {
//     const data = await prisma.token.findFirst({
//       select: {
//         tokenCode: true,
//       },
//       where: {
//         mobileNumber: mobileNumber,
//         tokenStatus: "REQUESTED",
//       },
//     });

//     // Check if user already has an active token
//     if (data != null) {
//       return res.status(403).json({
//         orderToken: data.tokenCode,
//         message: "У вас уже есть активный токен!",
//       });
//     }
//     // Proceed to create new token
//     else {
//       const tokenCode = await generateUniqueCode();
//       const result = await prisma.token.create({
//         data: {
//           orderNumber: orderNumber,
//           mobileNumber: mobileNumber,
//           orderCode: orderCode,
//           tokenCode: tokenCode,
//           quantity: 1,
//           tokenStatus: "REQUESTED",
//           postedById: mobileNumber,
//         },
//       });

//       if (result) {
//         // Invalidate Cache
//         await invalidateKeys([
//           "tokens:all",
//           `tokens:${mobileNumber}`,
//           `token:${mobileNumber}`,
//         ]);

//         // LIVE NOTIFICATION: Emit event to Admin Panel
//         // This payload must match what your Next.js Admin is listening for
//         if (io) {
//           io.emit("new_token", {
//             id: result.id,
//             tokenCode: result.tokenCode,
//             orderNumber: result.orderNumber,
//             mobileNumber: result.mobileNumber,
//             status: result.tokenStatus,
//             createdAt: result.createdAt || new Date(),
//           });
//           console.log(`📡 Socket Event emitted for Token: ${tokenCode}`);
//         } else {
//           console.warn("⚠️ Socket.io instance not found on req.app");
//         }

//         // BACKGROUND NOTIFICATION (Web Push - For Closed Tabs)

//         try {
//           // A. Fetch all subscribed admins from Postgres
//           const subscriptions = await prisma.subscription.findMany();
//           // B. Prepare the payload (Must match what sw.js expects)
//           const notificationPayload = JSON.stringify({
//             title: "New Token Generated!",
//             body: `Token: ${tokenCode} | Order: ${orderNumber}`,
//             url: `${ADMIN_PANEL_URL}/tokens`, // Deep link
//           });

//           // C. Send to all subscriptions in parallel
//           const pushPromises = subscriptions.map((sub) => {
//             // Construct the subscription object required by web-push
//             const pushSubscription = {
//               endpoint: sub.endpoint,
//               keys: {
//                 p256dh: sub.p256dh,
//                 auth: sub.auth,
//               },
//             };

//             return webpush
//               .sendNotification(pushSubscription, notificationPayload)
//               .catch(async (err) => {
//                 // Cleanup: If subscription is invalid (410 Gone), delete it from DB
//                 if (err.statusCode === 410 || err.statusCode === 404) {
//                   console.log(`🗑️ Removing stale subscription: ${sub.id}`);
//                   await prisma.subscription.delete({ where: { id: sub.id } });
//                 } else {
//                   console.error("Web Push Error:", err.message);
//                 }
//               });
//           });

//           // Execute all pushes without blocking the HTTP response
//           Promise.all(pushPromises);
//           console.log(
//             `🔔 Background Notification sent to ${subscriptions.length} admins.`,
//           );
//         } catch (pushError) {
//           console.error("Background Notification Failed:", pushError);
//         }

//         if (fcmToken) {
//           sendPushNotification(
//             "token",
//             `Сгенерированный номер токена ${tokenCode} 📦`,
//             "Токен действителен только в течение 48 часов⌚",
//             fcmToken,
//             null,
//           );
//         }

//         return res.status(200).json({
//           token: result.tokenCode,
//           message: "success",
//         });
//       }
//     }
//   } catch (error) {
//     console.error("Create Token Error:", error.message);
//     return res.status(400).json({ message: "Something went wrong!" });
//   }
//   // REMOVED: finally { prisma.$disconnect() } - Do not disconnect in routes!
// });

router.post("/create", async (req, res) => {
  const { mobileNumber, orderNumber, orderCode, fcmToken } = req.body;
  const io = req.app.get("socketio");

  try {
    const data = await prisma.token.findFirst({
      select: { tokenCode: true },
      where: {
        mobileNumber: mobileNumber,
        tokenStatus: "REQUESTED",
      },
    });

    if (data != null) {
      return res.status(403).json({
        orderToken: data.tokenCode,
        message: "У вас уже есть активный токен!",
      });
    } else {
      const tokenCode = await generateUniqueCode();

      const result = await prisma.token.create({
        data: {
          orderNumber: orderNumber,
          mobileNumber: mobileNumber,
          orderCode: orderCode,
          tokenCode: tokenCode,
          quantity: 1,
          tokenStatus: "REQUESTED",
          postedById: mobileNumber,
        },
      });

      if (result) {
        // ============================================================
        // 🚀 CACHE INVALIDATION UPDATED
        // ============================================================

        // 1. Invalidate ALL Admin Panel Lists (Pagination + Status + Search)
        // This matches "tokens:tokens_p...", "tokens:tokens_statusREQUESTED...", etc.
        await invalidatePattern("tokens:tokens*");

        // 2. Invalidate Mobile App User-Specific Lists
        await invalidateKeys([
          `tokens:${mobileNumber}`,
          `token:${mobileNumber}`,
        ]);

        console.log(`✅ Cache invalidated for new token`);

        // --- LIVE NOTIFICATION (Socket.io) ---
        if (io) {
          io.emit("new_token", {
            type: "TOKEN",
            id: result.id,
            tokenCode: result.tokenCode,
            orderNumber: result.orderNumber,
            mobileNumber: result.mobileNumber,
            status: result.tokenStatus,
            createdAt: result.createdAt || new Date(),
          });
          console.log(`📡 Socket Event emitted for Token: ${tokenCode}`);
        } else {
          console.warn("⚠️ Socket.io instance not found on req.app");
        }

        // --- BACKGROUND NOTIFICATION (Web Push) ---
        try {
          const subscriptions = await prisma.subscription.findMany();

          const notificationPayload = JSON.stringify({
            title: "New Token Generated!",
            body: `Token: ${tokenCode} | Order: ${orderNumber}`,
            url: `${process.env.ADMIN_PANEL_URL || "https://admin.klinciti.ru"}/tokens`,
          });

          const pushPromises = subscriptions.map((sub) => {
            const pushSubscription = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            };

            return webpush
              .sendNotification(pushSubscription, notificationPayload)
              .catch(async (err) => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                  console.log(`🗑️ Removing stale subscription: ${sub.id}`);
                  await prisma.subscription.delete({ where: { id: sub.id } });
                } else {
                  console.error("Web Push Error:", err.message);
                }
              });
          });

          Promise.all(pushPromises);
        } catch (pushError) {
          console.error("Background Notification Failed:", pushError);
        }

        // --- FCM NOTIFICATION ---
        if (fcmToken) {
          sendPushNotification(
            "token",
            `Сгенерированный номер токена ${tokenCode} 📦`,
            "Токен действителен только в течение 48 часов⌚",
            fcmToken,
            null,
          );
        }

        return res.status(200).json({
          token: result.tokenCode,
          message: "success",
        });
      }
    }
  } catch (error) {
    console.error("Create Token Error:", error.message);
    return res.status(400).json({ message: "Something went wrong!" });
  }
});
router.get("/user/all-tokens/:mobile", async (req, res) => {
  try {
    const mobileNumber = req.params.mobile;

    if (!mobileNumber)
      return res.status(400).json({ message: "Mobile number required" });

    const results = await fetchCached("tokens", mobileNumber, async () => {
      return await prisma.token.findMany({
        where: { mobileNumber: mobileNumber },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          tokenCode: true,
          orderNumber: true,
          createdAt: true,
          receivedAt: true,
          tokenStatus: true,
        },
      });
    });

    if (results && results.length > 0) {
      return res.status(200).json(results);
    } else {
      return res.status(200).json([]);
    }
  } catch (error) {
    console.error("Error fetching tokens:", error.message);
    return res.status(500).json({ message: "server error !" });
  }
});

router.get("/all-tokens", async (req, res) => {
  try {
    // 1. Get query params (default to Page 1, Limit 10)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const skip = (page - 1) * limit;

    // 2. Construct Prisma "Where" Clause
    // If search exists, filter by OR condition across 3 fields
    const whereClause = search
      ? {
          OR: [
            { tokenCode: { contains: search } }, // Case insensitive in Postgres usually requires mode: 'insensitive'
            { mobileNumber: { contains: search } },
            { orderNumber: { contains: search } },
          ],
        }
      : {};

    // 3. Create Unique Cache Key including Search
    // Key format: "tokens_p1_l10_sMySearchQuery"
    const cacheId = `tokens_p${page}_l${limit}_s${search.replace(/\s/g, "")}`;

    const result = await fetchCached("tokens", cacheId, async () => {
      // 4. Run Transaction
      const [total, tokens] = await prisma.$transaction([
        prisma.token.count({ where: whereClause }),
        prisma.token.findMany({
          where: whereClause,
          skip: skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            postedBy: {
              select: { name: true, mobile: true, image: true },
            },
          },
        }),
      ]);

      return {
        data: tokens,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });

    // 5. Always return 200 with data structure (even if empty)
    return res.status(200).json({
      data: result.data || [],
      meta: result.meta || { total: 0, page, limit, totalPages: 0 },
    });
  } catch (error) {
    console.error("Error fetching tokens:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/all/:status", async (req, res) => {
  const status = req.params.status;
  try {
    // 1. Get query params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || ""; // <--- FIX: Capture search param
    const skip = (page - 1) * limit;

    // 2. Construct Where Clause (Status + Search)
    const whereClause = {
      tokenStatus: status, // <--- Filter by Status
      ...(search
        ? {
            OR: [
              { tokenCode: { contains: search } },
              { mobileNumber: { contains: search } },
              { orderNumber: { contains: search } },
            ],
          }
        : {}),
    };

    // 3. Create Unique Cache Key
    // Format: "tokens_statusISSUED_p1_l10_sMySearch"
    // This prevents collisions between different statuses and search terms
    const cacheId = `tokens_status${status}_p${page}_l${limit}_s${search.replace(/\s/g, "")}`;

    const result = await fetchCached("tokens", cacheId, async () => {
      // 4. Run Transaction
      const [total, tokens] = await prisma.$transaction([
        // FIX: Count only tokens matching the status/search
        prisma.token.count({ where: whereClause }),
        prisma.token.findMany({
          skip: skip,
          take: limit,
          where: whereClause,
          orderBy: { createdAt: "desc" },
          include: {
            postedBy: {
              select: {
                name: true,
                mobile: true,
                image: true,
              },
            },
          },
        }),
      ]);

      return {
        data: tokens,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });

    // 5. Response
    return res.status(200).json({
      data: result.data || [],
      meta: result.meta || { total: 0, page, limit, totalPages: 0 },
    });
  } catch (error) {
    console.error("Error fetching tokens:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/status/:quantity/:token", async (req, res) => {
  const { token, quantity } = req.params;
  const { mobile, id } = req.query;

  try {
    const result = await prisma.token.update({
      data: {
        tokenStatus: "ISSUED",
        receivedAt: new Date().toISOString(),
        quantity: Number(quantity),
      },
      where: {
        mobileNumber: mobile,
        tokenCode: token,
        id: Number(id),
      },
    });

    if (result) {
      // ============================================================
      // 🚀 CACHE INVALIDATION UPDATED
      // ============================================================

      // 1. Invalidate ALL Admin Panel Lists
      // We use the broader wildcard "tokens:tokens*" to catch:
      // - "tokens:tokens_p1..." (The main list)
      // - "tokens:tokens_statusREQUESTED..." (The filtered tabs)
      // - "tokens:tokens_..._sSearch..." (Search results)
      await invalidatePattern("tokens:tokens*");

      // 2. Invalidate User-Specific Keys (Mobile App)
      // This ensures the user sees the updated status on their phone immediately
      await invalidateKeys([
        `tokens:${result.mobileNumber}`,
        `token:${result.mobileNumber}`,
      ]);

      // --- SEND NOTIFICATIONS ---
      sendPushNotification(
        "topic",
        `Ваш токен-номер ${token} выдан 👍`,
        "Благодарим вас за оформление заказов в наших пунктах выдачи. Надеемся, вам всё понравилось, и будем рады видеть вас снова. Всего доброго! 🎉",
        null,
        `user_${result.mobileNumber}`,
      );
    }

    return res.status(200).json({
      message: "Token status updated successfully",
    });
  } catch (error) {
    console.error("Update Token Error:", error.message);
    return res.status(400).json({ message: error.message });
  }
});

router.get("/user/:mobile", async (req, res) => {
  const mobileNumber = req.params.mobile;
  try {
    const result = await fetchCached("token", mobileNumber, async () => {
      return await prisma.token.findFirst({
        where: { mobileNumber: mobileNumber, tokenStatus: "REQUESTED" },
        select: {
          tokenCode: true,
          tokenStatus: true,
        },
      });
    });
    if (result != null) {
      return res.status(200).json({
        token: result.tokenCode,
        message: "success",
      });
    } else {
      throw new Error("У вас нет активных токенов!");
    }
  } catch (error) {
    console.log(error.message);
    return res.status(400).json({ message: error.message });
  }
});

export default router;
