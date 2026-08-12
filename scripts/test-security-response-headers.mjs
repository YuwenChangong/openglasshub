import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const middlewarePath = path.join(repositoryRoot, "src", "middleware.ts");
const pagesHeadersPath = path.join(repositoryRoot, "public", "_headers");

const [middleware, pagesHeaders] = await Promise.all([
  readFile(middlewarePath, "utf8"),
  readFile(pagesHeadersPath, "utf8"),
]);

const expectedHeaders = [
  ["content-security-policy", "base-uri 'self'; object-src 'none'; frame-ancestors 'none'"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
];

for (const [name, value] of expectedHeaders) {
  assert.ok(middleware.includes(`"${name}": "${value}"`));
  const renderedName = name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("-");
  assert.ok(pagesHeaders.includes(`${renderedName}: ${value}`));
}

console.log("R6_SECURITY_RESPONSE_HEADERS_CONSISTENT");
