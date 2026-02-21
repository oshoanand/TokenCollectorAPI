import express from "express";
import prisma from "../utils/prisma.js";
import { redis } from "../services/redis.js";

const router = express.Router();

/**
 * 1. GET ALL CHAT SESSIONS (Universal Inbox)
 * Endpoint: GET /api/chat/sessions?userId=xyz
 * Used by: Android App & Next.js Admin Panel Sidebar
 */

router.get("/sessions", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId required" });

  try {
    // 1. Fetch the list of online user IDs from Redis first
    const onlineUsers = await redis.smembers("online_users");

    const sessions = await prisma.chatSession.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      include: {
        user1: {
          select: {
            id: true,
            name: true,
            userRole: true,
            mobile: true,
            email: true,
          },
        },
        user2: {
          select: {
            id: true,
            name: true,
            userRole: true,
            mobile: true,
            email: true,
          },
        },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: {
          select: {
            messages: {
              where: { isRead: false, senderId: { not: userId } },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const formattedSessions = sessions.map((session) => {
      const partner =
        session.user1Id === userId ? session.user2 : session.user1;
      const lastMessage = session.messages[0];

      // 2. Check if the partner's ID exists in the Redis onlineUsers set
      const isOnline = onlineUsers.includes(partner.id.toString());

      return {
        // --- DTO for Android Compatibility ---
        collectorId: partner.id,
        collectorName: partner.name,
        collectorRole: partner.userRole,
        collectorProfileImage: null,
        lastMessage: lastMessage ? lastMessage.text : "No messages yet",
        lastMessageTime: lastMessage
          ? lastMessage.createdAt.toISOString()
          : session.createdAt.toISOString(),
        unreadCount: session._count.messages,
        isOnline: isOnline, // <--- Add this for Android "Green Dot"

        // --- DTO for Next.js Admin Compatibility ---
        userId: partner.id,
        user: {
          ...partner,
          isOnline: isOnline, // <--- Add this for Admin "Online" status
        },
      };
    });

    res.status(200).json(formattedSessions);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ message: "Failed to fetch chat sessions" });
  }
});
/**
 * 2. GET CHAT HISTORY BETWEEN TWO USERS
 * Endpoint: GET /api/chat/history?userId1=xyz&userId2=abc
 */
router.get("/history", async (req, res) => {
  const { userId1, userId2 } = req.query;

  if (!userId1 || !userId2) {
    return res.status(400).json({ message: "userId1 and userId2 required" });
  }

  try {
    const [user1Id, user2Id] = [userId1, userId2].sort();

    const session = await prisma.chatSession.findUnique({
      where: { user1Id_user2Id: { user1Id, user2Id } },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    res.status(200).json(session ? session.messages : []);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/chat/unread-count?userId=123
router.get("/unread-count", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ message: "userId is required" });
  }

  try {
    // Count all messages where:
    // 1. The user is a participant in the session
    // 2. The user is NOT the sender
    // 3. isRead is false
    const unreadCount = await prisma.chatMessage.count({
      where: {
        session: {
          OR: [{ user1Id: userId }, { user2Id: userId }],
        },
        senderId: { not: userId },
        isRead: false,
      },
    });

    res.status(200).json({ totalUnread: unreadCount });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * 4. MARK MESSAGES AS READ (REST API Fallback)
 * Endpoint: PUT /api/chat/mark-read
 * Body: { visitorId: "xyz", collectorId: "abc", currentUserId: "xyz" }
 */
router.put("/mark-read", async (req, res) => {
  const { visitorId, collectorId, currentUserId } = req.body;
  if (!visitorId || !collectorId || !currentUserId) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  // Treat visitorId and collectorId just as generic user1 and user2
  const [user1Id, user2Id] = [visitorId, collectorId].sort();

  try {
    const session = await prisma.chatSession.findUnique({
      where: { user1Id_user2Id: { user1Id, user2Id } },
    });

    if (!session) return res.status(404).json({ message: "Session not found" });

    await prisma.chatMessage.updateMany({
      where: {
        chatSessionId: session.id,
        senderId: { not: currentUserId },
        isRead: false,
      },
      data: { isRead: true },
    });

    res.status(200).json({ success: true, message: "Marked as read" });
  } catch (error) {
    console.error("Error marking read:", error);
    res.status(500).json({ message: "Failed to mark chat as read" });
  }
});

/**
 * 5. GET ONLINE USERS
 * Endpoint: GET /api/chat/online
 */
router.get("/online", async (req, res) => {
  try {
    const onlineUsers = await redis.smembers("online_users");
    res.json(onlineUsers); // Kept as strings for CUID compatibility
  } catch (error) {
    res.json([]);
  }
});

/**
 * 6. RESOLVE TICKET (Admin Only)
 * Endpoint: PUT /api/chat/admin/resolve/:userId
 */
router.put("/admin/resolve/:userId", async (req, res) => {
  // Logic here to update status to RESOLVED
  res.status(200).json({ success: true, message: "Ticket closed" });
});

export default router;
