import assert from "node:assert/strict";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function createTaskOwnedSupabaseOutbound(apiOrigin) {
  let allowed;
  try { allowed = new URL(apiOrigin); }
  catch { throw new Error("TASK6_LOCAL_ORIGIN_INVALID"); }
  assert.ok(allowed.protocol === "http:" && LOOPBACK_HOSTS.has(allowed.hostname) && allowed.port &&
    !allowed.username && !allowed.password && allowed.pathname === "/" && !allowed.search && !allowed.hash,
  "TASK6_LOCAL_ORIGIN_INVALID");

  return async (request) => {
    let target;
    try { target = new URL(request.url); }
    catch { throw new Error("TASK6_OUTBOUND_TARGET_DENIED"); }
    assert.ok(target.origin === allowed.origin && !target.username && !target.password,
      "TASK6_OUTBOUND_TARGET_DENIED");
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer());
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.delete("host");
    const forwarded = new Request(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });
    const response = await fetch(forwarded);
    assert.ok(response.status < 300 || response.status >= 400, "TASK6_OUTBOUND_REDIRECT_DENIED");
    return response;
  };
}
