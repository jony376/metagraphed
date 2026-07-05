import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "./client";
import { apiFetch } from "./client";
import {
  chainTransferPairsQuery,
  normalizeChainTransferPair,
  normalizeChainTransferPairs,
} from "./queries";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const CHARLIE = "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y";

function resolveWith(data: unknown): void {
  mockedApiFetch.mockResolvedValue({
    data,
    meta: {} as ApiResult<unknown>["meta"],
    url: "/api/v1/chain/transfer-pairs",
  });
}

async function runQuery(
  params: { window?: "7d" | "30d"; limit?: number; sort?: "volume" | "count" } = {},
) {
  const opts = chainTransferPairsQuery(params);
  if (!opts.queryFn) throw new Error("expected a queryFn");
  return opts.queryFn({
    signal: new AbortController().signal,
    queryKey: opts.queryKey,
    meta: undefined,
  } as unknown as Parameters<NonNullable<typeof opts.queryFn>>[0]);
}

describe("normalizeChainTransferPair", () => {
  it("accepts a well-formed directed pair", () => {
    expect(
      normalizeChainTransferPair({
        from: ALICE,
        to: BOB,
        volume_tao: 80,
        transfer_count: 5,
        last_block: 5_000_000,
        last_observed_at: "2026-06-01T00:00:00.000Z",
      }),
    ).toEqual({
      from: ALICE,
      to: BOB,
      volume_tao: 80,
      transfer_count: 5,
      last_block: 5_000_000,
      last_observed_at: "2026-06-01T00:00:00.000Z",
    });
  });

  it("drops malformed rows, self-transfers, and invalid ss58 addresses", () => {
    expect(normalizeChainTransferPair(null)).toBeNull();
    expect(
      normalizeChainTransferPair({
        from: ALICE,
        to: ALICE,
        volume_tao: 10,
        transfer_count: 1,
      }),
    ).toBeNull();
    expect(
      normalizeChainTransferPair({
        from: "not-ss58",
        to: BOB,
        volume_tao: 10,
        transfer_count: 1,
      }),
    ).toBeNull();
    expect(
      normalizeChainTransferPair({
        from: ALICE,
        to: BOB,
        volume_tao: { bad: true },
        transfer_count: 1,
      }),
    ).toBeNull();
  });
});

describe("normalizeChainTransferPairs", () => {
  it("maps the leaderboard card and filters bad pair rows", () => {
    const out = normalizeChainTransferPairs({
      schema_version: 1,
      window: "7d",
      sort: "count",
      observed_at: "2026-07-03T00:00:00.000Z",
      total_volume_tao: 100,
      transfer_count: 12,
      unique_pairs: 5,
      pair_count: 2,
      top_pair_share: 0.55,
      pairs: [
        {
          from: ALICE,
          to: BOB,
          volume_tao: 20,
          transfer_count: 4,
          last_block: 100,
          last_observed_at: "2026-07-03T00:00:00.000Z",
        },
        {
          from: BOB,
          to: CHARLIE,
          volume_tao: 55,
          transfer_count: 2,
          last_block: 99,
          last_observed_at: "2026-07-03T00:00:00.000Z",
        },
        { from: ALICE, to: ALICE, volume_tao: 99, transfer_count: 9 },
      ],
    });
    expect(out).toMatchObject({
      schema_version: 1,
      window: "7d",
      sort: "count",
      total_volume_tao: 100,
      transfer_count: 12,
      unique_pairs: 5,
      pair_count: 2,
      top_pair_share: 0.55,
    });
    expect(out.pairs).toHaveLength(2);
  });

  it("falls back to a schema-stable cold card", () => {
    expect(normalizeChainTransferPairs({})).toEqual({
      schema_version: 1,
      window: null,
      sort: "volume",
      observed_at: null,
      total_volume_tao: 0,
      transfer_count: 0,
      unique_pairs: 0,
      pair_count: 0,
      top_pair_share: null,
      pairs: [],
    });
  });

  it("caps the pair list at 100 rows", () => {
    const pairs = Array.from({ length: 120 }, (_, i) => ({
      from: ALICE,
      to: BOB,
      volume_tao: i + 1,
      transfer_count: 1,
    }));
    expect(normalizeChainTransferPairs({ pairs }).pairs).toHaveLength(100);
  });
});

describe("chainTransferPairsQuery", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it("fetches with window/limit/sort params and normalizes the response", async () => {
    resolveWith({
      schema_version: 1,
      window: "30d",
      sort: "volume",
      observed_at: "2026-07-03T00:00:00.000Z",
      total_volume_tao: 250,
      transfer_count: 30,
      unique_pairs: 3,
      pair_count: 1,
      top_pair_share: 0.6,
      pairs: [{ from: ALICE, to: BOB, volume_tao: 150, transfer_count: 10 }],
    });

    const result = await runQuery({ window: "30d", limit: 10, sort: "volume" });
    expect(mockedApiFetch).toHaveBeenCalledWith("/api/v1/chain/transfer-pairs", {
      params: { window: "30d", limit: 10, sort: "volume" },
      signal: expect.any(AbortSignal),
    });
    expect(result.data.pairs).toHaveLength(1);
    expect(result.data.pairs[0]).toMatchObject({
      from: ALICE,
      to: BOB,
      volume_tao: 150,
      transfer_count: 10,
    });
  });
});
