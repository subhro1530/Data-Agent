const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

const allowedExts = new Set([".csv", ".json", ".txt", ".log"]);
const allowedMimes = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.ms-excel",
]);

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const ok = allowedExts.has(ext) || allowedMimes.has(file.mimetype);
  if (!ok)
    return cb(new Error("Unsupported file type. Allowed: CSV, JSON, TXT, LOG"));
  cb(null, true);
};

module.exports = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter,
});
