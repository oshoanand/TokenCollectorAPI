// import multer from "multer";
// import path from "path";
// import fs from "fs";

// /**
//  * Creates a Multer middleware instance for a specific folder.
//  * @param {string} subfolder - The subfolder inside 'uploads/' (e.g., 'profiles', 'supports')
//  * @returns {multer.Multer} - The configured multer instance
//  */
// export const createUploader = (subfolder) => {
//   // 1. Define storage within the function scope so it captures 'subfolder'
//   const storage = multer.diskStorage({
//     destination: function (req, file, cb) {
//       // Robust path handling using path.join
//       const uploadDir = path.join("uploads", subfolder);

//       // Check if directory exists, if not create it (recursive: true handles nested folders)
//       if (!fs.existsSync(uploadDir)) {
//         fs.mkdirSync(uploadDir, { recursive: true });
//       }

//       cb(null, uploadDir);
//     },
//     filename: function (req, file, cb) {
//       // Your unique naming logic
//       const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
//       const ext = path.extname(file.originalname);
//       cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
//     },
//   });

//   // 2. Return the multer instance
//   return multer({ storage: storage });
// };

import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp"; // Industry standard for high-performance image processing

// Helper to ensure directories exist safely
const ensureDirectoryExistence = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * 1. STANDARD UPLOADER (Disk Storage)
 * Use this for general files (PDFs, docs) where compression isn't needed.
 * Includes safety limits and MIME type filtering.
 */
export const createUploader = (subfolder, maxSizeMB = 5) => {
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      // Use process.cwd() and "public" to ensure it's accessible via HTTP later
      const uploadDir = path.join(process.cwd(), "uploads", subfolder);

      ensureDirectoryExistence(uploadDir);
      cb(null, uploadDir);
    },

    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  });

  return multer({
    storage: storage,
    limits: { fileSize: maxSizeMB * 1024 * 1024 }, // Enforce size limit
    fileFilter: (req, file, cb) => {
      // Strict MIME type check prevents malicious scripts disguised as images
      const allowedMimeTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/gif",
      ];
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new Error(
            "Invalid file type. Only JPEG, PNG, WEBP, and GIF are allowed.",
          ),
        );
      }
    },
  });
};

/**
 * 2. COMPRESSION UPLOADER (Memory Storage)
 * Keeps the file in RAM temporarily so we can compress it before saving to disk.
 */
export const uploadToMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Max 10MB into RAM before compression
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed for compression."));
    }
  },
});

/**
 * 3. COMPRESSION MIDDLEWARE
 * Takes the file from RAM, resizes it, converts to WebP, and saves to disk.
 */
export const compressAndSaveImage = (subfolder) => {
  return async (req, res, next) => {
    if (!req.file) return next(); // Skip if no file was uploaded

    try {
      const uploadDir = path.join(
        process.cwd(),
        "public",
        "uploads",
        subfolder,
      );
      ensureDirectoryExistence(uploadDir);

      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      // We convert everything to .webp for the absolute best performance/quality ratio in chat apps
      const filename = `img-${uniqueSuffix}.webp`;
      const filepath = path.join(uploadDir, filename);

      // Execute compression
      await sharp(req.file.buffer)
        .resize({ width: 1080, withoutEnlargement: true }) // Prevent scaling up small images
        .webp({ quality: 80 }) // 80% quality drops file size by ~70% with no visible loss
        .toFile(filepath);

      // Reassign properties so the route handler thinks it was uploaded directly
      req.file.filename = filename;
      req.file.path = filepath;
      req.file.mimetype = "image/webp";

      next();
    } catch (error) {
      console.error("Image compression error:", error);
      next(new Error("Failed to process and compress image."));
    }
  };
};
