import express from "express";
import { sendPushNotification } from "../lib/firebase.js";
import {
  fetchCached,
  prisma,
  generateUniqueCode,
  invalidateKeys,
} from "../middleware/redis.js";
import webpush from "../utils/web-push.js";

const router = express.Router();

router.post("/create", async (req, res) => {
  const { mobileNumber, orderNumber, orderCode, fcmToken } = req.body;

  // Retrieve the Socket.io instance setup in app.js
  const io = req.app.get("socketio");

  try {
    const data = await prisma.token.findFirst({
      select: {
        tokenCode: true,
        tokenStatus: true,
      },
      where: {
        mobileNumber: mobileNumber,
      },
    });

    // Check if user already has an active token
    if (data != null && data.tokenStatus == "REQUESTED") {
      return res.status(403).json({
        orderToken: data.tokenCode,
        message: "У вас уже есть активный токен!",
      });
    }
    // Proceed to create new token
    else {
      const tokenCode = await generateUniqueCode();
      const result = await prisma.token.create({
        data: {
          orderNumber: orderNumber,
          mobileNumber: mobileNumber,
          orderCode: orderCode,
          tokenCode: tokenCode,
          quantity: 1,
          tokenStatus: "REQUESTED", // Ensure status is set explicitly
        },
      });

      if (result) {
        // Invalidate Cache
        await invalidateKeys([
          "tokens:all",
          `tokens:${mobileNumber}`,
          `token:${mobileNumber}`,
        ]);

        // LIVE NOTIFICATION: Emit event to Admin Panel
        // This payload must match what your Next.js Admin is listening for
        if (io) {
          io.emit("new_token", {
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

        // BACKGROUND NOTIFICATION (Web Push - For Closed Tabs)

        try {
          // A. Fetch all subscribed admins from Postgres
          const subscriptions = await prisma.subscription.findMany();
          // B. Prepare the payload (Must match what sw.js expects)
          const notificationPayload = JSON.stringify({
            title: "New Token Generated!",
            body: `Code: ${tokenCode} | Order: ${orderNumber}`,
            url: "http://localhost:3000/orders", // Deep link
          });

          // C. Send to all subscriptions in parallel
          const pushPromises = subscriptions.map((sub) => {
            // Construct the subscription object required by web-push
            const pushSubscription = {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            };

            return webpush
              .sendNotification(pushSubscription, notificationPayload)
              .catch(async (err) => {
                // Cleanup: If subscription is invalid (410 Gone), delete it from DB
                if (err.statusCode === 410 || err.statusCode === 404) {
                  console.log(`🗑️ Removing stale subscription: ${sub.id}`);
                  await prisma.subscription.delete({ where: { id: sub.id } });
                } else {
                  console.error("Web Push Error:", err.message);
                }
              });
          });

          // Execute all pushes without blocking the HTTP response
          Promise.all(pushPromises);
          console.log(
            `🔔 Background Notification sent to ${subscriptions.length} admins.`,
          );
        } catch (pushError) {
          console.error("Background Notification Failed:", pushError);
        }

        if (fcmToken) {
          sendPushNotification(
            "token",
            `Сгенерированный номер токена ${tokenCode} 📦✨`,
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
  // REMOVED: finally { prisma.$disconnect() } - Do not disconnect in routes!
});

router.get("/list/:mobile", async (req, res) => {
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
    console.log(results);
    if (results && results.length > 0) {
      return res.status(200).json(results);
    } else {
      throw new Error("У вас нет активных токенов!");
    }
  } catch (error) {
    console.error("Error fetching tokens:", error.message);
    return res.status(500).json({ message: error.message });
  } finally {
    async () => {
      await prisma.$disconnect();
    };
  }
});

router.get("/all", async (req, res) => {
  try {
    const results = await fetchCached("tokens", "all", async () => {
      return await prisma.token.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          postedBy: {
            select: {
              name: true,
            },
          },
        },
      });
    });

    if (results && results.length > 0) {
      return res.status(200).json(results);
    } else {
      throw new Error("No Tokens");
    }
  } catch (error) {
    console.error("Error fetching tokens:", error.message);
    return res.status(500).json({ message: error.message });
  } finally {
    async () => {
      await prisma.$disconnect();
    };
  }
});

router.get("/all/:status", async (req, res) => {
  const status = req.params.status;

  try {
    const results = await prisma.token.findMany({
      where: {
        tokenStatus: status.toUpperCase(),
      },
    });

    if (results != null) {
      return res.status(200).json(results);
    } else {
      throw new Error("No orders found with the specified status");
    }
  } catch (error) {
    console.log(error.message);
    return res.status(400).json({ message: error.message });
  } finally {
    async () => {
      await prisma.$disconnect();
    };
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
      await invalidateKeys([
        "tokens:all",
        `tokens:${result.mobileNumber}`,
        `token:${result.mobileNumber}`,
      ]);

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
    console.log(error.message);
    return res.status(400).json({ message: error.message });
  } finally {
    async () => {
      await prisma.$disconnect();
    };
  }
});

router.get("/:mobileId", async (req, res) => {
  const mobileNumber = req.params.mobileId;
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
  } finally {
    async () => {
      await prisma.$disconnect();
    };
  }
});

export default router;
