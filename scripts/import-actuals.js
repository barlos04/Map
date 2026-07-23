/**
 * Bulk-import historical engagements to seed calibration for a firm.
 *
 * Usage:
 *   node scripts/import-actuals.js path/to/engagements.csv
 *
 * With DATABASE_URL set (e.g. `railway run node scripts/import-actuals.js ...`
 * or exporting your Railway Postgres URL), rows are persisted. Without it, the
 * script runs in DRY-RUN mode: it validates every row and shows the computed
 * estimates and resulting calibration ratios, but saves nothing.
 *
 * CSV columns (header row required):
 *   workspace, industry, projectType, scope, complexity, client, revisions,
 *   actualHours, notes
 *
 * For each row, the script computes what HourMap's rules would have estimated
 * (uncalibrated — that's deliberate, so ratios measure the rules against your
 * reality) and logs the actual hours against that figure.
 */

const fs = require("fs");
const path = require("path");
const engine = require(path.join(__dirname, "..", "server", "engine.js"));
const db = require(path.join(__dirname, "..", "server", "db.js"));

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f.trim() !== "")) rows.push(row); }
  return rows;
}

function validValues() {
  const cfg = engine.getConfig();
  return {
    industries: cfg.industries.map((i) => i.id),
    typesByIndustry: Object.fromEntries(cfg.industries.map((i) => [i.id, i.types.map((t) => t.id)])),
    scope: cfg.scope.map((o) => o.id),
    complexity: cfg.complexity.map((o) => o.id),
    client: cfg.client.map((o) => o.id),
    revisions: cfg.revisions.map((o) => o.id)
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/import-actuals.js path/to/engagements.csv");
    process.exit(1);
  }

  const dryRun = !process.env.DATABASE_URL;
  if (dryRun) {
    console.log("No DATABASE_URL set — DRY RUN. Validating and previewing only; nothing will be saved.\n");
  } else {
    await db.init();
  }

  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const header = rows.shift().map((h) => h.trim());
  const required = ["workspace", "industry", "projectType", "scope", "complexity", "client", "revisions", "actualHours"];
  for (const col of required) {
    if (!header.includes(col)) {
      console.error(`Missing required column: ${col}`);
      process.exit(1);
    }
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const valid = validValues();

  let ok = 0, failed = 0;
  const perType = {};

  for (let n = 0; n < rows.length; n++) {
    const r = rows[n];
    const get = (c) => (r[idx[c]] || "").trim();
    const rec = {
      workspace: get("workspace") || "default",
      industry: get("industry"),
      projectType: get("projectType"),
      scope: get("scope") || "medium",
      complexity: get("complexity") || "standard",
      client: get("client") || "existing",
      revisions: get("revisions") || "standard"
    };
    const actualHours = Number(get("actualHours"));
    const notes = idx.notes !== undefined ? get("notes") : "";
    const line = n + 2;

    const problems = [];
    if (!valid.industries.includes(rec.industry)) problems.push(`industry "${rec.industry}" (valid: ${valid.industries.join(", ")})`);
    else if (!valid.typesByIndustry[rec.industry].includes(rec.projectType))
      problems.push(`projectType "${rec.projectType}" (valid for ${rec.industry}: ${valid.typesByIndustry[rec.industry].join(", ")})`);
    if (!valid.scope.includes(rec.scope)) problems.push(`scope "${rec.scope}"`);
    if (!valid.complexity.includes(rec.complexity)) problems.push(`complexity "${rec.complexity}"`);
    if (!valid.client.includes(rec.client)) problems.push(`client "${rec.client}"`);
    if (!valid.revisions.includes(rec.revisions)) problems.push(`revisions "${rec.revisions}"`);
    if (!isFinite(actualHours) || actualHours <= 0) problems.push(`actualHours "${get("actualHours")}"`);

    if (problems.length) {
      console.error(`Row ${line}: skipped — invalid ${problems.join("; ")}`);
      failed++;
      continue;
    }

    // Uncalibrated rule estimate = the baseline this actual is measured against.
    const est = engine.estimate(rec, null);
    const expected = est.bands.expected;
    const ratio = actualHours / expected;

    if (!dryRun) {
      await db.logActual({
        workspace: rec.workspace,
        industry: rec.industry,
        projectType: rec.projectType,
        estimatedHours: expected,
        actualHours,
        notes: notes || "backfilled"
      });
    }

    const key = `${rec.workspace} / ${rec.industry} / ${rec.projectType}`;
    (perType[key] = perType[key] || []).push(ratio);
    console.log(`Row ${line}: ${key} — rules said ${expected} hrs, actual ${actualHours} (ratio ${ratio.toFixed(2)})`);
    ok++;
  }

  console.log(`\n${dryRun ? "Validated" : "Imported"} ${ok} row(s), skipped ${failed}.`);
  console.log("\nCalibration effect by project type:");
  for (const [key, ratios] of Object.entries(perType)) {
    const sorted = [...ratios].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const status = ratios.length >= 3 ? "active" : `needs ${3 - ratios.length} more to activate`;
    console.log(`  ${key}: ${ratios.length} project(s), median ratio ${med.toFixed(2)} — ${status}`);
  }
  if (dryRun) console.log("\nRe-run with DATABASE_URL set to persist (e.g. `railway run node scripts/import-actuals.js <file>`).");
  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
