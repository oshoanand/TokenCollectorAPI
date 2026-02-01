import express from "express";
import { sendPushNotification } from "../lib/firebase.js";
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fetchCached, prisma, invalidateKeys } from "../middleware/redis.js";
import { createUploader } from "../utils/multer.js";
import { sendMessageToBot } from "../utils/telegram.js";

const router = express.Router();

const jobUpload = createUploader("jobs");
const jobProofUpload = createUploader("proof");

// ==========================================
// 1. CREATE JOB
// ==========================================

// router.post("/create", jobUpload.single("image"), async (req, res) => {
//   try {
//     // 1. Check if file exists
//     if (!req.file) {
//       return res.status(400).json({ message: "No image file provided" });
//     }

//     // 2. Extract text fields (req.body contains the text parts)
//     const { description, address, cost, mobile } = req.body;

//     // 3. Construct the image URL (accessible via static serve)
//     // Ensure you configure express.static to serve the 'uploads' folder
//     const imageUrl = `https://api.klinciti.ru/uploads/jobs/${req.file.filename}`;

//     const result = await prisma.job.create({
//       data: {
//         description: description,
//         location: address,
//         cost: cost,
//         jobPhoto: imageUrl,
//         postedById: mobile,
//       },
//     });

//     if (result) {
//       // --- CACHE INVALIDATION ---
//       // 1. Clear the main 'active' list so collectors see the new job immediately
//       // 2. Clear the 'posted' list for this specific user so their "My Jobs" updates

//       // Invalidate Cache
//       await invalidateKeys(["jobs:active", `jobs:postedBy:${mobile}`]);
//       console.log(`after redis keys valided`);

//       //Send FCM Push Notification to all the collectors
//       sendPushNotification(
//         "topic",
//         `Новая работа ! 🚛`,
//         `\uD83D\uDCCC Расположение : ${address} ${cost}₽ ${description.substring(0, 30)}`,
//         null,
//         process.env.COLLECTOR_FCM_TOPIC,
//       );

//       // Send message to Telegram Bot
//       sendMessageToBot(
//         "created",
//         "Опубликовано новое задание",
//         description,
//         address,
//         cost,
//       );
//     }
//     return res.status(200).json({ message: "Job created successfully" });
//   } catch (error) {
//     console.error("Error creating job:", error.message);
//     res.status(500).json({ message: "Server error" });
//   }
// });

