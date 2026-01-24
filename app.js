import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import authRoutes from "./routes/auth.js";
import jobRoutes from "./routes/jobs.js";
import userRoutes from "./routes/user.js";
import tokenRoutes from "./routes/token.js";

import setupTTL from "./utils/ttl-service.js";
import { connectRedis } from "./middleware/redis.js";

dotenv.config();

// 1. Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initializeExpressServer() {
  const app = express();
  app.use(express.json());
  // app.use(express.static("uploads"));

  // Serve Static Files
  // This makes http://localhost:8800/uploads/image.jpg accessible
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // 1. Initialize the TTL Cron Job
  setupTTL();

  // Middleware for logging
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

  let allowedDomains = ["http://localhost:3000"];
  app.use(
    cors({
      origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedDomains.indexOf(origin) === -1) {
          var msg = `This site ${origin} does not have an access. Only specific domains are allowed to access it.`;
          return callback(new Error(msg), false);
        }
        return callback(null, true);
      },
    }),
  );

  // connect to Redis
  await connectRedis();
  app.use("/api/auth", authRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/token", tokenRoutes);

  const PORT = process.env.PORT || 8800;
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

initializeExpressServer()
  .then()
  .catch((e) => console.error(e));
