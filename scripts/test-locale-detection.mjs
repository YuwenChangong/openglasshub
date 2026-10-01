import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { getTrustedCountry } from "../src/lib/i18n/country.server.ts";
import { resolveAcceptLanguage } from "../src/lib/i18n/accept-language.ts";

for (const [name, input, want, source] of [
  ["CN_AUTO_WITH_EN_HEADER", { trustedCountry: "CN", acceptLanguage: "en-US" }, "zh-CN", "country"],
  ["US_AUTO_WITH_ZH_HEADER", { trustedCountry: "US", acceptLanguage: "zh-CN" }, "en", "country"],
  ["absent country uses Chinese", { acceptLanguage: "zh" }, "zh-CN", "accept_language"],
  ["sentinel uses header", { trustedCountry: "XX", acceptLanguage: "zh-Hans" }, "zh-CN", "accept_language"],
  ["invalid country is not known non-CN", { trustedCountry: "ZZ", acceptLanguage: "zh-CN" }, "zh-CN", "accept_language"],
  ["Tor sentinel uses header", { trustedCountry: "T1", acceptLanguage: "zh" }, "zh-CN", "accept_language"],
  ["malformed country uses header", { trustedCountry: "CN<script>", acceptLanguage: "zh" }, "zh-CN", "accept_language"],
  ["saved manual remains dominant", { saved: { version: 1, preference: "en", generation: 1, provenance: "device_explicit" }, trustedCountry: "CN", acceptLanguage: "zh" }, "en", "saved"],
]) test(name, () => { const result = resolveLocale(input); assert.equal(result.locale, want); assert.equal(result.source, source); assert.equal("country" in result, false); });

for (const [header, want] of [
  [undefined, undefined], ["", undefined], ["zh", "zh-CN"], ["zh-CN", "zh-CN"],
  ["zh-Hans", "zh-CN"], ["zh-Hans-CN", "zh-CN"], ["en-GB", "en"],
  ["zh-Hant;q=1,en;q=0.5", "en"], ["zh-Hant", undefined], ["zh-TW", undefined],
  ["zh;q=0,en;q=0.5", "en"], ["en;q=0,zh", "zh-CN"], ["*", undefined],
  ["fr,zh;q=0.6,en;q=0.8", "en"], ["zh;q=0.8,en;q=0.8", "zh-CN"],
  ["en;q=0.8,zh;q=0.8", "en"], [" EN-us ; q=0.700, zh;q=0.9 ", "zh-CN"],
  ["fr;q=oops,zh", undefined], ["zh;q=1.1", undefined], ["zh;q=-1", undefined],
  ["zh;q=0.1234", undefined], ["zh;q=NaN", undefined], ["zh;x=1", undefined],
  ["zh,,en", undefined], ["zh," , undefined], ["zh;q=0.5;q=0.7", undefined],
  [Array(21).fill("zh").join(","), undefined], [" ".repeat(2048) + "zh", undefined],
]) test(`bounded header ${JSON.stringify(header)?.slice(0,65)}`, () => assert.equal(resolveAcceptLanguage(header), want));

test("20 tags remain eligible", () => assert.equal(resolveAcceptLanguage([...Array(19).fill("fr"), "zh"].join(",")), "zh-CN"));
test("2048-byte header boundary remains eligible", () => assert.equal(resolveAcceptLanguage("zh" + " ".repeat(2046)), "zh-CN"));
test("unavailable detection falls back to English", () => assert.equal(resolveLocale({ trustedCountry: "ZZ", acceptLanguage: "fr" }).locale, "en"));
test("country headers and query do not establish trust", () => {
  const request = new Request("https://example.test/?country=CN", { headers: { "CF-IPCountry": "CN", "X-Forwarded-Country": "CN" } });
  assert.equal(getTrustedCountry(request), undefined);
  Object.defineProperty(request, "cf", { value: { country: "US" } });
  assert.equal(getTrustedCountry(request), "US");
});
for (const country of ["XX", "T1", "ZZ", "cn", "", null, 123]) {
  test(`runtime country rejects ${JSON.stringify(country)}`, () => {
    const request = new Request("https://example.test/");
    Object.defineProperty(request, "cf", { value: { country } });
    assert.equal(getTrustedCountry(request), undefined);
  });
}