router.post("/create", jobUpload.single("image"), async (req, res) => {
  // 1. Retrieve Socket IO Instance
  const io = req.app.get("socketio");

  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    const { description, address, cost, mobile } = req.body;
    const imageUrl = `https://api.klinciti.ru/uploads/jobs/${req.file.filename}`;

    const result = await prisma.job.create({
      data: {
        description: description,
        location: address,
        cost: cost,
        jobPhoto: imageUrl,
        postedById: mobile,
      },
    });

    if (result) {
      await invalidateKeys(["jobs:active", `jobs:postedBy:${mobile}`]);

      // --- NEW: EMIT SOCKET EVENT ---
      if (io) {
        io.emit("new_job", {
          type: "JOB", // Important for frontend to distinguish
          id: result.id,
          description: result.description,
          location: result.location,
          cost: result.cost,
          postedBy: result.postedById,
          createdAt: result.createdAt,
        });
        console.log(`📡 Socket Event emitted for Job: ${result.id}`);
      }

      // Existing FCM Logic...
      sendPushNotification(
        "topic",
        `Новая работа ! 🚛`,
        `\uD83D\uDCCC Расположение : ${address} ${cost}₽ ${description.substring(0, 30)}`,
        null,
        process.env.COLLECTOR_FCM_TOPIC,
      );

      // Existing Telegram Logic...
      sendMessageToBot(
        "created",
        "Опубликовано новое задание",
        description,
        address,
        cost,
      );
    }
    return res.status(200).json({ message: "Job created successfully" });
  } catch (error) {
    console.error("Error creating job:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ==========================================
// 2. GET OPEN JOBS (Cached) Used by Collector to see all available active jobs
// ==========================================

router.get("/open", async (req, res) => {
  try {
    // We use fetchCached wrapper.
    // Key: "jobs:open"
    // Query: The expensive Prisma findMany

    const jobs = await fetchCached("jobs", "active", async () => {
      return await prisma.job.findMany({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        include: {
          postedBy: {
            select: { image: true, name: true, mobile: true },
          },
        },
      });
    });

    if (jobs && jobs.length > 0) {
      return res.status(200).json(jobs);
    } else {
      // Return empty array instead of 500 error for empty state
      return res.status(200).json([]);
    }
  } catch (error) {
    console.error("Error fetching open jobs:", error.message);
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 3. GET VISITOR'S POSTED JOBS (Cached)
// ==========================================

router.get("/list", async (req, res) => {
  try {
    const userMobile = req.query.mobile;
    if (!userMobile)
      return res.status(400).json({ message: "Mobile number required" });

    // Key: "jobs:posted:+1234567890"
    // We use a prefix 'posted' to distinguish from other lists
    const cacheKeyId = `postedBy:${userMobile}`;

    const jobs = await fetchCached("jobs", cacheKeyId, async () => {
      return await prisma.job.findMany({
        where: { postedById: userMobile },
        orderBy: { createdAt: "desc" },
        include: {
          finishedBy: {
            select: { image: true, name: true, mobile: true },
          },
        },
      });
    });

    if (jobs && jobs.length > 0) {
      return res.status(200).json(jobs);
    } else {
      // Return empty array instead of 500 error for empty state
      return res.status(200).json([]);
    }
  } catch (error) {
    console.error("Error fetching jobs:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

// ==========================================
// 4. GET COLLECTOR'S HISTORY (Cached)
// ==========================================

router.get("/collector-list", async (req, res) => {
  try {
    const userMobile = req.query.mobile;
    if (!userMobile)
      return res.status(400).json({ message: "Mobile number required" });

    // Key: "jobs:collected:+1234567890"
    const cacheKeyId = `collectedBy:${userMobile}`;

    const jobs = await fetchCached("jobs", cacheKeyId, async () => {
      return await prisma.job.findMany({
        where: { finishedById: userMobile },
        orderBy: { finishedAt: "desc" },
        include: {
          postedBy: {
            select: { image: true, name: true, mobile: true },
          },
        },
      });
    });

    if (jobs && jobs.length > 0) {
      return res.status(200).json(jobs);
    } else {
      // Return empty array instead of 500 error for empty state
      return res.status(200).json([]);
    }
  } catch (error) {
    console.error("Error fetching jobs:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});
// ==========================================
// 5. DELETE JOB
// ==========================================
router.delete("/:id", async (req, res) => {
  try {
    const jobId = Number(req.params.id);

    // 1. Fetch job first to check status and owner
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.status === "ACTIVE") {
      // 2. Delete from DB
      await prisma.job.delete({ where: { id: jobId } });

      // 3. Delete Local File (Async - don't block response)
      if (job.jobPhoto) {
        const filename = job.jobPhoto.split("/").pop();
        const filePath = path.join(process.cwd(), "uploads/jobs", filename); // Use process.cwd() for reliability
        fs.unlink(filePath, (err) => {
          if (err) console.error("File delete error", err);
        });
      }

      // --- CACHE INVALIDATION ---
      // Removing an active job affects the 'active' list and the 'posted' list of that user
      await invalidateKeys([`jobs:active`, `jobs:postedBy:${job.postedById}`]);

      return res.status(200).json({ message: "Job deleted successfully" });
    } else {
      return res.status(400).json({
        message: "Cannot delete job. It is already taken or completed.",
      });
    }
  } catch (error) {
    console.error("Error deleting job:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ==========================================
// 6. COMPLETE JOB
// ==========================================
router.post("/complete", jobProofUpload.single("proof"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "Proof image is required." });

    const { job_id, mobile } = req.body; // mobile = COLLECTOR
    if (!job_id)
      return res.status(400).json({ message: "Job ID is required." });

    const proofUrl = `${req.protocol}://${req.get("host")}/uploads/proof/${req.file.filename}`;

    // Update DB
    const updatedJob = await prisma.job.update({
      where: { id: Number(job_id) },
      data: {
        status: "PAYMENT_REQUIRED",
        jobPhotoDone: proofUrl,
        finishedAt: new Date(),
        finishedById: mobile,
      },
      include: {
        postedBy: { select: { mobile: true } }, // Need this for notification AND cache invalidation
      },
    });

    // --- CACHE INVALIDATION ---
    // 1. Job is no longer "Active/Open" -> Clear jobs:open
    // 2. Job status changed for the Poster -> Clear jobs:posted:<poster_mobile>
    // 3. Job added to Collector's history -> Clear jobs:collected:<collector_mobile>
    await invalidateKeys([
      `jobs:active`,
      `jobs:postedBy:${updatedJob.postedBy.mobile}`,
      `jobs:collectedBy:${mobile}`,
    ]);

    // Send Notification
    if (updatedJob.postedBy?.mobile) {
      const posterTopic = `user_${updatedJob.postedBy.mobile}`;
      try {
        sendPushNotification(
          "topic",
          `Работа выполнена! ${updatedJob.location} ✅`,
          `Пожалуйста, проверьте подтверждение и произведите оплату в размере ${updatedJob.cost} рублей`,
          null,
          posterTopic,
        );
      } catch (err) {
        console.error("FCM Error", err);
      }

      sendMessageToBot(
        "",
        "Задача выполнена. Ожидание оплаты",
        updatedJob.description,
        updatedJob.location,
        updatedJob.cost,
      );
    }

    return res.status(200).json({
      message: "Job completed. Waiting for payment.",
      proofUrl: proofUrl,
    });
  } catch (error) {
    console.error("Error completing job:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ==========================================
// 7. All Jobs
// ==========================================
router.get("/all-jobs", async (req, res) => {
  try {
    // 1. Get query params with defaults
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 2. Create a cache key that includes pagination params
    // Note: If you have high write volume, caching paginated lists can be tricky.
    // If you need real-time accuracy, you might remove caching here.
    const cacheKey = `jobs_p${page}_l${limit}`;

    const result = await fetchCached("jobs", cacheKey, async () => {
      // Run two queries in transaction: Count total & Fetch data
      const [total, jobs] = await prisma.$transaction([
        prisma.job.count(),
        prisma.job.findMany({
          skip: skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            postedBy: {
              select: { image: true, name: true, mobile: true },
            },
            finishedBy: {
              select: { image: true, name: true, mobile: true },
            },
          },
        }),
      ]);

      return {
        data: jobs,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching jobs:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
