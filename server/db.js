/**
 * Actuals storage. Uses Postgres when DATABASE_URL is present (Railway
 * provisions this automatically when you add a Postgres service). Falls back
 * to an in-memory store locally so the app runs with zero setup — estimates
 * always work; only calibration persistence needs the database.
 */

const hasDb = !!process.env.DATABASE_URL;
let pool = null;
const memory = [];

async function init() {
  if (!hasDb) return { mode: "memory" };
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS actuals (
      id SERIAL PRIMARY KEY,
      workspace TEXT NOT NULL DEFAULT 'default',
      industry TEXT NOT NULL,
      project_type TEXT NOT NULL,
      estimated_hours NUMERIC NOT NULL,
      actual_hours NUMERIC NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  // Safe upgrade path for deployments created before workspaces existed.
  await pool.query(`ALTER TABLE actuals ADD COLUMN IF NOT EXISTS workspace TEXT NOT NULL DEFAULT 'default'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS actuals_scope_idx ON actuals (workspace, industry, project_type)`);
  return { mode: "postgres" };
}

function normalizeWorkspace(w) {
  return (w || "default").toString().trim().toLowerCase().slice(0, 60) || "default";
}

async function logActual({ workspace, industry, projectType, estimatedHours, actualHours, notes }) {
  const ws = normalizeWorkspace(workspace);
  if (pool) {
    const res = await pool.query(
      `INSERT INTO actuals (workspace, industry, project_type, estimated_hours, actual_hours, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [ws, industry, projectType, estimatedHours, actualHours, notes || null]
    );
    return res.rows[0];
  }
  const row = {
    id: memory.length + 1,
    workspace: ws,
    industry,
    project_type: projectType,
    estimated_hours: estimatedHours,
    actual_hours: actualHours,
    notes: notes || null,
    created_at: new Date().toISOString()
  };
  memory.push(row);
  return row;
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function fetchRatios(industry, projectType, workspace) {
  let rows;
  if (pool) {
    const params = [industry, projectType];
    let where = `industry = $1 AND project_type = $2`;
    if (workspace) {
      params.push(workspace);
      where += ` AND workspace = $3`;
    }
    const res = await pool.query(
      `SELECT estimated_hours, actual_hours FROM actuals
       WHERE ${where} ORDER BY created_at DESC LIMIT 50`,
      params
    );
    rows = res.rows;
  } else {
    rows = memory.filter(
      (r) =>
        r.industry === industry &&
        r.project_type === projectType &&
        (!workspace || r.workspace === workspace)
    );
  }
  return rows
    .map((r) => Number(r.actual_hours) / Number(r.estimated_hours))
    .filter((x) => isFinite(x) && x > 0);
}

/**
 * Median actual/estimated ratio for one industry + project type.
 * Firm-scoped first; if the firm has fewer than 3 logged projects, fall back
 * to the pooled cross-firm data so new workspaces never cold-start.
 */
async function getCalibration(industry, projectType, workspace) {
  const ws = normalizeWorkspace(workspace);
  const own = await fetchRatios(industry, projectType, ws);
  if (own.length >= 3) {
    return { ratio: median(own), count: own.length, scope: "workspace" };
  }
  const pooled = await fetchRatios(industry, projectType, null);
  if (pooled.length === 0) return null;
  return { ratio: median(pooled), count: pooled.length, scope: "pooled" };
}

async function listActuals(limit = 25) {
  if (pool) {
    const res = await pool.query(
      `SELECT * FROM actuals ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return res.rows;
  }
  return [...memory].reverse().slice(0, limit);
}

module.exports = { init, logActual, getCalibration, listActuals, hasDb };
