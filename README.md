# HourMap

Structured project hour estimation for professional services. Set six parameters, get a three-band hour range (Base / Expected / Buffered) with a phase-by-phase breakdown — ready to print as a PDF and attach to a proposal.

Built for consulting, legal, accounting & finance, creative/agency, software, and general business engagements, all running on one shared rule engine with per-deployment calibration from logged actuals.

## How estimates work

1. **Rule engine** — each industry module defines project types with base hours and phase weights. Scope, complexity, client relationship, and revision expectations apply multipliers. Every number lives in `server/engine.js` and is meant to be tuned.
2. **Three bands** — the uncertainty spread widens with complexity, new clients, and heavy revisions:
   - **Base case** (~25th percentile): everything goes to plan. Internal floor, never the quote.
   - **Expected** (median): normal friction included. This is the number to quote.
   - **Buffered** (~85th percentile): scope shifts and extra rounds. This is what protects margin.
3. **Calibration** — when a project closes, log the actual hours. Once 3+ actuals exist for an industry + project type, the engine blends the median actual/estimated ratio into future Expected figures (weight grows with sample size, capped at 70% so the rules always retain a vote). The tool quietly drifts from industry rules toward your real history.

## Firm workspaces (multi-firm on one deployment)

One deployment serves many firms. Each firm enters a workspace code in the header (e.g. `barlos-legal`) — it's remembered in their browser and sent with every estimate and logged actual.

- Calibration is **firm-scoped**: a law firm's actuals only adjust that law firm's estimates, even alongside other law firms on the same deployment.
- **Pooled fallback**: a workspace with fewer than 3 logged projects of a type falls back to the anonymized median across all firms — so new firms benefit from the network without leaking anyone's specifics.
- The result screen always says which data calibrated the number ("your firm's logged projects" vs. "pooled data across all firms").

Workspace codes are honor-system in v1 — anyone who knows a code can log to it. That's fine for a trusted pilot group; Phase 2 replaces codes with real authenticated accounts (Clerk/Auth0) before opening this to strangers.

## Seeding accuracy before a firm starts (backfill)

Calibration measures the engine's rules against a firm's real history, so the fastest way to make a new firm accurate is to backfill their recent engagements:

1. Copy `scripts/engagements-template.csv` and fill one row per past project. Score `scope`, `complexity`, `client`, and `revisions` **as they looked at kickoff**, not with hindsight — that's the situation future estimates will be made in. Valid values for every column are printed by the script if you get one wrong.
2. Dry-run it locally to validate and preview the calibration effect (nothing is saved without a database):
   ```bash
   node scripts/import-actuals.js scripts/engagements-template.csv
   ```
3. Persist to your Railway Postgres:
   ```bash
   railway run node scripts/import-actuals.js scripts/engagements-template.csv
   ```
   (or export `DATABASE_URL` from the Railway dashboard and run the plain command).

Backfill guidance: quality beats volume. Five to ten **recent, representative** projects per project type the firm commonly does is ideal — calibration activates at 3, reaches full weight around 10, and only the 50 most recent count. Skip one-off disasters unless they're genuinely typical; the median resists outliers but there's no need to feed it any.

## Run locally

```bash
npm install
npm run build     # builds the React client into client/dist
npm start         # serves app + API on http://localhost:3000
```

No database needed locally — actuals are held in memory (lost on restart). Estimates always work either way.

Frontend dev with hot reload: `npm start` in one terminal, `npm --prefix client run dev` in another (Vite proxies `/api` to port 3000).

## Deploy on Railway (with GitHub autodeploy)

1. Push this repo to GitHub:
   ```bash
   git init && git add . && git commit -m "HourMap v1"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. In Railway: **New Project → Deploy from GitHub repo** and select the repo. Railway detects Node, runs `npm install && npm run build`, then `npm start`. Every push to `main` now autodeploys.
3. Add persistence: in the same Railway project, **New → Database → PostgreSQL**. Then on the app service, add a variable reference so `DATABASE_URL` points at the Postgres service (Railway offers this as a one-click reference: `${{Postgres.DATABASE_URL}}`). The app creates its own table on boot.
4. **Settings → Networking → Generate Domain** to get a public URL.

That's the entire pipeline: GitHub is source of truth, Railway builds and hosts, Postgres holds actuals.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/config` | Industries, project types, and option lists |
| POST | `/api/estimate` | `{industry, projectType, scope, complexity, client, revisions}` → bands + phases |
| POST | `/api/actuals` | `{industry, projectType, estimatedHours, actualHours, notes?}` → saves + returns calibration state |
| GET | `/api/actuals` | Recent logged actuals |
| GET | `/api/health` | Status + storage mode (`postgres` / `memory`) |

## Tuning the rules

Open `server/engine.js`. Base hours per project type, phase weights, multipliers, and the spread formula are all plain data at the top of the file. Adjust them to match how your work actually runs — then let logged actuals take over from there.

## Roadmap (matches the proposal's phases)

- **Phase 2** — user accounts (Clerk/Auth0), per-account calibration instead of per-deployment, Claude API natural-language intake ("describe the project in plain English").
- **Phase 3** — multi-tenant firm workspaces, firm-level models on top of industry baselines, premium tier.
