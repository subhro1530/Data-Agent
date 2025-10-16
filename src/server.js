require("dotenv").config();
const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const db = require("./db/db");

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// API routes
app.use("/api", routes);

// Global error handler
app.use((err, req, res, next) => {
  console.error("[ERROR]", err);
  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: err.message || "Internal Server Error",
    },
  });
});

// Start server after DB init
const PORT = process.env.PORT || 8080;
(async () => {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`AI Data Agent listening on port ${PORT}`);
    });
  } catch (e) {
    console.error("Failed to initialize database:", e);
    process.exit(1);
  }
})();
