// Network-wide windowed account_events summary: compact kind/category counts plus a
// small newest-first evidence slice across every subnet. Pure shaping
// (buildChainEventSummary) + a thin D1 loader (loadChainEventSummary); the field
// semantics live in schemas/components/05-subnets.schema.json
// (ChainEventSummaryArtifact). Companion to the per-subnet /subnets/{netuid}/event-summary
// route and GET /api/v1/chain/event-summary.

import { clampLimit } from "../workers/request-params.mjs";
import {
  ACCOUNT_EVENT_COLUMNS,
  DEFAULT_SUBNET_EVENT_SUMMARY_WINDOW,
  formatAccountEvent,
  SUBNET_EVENT_SUMMARY_RECENT_LIMIT_DEFAULT,
  SUBNET_EVENT_SUMMARY_RECENT_LIMIT_MAX,
  SUBNET_EVENT_SUMMARY_WINDOWS,
} from "./account-events.mjs";

export {
  DEFAULT_SUBNET_EVENT_SUMMARY_WINDOW as DEFAULT_CHAIN_EVENT_SUMMARY_WINDOW,
  SUBNET_EVENT_SUMMARY_RECENT_LIMIT_DEFAULT as CHAIN_EVENT_SUMMARY_RECENT_LIMIT_DEFAULT,
  SUBNET_EVENT_SUMMARY_RECENT_LIMIT_MAX as CHAIN_EVENT_SUMMARY_RECENT_LIMIT_MAX,
  SUBNET_EVENT_SUMMARY_WINDOWS as CHAIN_EVENT_SUMMARY_WINDOWS,
};

