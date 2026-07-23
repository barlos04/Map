/**
 * HourMap estimation engine — rule-based v1.
 *
 * Every number here is an encoded expert assumption, deliberately visible and
 * tunable. The calibration layer (see applyCalibration) adjusts the Expected
 * figure using logged actuals once enough history exists, so the engine drifts
 * from "industry rules" toward "your real history" without a rewrite.
 */

const INDUSTRIES = {
  consulting: {
    label: "Consulting",
    types: {
      market_research: { label: "Market research / analysis", base: 60, phases: { discovery: 0.2, core: 0.45, review: 0.2, delivery: 0.15 } },
      strategy_engagement: { label: "Strategy engagement", base: 120, phases: { discovery: 0.25, core: 0.4, review: 0.2, delivery: 0.15 } },
      process_improvement: { label: "Process / ops improvement", base: 90, phases: { discovery: 0.25, core: 0.45, review: 0.15, delivery: 0.15 } },
      due_diligence: { label: "Due diligence support", base: 100, phases: { discovery: 0.15, core: 0.55, review: 0.2, delivery: 0.1 } },
      workshop_facilitation: { label: "Workshop / training program", base: 40, phases: { discovery: 0.3, core: 0.35, review: 0.1, delivery: 0.25 } }
    }
  },
  legal: {
    label: "Legal",
    types: {
      contract_drafting: { label: "Contract drafting", base: 25, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } },
      contract_review: { label: "Contract review / redline", base: 12, phases: { discovery: 0.15, core: 0.55, review: 0.2, delivery: 0.1 } },
      research_memo: { label: "Legal research memo", base: 30, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } },
      transaction_support: { label: "Transaction support", base: 80, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } },
      compliance_review: { label: "Compliance / regulatory review", base: 60, phases: { discovery: 0.25, core: 0.45, review: 0.2, delivery: 0.1 } }
    }
  },
  accounting: {
    label: "Accounting & Finance",
    types: {
      bookkeeping_cleanup: { label: "Bookkeeping cleanup / catch-up", base: 20, phases: { discovery: 0.2, core: 0.6, review: 0.1, delivery: 0.1 } },
      financial_statements: { label: "Financial statement preparation", base: 40, phases: { discovery: 0.15, core: 0.55, review: 0.2, delivery: 0.1 } },
      business_tax_return: { label: "Business tax return", base: 35, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } },
      audit_support: { label: "Audit support / preparation", base: 120, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } },
      financial_model: { label: "Financial model / forecast", base: 60, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } }
    }
  },
  creative: {
    label: "Creative & Agency",
    types: {
      brand_identity: { label: "Brand identity package", base: 80, phases: { discovery: 0.2, core: 0.45, review: 0.25, delivery: 0.1 } },
      website_design: { label: "Website design & build", base: 120, phases: { discovery: 0.15, core: 0.5, review: 0.25, delivery: 0.1 } },
      marketing_campaign: { label: "Marketing campaign", base: 70, phases: { discovery: 0.2, core: 0.45, review: 0.2, delivery: 0.15 } },
      content_package: { label: "Content package (copy / social)", base: 35, phases: { discovery: 0.15, core: 0.5, review: 0.25, delivery: 0.1 } },
      video_production: { label: "Video production", base: 90, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } }
    }
  },
  software: {
    label: "Software & Dev",
    types: {
      landing_page: { label: "Landing page / marketing site", base: 40, phases: { discovery: 0.15, core: 0.55, review: 0.2, delivery: 0.1 } },
      web_app_mvp: { label: "Web app MVP", base: 250, phases: { discovery: 0.15, core: 0.55, review: 0.2, delivery: 0.1 } },
      api_integration: { label: "API / systems integration", base: 60, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } },
      feature_build: { label: "Feature build on existing product", base: 80, phases: { discovery: 0.15, core: 0.55, review: 0.2, delivery: 0.1 } },
      data_pipeline: { label: "Data pipeline / reporting", base: 70, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } }
    }
  },
  general: {
    label: "General Business",
    types: {
      small_project: { label: "Small engagement", base: 30, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } },
      medium_project: { label: "Medium engagement", base: 80, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } },
      large_project: { label: "Large engagement", base: 200, phases: { discovery: 0.2, core: 0.5, review: 0.2, delivery: 0.1 } }
    }
  }
};

const PHASE_LABELS = {
  discovery: "Discovery & setup",
  core: "Core work",
  review: "Review & revisions",
  delivery: "Delivery & close-out"
};

const SCOPE = {
  small: { label: "Small — narrow, well-defined", mult: 0.6 },
  medium: { label: "Medium — typical for this work", mult: 1.0 },
  large: { label: "Large — broad or multi-part", mult: 1.6 },
  xl: { label: "Extra large — major engagement", mult: 2.5 }
};

