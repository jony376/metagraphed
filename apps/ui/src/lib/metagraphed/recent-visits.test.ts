import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRecentVisits,
  loadRecentVisits,
  pushRecentVisit,
  visitFromPath,
} from "./recent-visits";

describe("visitFromPath", () => {
  it("maps subnet entity paths", () => {
    expect(visitFromPath("/subnets/7")).toEqual({
      kind: "subnet",
      id: "7",
      href: "/subnets/7",
    });
    expect(visitFromPath("/subnets/my-slug/extrinsics")).toEqual({
      kind: "subnet",
      id: "my-slug",
      href: "/subnets/my-slug",
    });
  });

  it("maps provider entity paths", () => {
    expect(visitFromPath("/providers/opentensor")).toEqual({
      kind: "provider",
      id: "opentensor",
      href: "/providers/opentensor",
    });
  });

  it("returns null for non-entity pages", () => {
    expect(visitFromPath("/")).toBeNull();
    expect(visitFromPath("/blocks/123")).toBeNull();
  });
});

describe("recent visit store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty list during SSR", () => {
    expect(loadRecentVisits()).toEqual([]);
  });

  it("dedupes, prepends, and caps stored visits", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      dispatchEvent: vi.fn(),
    });

    pushRecentVisit({ kind: "subnet", id: "1", href: "/subnets/1" });
    pushRecentVisit({ kind: "provider", id: "a", href: "/providers/a" });
    pushRecentVisit({ kind: "subnet", id: "1", href: "/subnets/1", label: "SN1" });

    const visits = loadRecentVisits();
    expect(visits).toHaveLength(2);
    expect(visits[0]).toMatchObject({
      kind: "subnet",
      id: "1",
      href: "/subnets/1",
      label: "SN1",
    });
    expect(visits[1]).toMatchObject({ kind: "provider", id: "a" });
  });

  it("clears persisted visits", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      dispatchEvent: vi.fn(),
    });

    pushRecentVisit({ kind: "page", id: "home", href: "/" });
    clearRecentVisits();
    expect(loadRecentVisits()).toEqual([]);
  });
});
