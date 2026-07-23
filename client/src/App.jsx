import { useEffect, useMemo, useState } from "react";

const BAND_META = {
  base: {
    label: "Base case",
    note: "Everything goes to plan. Use for internal floor, never for quoting."
  },
  expected: {
    label: "Expected",
    note: "Normal friction included. This is the number to quote."
  },
  buffered: {
    label: "Buffered",
    note: "Scope shifts and extra rounds. This is what protects your margin."
  }
};

const CONFIDENCE_COPY = {
  high: "High confidence — inputs suggest a well-defined project.",
  medium: "Medium confidence — some uncertainty priced into the spread.",
  low: "Low confidence — wide spread. Consider tightening scope before quoting."
};

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function HourBand({ bands }) {
  const max = bands.buffered * 1.12;
  const pos = (v) => `${Math.min(97, (v / max) * 100)}%`;
  return (
    <div className="band" aria-label={`Estimate range from ${bands.base} to ${bands.buffered} hours`}>
      <div className="band-track">
        <div
          className="band-fill"
          style={{ left: pos(bands.base), width: `calc(${pos(bands.buffered)} - ${pos(bands.base)})` }}
        />
        {["base", "expected", "buffered"].map((k) => (
          <div key={k} className={`band-marker band-marker-${k}`} style={{ left: pos(bands[k]) }}>
            <span className="band-marker-line" />
            <span className="band-marker-value">{bands[k]}</span>
            <span className="band-marker-label">{BAND_META[k].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [workspace, setWorkspace] = useState(
    () => window.localStorage.getItem("hourmap-workspace") || ""
  );
  const [form, setForm] = useState({
    industry: "consulting",
    projectType: "",
    scope: "medium",
    complexity: "standard",
    client: "existing",
    revisions: "standard"
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showLog, setShowLog] = useState(false);
  const [actualHours, setActualHours] = useState("");
  const [notes, setNotes] = useState("");
  const [logStatus, setLogStatus] = useState(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        setConfig(c);
        setForm((f) => ({ ...f, projectType: c.industries[0].types[0].id }));
      })
      .catch(() => setError("Could not load configuration. Refresh to try again."));
  }, []);

  const industry = useMemo(
    () => config?.industries.find((i) => i.id === form.industry),
    [config, form.industry]
  );

  function setIndustry(id) {
    const ind = config.industries.find((i) => i.id === id);
    setForm((f) => ({ ...f, industry: id, projectType: ind.types[0].id }));
  }

  function updateWorkspace(value) {
    setWorkspace(value);
    window.localStorage.setItem("hourmap-workspace", value);
  }

  async function runEstimate() {
    setLoading(true);
    setError(null);
    setLogStatus(null);
    setShowLog(false);
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, workspace })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Estimate failed");
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitActual() {
    setLogStatus(null);
    try {
      const res = await fetch("/api/actuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace,
          industry: result.input.industry,
          projectType: result.input.projectType,
          estimatedHours: result.bands.expected,
          actualHours: Number(actualHours),
          notes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setLogStatus(
        `Logged. ${data.calibration.count} project${data.calibration.count === 1 ? "" : "s"} now calibrating this project type.`
      );
      setActualHours("");
      setNotes("");
      setShowLog(false);
    } catch (e) {
      setLogStatus(`Error: ${e.message}`);
    }
  }

  if (!config) {
    return (
      <div className="shell">
        <p className="muted">{error || "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="masthead no-print">
        <div className="wordmark">
          <span className="wordmark-ticks" aria-hidden="true" />
          HourMap
        </div>
        <p className="tagline">Project hour estimates you can defend.</p>
        <label className="workspace">
          <span className="workspace-label">Firm workspace</span>
          <input
            type="text"
            placeholder="e.g. barlos-legal"
            value={workspace}
            onChange={(e) => updateWorkspace(e.target.value)}
          />
        </label>
      </header>

      <main className="layout">
        <section className="panel form-panel no-print" aria-label="Project parameters">
          <h2 className="panel-title">Scope the project</h2>

          <Field label="Industry">
            <Select value={form.industry} onChange={setIndustry} options={config.industries} />
          </Field>
          <Field label="Project type">
            <Select
              value={form.projectType}
              onChange={(v) => setForm((f) => ({ ...f, projectType: v }))}
              options={industry.types}
            />
          </Field>
          <Field label="Scope size">
            <Select
              value={form.scope}
              onChange={(v) => setForm((f) => ({ ...f, scope: v }))}
              options={config.scope}
            />
          </Field>
          <Field label="Complexity">
            <Select
              value={form.complexity}
              onChange={(v) => setForm((f) => ({ ...f, complexity: v }))}
              options={config.complexity}
            />
          </Field>
          <Field label="Client relationship">
            <Select
              value={form.client}
              onChange={(v) => setForm((f) => ({ ...f, client: v }))}
              options={config.client}
            />
          </Field>
          <Field label="Revision expectations">
            <Select
              value={form.revisions}
              onChange={(v) => setForm((f) => ({ ...f, revisions: v }))}
              options={config.revisions}
            />
          </Field>

          <button className="btn-primary" onClick={runEstimate} disabled={loading}>
            {loading ? "Estimating…" : "Estimate hours"}
          </button>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="panel result-panel" aria-label="Estimate result">
          {!result ? (
            <div className="empty">
              <p className="empty-title">Your estimate appears here.</p>
              <p className="muted">
                Set six parameters on the left and get a three-band hour range with a
                phase-by-phase breakdown — ready to attach to a proposal.
              </p>
            </div>
          ) : (
            <>
              <div className="result-head">
                <div>
                  <p className="eyebrow">{result.labels.industry} · {result.labels.projectType}</p>
                  <p className="headline-number">
                    {result.bands.expected}
                    <span className="headline-unit">hrs expected</span>
                  </p>
                </div>
                <div className="result-actions no-print">
                  <button className="btn-ghost" onClick={() => window.print()}>
                    Print / save PDF
                  </button>
                  <button className="btn-ghost" onClick={() => setShowLog((s) => !s)}>
                    Log actual hours
                  </button>
                </div>
              </div>

              <HourBand bands={result.bands} />

              <div className="band-cards">
                {["base", "expected", "buffered"].map((k) => (
                  <div key={k} className={`band-card ${k === "expected" ? "band-card-hero" : ""}`}>
                    <p className="band-card-label">{BAND_META[k].label}</p>
                    <p className="band-card-value">{result.bands[k]} hrs</p>
                    <p className="band-card-note">{BAND_META[k].note}</p>
                  </div>
                ))}
              </div>

              <p className={`confidence confidence-${result.confidence}`}>
                {CONFIDENCE_COPY[result.confidence]}
                {result.calibration.applied &&
                  (result.calibration.scope === "workspace"
                    ? ` Calibrated with ${result.calibration.count} of your firm's logged projects.`
                    : ` Calibrated with pooled data from ${result.calibration.count} projects across all firms — your firm's own history takes over after 3 logged projects.`)}
              </p>

              <h3 className="section-title">Breakdown by phase</h3>
              <table className="phase-table">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Base</th>
                    <th>Expected</th>
                    <th>Buffered</th>
                  </tr>
                </thead>
                <tbody>
                  {result.phases.map((p) => (
                    <tr key={p.id}>
                      <td>{p.label}</td>
                      <td>{p.base}</td>
                      <td>{p.expected}</td>
                      <td>{p.buffered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="assumptions">
                Assumes: {result.labels.scope.toLowerCase()} · {result.labels.complexity.toLowerCase()} ·{" "}
                {result.labels.client.toLowerCase()} · {result.labels.revisions.toLowerCase()} revisions.
              </p>

              {showLog && (
                <div className="log-form no-print">
                  <h3 className="section-title">Close out this project</h3>
                  <p className="muted">
                    Log the real hours once the project wraps. Three or more logged projects of the
                    same type start calibrating future estimates automatically.
                  </p>
                  <div className="log-row">
                    <input
                      type="number"
                      min="1"
                      placeholder="Actual hours"
                      value={actualHours}
                      onChange={(e) => setActualHours(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Notes (optional)"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                    <button
                      className="btn-primary"
                      onClick={submitActual}
                      disabled={!actualHours || Number(actualHours) <= 0}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
              {logStatus && <p className="log-status no-print">{logStatus}</p>}
            </>
          )}
        </section>
      </main>

      <footer className="footer no-print">
        <p className="muted">
          Estimates are rule-based starting points refined by your logged actuals — not a
          substitute for professional judgment on unusual engagements.
        </p>
      </footer>
    </div>
  );
}
