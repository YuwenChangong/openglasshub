import fs from "node:fs";
import path from "node:path";

const requiredDirectives = [
  "x-content-type-options: nosniff",
  "referrer-policy: strict-origin-when-cross-origin",
  "x-frame-options: deny",
  "permissions-policy: camera=(), microphone=(), geolocation=()",
];

export function validateSecurityHeadersArtifact(rootDirectory = process.cwd()) {
  const relativePath = path.join("dist", "client", "_headers");
  const headersPath = path.join(rootDirectory, relativePath);
  if (!fs.existsSync(headersPath)) {
    throw new Error("SECURITY_HEADERS_MISSING: Astro 7 Cloudflare Pages output does not provide dist/client/_headers");
  }

  const headers = fs.readFileSync(headersPath, "utf8");
  const normalizedHeaders = headers.toLowerCase();
  for (const expected of requiredDirectives) {
    if (!normalizedHeaders.includes(expected)) {
      throw new Error(`SECURITY_HEADER_MISSING: ${expected}`);
    }
  }
  if (/(?:service[_-]?role|api[_-]?key|token|secret)\s*:/i.test(headers)) {
    throw new Error("SECURITY_HEADERS_SECRET_LIKE_VALUE: generated headers must not contain credential-like values");
  }
  return { headersPath, relativePath };
}
