import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { startLoopbackViteHarness } from "./lib/start-loopback-vite-harness.mjs";

const root = process.cwd();
const harnessRoot = path.join(root, "tests", "visual", "legal-consent-harness");
const configFile = path.join(harnessRoot, "vite.config.ts");

const actual = await startLoopbackViteHarness({ root: harnessRoot, configFile });
try {
  assert.equal(actual.host, "127.0.0.1");
  assert.match(actual.origin, /^http:\/\/127\.0\.0\.1:[1-9]\d*$/);
  assert.equal((await fetch(`${actual.origin}/`, { signal: AbortSignal.timeout(5_000) })).ok, true);
  const address = actual.httpServer.address();
  assert.equal(typeof address, "object");
  assert.equal(address.address, "127.0.0.1");
  assert.equal(address.port, actual.port);
} finally {
  await actual.close();
  await actual.close();
}
assert.equal(actual.httpServer.listening, false);

const syntheticVite = async () => ({
  middlewares(_request, response) { response.end("synthetic"); },
  async close() {},
});
const first = await startLoopbackViteHarness({ root: harnessRoot, configFile, createServer: syntheticVite });
const second = await startLoopbackViteHarness({ root: harnessRoot, configFile, createServer: syntheticVite });
try {
  assert.notEqual(first.port, second.port);
  assert.equal((await fetch(`${first.origin}/`, { signal: AbortSignal.timeout(5_000) })).status, 200);
  assert.equal((await fetch(`${second.origin}/`, { signal: AbortSignal.timeout(5_000) })).status, 200);
} finally {
  await first.close();
  await second.close();
}
assert.equal(first.httpServer.listening, false);
assert.equal(second.httpServer.listening, false);

await assert.rejects(
  startLoopbackViteHarness({
    root: harnessRoot,
    configFile,
    createServer: async () => { throw new Error("synthetic vite creation failure"); },
  }),
  /synthetic vite creation failure/,
);

const executableSources = await Promise.all([
  readFile("scripts/test-legal-consent-visual.mjs", "utf8"),
  readFile("scripts/test-legal-consent-page-gate-visual.mjs", "utf8"),
]);
const forbiddenPortPattern = new RegExp(`\\b${["438", "7"].join("")}\\b|\\b${["439", "0"].join("")}\\b`);
for (const source of executableSources) {
  assert.doesNotMatch(source, forbiddenPortPattern);
  assert.doesNotMatch(source, /localhost/);
  assert.match(source, /startLoopbackViteHarness/);
}

console.log("LOOPBACK_VITE_HARNESS_DYNAMIC_PORT_FIXTURES_OK");
