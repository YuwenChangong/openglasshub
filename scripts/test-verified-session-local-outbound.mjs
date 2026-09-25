import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createTaskOwnedSupabaseOutbound } from "./lib/verified-session-local-outbound.mjs";

const server = createServer(async (request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, { location: "https://example.supabase.co/escape" });
    response.end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  response.writeHead(201, { "content-type": "application/json", "x-local-proof": "yes" });
  response.end(JSON.stringify({ method: request.method, path: request.url,
    apikey: request.headers.apikey, authorization: request.headers.authorization,
    body: Buffer.concat(chunks).toString("utf8") }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const outbound = createTaskOwnedSupabaseOutbound(origin);
  const get = await outbound(new Request(`${origin}/rest/v1/devices?select=slug`, {
    headers: { apikey: "local-key", authorization: "Bearer local-token" },
  }));
  assert.equal(get.status, 201);
  assert.equal(get.headers.get("x-local-proof"), "yes");
  assert.deepEqual(await get.json(), { method: "GET", path: "/rest/v1/devices?select=slug",
    apikey: "local-key", authorization: "Bearer local-token", body: "" });

  const post = await outbound(new Request(`${origin}/rest/v1/entries`, {
    method: "POST", headers: { "content-type": "application/json", apikey: "local-key" },
    body: JSON.stringify({ value: "local" }),
  }));
  assert.equal(post.status, 201);
  assert.deepEqual(await post.json(), { method: "POST", path: "/rest/v1/entries",
    apikey: "local-key", body: '{"value":"local"}' });

  const workerdBody = Buffer.from('{"value":"workerd"}');
  const workerdPost = await outbound({
    url: `${origin}/rest/v1/entries`, method: "POST",
    headers: new Headers({ "content-type": "application/json", "content-length": "1",
      host: "untrusted.invalid", authorization: "Bearer local-token", apikey: "local-key" }),
    arrayBuffer: async () => workerdBody,
  });
  assert.equal(workerdPost.status, 201);
  assert.deepEqual(await workerdPost.json(), { method: "POST", path: "/rest/v1/entries",
    apikey: "local-key", authorization: "Bearer local-token", body: workerdBody.toString("utf8") });

  for (const target of [
    `http://127.0.0.1:${server.address().port + 1}/rest/v1/devices`,
    "https://example.invalid/rest/v1/devices", "https://example.supabase.co/rest/v1/devices",
    "http://0.0.0.0/rest/v1/devices", "http://192.168.1.1/rest/v1/devices",
    `http://localhost:${server.address().port}/rest/v1/devices`,
    `http://user:pass@127.0.0.1:${server.address().port}/rest/v1/devices`,
  ]) await assert.rejects(() => outbound({ url: target, method: "GET", headers: new Headers() }), /TASK6_OUTBOUND_TARGET_DENIED/);
  await assert.rejects(() => outbound(new Request(`${origin}/redirect`)), /TASK6_OUTBOUND_REDIRECT_DENIED/);
  for (const invalidOrigin of ["https://127.0.0.1:54321", "http://0.0.0.0:54321", "http://127.0.0.1",
    "http://user:pass@127.0.0.1:54321", "https://example.supabase.co"])
    assert.throws(() => createTaskOwnedSupabaseOutbound(invalidOrigin), /TASK6_LOCAL_ORIGIN_INVALID/);

  process.env.TASK6_HOSTED_ORIGIN = "https://example.supabase.co";
  try { await assert.rejects(() => outbound(new Request(process.env.TASK6_HOSTED_ORIGIN)), /TASK6_OUTBOUND_TARGET_DENIED/); }
  finally { delete process.env.TASK6_HOSTED_ORIGIN; }
  console.log("TASK6_LOCAL_OUTBOUND=PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
