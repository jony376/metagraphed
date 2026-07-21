// SN54 (Yanez MIID) end-to-end verification for the call_subnet_surface MCP
// tool (metagraphed#7067, MCP execute Phase 1 follow-up #7014/#7215). Unlike
// tests/call-subnet-surface-mcp.test.mjs -- which proves the tool wiring with
// synthetic surfaces -- this file pins SN54's *real* registry surface configs
// (registry/subnets/yanez-miid.json) to the tool's contract, so a future edit
// that regresses their callability (flipping to HEAD, marking one
// auth_required, disabling a probe) is caught here.
//
// All four surfaces listed in #7067 were live-verified 2026-07-21:
//   sn-54-yanez-compliance-openapi     GET .../openapi.json -> OpenAPI 3.1.0
//   sn-54-yanez-compliance-subnet-api  GET .../miners_stats -> {timestamp,miners:[...]}
//   sn-54-yanez-miners-stats-index     GET .../             -> {message,version,endpoints}
//   sn-54-yanez-miners-stats-health    GET .../health       -> {status:"healthy",...}
// Fixtures mirror stable top-level shapes (hermetic). kind "openapi" is not in
// OPERATIONAL_SURFACE_KINDS, so that surface is direct-call verified only --
// same pattern as sn-74-gittensor-openapi in tests/sn74-call-subnet-surface-verify.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { OPERATIONAL_SURFACE_KINDS } from "../src/health-probe-core.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const NETUID = 54;

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../registry/subnets/yanez-miid.json", import.meta.url),
    ),
    "utf8",
  ),
);

function surfaceOf(id) {
  return registry.surfaces.find((surface) => surface.id === id);
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function callToolWithSurface(surface, upstreamResponse) {
  const catalog = {
    surfaces: [{ ...surface, surface_id: surface.id, netuid: NETUID }],
  };
  const deps = {
    readArtifact: async (_env, path) =>
      path === "/metagraph/operational-surfaces.json"
        ? { ok: true, data: catalog }
        : { ok: false, status: 404 },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Status: 0 }), {
        headers: { "content-type": "application/dns-json" },
      });
    }
    return upstreamResponse();
  };
  try {
    const response = await handleMcpRequest(
      new Request("https://metagraph.sh/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "call_subnet_surface",
            arguments: { surface_id: surface.id },
          },
        }),
      }),
      {},
      deps,
    );
    return (await response.json()).result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const SUBNET_API_SURFACES = [
  {
    id: "sn-54-yanez-compliance-subnet-api",
    url: "https://miners-stats.yanezcompliance.net/miners_stats",
    body: {
      timestamp: "2026-07-21T06:12:02",
      miners: [
        {
          miner_uid: "205",
          hotkey: "5CMLKKHrcaETFym2vh5ucqoCvVgdxxy3NQnwHTaTFm4zRX6Y",
          score: 0.725,
        },
      ],
    },
    assertBody: (b) => {
      assert.equal(typeof b.timestamp, "string");
      assert.ok(Array.isArray(b.miners));
      assert.equal(typeof b.miners[0].miner_uid, "string");
      assert.equal(typeof b.miners[0].hotkey, "string");
    },
  },
  {
    id: "sn-54-yanez-miners-stats-index",
    url: "https://miners-stats.yanezcompliance.net/",
    body: {
      message: "Miner Stats API",
      version: "1.0.0",
      endpoints: {
        "/miners/{miner_uid}": "Get stats for a specific miner",
        "/miners": "List all available miners",
        "/miners_stats": "Get the latest stats for all miners",
      },
    },
    assertBody: (b) => {
      assert.equal(b.message, "Miner Stats API");
      assert.equal(b.version, "1.0.0");
      assert.equal(typeof b.endpoints, "object");
      assert.equal(typeof b.endpoints["/miners_stats"], "string");
    },
  },
  {
    id: "sn-54-yanez-miners-stats-health",
    url: "https://miners-stats.yanezcompliance.net/health",
    body: { status: "healthy", miners_stats_dir: "miners_stats" },
    assertBody: (b) => {
      assert.equal(b.status, "healthy");
      assert.equal(b.miners_stats_dir, "miners_stats");
    },
  },
];

describe("SN54 Yanez MIID call_subnet_surface verification (#7067)", () => {
  for (const fixture of SUBNET_API_SURFACES) {
    const SURFACE = surfaceOf(fixture.id);

    test(`${fixture.id}: registry surface exists and is configured to be callable`, () => {
      assert.ok(SURFACE, `registry surface ${fixture.id} is present`);
      assert.equal(SURFACE.kind, "subnet-api");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "json");
      assert.equal(SURFACE.url, fixture.url);
      assert.equal(SURFACE.schema_url, undefined);
    });

    test(`${fixture.id}: callSubnetSurface returns the real JSON body using the surface's own url + GET`, async () => {
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(SURFACE, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (url, init) => {
          requestedUrl = String(url);
          requestedMethod = init.method;
          return jsonResponse(fixture.body);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.content_type, "application/json");
      assert.equal(result.truncated, false);
      fixture.assertBody(result.body);
    });

    test(`${fixture.id}: end-to-end through the call_subnet_surface MCP tool, resolved by surface id`, async () => {
      const result = await callToolWithSurface(SURFACE, () =>
        jsonResponse(fixture.body),
      );
      assert.equal(result.isError, false);
      assert.equal(result.structuredContent.surface_id, fixture.id);
      assert.equal(result.structuredContent.status_code, 200);
      fixture.assertBody(result.structuredContent.body);
    });
  }

  describe("sn-54-yanez-compliance-openapi (direct-call only)", () => {
    const SURFACE = surfaceOf("sn-54-yanez-compliance-openapi");
    const BODY = {
      openapi: "3.1.0",
      info: {
        title: "Miner Stats API",
        description:
          "API to retrieve miner statistics from the miners_stats directory",
        version: "1.0.0",
      },
      paths: {
        "/": {
          get: {
            summary: "Root",
            operationId: "root__get",
          },
        },
      },
    };

    test("registry surface exists, is no-auth GET, and carries its captured schema", () => {
      assert.ok(
        SURFACE,
        "registry surface sn-54-yanez-compliance-openapi is present",
      );
      assert.equal(SURFACE.kind, "openapi");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "json");
      assert.equal(
        SURFACE.url,
        "https://miners-stats.yanezcompliance.net/openapi.json",
      );
      assert.equal(SURFACE.schema_status, "machine-readable");
      assert.equal(
        SURFACE.schema_url,
        "https://miners-stats.yanezcompliance.net/openapi.json",
      );
    });

    test('kind "openapi" is not an operational kind, so this surface is direct-call verified', () => {
      assert.ok(!OPERATIONAL_SURFACE_KINDS.includes("openapi"));
      assert.ok(OPERATIONAL_SURFACE_KINDS.includes("subnet-api"));
    });

    test("callSubnetSurface returns the OpenAPI 3.1 document as parsed JSON", async () => {
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(SURFACE, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (url, init) => {
          requestedUrl = String(url);
          requestedMethod = init.method;
          return jsonResponse(BODY);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.truncated, false);
      assert.equal(result.body.openapi, "3.1.0");
      assert.equal(result.body.info.title, "Miner Stats API");
      assert.equal(result.body.paths["/"].get.operationId, "root__get");
    });
  });
});
