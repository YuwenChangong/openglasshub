import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { readBrevoReadiness } from "./verified-session-auth-a-brevo-read.mjs";

async function serve(handler, fn) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("BR-01..08 two GETs, free credits and verified sender without PII", async () => {
  const requests = [];
  await serve((req, res) => {
    requests.push({ method: req.method, path: req.url });
    res.setHeader("content-type", "application/json");
    if (req.url === "/v3/account") res.end(JSON.stringify({ plan: [{ type: "free", credits: 100 }],
      relay: { enabled: true, password: "dummy-secret" }, email: "owner@example.test" }));
    else if (req.url === "/v3/senders") res.end(JSON.stringify({ senders: [
      { email: "expected@example.test", active: true, verified: true },
      { email: "other@example.test", active: true, verified: true },
    ] }));
    else { res.statusCode = 404; res.end("{}"); }
  }, async (origin) => {
    const result = await readBrevoReadiness({ mode: "LOCAL_TEST", origin,
      token: "dummy-key", expectedSenderEmail: "expected@example.test", minimumCredits: 9 });
    assert.deepEqual(result, { plan: "FREE", creditsAvailable: 100,
      capacitySufficient: true, senderVerified: true, requestCount: 2 });
    for (const secret of ["dummy-secret", "dummy-key", "expected@example.test", "owner@example.test"])
      assert.equal(JSON.stringify(result).includes(secret), false);
  });
  assert.deepEqual(requests, [
    { method: "GET", path: "/v3/account" }, { method: "GET", path: "/v3/senders" },
  ]);
});

test("BR-04..06 paid, missing credits or unverified sender cannot pass", async () => {
  for (const [account, senders] of [
    [{ plan: [{ type: "paid", credits: 100 }] }, { senders: [{ email: "expected@example.test", active: true, verified: true }] }],
    [{ plan: [{ type: "free" }] }, { senders: [{ email: "expected@example.test", active: true, verified: true }] }],
    [{ plan: [{ type: "free", credits: 100 }] }, { senders: [{ email: "expected@example.test", active: true, verified: false }] }],
  ]) await serve((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/v3/account" ? account : senders));
  }, async (origin) => {
    const result = await readBrevoReadiness({ mode: "LOCAL_TEST", origin,
      token: "dummy-key", expectedSenderEmail: "expected@example.test", minimumCredits: 9 });
    assert.equal(result.capacitySufficient && result.senderVerified && result.plan === "FREE", false);
  });
});

test("BR-09..12 redirect/error stops after one request and never sends email", async () => {
  for (const status of [302, 401, 403, 404, 429, 500]) {
    const paths = [];
    await serve((req, res) => { paths.push(req.url); res.statusCode = status;
      if (status === 302) res.setHeader("location", "https://example.invalid/"); res.end("{}");
    }, async (origin) => {
      await assert.rejects(readBrevoReadiness({ mode: "LOCAL_TEST", origin,
        token: "dummy-key", expectedSenderEmail: "expected@example.test", minimumCredits: 9 }),
      (error) => !error.message.includes("dummy-key"));
    });
    assert.deepEqual(paths, ["/v3/account"]);
  }
});
