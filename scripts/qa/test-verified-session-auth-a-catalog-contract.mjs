import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CATALOG_FAMILIES, CATALOG_FIELDS, CATALOG_SQL, catalogPacket,
  normalizeCatalogCapture } from "../lib/verified-session-catalog-contract.mjs";
import { loadReadOnlyPacketUnits } from "./p9-readonly-postgres-transport.mjs";
import { AUTH_A_CATALOG_SHA256 } from "./verified-session-auth-a-db-capture.mjs";

const REVIEWED_QUERY_HASHES = Object.freeze({
  schemas: "e9c31408cb3db514c88b8f7d804b10c54fc5770634cce69db13fe144fc0639e2",
  objects: "87cd868d95c9e99ceb7bb2cc995ee8531c87db31e70a463886f7e7c00d050a64",
  tables: "f3c0e544ba361a2c203e74a814f8442c3b975bd99ec718a705736b2ba8b64e22",
  columns: "902bcb41588c0498918da82434ebd431011705c209d2005308bb70ae341abf33",
  constraints: "c1733fbfbbdd0a59821a4dc76a186ac2ed5a53ce13b23a1a9c26ad14b4f59092",
  indexes: "13afa652871fff8379a9a138ed9a1077991c398ff996cb0407c6c8169bb16761",
  functions: "542cf5f0f0a970066147d418804d7165d0c7f1db1571928d12ad458d5e0afc95",
  policies: "19f625b52a3c666674c343e7b7da5256d5029da4e929b2b919ac8a7e83a410e9",
  rls: "40eb66f3b8c571f0d22c2275164432bf62dffbcd8714ec51c413e2f89ad34c13",
  readAcl: "a2f21948137f99afcc12a00fcf15ce7b084bedbc22ade55b7505002e049348dd",
  publication: "eb16f9381dff88c9a1ab0c9c03f42806eee55cffa53c590da2ed00f31abca5d6",
});

test("AUTH-A catalog packet is generated from the sole ordered metadata contract", () => {
  const packet = readFileSync("docs/ops/verified-session-v1-hosted-catalog-preflight.sql", "utf8");
  assert.equal(packet, catalogPacket());
  assert.equal(new Set(CATALOG_FAMILIES).size, 11);
  assert.deepEqual(Object.keys(CATALOG_SQL), CATALOG_FAMILIES);
  assert.deepEqual(Object.keys(CATALOG_FIELDS), CATALOG_FAMILIES);
  assert.deepEqual(Object.keys(REVIEWED_QUERY_HASHES), CATALOG_FAMILIES);
  const ids = CATALOG_FAMILIES.map((_, index) => `CATALOG_${String(index + 1).padStart(2, "0")}`);
  assert.equal(new Set(ids).size, 11);
  assert.equal(loadReadOnlyPacketUnits({ packet, packetContract: {
    packetHash: AUTH_A_CATALOG_SHA256.toUpperCase(), queryIds: ids } }).length, 11);
  for (const family of CATALOG_FAMILIES) {
    assert.equal(createHash("sha256").update(CATALOG_SQL[family]).digest("hex"), REVIEWED_QUERY_HASHES[family]);
    assert.match(CATALOG_SQL[family], /^SELECT\b/i);
    const sources = [...CATALOG_SQL[family].matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z_.]*)/gi)]
      .map((match) => match[1].toLowerCase());
    assert.ok(sources.length > 0);
    const allowed = new Set(["pg_namespace", "pg_class", "pg_proc", "pg_type", "pg_constraint",
      "pg_indexes", "pg_language", "pg_policies", "pg_publication_tables", "information_schema.columns"]);
    assert.ok(sources.every((source) => allowed.has(source)), `${family}: catalog sources only`);
  }
  assert.throws(() => normalizeCatalogCapture([]), /AUTH_A_CATALOG_CONTRACT_INVALID/);
});
