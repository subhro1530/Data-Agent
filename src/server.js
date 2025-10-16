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

// Additional API health route with DB check
app.get("/api/health", async (req, res) => {
  const started = Date.now();
  try {
    const nowRes = await db.query("select now() as now");
    const verRes = await db.query("select version() as version");
    return res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.round(process.uptime()),
      db: {
        status: "ok",
        now: nowRes.rows[0]?.now,
        version: verRes.rows[0]?.version,
        latency_ms: Date.now() - started,
      },
    });
  } catch (e) {
    return res.status(503).json({
      status: "degraded",
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.round(process.uptime()),
      db: {
        status: "failed",
        error: e.message,
      },
    });
  }
});

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
