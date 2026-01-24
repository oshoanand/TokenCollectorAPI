import express from "express";
import { messaging } from "../lib/firebase.js";
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fetchCached, prisma, invalidateKeys } from "../middleware/redis.js";
import multer from "multer";

const router = express.Router();

// Multer Configuration ---
// Define where to save the uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure this directory exists or create it
    const uploadDir = "uploads/jobs/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create a unique filename: fieldname-timestamp.jpg
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

// Initialize multer
const upload = multer({ storage: storage });

const sendPushNotificationToTopic = async (topic, title, body, data) => {
  const message = {
    notification: {
      title: title,
      body: body,
    },
    data: data,
    topic: topic,
  };

  return await messaging.send(message);
};

// ==========================================
// 1. CREATE JOB
// ==========================================

router.post("/create", upload.single("image"), async (req, res) => {
  try {
    // 1. Check if file exists
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    // 2. Extract text fields (req.body contains the text parts)
    const { description, address, cost, mobile } = req.body;

    // 3. Construct the image URL (accessible via static serve)
    // Ensure you configure express.static to serve the 'uploads' folder
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/jobs/${
      req.file.filename
    }`;

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
      // --- CACHE INVALIDATION ---
      // 1. Clear the main 'open' list so collectors see the new job immediately
      // 2. Clear the 'posted' list for this specific user so their "My Jobs" updates
      await invalidateKeys([`jobs:open`, `jobs:posted:${mobile}`]);

      // Send Notification
      await sendPushNotificationToTopic(
        process.env.COLLECTOR_FCM_TOPIC,
        "New Job Available! 🚛",
        `${cost} ₽ - \uD83D\uDCCC Location : ${address} - ${description.substring(0, 30)}`,
        {
          type: "NEW_JOB",
          jobId: String(result.id),
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
      );
    }
    return res.status(200).json({ message: "Job created successfully" });
  } catch (error) {
    console.error("Error creating job:", error.message);
    res.status(500).json({ message: "Server error" });
  } finally {
    async () => {
      await prisma.$disconnect();
    };
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

    const jobs = await fetchCached("jobs", "open", async () => {
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
  } finally {
    async () => {
      await prisma.$disconnect();
    };
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
    const cacheKeyId = `posted:${userMobile}`;

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
  } finally {
    async () => {
      await prisma.$disconnect();
    };
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
    const cacheKeyId = `collected:${userMobile}`;

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
  } finally {
    async () => {
      await prisma.$disconnect();
    };
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
      // Removing an active job affects the 'open' list and the 'posted' list of that user
      await invalidateKeys([`jobs:open`, `jobs:posted:${job.postedById}`]);

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
router.post("/complete", upload.single("proof"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "Proof image is required." });

    const { job_id, mobile } = req.body; // mobile = COLLECTOR
    if (!job_id)
      return res.status(400).json({ message: "Job ID is required." });

    const proofUrl = `${req.protocol}://${req.get("host")}/uploads/jobs/${req.file.filename}`;

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
      `jobs:open`,
      `jobs:posted:${updatedJob.postedBy.mobile}`,
      `jobs:collected:${mobile}`,
    ]);

    // Send Notification
    if (updatedJob.postedBy?.mobile) {
      const posterTopic = `user_${updatedJob.postedBy.mobile}`;
      try {
        await sendPushNotificationToTopic(
          posterTopic,
          "Job Completed! ✅",
          `Job #${job_id} is done. Please check the proof and release payment`,
          {
            jobId: String(job_id),
            type: "PAYMENT_REQUIRED",
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          },
        );
      } catch (err) {
        console.error("FCM Error", err);
      }
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

export default router;
