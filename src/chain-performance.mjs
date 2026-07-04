// Network-wide performance / reward-distribution metrics: pure statistics over
// EVERY subnet's per-UID PERFORMANCE columns (incentive, dividends, trust,
// consensus, validator_trust) from the live `neurons` D1 tier. The network analog
// of a per-subnet reward scorecard and the reward-flow companion to
// chain-concentration.mjs — concentration measures who holds the STAKE/EMISSION
// across the network; this measures how concentrated the actual REWARDS are and
// how the 0..1 trust/consensus scores are spread across all neurons at once.
// Every function is pure + exported for unit tests; the Worker does the D1 read +
// envelope. Null-safe: an empty snapshot yields a schema-stable `null` block.

import { computeConcentration } from "./concentration.mjs";
import {
  parseSubnetPerformanceHistoryWindow,
  PERFORMANCE_HISTORY_ROW_CAP,
} from "./subnet-performance.mjs";

// The neurons-tier columns the network performance handler reads — like the
// per-subnet read but with `netuid`, so the artifact can report how many subnets
// the current snapshot spans (mirrors CHAIN_CONCENTRATION_READ_COLUMNS).
export const CHAIN_PERFORMANCE_READ_COLUMNS =
  "incentive, dividends, trust, consensus, validator_trust, " +
  "active, validator_permit, netuid, captured_at";

// The 0..1 score columns reported as a percentile spread (a bounded score has no
// "share of a total" to be unequal over, so a distribution summary is the lens).
const SCORE_PERCENTILES = [10, 25, 50, 75, 90];

// Round a score/mean to 6 dp so JSON never carries a long floating-point tail.
// Callers only ever pass finite values (finiteValues drops non-finite cells and
// scoreDistribution guards count > 0), so no null-guard is needed here.
function round(value) {
  const factor = 1e6;
  return Math.round(value * factor) / factor;
}

function epochMsStamp(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return null;
  return { ms, value: date.toISOString() };
}

function captureStamp(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      return epochMsStamp(Number(value));
    }
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return { ms, value };
    return null;
  }
  if (typeof value === "number") {
    return epochMsStamp(value);
  }
  return null;
}

