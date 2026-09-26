import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { readSupabaseInventory } from "./verified-session-auth-a-supabase-read.mjs";

const ref = "xcbnxzjlsvtgzixurcof";
const project = { ref, organization_slug: "reviewed-org", status: "ACTIVE_HEALTHY",
  database_host: `db.${ref}.supabase.co`, name: "private-project-name" };

async function serve(handler, fn) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("SB-01..15 two derived GETs prove inventory, never capacity or PII", async () => {
  const requests = [];
  await serve((req, res) => { requests.push({ method: req.method, path: req.url });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/v1/projects" ? [project]
      : { slug: "reviewed-org", plan: "free", name: "private-owner", email: "owner@example.test" }));
  }, async (origin) => {
    const result = await readSupabaseInventory({ mode: "LOCAL_TEST", origin, token: "dummy-token" });
    assert.deepEqual(result, { projectRef: ref, projectStatus: "ACTIVE_HEALTHY",
      targetMatch: true, freePlan: true, freeCapacityStatus: "UNKNOWN",
      capacityGate: "BLOCKED_BEFORE_AUTH_B", requestCount: 2 });
    for (const secret of ["dummy-token", "private-owner", "owner@example.test", "private-project-name"])
      assert.equal(JSON.stringify(result).includes(secret), false);
  });
  assert.deepEqual(requests, [{ method: "GET", path: "/v1/projects" },
    { method: "GET", path: "/v1/organizations/reviewed-org" }]);
});

test("SB target ambiguity and project drift stop before organization request", async () => {
  for (const projects of [[], [{ ...project, ref: "wrong" }], [project, project],
    [{ ...project, organization_slug: "../wrong" }]]) {
    let requests = 0;
    await serve((_req, res) => { requests++; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(projects)); }, async (origin) => {
      await assert.rejects(readSupabaseInventory({ mode: "LOCAL_TEST", origin, token: "dummy-token" }), /AUTH_A_SB_/);
    });
    assert.equal(requests, 1);
  }
});

test("SB status, org identity and plan must be independently proven", async () => {
  for (const [projects, organization] of [
    [[{ ...project, status: "INACTIVE" }], { slug: "reviewed-org", plan: "free" }],
    [[project], { slug: "reviewed-org", plan: "pro" }],
  ]) await serve((req, res) => { res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/v1/projects" ? projects : organization));
  }, async (origin) => {
    const result = await readSupabaseInventory({ mode: "LOCAL_TEST", origin, token: "dummy-token" });
    assert.equal(result.targetMatch && result.freePlan && result.projectStatus === "ACTIVE_HEALTHY", false);
    assert.equal(result.freeCapacityStatus, "UNKNOWN");
  });
  await serve((req, res) => { res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/v1/projects" ? [project] : { slug: "other-org", plan: "free" }));
  }, async (origin) => {
    await assert.rejects(readSupabaseInventory({ mode: "LOCAL_TEST", origin, token: "dummy-token" }),
      /AUTH_A_SB_ORGANIZATION_DRIFT/);
  });
});

test("SB redirects and provider failures stop without retry", async () => {
  for (const status of [302, 401, 403, 404, 429, 500]) {
    let requests = 0;
    await serve((_req, res) => { requests++; res.statusCode = status;
      if (status === 302) res.setHeader("location", "https://example.invalid/"); res.end("{}");
    }, async (origin) => {
      await assert.rejects(readSupabaseInventory({ mode: "LOCAL_TEST", origin, token: "dummy-token" }),
        (error) => !error.message.includes("dummy-token"));
    });
    assert.equal(requests, 1);
  }
});

test("SB Production origin cannot be caller-substituted", async () => {
  await assert.rejects(readSupabaseInventory({ mode: "PRODUCTION", origin: "https://example.invalid/",
    token: "dummy-token" }), /AUTH_A_SB_ORIGIN_DENIED/);
});
