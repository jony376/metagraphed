// Canonical hex fallbacks for inline `var(--health-*, …)` usages (#3458). styles.css
// defines the real tokens in oklch; these literals are only the SSR/chart fallback when a
// token is unavailable. Centralised here so consumers stop drifting to disagreeing hexes.

export const HEALTH_STATUS_COLOR_FALLBACKS = {
  ok: "#22c55e",
  warn: "#f59e0b",
  down: "#ef4444",
  unknown: "#94a3b8",
} as const;

export type HealthStatusColorKey = keyof typeof HEALTH_STATUS_COLOR_FALLBACKS;

/** CSS colour string for one of the three health-state tokens. */
export function healthStatusVar(key: "ok" | "warn" | "down"): string {
  return `var(--health-${key}, ${HEALTH_STATUS_COLOR_FALLBACKS[key]})`;
}

/** Muted/unknown tier colour used by Donut legends (maps to --ink-muted). */
export function inkMutedVar(): string {
  return `var(--ink-muted, ${HEALTH_STATUS_COLOR_FALLBACKS.unknown})`;
}