// Coerce a raw column array to the finite values present. A score of exactly 0 is
// a real observation (a neuron with zero trust IS part of the spread), so only
// null/NaN/blank cells are dropped — the `count` reflects the neurons that carry
// a score.
function finiteValues(values) {
  const out = [];
  for (const raw of values) {
    // trim() catches whitespace-only cells too, not just the exact empty string
    // (Number(" ") === 0, which would count an absent score as a real 0).
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// Nearest-rank percentile over a non-empty ascending array (rank = ceil(p/100 · n),
// 1-based), matching the subnet-yield / health-percentile convention. Only called
// after scoreDistribution has established count > 0, so the array is never empty.
function percentile(ascending, p) {
  const rank = Math.max(1, Math.ceil((p / 100) * ascending.length));
  return ascending[rank - 1];
}

// Distribution summary for one 0..1 score column, or `null` when no neuron carries
// a finite value (cold store / empty network / all-null column). count/mean plus
// the SCORE_PERCENTILES spread and the min/max, all rounded to a stable precision.
export function scoreDistribution(values) {
  const finite = finiteValues(Array.isArray(values) ? values : []);
  const count = finite.length;
  if (count === 0) return null;
  const ascending = [...finite].sort((a, b) => a - b);
  const total = finite.reduce((sum, v) => sum + v, 0);
  const summary = {
    count,
    mean: round(total / count),
    min: round(ascending[0]),
    max: round(ascending[count - 1]),
  };
  for (const p of SCORE_PERCENTILES) {
    summary[`p${p}`] = round(percentile(ascending, p));
  }
  return summary;
}

// Shape EVERY subnet's neurons-tier rows into the network performance artifact —
// two lenses over the whole-network snapshot:
//   • reward CONCENTRATION → `incentive`, `dividends` (Gini/HHI/Nakamoto/top-share
//     of the actual reward flow across ALL neurons — how few capture most rewards
//     network-wide, the genuinely new measurement a per-subnet view can't give)
//   • score DISTRIBUTION   → `trust`, `consensus`, `validator_trust` (the p10..p90
//     spread of the 0..1 performance scores across the whole network)
// plus `subnet_count` (subnets the snapshot spans) and neuron/validator/active
// counts. Null-safe on junk/sparse rows — an empty array yields a schema-stable
// zero (every metric block null).
export function buildChainPerformance(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let capturedAt = null;
  let validatorCount = 0;
  let activeCount = 0;
  const netuids = new Set();
  for (const row of list) {
    const captured = captureStamp(row?.captured_at);
    if (captured && (capturedAt == null || captured.ms > capturedAt.ms)) {
      capturedAt = captured;
    }
    if (Number(row?.validator_permit) === 1) validatorCount += 1;
    if (Number(row?.active) === 1) activeCount += 1;
    const rawNetuid = row?.netuid;
    if (rawNetuid != null) {
      // Blank D1 cells coerce via Number("") → 0; trim rejects "" / whitespace-only.
      if (typeof rawNetuid === "string" && rawNetuid.trim() === "") continue;
      const netuid = Number(rawNetuid);
      // Guard the coercion: a non-numeric cell must not count as subnet 0.
      if (Number.isInteger(netuid) && netuid >= 0) netuids.add(netuid);
    }
  }
  const validatorRows = list.filter(
    (row) => Number(row?.validator_permit) === 1,
  );
  return {
    schema_version: 1,
    subnet_count: netuids.size,
    neuron_count: list.length,
    validator_count: validatorCount,
    active_count: activeCount,
    captured_at: capturedAt?.value ?? null,
    // Reward-flow concentration (who actually earns) across the whole network.
    incentive: computeConcentration(list.map((row) => row?.incentive)),
    dividends: computeConcentration(validatorRows.map((row) => row?.dividends)),
    // 0..1 score spread across the whole network.
    trust: scoreDistribution(list.map((row) => row?.trust)),
    consensus: scoreDistribution(list.map((row) => row?.consensus)),
    validator_trust: scoreDistribution(
      validatorRows.map((row) => row?.validator_trust),
    ),
  };
}

// Shared D1 loader (mirrors handleChainPerformance + loadChainConcentration): read
// EVERY subnet's neurons in one pass, no netuid filter, and shape them into the
// network performance artifact. Exported for the MCP tool.
export async function loadChainPerformance(d1) {
  const rows = await d1(
    `SELECT ${CHAIN_PERFORMANCE_READ_COLUMNS} FROM neurons`,
    [],
  );
  return buildChainPerformance(rows);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Re-export the shared history window parser (7d/30d/90d, default 30d) so chain
// and subnet performance-history routes cannot drift.
export {
  parseSubnetPerformanceHistoryWindow as parseChainPerformanceHistoryWindow,
  PERFORMANCE_HISTORY_ROW_CAP,
};

// neuron_daily columns for the network-wide performance history read — netuid is
// required so each day's subnet_count is exact.
export const CHAIN_PERFORMANCE_HISTORY_READ_COLUMNS =
  "snapshot_date, incentive, dividends, trust, consensus, " +
  "validator_trust, validator_permit, active, netuid";

// Project one day's cross-subnet neuron_daily rows to a flat, chartable point.
// Reuses buildChainPerformance so a day's reward-flow metrics match the snapshot route.
function chainPerformanceHistoryPoint(date, dayRows) {
  const card = buildChainPerformance(dayRows);
  return {
    snapshot_date: date,
    subnet_count: card.subnet_count,
    neuron_count: card.neuron_count,
    validator_count: card.validator_count,
    active_count: card.active_count,
    incentive_gini: card.incentive?.gini ?? null,
    incentive_nakamoto_coefficient:
      card.incentive?.nakamoto_coefficient ?? null,
    incentive_top_10pct_share: card.incentive?.top_10pct_share ?? null,
    dividends_gini: card.dividends?.gini ?? null,
    dividends_nakamoto_coefficient:
      card.dividends?.nakamoto_coefficient ?? null,
    dividends_top_10pct_share: card.dividends?.top_10pct_share ?? null,
    trust_mean: card.trust?.mean ?? null,
    trust_median: card.trust?.p50 ?? null,
    consensus_mean: card.consensus?.mean ?? null,
    consensus_median: card.consensus?.p50 ?? null,
    validator_trust_mean: card.validator_trust?.mean ?? null,
    validator_trust_median: card.validator_trust?.p50 ?? null,
  };
}

// Build the per-day network performance time series (newest first) from neuron_daily
// rows already ordered snapshot_date DESC. `capped` (the read hit the row cap) drops the
// oldest day, which may be a partial distribution. Null-safe: a cold store yields
// point_count:0.
export function buildChainPerformanceHistory(rows, { window, capped } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const byDate = new Map();
  for (const row of list) {
    const date = row?.snapshot_date;
    if (typeof date !== "string" || !date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }
  let dates = [...byDate.keys()];
  if (capped && dates.length > 1) dates = dates.slice(0, -1);
  const points = dates.map((date) =>
    chainPerformanceHistoryPoint(date, byDate.get(date)),
  );
  return {
    schema_version: 1,
    window: window ?? null,
    point_count: points.length,
    points,
  };
}

// Shared D1 loader — read EVERY subnet's dated neuron_daily rows over the window
// and shape them into the per-day network performance series. Cold store -> point_count:0.
export async function loadChainPerformanceHistory(
  d1,
  { windowLabel, windowDays },
) {
  const cutoff = new Date(Date.now() - windowDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const rows = await d1(
    `SELECT ${CHAIN_PERFORMANCE_HISTORY_READ_COLUMNS} FROM neuron_daily WHERE snapshot_date >= ? ORDER BY snapshot_date DESC LIMIT ?`,
    [cutoff, PERFORMANCE_HISTORY_ROW_CAP],
  );
  return buildChainPerformanceHistory(rows, {
    window: windowLabel,
    capped: rows.length >= PERFORMANCE_HISTORY_ROW_CAP,
  });
}
