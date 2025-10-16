const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMiddleware");
const fileController = require("../controllers/fileController");

// POST /api/upload
router.post("/upload", upload.single("file"), fileController.upload);

// GET /api/logs
router.get("/logs", fileController.list);

// GET /api/logs/:id
router.get("/logs/:id", fileController.detail);

// On-demand summarize (support both POST and GET for convenience)
router.post("/logs/:id/summarize", fileController.summarizeNow);
router.get("/logs/:id/summarize", fileController.summarizeNow);

// Delete a record
router.delete("/logs/:id", fileController.remove);

module.exports = router;
