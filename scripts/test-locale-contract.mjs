import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { defineUiMessages, formatUiMessage, getUiMessages } from "../src/lib/i18n/catalog.ts";

const saved = (preference) => ({ version: 1, preference, generation: 4, provenance: "device_explicit" });
for (const [name, input, want] of [
  ["manual Chinese beats non-CN", { current: "zh-CN", trustedCountry: "US" }, "zh-CN"],
  ["manual English beats CN", { current: "en", trustedCountry: "CN" }, "en"],
  ["saved Chinese beats country", { saved: saved("zh-CN"), trustedCountry: "US" }, "zh-CN"],
  ["saved English beats country", { saved: saved("en"), trustedCountry: "CN" }, "en"],
  ["current Auto removes saved lock", { current: "auto", saved: saved("en"), trustedCountry: "CN" }, "zh-CN"],
  ["current choice beats saved choice", { current: "en", saved: saved("zh-CN") }, "en"],
  ["no input falls back to English", {}, "en"],
]) {
  test(name, () => assert.equal(resolveLocale(input).locale, want));
}
test("invalid preference becomes Auto", () => {
  const result = resolveLocale({ current: "fr" });
  assert.equal(result.preference, "auto");
  assert.equal(result.locale, "en");
});
test("context retains choice provenance without detection data", () => {
  assert.deepEqual(resolveLocale({ saved: saved("zh-CN"), trustedCountry: "US" }), {
    locale: "zh-CN", preference: "zh-CN", source: "saved", autoLocale: "en",
    generation: 4, provenance: "device_explicit",
  });
});
test("supported catalogs expose symmetric translated shell controls", () => {
  const zh = getUiMessages("zh-CN");
  const en = getUiMessages("en");
  assert.deepEqual(Object.keys(zh.shell).sort(), Object.keys(en.shell).sort());
  assert.notEqual(zh.shell.settings, en.shell.settings);
  assert.equal(en.shell.settings, "Settings");
});
test("missing catalog key fails visibly rather than borrowing another locale", () => {
  assert.throws(() => defineUiMessages({ "zh-CN": { label: "x" }, en: {} }), /key/i);
});
test("interpolation arguments must agree across catalog locales", () => {
  assert.throws(() => defineUiMessages({ "zh-CN": { label: "{user}" }, en: { label: "{name}" } }), /argument/i);
});
test("named interpolation preserves literal values and rejects omitted or surplus args", () => {
  assert.equal(formatUiMessage("Hello {name}; {count} items", { name: "{count}", count: 2 }), "Hello {count}; 2 items");
  assert.throws(() => formatUiMessage("Hello {name}", {}), /argument/i);
  assert.throws(() => formatUiMessage("Hello {name}", { name: "QA", country: "CN" }), /argument/i);
});
