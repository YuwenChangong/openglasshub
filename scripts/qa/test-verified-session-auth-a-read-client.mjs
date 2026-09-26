import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";

test("GET-only path/budget enforcement happens before dispatch", async () => {
  let calls = 0;
  const server = createServer((req, res) => { calls++; assert.equal(req.method, "GET");
    res.setHeader("content-type", "application/json"); res.end("{}"); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const client = createAuthAReadClient({ mode: "LOCAL_TEST",
      origin: `http://127.0.0.1:${server.address().port}/`, token: "dummy-token",
      headerName: "Authorization", allowedPaths: ["/one"], maxRequests: 1 });
    await assert.rejects(client.get("/v3/smtp/email"), /AUTH_A_READ_PATH_DENIED/);
    assert.equal(calls, 0);
    await client.get("/one");
    await assert.rejects(client.get("/one"), /AUTH_A_READ_BUDGET_EXCEEDED/);
    assert.equal(calls, 1);
    assert.equal(client.requestCount, 1);
  } finally { server.close(); await once(server, "close"); }
});

test("production origins stay disabled before reviewed orchestration", () => {
  for (const origin of ["https://api.cloudflare.com/", "https://api.brevo.com/", "https://api.supabase.com/"])
    assert.throws(() => createAuthAReadClient({ mode: "PRODUCTION", origin, token: "dummy-token",
      headerName: "Authorization", allowedPaths: ["/one"], maxRequests: 1 }), /AUTH_A_READ_PRODUCTION_DISABLED/);
  assert.throws(() => createAuthAReadClient({ mode: "LOCAL_TEST", origin: "http://localhost.example.invalid/",
    token: "dummy-token", headerName: "Authorization", allowedPaths: ["/one"], maxRequests: 1 }), /AUTH_A_READ_ORIGIN_INVALID/);
});

test("body budget stops an unlengthened stream before full consumption", async () => {
  let pulls = 0;
  const fetchImpl = async () => new Response(new ReadableStream({
    pull(controller) {
      pulls++;
      if (pulls > 4) throw new Error("unbounded-read");
      controller.enqueue(new Uint8Array(70 * 1024));
    },
  }), { status: 200 });
  const client = createAuthAReadClient({ mode: "LOCAL_TEST", origin: "http://127.0.0.1:1234/",
    token: "dummy-token", headerName: "Authorization", allowedPaths: ["/one"], maxRequests: 1,
    fetchImpl });
  await assert.rejects(client.get("/one"), /AUTH_A_READ_BODY_TOO_LARGE/);
  assert.ok(pulls <= 4);
});