const COMPLEXITY = {
  low: { label: "Low — routine, done many times", mult: 0.85, spread: 0.0 },
  standard: { label: "Standard — some unknowns", mult: 1.0, spread: 0.0 },
  high: { label: "High — novel or messy inputs", mult: 1.3, spread: 0.07 },
  very_high: { label: "Very high — significant unknowns", mult: 1.65, spread: 0.12 }
};

const CLIENT = {
  existing: { label: "Existing client", mult: 1.0, spread: 0.0 },
  new: { label: "New client", mult: 1.12, spread: 0.03 }
};

const REVISIONS = {
  minimal: { label: "Minimal — sign-off expected quickly", mult: 0.95, spread: 0.0 },
  standard: { label: "Standard — one or two rounds", mult: 1.0, spread: 0.0 },
  heavy: { label: "Heavy — many stakeholders / rounds", mult: 1.2, spread: 0.04 }
};

const BASE_SPREAD = 0.18;

function roundHours(h) {
  if (h >= 100) return Math.round(h / 10) * 10;
  if (h >= 40) return Math.round(h / 5) * 5;
  if (h >= 10) return Math.round(h / 2) * 2;
  return Math.max(1, Math.round(h));
}

function getConfig() {
  return {
    industries: Object.entries(INDUSTRIES).map(([id, ind]) => ({
      id,
      label: ind.label,
      types: Object.entries(ind.types).map(([tid, t]) => ({ id: tid, label: t.label }))
    })),
    scope: Object.entries(SCOPE).map(([id, v]) => ({ id, label: v.label })),
    complexity: Object.entries(COMPLEXITY).map(([id, v]) => ({ id, label: v.label })),
    client: Object.entries(CLIENT).map(([id, v]) => ({ id, label: v.label })),
    revisions: Object.entries(REVISIONS).map(([id, v]) => ({ id, label: v.label }))
  };
}

/**
 * calibration: { ratio, count } | null — median(actual / expected) across the
 * user's logged projects for this industry + project type. Blend weight grows
 * with sample size and caps at 0.7 so rules always retain a vote.
 */
function applyCalibration(expected, calibration) {
  if (!calibration || calibration.count < 3) return { expected, applied: false };
  const ratio = Math.min(1.6, Math.max(0.6, calibration.ratio));
  const weight = Math.min(calibration.count / 10, 0.7);
  return {
    expected: expected * (1 + weight * (ratio - 1)),
    applied: true,
    ratio,
    weight,
    count: calibration.count,
    scope: calibration.scope || "workspace"
  };
}

function estimate(input, calibration = null) {
  const { industry, projectType, scope, complexity, client, revisions } = input;

  const ind = INDUSTRIES[industry];
  if (!ind) throw new Error(`Unknown industry: ${industry}`);
  const type = ind.types[projectType];
  if (!type) throw new Error(`Unknown project type: ${projectType}`);
  const s = SCOPE[scope] || SCOPE.medium;
  const c = COMPLEXITY[complexity] || COMPLEXITY.standard;
  const cl = CLIENT[client] || CLIENT.existing;
  const r = REVISIONS[revisions] || REVISIONS.standard;

  let expected = type.base * s.mult * c.mult * cl.mult * r.mult;

  const cal = applyCalibration(expected, calibration);
  expected = cal.expected;

  const spread = BASE_SPREAD + c.spread + cl.spread + r.spread;
  const baseCase = expected * (1 - spread * 0.8);
  const buffered = expected * (1 + spread * 1.6);

  const bands = {
    base: roundHours(baseCase),
    expected: roundHours(expected),
    buffered: roundHours(buffered)
  };

  const phases = Object.entries(type.phases).map(([pid, pct]) => ({
    id: pid,
    label: PHASE_LABELS[pid],
    pct,
    base: roundHours(baseCase * pct),
    expected: roundHours(expected * pct),
    buffered: roundHours(buffered * pct)
  }));

  const confidence = spread <= 0.2 ? "high" : spread <= 0.27 ? "medium" : "low";

  return {
    input,
    bands,
    phases,
    spread: Number(spread.toFixed(2)),
    confidence,
    calibration: cal.applied
      ? { applied: true, count: cal.count, ratio: Number(cal.ratio.toFixed(2)), scope: cal.scope }
      : { applied: false },
    labels: {
      industry: ind.label,
      projectType: type.label,
      scope: s.label,
      complexity: c.label,
      client: cl.label,
      revisions: r.label
    }
  };
}

module.exports = { getConfig, estimate, INDUSTRIES };
