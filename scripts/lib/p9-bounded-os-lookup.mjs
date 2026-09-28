// Derived from the reviewed DNS-only child isolation. No launcher or credentials live here.
export const OS_LOOKUP_WORKER_SOURCE = `
import { lookup } from "node:dns/promises";
const timer = setTimeout(() => process.exit(1), 5000);
try {
  const rows = await lookup("aws-1-ap-northeast-1.pooler.supabase.com", { family: 4, all: true, verbatim: true });
  if (!Array.isArray(rows) || rows.length > 128) {
    process.stdout.write(JSON.stringify({ errorCode: "DNS_MALFORMED_RESULT" }));
  } else {
    const first = rows[0];
    process.stdout.write(JSON.stringify({ count: rows.length, first: rows.length ? {
      address: typeof first?.address === "string" && first.address.length <= 45 ? first.address : null,
      family: first?.family === 4 ? 4 : 0,
    } : null }));
  }
} catch (error) {
  const codes = ["ENOTFOUND", "ENODATA", "ESERVFAIL", "EREFUSED", "ETIMEOUT", "ENOTINITIALIZED",
    "ELOADIPHLPAPI", "EADDRGETNETWORKPARAMS"];
  process.stdout.write(JSON.stringify({ errorCode: codes.includes(error?.code) ? error.code : "OTHER" }));
}
clearTimeout(timer);
`;

const CLASSES = Object.freeze({ ENOTFOUND: "DNS_NAME_NOT_FOUND", ENODATA: "DNS_NO_A_RECORD",
  ESERVFAIL: "DNS_SERVER_FAILURE", EREFUSED: "DNS_SERVER_REFUSED", ETIMEOUT: "DNS_TIMEOUT",
  ENOTINITIALIZED: "DNS_RESOLVER_CONFIGURATION_FAILURE", ELOADIPHLPAPI: "DNS_RESOLVER_CONFIGURATION_FAILURE",
  EADDRGETNETWORKPARAMS: "DNS_RESOLVER_CONFIGURATION_FAILURE", DNS_MALFORMED_RESULT: "DNS_MALFORMED_RESULT" });
const failure = (code) => Object.assign(new Error(code), { code });

export function superviseOsLookupChild(launch, timeoutMs = 5000, graceMs = 500) {
  return new Promise((resolve, reject) => {
    let child, forced, timer, grace, bytes = 0, output = "", settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(grace);
      if (error) reject(failure(error)); else resolve(result);
    };
    const stop = (code) => {
      if (settled || forced) return;
      forced = code;
      // A receipt must never outrun an unconfirmed DNS child's termination.
      grace = setTimeout(() => { forced = "DNS_TERMINATION_UNCONFIRMED"; }, graceMs);
      try { child.kill("SIGKILL"); } catch { /* Keep waiting for authoritative close. */ }
    };
    timer = setTimeout(() => stop("DNS_TIMEOUT"), timeoutMs);
    try { child = launch(); } catch { finish("DNS_RESOLVER_ERROR"); return; }
    child.stdout.on("data", (chunk) => {
      if (settled || forced) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 512) { stop("DNS_MALFORMED_RESULT"); return; }
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", () => stop("DNS_RESOLVER_ERROR"));
    child.on("error", () => stop("DNS_RESOLVER_ERROR"));
    child.on("close", (code) => {
      if (forced) { finish(forced); return; }
      if (code !== 0) { finish("DNS_RESOLVER_ERROR"); return; }
      try {
        const result = JSON.parse(output);
        if (result && Object.keys(result).join(",") === "errorCode") {
          finish(Object.hasOwn(CLASSES, result.errorCode) ? CLASSES[result.errorCode] : "DNS_RESOLVER_ERROR");
          return;
        }
        if (!result || Object.keys(result).join(",") !== "count,first"
          || !Number.isSafeInteger(result.count) || result.count < 0 || result.count > 128
          || result.count > 0 && (!result.first || Object.keys(result.first).join(",") !== "address,family"
            || !(result.first.address === null || typeof result.first.address === "string" && result.first.address.length <= 45)
            || ![0, 4].includes(result.first.family))
          || result.count === 0 && result.first !== null) { finish("DNS_MALFORMED_RESULT"); return; }
        finish(null, result);
      } catch { finish("DNS_MALFORMED_RESULT"); }
    });
  });
}
