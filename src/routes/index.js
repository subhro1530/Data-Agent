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

module.exports = router;
