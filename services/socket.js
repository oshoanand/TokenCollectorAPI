import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { redis, pubClient, subClient } from "./redis.js";
import prisma from "../utils/prisma.js";

export const initializeSocket = (httpServer, allowedDomains) => {
  const io = new Server(httpServer, {
    cors: {
      origin: allowedDomains,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.adapter(createAdapter(pubClient, subClient));

  io.on("connection", (socket) => {
    console.log(`🔌 Client Connected: ${socket.id}`);

    // ==========================================
    // 🟢 REAL-TIME PRESENCE (Updated)
    // ==========================================
    socket.on("user_connected", async (data) => {
      // Defensive check: Handle both raw string "id123" and object { userId: "id123" }
      let userId = typeof data === "object" ? data.userId : data;

      if (!userId) {
        console.log("❌ Socket connected but no userId provided");
        return;
      }

      socket.userId = userId.toString();
      const personalRoom = `user_${userId}`;
      socket.join(personalRoom);

      try {
        // Save to Redis as a string for consistency
        await redis.sadd("online_users", userId.toString());

        // Broadcast to EVERYONE (including Admin) that this user is online
        io.emit("user_status_changed", {
          userId: userId.toString(),
          isOnline: true,
        });

        console.log(`👤 User Online: ${userId} (Socket: ${socket.id})`);
      } catch (error) {
        console.error("Redis Error:", error);
      }
    });

    // ==========================================
    // 💬 UNIVERSAL CHAT MESSAGE ROUTING
    // ==========================================
    socket.on("send_message", async (data) => {
      console.log("\n🚀 --- INCOMING MESSAGE REQUEST ---");

      // Defensive Parsing
      let parsedData = data;
      if (typeof data === "string") {
        try {
          parsedData = JSON.parse(data);
        } catch (e) {
          console.log("❌ Failed to parse string data");
          return;
        }
      }

      // FIX: Use parsedData consistently
      const { senderId, receiverId, text, tempId } = parsedData;

      if (!senderId || !receiverId || !text) {
        console.log("❌ ERROR: Missing required fields!");
        return;
      }

      try {
        const [user1Id, user2Id] = [senderId, receiverId].sort();

        // 1. Manage the Session
        const session = await prisma.chatSession.upsert({
          where: { user1Id_user2Id: { user1Id, user2Id } },
          update: { status: "OPEN", updatedAt: new Date() },
          create: { user1Id, user2Id, status: "OPEN" },
        });

        // 2. Save Message
        const savedMessage = await prisma.chatMessage.create({
          data: {
            chatSessionId: session.id,
            senderId: senderId,
            text: text,
            isRead: false,
          },
        });

        console.log("✅ Message saved to DB.");

        // 3. ACKNOWLEDGEMENT (For the sender's Optimistic UI)
        // We send back the tempId so the frontend can replace the 'pending' bubble
        socket.emit("message_confirmed", {
          tempId: tempId, // Use tempId from parsedData
          message: savedMessage,
        });

        // 4. BROADCAST (To both users for multi-device sync)
        // We include tempId in the broadcast so Admin Panel's 'exists' check works
        const broadcastPayload = {
          ...savedMessage,
          tempId: tempId || null,
        };

        io.to(`user_${receiverId}`)
          .to(`user_${senderId}`)
          .emit("receive_message", broadcastPayload);
      } catch (error) {
        console.error("❌ PRISMA DATABASE ERROR:", error);
      }
    });

    // ==========================================
    // ✍️ TYPING INDICATORS
    // ==========================================

    socket.on("typing", ({ senderId, receiverId }) => {
      io.to(`user_${receiverId}`).emit("user_typing", { senderId });
    });

    socket.on("stop_typing", ({ senderId, receiverId }) => {
      io.to(`user_${receiverId}`).emit("user_stopped_typing", { senderId });
    });

    // socket.on("typing", (data) => {
    //   const { senderId, receiverId } =
    //     typeof data === "string" ? JSON.parse(data) : data;
    //   io.to(`user_${receiverId}`).emit("user_typing", { userId: senderId });
    // });

    // socket.on("stop_typing", (data) => {
    //   const { senderId, receiverId } =
    //     typeof data === "string" ? JSON.parse(data) : data;
    //   io.to(`user_${receiverId}`).emit("user_stopped_typing", {
    //     userId: senderId,
    //   });
    // });

    // ==========================================
    // ✔️✔ READ RECEIPTS
    // ==========================================

    // Inside your socket handler
    // socket.on(
    //   "mark_messages_read",
    //   async ({ sessionId, userId, partnerId }) => {
    //     try {
    //       // 1. Update database: Mark all messages in this session NOT sent by this user as read
    //       await prisma.chatMessage.updateMany({
    //         where: {
    //           chatSessionId: sessionId,
    //           senderId: partnerId, // Messages from the other person
    //           isRead: false,
    //         },
    //         data: {
    //           isRead: true,
    //           readAt: new Date(),
    //         },
    //       });

    //       // 2. Notify the partner that their messages were read
    //       io.to(`user_${partnerId}`).emit("messages_read_by_recipient", {
    //         sessionId,
    //         readAt: new Date(),
    //       });
    //     } catch (error) {
    //       console.error("Read receipt error:", error);
    //     }
    //   },
    // );

    socket.on("mark_messages_read", async (data) => {
      const { readerId, senderId } =
        typeof data === "string" ? JSON.parse(data) : data;
      if (!readerId || !senderId) return;

      try {
        const [user1Id, user2Id] = [readerId, senderId].sort();
        const now = new Date();

        const session = await prisma.chatSession.findUnique({
          where: { user1Id_user2Id: { user1Id, user2Id } },
        });

        if (session) {
          await prisma.chatMessage.updateMany({
            where: {
              chatSessionId: session.id,
              senderId: senderId,
              isRead: false,
            },
            data: {
              isRead: true,
              readAt: now,
            },
          });

          io.to(`user_${senderId}`).emit("messages_read_by_recipient", {
            readerId: readerId,
            readAt: now.toISOString(),
          });

          // Sync the reader's other devices (e.g. tablet and phone)
          socket.emit("read_status_synced", { partnerId: senderId });
        }
      } catch (error) {
        console.error("Error marking read:", error);
      }
    });

    // ==========================================
    // 🔴 DISCONNECT
    // ==========================================
    socket.on("disconnect", async () => {
      if (socket.userId) {
        try {
          await redis.srem("online_users", socket.userId.toString());
          io.emit("user_status_changed", {
            userId: socket.userId.toString(),
            isOnline: false,
          });
        } catch (error) {
          console.error("Redis Error on disconnect:", error);
        }
      }
    });
  });

  return io;
};
