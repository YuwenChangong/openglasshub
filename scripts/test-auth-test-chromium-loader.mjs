import assert from "node:assert/strict";
import { test } from "node:test";
import { loadChromium } from "./lib/load-auth-test-chromium.mjs";

const missing = () => Object.assign(new Error("Cannot find package 'playwright' imported from fixture"), { code: "ERR_MODULE_NOT_FOUND" });
test("installed Playwright evaluation errors are preserved", async () => {
  const broken = new SyntaxError("broken installed package");
  await assert.rejects(loadChromium({ importModule: async () => { throw broken; }, readDirectory: async () => [] }), (error) => error === broken);
});
test("missing transitive dependency is not mistaken for missing Playwright", async () => {
  const broken = Object.assign(new Error("Cannot find package 'internal-dependency' imported from playwright"), { code: "ERR_MODULE_NOT_FOUND" });
  await assert.rejects(loadChromium({ importModule: async () => { throw broken; }, readDirectory: async () => [] }), (error) => error === broken);
});
test("absent runtime directory produces a bounded unavailable error", async () => {
  await assert.rejects(loadChromium({ importModule: async () => { throw missing(); }, readDirectory: async () => { throw Object.assign(new Error("private directory"), { code: "ENOENT" }); } }), { message: "Playwright runtime unavailable" });
});
test("expected missing package uses desktop fallback", async () => {
  const chromium = {};
  assert.equal(await loadChromium({ importModule: async (specifier) => { if (specifier === "playwright") throw missing(); return { chromium }; }, readDirectory: async () => ["v1"], access: async () => {} }), chromium);
});
test("broken fallback evaluation is preserved", async () => {
  const broken = new Error("broken fallback");
  await assert.rejects(loadChromium({ importModule: async (specifier) => { if (specifier === "playwright") throw missing(); throw broken; }, readDirectory: async () => ["v1"], access: async () => {} }), (error) => error === broken);
});
test("missing candidate is skipped but filesystem access errors are preserved", async () => {
  const denied = Object.assign(new Error("private path"), { code: "EACCES" });
  await assert.rejects(loadChromium({ importModule: async () => { throw missing(); }, readDirectory: async () => ["v1"], access: async () => { throw denied; } }), (error) => error === denied);
  await assert.rejects(loadChromium({ importModule: async () => { throw missing(); }, readDirectory: async () => ["v1"], access: async () => { throw Object.assign(new Error("absent"), { code: "ENOENT" }); } }), { message: "Playwright runtime unavailable" });
});
