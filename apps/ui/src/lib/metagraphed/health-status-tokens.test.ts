import { describe, expect, it } from "vitest";

import {
  HEALTH_STATUS_COLOR_FALLBACKS,
  healthStatusVar,
  inkMutedVar,
} from "./health-status-tokens";

describe("healthStatusVar", () => {
  it("builds canonical var(--health-*, fallback) strings", () => {
    expect(healthStatusVar("ok")).toBe(`var(--health-ok, ${HEALTH_STATUS_COLOR_FALLBACKS.ok})`);
    expect(healthStatusVar("warn")).toBe(
      `var(--health-warn, ${HEALTH_STATUS_COLOR_FALLBACKS.warn})`,
    );
    expect(healthStatusVar("down")).toBe(
      `var(--health-down, ${HEALTH_STATUS_COLOR_FALLBACKS.down})`,
    );
  });
});

describe("inkMutedVar", () => {
  it("maps the unknown tier to --ink-muted with the shared fallback", () => {
    expect(inkMutedVar()).toBe(`var(--ink-muted, ${HEALTH_STATUS_COLOR_FALLBACKS.unknown})`);
  });
});
