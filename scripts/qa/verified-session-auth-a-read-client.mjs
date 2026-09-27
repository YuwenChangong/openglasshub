import { assertAuthAProductionCapability, markAuthAExternalDispatch } from
  "../lib/verified-session-auth-a-production-gate.mjs";

const MAX_BODY_BYTES = 128 * 1024;
const PRODUCTION_ORIGINS = new Map([
  ["https://api.cloudflare.com/", "cloudflare"],
  ["https://api.supabase.com/", "supabase"],
  ["https://api.brevo.com/", "brevo"],
]);
const PRODUCTION_PATHS = Object.freeze({
  cloudflare: [
    /^\/client\/v4\/accounts\/[a-f0-9]{32}\/workers\/scripts\/openglasshub\/deployments$/,
    /^\/client\/v4\/accounts\/[a-f0-9]{32}\/workers\/scripts\/openglasshub\/versions\/[a-f0-9-]{36}$/,
  ],
  supabase: [/^\/v1\/projects$/, /^\/v1\/organizations\/[a-z0-9][a-z0-9-]{0,62}$/],
  brevo: [/^\/v3\/account$/, /^\/v3\/senders$/],
});
const fail = (code) => { throw new Error(`AUTH_A_READ_${code}`); };

export function createAuthAReadClient({ mode, origin, token, headerName, allowedPaths, maxRequests,
  capability,
  fetchImpl } = {}) {
  let base;
  try { base = new URL(origin); } catch { fail("ORIGIN_INVALID"); }
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash) fail("ORIGIN_INVALID");
  let productionProvider;
  if (mode === "LOCAL_TEST") {
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) fail("ORIGIN_INVALID");
  } else if (mode === "PRODUCTION") {
    productionProvider = PRODUCTION_ORIGINS.get(origin);
    if (!productionProvider) fail("ORIGIN_INVALID");
    const verified = assertAuthAProductionCapability(capability);
    if (verified.testOnly && typeof fetchImpl !== "function") fail("TEST_TRANSPORT_REQUIRED");
    if (!verified.testOnly && fetchImpl !== undefined) fail("TEST_TRANSPORT_DENIED");
  } else fail("MODE_INVALID");
  if (typeof token !== "string" || !token || !["Authorization", "api-key"].includes(headerName)
    || !Array.isArray(allowedPaths) || !allowedPaths.length
    || allowedPaths.some((part) => typeof part === "string"
      ? !/^\/[a-zA-Z0-9_/-]+$/.test(part)
      : !(part instanceof RegExp) || !part.source.startsWith("^") || !part.source.endsWith("$") || part.flags)
    || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 2) fail("CONTRACT_INVALID");
  let requests = 0;
  return Object.freeze({
    get requestCount() { return requests; },
    async get(path) {
      if (productionProvider && !PRODUCTION_PATHS[productionProvider].some((pattern) => pattern.test(path)))
        fail("PATH_DENIED");
      if (!allowedPaths.some((part) => typeof part === "string" ? part === path : part.test(path))) fail("PATH_DENIED");
      const bodyLimit = MAX_BODY_BYTES;
      if (requests >= maxRequests) fail("BUDGET_EXCEEDED");
      if (productionProvider) markAuthAExternalDispatch(capability, productionProvider);
      requests += 1;
      let response;
      try {
        response = await (fetchImpl ?? fetch)(new URL(path, base), {
          method: "GET", redirect: "manual", headers: { [headerName]: headerName === "Authorization" ? `Bearer ${token}` : token,
            Accept: "application/json" },
        });
      } catch { fail("NETWORK_FAILURE"); }
      if (response.status !== 200) fail("HTTP_FAILURE");
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > bodyLimit) fail("BODY_TOO_LARGE");
      if (!response.body) fail("BODY_READ_FAILURE");
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        let part;
        try { part = await reader.read(); } catch { fail("BODY_READ_FAILURE"); }
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > bodyLimit) {
          await reader.cancel().catch(() => {});
          fail("BODY_TOO_LARGE");
        }
        chunks.push(part.value);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { fail("JSON_INVALID"); }
    },
  });
}
