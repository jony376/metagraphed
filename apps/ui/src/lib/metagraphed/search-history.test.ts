import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRecent,
  loadPaletteState,
  loadRecent,
  pushRecent,
  savePaletteState,
  SUGGESTED_QUERIES,
} from "./search-history";

function mockLocalStorage() {
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
  });
  return store;
}

describe("loadRecent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty list during SSR", () => {
    expect(loadRecent()).toEqual([]);
  });

  it("filters non-string entries and caps at five items", () => {
    mockLocalStorage();
    pushRecent("rpc");
    pushRecent("openapi");
    pushRecent("bittensor");
    pushRecent("taostats");
    pushRecent("sn7");
    pushRecent("subnet");

    expect(loadRecent()).toEqual(["subnet", "sn7", "taostats", "bittensor", "openapi"]);
  });
});

describe("pushRecent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes case-insensitively and prepends the latest query", () => {
    mockLocalStorage();
    pushRecent("RPC");
    pushRecent("openapi");
    pushRecent("rpc");

    expect(loadRecent()).toEqual(["rpc", "openapi"]);
  });

  it("ignores blank queries", () => {
    mockLocalStorage();
    pushRecent("   ");
    expect(loadRecent()).toEqual([]);
  });
});

describe("clearRecent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes persisted recent searches", () => {
    mockLocalStorage();
    pushRecent("rpc");
    clearRecent();
    expect(loadRecent()).toEqual([]);
  });
});

describe("palette state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when no palette state is stored", () => {
    expect(loadPaletteState()).toBeNull();
  });

  it("round-trips query and scope through localStorage", () => {
    mockLocalStorage();
    savePaletteState({ q: "subnet 7", scope: "subnets" });
    expect(loadPaletteState()).toEqual({ q: "subnet 7", scope: "subnets" });
  });

  it("defaults missing fields when stored JSON is partial", () => {
    mockLocalStorage();
    window.localStorage.setItem("mg.search.state.v1", JSON.stringify({ q: "rpc" }));
    expect(loadPaletteState()).toEqual({ q: "rpc", scope: "all" });
  });
});

describe("SUGGESTED_QUERIES", () => {
  it("exposes the curated starter queries", () => {
    expect(SUGGESTED_QUERIES).toEqual(["bittensor", "taostats", "rpc", "openapi", "sn7"]);
  });
});