function toIso(ms) {
  if (ms == null) return null;
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

function toBlockNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function toTaoOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toTaoOrZero(value) {
  return toTaoOrNull(value) ?? 0;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

const EVENT_KIND_CATEGORIES = {
  NeuronRegistered: "registration",
  NeuronDeregistered: "registration",
  NetworkAdded: "registration",
  NetworkRemoved: "registration",
  RegistrationAllowed: "registration",
  PowRegistrationAllowed: "registration",
  Faucet: "registration",
  StakeAdded: "stake",
  StakeRemoved: "stake",
  StakeMoved: "stake",
  StakeTransferred: "stake",
  AxonServed: "serving",
  PrometheusServed: "serving",
  AxonInfoRemoved: "serving",
  WeightsSet: "consensus",
  RootClaimed: "consensus",
  DelegateAdded: "delegation",
  TakeDecreased: "delegation",
  TakeIncreased: "delegation",
  HotkeySwapped: "identity",
  ColdkeySwapped: "identity",
  ColdkeySwapScheduled: "identity",
  SubnetOwnerHotkeySet: "governance",
  BurnSet: "governance",
  Transfer: "transfer",
};

function eventKindCategory(kind) {
  return EVENT_KIND_CATEGORIES[kind] ?? "other";
}

function emptyCategory(category) {
  return {
    category,
    event_count: 0,
    kind_count: 0,
    amount_tao: 0,
    alpha_amount: 0,
    first_block: null,
    last_block: null,
    first_observed_at: null,
    last_observed_at: null,
  };
}

function mergeObserved(existing, next, choose) {
  const nextValue = Number(next);
  if (!Number.isFinite(nextValue) || nextValue <= 0) return existing;
  if (existing == null) return nextValue;
  return choose(existing, nextValue);
}

// Windowed event summary across every subnet: compact kind/category counts plus a
// small newest-first evidence slice. Mirrors buildSubnetEventSummary but omits
// netuid, carries root subnet_count, and each event_kind row includes subnet_count.
export function buildChainEventSummary(
  kindRows,
  recentRows,
  { window, limit, subnetCount } = {},
) {
  const eventKinds = [];
  const categories = new Map();
  let latestObserved = null;
  for (const row of Array.isArray(kindRows) ? kindRows : []) {
    const kind =
      typeof row?.event_kind === "string" && row.event_kind.length > 0
        ? row.event_kind
        : null;
    if (!kind) continue;
    const category = eventKindCategory(kind);
    const eventCount = toCount(row.event_count);
    const amountTao = toTaoOrZero(row.amount_tao);
    const alphaAmount = toTaoOrZero(row.alpha_amount);
    const firstObservedMs = mergeObserved(
      null,
      row.first_observed_at,
      Math.min,
    );
    const lastObservedMs = mergeObserved(null, row.last_observed_at, Math.max);
    const shaped = {
      event_kind: kind,
      category,
      event_count: eventCount,
      subnet_count: toCount(row.subnet_count),
      hotkey_count: toCount(row.hotkey_count),
      coldkey_count: toCount(row.coldkey_count),
      amount_tao: amountTao,
      alpha_amount: alphaAmount,
      first_block: toBlockNumber(row.first_block),
      last_block: toBlockNumber(row.last_block),
      first_observed_at: toIso(firstObservedMs),
      last_observed_at: toIso(lastObservedMs),
    };
    eventKinds.push(shaped);
    const summary = categories.get(category) ?? emptyCategory(category);
    summary.event_count += eventCount;
    summary.kind_count += 1;
    summary.amount_tao = toTaoOrZero(summary.amount_tao + amountTao);
    summary.alpha_amount = toTaoOrZero(summary.alpha_amount + alphaAmount);
    summary.first_block =
      summary.first_block == null
        ? shaped.first_block
        : shaped.first_block == null
          ? summary.first_block
          : Math.min(summary.first_block, shaped.first_block);
    summary.last_block =
      summary.last_block == null
        ? shaped.last_block
        : shaped.last_block == null
          ? summary.last_block
          : Math.max(summary.last_block, shaped.last_block);
    summary.first_observed_at = toIso(
      mergeObserved(
        summary.first_observed_at == null
          ? null
          : Date.parse(summary.first_observed_at),
        firstObservedMs,
        Math.min,
      ),
    );
    summary.last_observed_at = toIso(
      mergeObserved(
        summary.last_observed_at == null
          ? null
          : Date.parse(summary.last_observed_at),
        lastObservedMs,
        Math.max,
      ),
    );
    categories.set(category, summary);
    latestObserved = mergeObserved(latestObserved, lastObservedMs, Math.max);
  }
  eventKinds.sort(
    (a, b) =>
      b.event_count - a.event_count ||
      a.category.localeCompare(b.category) ||
      a.event_kind.localeCompare(b.event_kind),
  );
  const categoryList = [...categories.values()].sort(
    (a, b) =>
      b.event_count - a.event_count || a.category.localeCompare(b.category),
  );
  const recentEvents = (Array.isArray(recentRows) ? recentRows : [])
    .map(formatAccountEvent)
    .filter(Boolean);
  for (const event of recentEvents) {
    latestObserved = mergeObserved(
      latestObserved,
      event.observed_at == null ? null : Date.parse(event.observed_at),
      Math.max,
    );
  }
  return {
    schema_version: 1,
    window: window ?? null,
    observed_at: toIso(latestObserved),
    subnet_count: toCount(subnetCount),
    total_events: eventKinds.reduce((sum, row) => sum + row.event_count, 0),
    kind_count: eventKinds.length,
    category_count: categoryList.length,
    recent_event_count: recentEvents.length,
    limit: limit ?? null,
    categories: categoryList,
    event_kinds: eventKinds,
    recent_events: recentEvents,
  };
}

const ACTOR_IDENTITY =
  "CASE " +
  "WHEN hotkey IS NOT NULL AND hotkey != '' THEN 'hotkey:' || hotkey " +
  "WHEN uid IS NOT NULL THEN 'uid:' || netuid || ':' || uid " +
  "ELSE NULL END";

export async function loadChainEventSummary(
  d1,
  {
    windowLabel = DEFAULT_SUBNET_EVENT_SUMMARY_WINDOW,
    limit = SUBNET_EVENT_SUMMARY_RECENT_LIMIT_DEFAULT,
  } = {},
) {
  const effectiveWindowLabel = Object.hasOwn(
    SUBNET_EVENT_SUMMARY_WINDOWS,
    windowLabel,
  )
    ? windowLabel
    : DEFAULT_SUBNET_EVENT_SUMMARY_WINDOW;
  const days = SUBNET_EVENT_SUMMARY_WINDOWS[effectiveWindowLabel];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const lim = clampLimit(limit, {
    defaultLimit: SUBNET_EVENT_SUMMARY_RECENT_LIMIT_DEFAULT,
    maxLimit: SUBNET_EVENT_SUMMARY_RECENT_LIMIT_MAX,
  });
  const probeRows = await d1(
    "SELECT COUNT(DISTINCT netuid) AS subnet_count, MAX(observed_at) AS newest_observed " +
      "FROM account_events WHERE observed_at >= ?",
    [cutoff],
  );
  const probe = probeRows?.[0] ?? null;
  const subnetCount = toCount(probe?.subnet_count);
  let kindRows = [];
  let recentRows = [];
  if (probe?.newest_observed != null) {
    kindRows = await d1(
      "SELECT event_kind, COUNT(*) AS event_count, " +
        "COUNT(DISTINCT netuid) AS subnet_count, " +
        "COUNT(DISTINCT " +
        ACTOR_IDENTITY +
        ") AS hotkey_count, " +
        "COUNT(DISTINCT coldkey) AS coldkey_count, " +
        "COALESCE(SUM(amount_tao), 0) AS amount_tao, " +
        "COALESCE(SUM(alpha_amount), 0) AS alpha_amount, " +
        "MIN(block_number) AS first_block, MAX(block_number) AS last_block, " +
        "MIN(observed_at) AS first_observed_at, MAX(observed_at) AS last_observed_at " +
        "FROM account_events WHERE observed_at >= ? " +
        "GROUP BY event_kind ORDER BY event_count DESC, event_kind ASC",
      [cutoff],
    );
    recentRows = await d1(
      `SELECT ${ACCOUNT_EVENT_COLUMNS} FROM account_events ` +
        "WHERE observed_at >= ? " +
        "ORDER BY block_number DESC, event_index DESC LIMIT ?",
      [cutoff, lim],
    );
  }
  const summary = buildChainEventSummary(kindRows, recentRows, {
    window: effectiveWindowLabel,
    limit: lim,
    subnetCount,
  });
  if (summary.observed_at == null && probe?.newest_observed != null) {
    summary.observed_at = toIso(probe.newest_observed);
  }
  return summary;
}
