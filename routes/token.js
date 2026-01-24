import express from "express";
import { messaging } from "../lib/firebase.js";
import {
  fetchCached,
  prisma,
  generateUniqueCode,
  invalidateKeys,
} from "../middleware/redis.js";

const router = express.Router();

const sendPushNotification = async (token, title, body) => {
  if (!token) return;
  try {
    return await messaging.send({
      notification: { title, body },
      token: token,
    });
  } catch (err) {
    console.error("FCM Error:", err.message);
  }
};

const sendPushNotificationToTopic = async (topic, title, body) => {
  if (!token) return;
  try {
    return await messaging.send({
      notification: { title, body },
      topic: topic,
    });
  } catch (err) {
    console.error("FCM Error:", err.message);
  }
};

router.post("/create", async (req, res) => {
  const { mobileNumber, orderNumber, orderCode, fcmToken } = req.body;
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

    if (data != null && data.tokenStatus == "REQUESTED") {
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
        },
      });

      if (result) {
        await invalidateKeys([
          "tokens:all",
          `tokens:${mobileNumber}`,
          `token:${mobileNumber}`,
        ]);
        sendPushNotification(
          fcmToken,
          `Your TOKEN NUMBER : ${tokenCode}`,
          " The Token Number is valid for 48 hours only",
        );
        return res.status(200).json({
          token: result.tokenCode,
          message: "success",
        });
      }
    }
  } catch (error) {
    console.log(error.message);
    return res.status(400).json({ message: "Something went wrong !" });
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
        tokenStatus: status,
      },
    });

    if (result != null) {
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
  const mobileNumber = req.query.mobile;
  try {
    const result = await prisma.token.update({
      data: {
        tokenStatus: "ISSUED",
        receivedAt: new Date().toISOString(),
        quantity: Number(quantity),
      },
      where: {
        mobileNumber: mobileNumber,
        tokenCode: token,
      },
    });

    if (result) {
      await invalidateKeys([
        "tokens:all",
        `tokens:${mobileNumber}`,
        `token:${mobileNumber}`,
      ]);

      sendPushNotificationToTopic(
        `user_${mobileNumber}`,
        `Token Number ${token} Issued`,
        "Thank you for placing orders through our pickup point",
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

export default router;
