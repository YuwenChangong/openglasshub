import fs from "node:fs";
import path from "node:path";

const headersPath = path.join(process.cwd(), "dist", "_headers");

if (!fs.existsSync(headersPath)) {
  throw new Error("SECURITY_HEADERS_MISSING: build output does not provide Cloudflare Pages headers");
}

const headers = fs.readFileSync(headersPath, "utf8").toLowerCase();
for (const expected of [
  "x-content-type-options: nosniff",
  "referrer-policy: strict-origin-when-cross-origin",
  "x-frame-options: deny",
  "permissions-policy: camera=(), microphone=(), geolocation=()",
]) {
  if (!headers.includes(expected)) {
    throw new Error(`SECURITY_HEADER_MISSING: ${expected}`);
  }
}

console.log("SECURITY_HEADERS_OK");
