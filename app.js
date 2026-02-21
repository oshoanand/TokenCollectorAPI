// import express from "express";
// import http from "http"; // 1. Import HTTP module
// import { Server } from "socket.io"; // 2. Import Socket.io
// import dotenv from "dotenv";
// import cors from "cors";
// import path from "path";
// import { fileURLToPath } from "url";
// import { dirname } from "path";

// // Routes
// import authRoutes from "./routes/auth.js";
// import jobRoutes from "./routes/jobs.js";
// import userRoutes from "./routes/user.js";
// import tokenRoutes from "./routes/token.js";
// import adminRoutes from "./routes/admin.js";
// import notificationRoutes from "./routes/notification.js";
// import supportRoutes from "./routes/support.js";
// import fcmRoutes from "./routes/fcm.js";

// // Services
// //import setupTTL from "./utils/ttl-service.js";
// import { connectRedis } from "./middleware/redis.js";

// dotenv.config();

// // Recreate __dirname for ES Modules
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// async function initializeExpressServer() {
//   const app = express();

//   // 3. Create HTTP Server explicitly (Required for Socket.io)
//   const server = http.createServer(app);

//   // 4. Define Allowed Domains (Shared between Express and Socket.io)
//   const allowedDomains = [
//     "http://localhost:3000",
//     "http://localhost:5000",
//     process.env.WEB_APP_URL,
//     process.env.ADMIN_PANEL_URL, // Add your production admin URL in .env
//   ].filter(Boolean); // Removes undefined if env is missing

//   // 5. Initialize Socket.io
//   const io = new Server(server, {
//     cors: {
//       origin: allowedDomains, // Socket.io needs explicit origins
//       methods: ["GET", "POST"],
//       credentials: true,
//     },
//   });

//   // 6. Make 'io' accessible in routes via req.app.get('socketio')
//   app.set("socketio", io);

//   // Socket Connection Logic
//   io.on("connection", (socket) => {
//     console.log(`🔌 Admin Connected: ${socket.id}`);

//     socket.on("disconnect", () => {
//       console.log(`❌ Admin Disconnected: ${socket.id}`);
//     });
//   });

//   // --- Express Middleware ---

//   app.use(express.json());

//   // Serve Static Files
//   app.use("/uploads", express.static(path.join(__dirname, "uploads")));

//   // Initialize TTL Service
//   // setupTTL();

//   // Logging Middleware
//   app.use((req, res, next) => {
//     console.log(`${req.method} : ${req.path}`);
//     next();
//   });

//   app.use(
//     express.urlencoded({
//       parameterLimit: 100000,
//       limit: "50mb",
//       extended: true,
//     }),
//   );

//   // Express CORS Setup (Using the shared allowedDomains)
//   app.use(
//     cors({
//       origin: function (origin, callback) {
//         // Allow requests with no origin (like mobile apps or curl requests)
//         if (!origin) return callback(null, true);

//         if (allowedDomains.indexOf(origin) === -1) {
//           const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
//           return callback(new Error(msg), false);
//         }
//         return callback(null, true);
//       },
//       credentials: true,
//     }),
//   );

//   // --- Database & Routes ---

//   // Connect to Redis BEFORE mounting routes
//   await connectRedis();

//   app.use("/api/auth", authRoutes);
//   app.use("/api/jobs", jobRoutes);
//   app.use("/api/user", userRoutes);
//   app.use("/api/token", tokenRoutes);
//   app.use("/api/admin", adminRoutes);
//   app.use("/api/notifications", notificationRoutes);
//   app.use("/api/support", supportRoutes);
//   app.use("/api/fcm", fcmRoutes);

//   // --- Server Start ---

//   const PORT = process.env.PORT || 8800;

//   // 7. LISTEN on 'server', NOT 'app'
//   server.listen(PORT, () => {
//     console.log(`🚀 Server running on http://localhost:${PORT}`);
//     console.log(`📡 Socket.io initialized for Admin Panel`);
//   });
// }

// initializeExpressServer()
//   .then()
//   .catch((e) => {
//     console.error("❌ Failed to start server:", e);
//     process.exit(1);
//   });

import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Routes
import authRoutes from "./routes/auth.js";
import jobRoutes from "./routes/jobs.js";
import userRoutes from "./routes/user.js";
import tokenRoutes from "./routes/token.js";
import adminRoutes from "./routes/admin.js";
import notificationRoutes from "./routes/notification.js";
import supportRoutes from "./routes/support.js";
import fcmRoutes from "./routes/fcm.js";
import chatRoutes from "./routes/chat.js";

// Services
import { connectRedis } from "./services/redis.js"; // Adjust path if you moved this to /services
import { initializeSocket } from "./services/socket.js";

dotenv.config();

// Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initializeExpressServer() {
  const app = express();

  // 1. Create HTTP Server explicitly (Required for Socket.io)
  const server = http.createServer(app);

  // 2. Define Allowed Domains (Shared between Express and Socket.io)
  const allowedDomains = [
    "http://localhost:3000",
    "http://localhost:5000",
    process.env.WEB_APP_URL,
    process.env.ADMIN_PANEL_URL, // Add your production admin URL in .env
  ].filter(Boolean); // Removes undefined if env is missing

  // --- Initialize External Services ---

  // 3. Connect Redis (Main Cache & Pub/Sub)
  await connectRedis();

  // 4. Initialize Socket.io with Redis Adapter
  const io = initializeSocket(server, allowedDomains);

  // 5. Make 'io' accessible in routes via req.app.get('socketio')
  // This allows you to trigger socket events from your standard Express REST controllers
  app.set("socketio", io);

  // --- Express Middleware ---

  app.use(express.json());

  // Serve Static Files
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // Logging Middleware
  app.use((req, res, next) => {
    console.log(`${req.method} : ${req.path}`);
    next();
  });

  app.use(
    express.urlencoded({
      parameterLimit: 100000,
      limit: "50mb",
      extended: true,
    }),
  );

  // Express CORS Setup (Using the shared allowedDomains)
  app.use(
    cors({
      origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedDomains.indexOf(origin) === -1) {
          const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
          return callback(new Error(msg), false);
        }
        return callback(null, true);
      },
      credentials: true,
    }),
  );

  // --- Database & Routes ---

  app.use("/api/auth", authRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/token", tokenRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/support", supportRoutes);
  app.use("/api/fcm", fcmRoutes);
  app.use("/api/chat", chatRoutes);

  // --- Server Start ---

  const PORT = process.env.PORT || 8800;

  // LISTEN on 'server' (HTTP), NOT 'app' (Express) to ensure WebSockets work
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on ${PORT}`);
    console.log(`📡 Socket.io initialized for Live Chat & Admin Panel`);
  });
}

initializeExpressServer()
  .then()
  .catch((e) => {
    console.error("❌ Failed to start server:", e);
    process.exit(1);
  });
