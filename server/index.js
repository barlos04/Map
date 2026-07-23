const path = require("path");
const express = require("express");
const engine = require("./engine");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- API ---

app.get("/api/health", (req, res) => {
  res.json({ ok: true, storage: db.hasDb ? "postgres" : "memory" });
});

app.get("/api/config", (req, res) => {
  res.json(engine.getConfig());
});

app.post("/api/estimate", async (req, res) => {
  try {
    const input = req.body || {};
    const calibration = await db
      .getCalibration(input.industry, input.projectType, input.workspace)
      .catch(() => null);
    const result = engine.estimate(input, calibration);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/actuals", async (req, res) => {
  try {
    const { workspace, industry, projectType, estimatedHours, actualHours, notes } = req.body || {};
    if (!industry || !projectType || !estimatedHours || !actualHours) {
      return res.status(400).json({
        error: "industry, projectType, estimatedHours and actualHours are required"
      });
    }
    const row = await db.logActual({ workspace, industry, projectType, estimatedHours, actualHours, notes });
    const calibration = await db.getCalibration(industry, projectType, workspace);
    res.json({ saved: row, calibration });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/actuals", async (req, res) => {
  try {
    res.json(await db.listActuals());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Static client ---

const dist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(dist, "index.html"));
});

db.init()
  .then((info) => {
    app.listen(PORT, () => {
      console.log(`HourMap running on port ${PORT} (storage: ${info.mode})`);
    });
  })
  .catch((err) => {
    console.error("Database init failed, starting with in-memory storage:", err.message);
    app.listen(PORT, () => console.log(`HourMap running on port ${PORT} (storage: memory)`));
  });
