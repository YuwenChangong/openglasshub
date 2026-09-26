const MAX_BODY_BYTES = 128 * 1024;
const fail = (code) => { throw new Error(`AUTH_A_READ_${code}`); };

export function createAuthAReadClient({ mode, origin, token, headerName, allowedPaths, maxRequests,
  fetchImpl = fetch } = {}) {
  let base;
  try { base = new URL(origin); } catch { fail("ORIGIN_INVALID"); }
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash) fail("ORIGIN_INVALID");
  if (mode === "LOCAL_TEST") {
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) fail("ORIGIN_INVALID");
  } else if (mode === "PRODUCTION") {
    // No hosted dispatch until a reviewed orchestrator binds a new authorization.
    fail("PRODUCTION_DISABLED");
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
      if (!allowedPaths.some((part) => typeof part === "string" ? part === path : part.test(path))) fail("PATH_DENIED");
      if (requests >= maxRequests) fail("BUDGET_EXCEEDED");
      requests += 1;
      let response;
      try {
        response = await fetchImpl(new URL(path, base), {
          method: "GET", redirect: "manual", headers: { [headerName]: headerName === "Authorization" ? `Bearer ${token}` : token,
            Accept: "application/json" },
        });
      } catch { fail("NETWORK_FAILURE"); }
      if (response.status !== 200) fail("HTTP_FAILURE");
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_BODY_BYTES) fail("BODY_TOO_LARGE");
      let body;
      try { body = await response.text(); } catch { fail("BODY_READ_FAILURE"); }
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) fail("BODY_TOO_LARGE");
      try { return JSON.parse(body); } catch { fail("JSON_INVALID"); }
    },
  });
}
