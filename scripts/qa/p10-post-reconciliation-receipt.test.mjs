import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = "docs/ops/p10-post-reconciliation-receipt-read-only.sql";

test("P10RECEIPT-01 freezes a SELECT-only eight-group catalog receipt", async () => {
  const sql = await readFile(path, "utf8");
  const statements = sql.split(";").map((entry) => entry.trim()).filter(Boolean);
  assert.equal(statements.length, 8);
  assert.equal(statements.every((statement) => /^SELECT\b/i.test(statement.replace(/^--[^\n]*\n/, "").trim())), true);
  assert.doesNotMatch(sql, /\bfrom\s+public\.(?:devices|profiles|posts|circles|forum_notifications|news_articles)\b/i);
  for (const identity of ["devices_publication_status_idx", "devices_brand_key_idx", "devices_category_idx", "devices_select_published_public", "devices_select_staff_all", "devices_insert_staff", "devices_update_staff", "devices_delete_staff", "enforce_device_slug_lock", "trg_devices_set_updated_at", "trg_devices_enforce_slug_lock", "20260902042807"]) assert.match(sql, new RegExp(identity));
  assert.match(createHash("sha256").update(sql).digest("hex").toUpperCase(), /^[A-F0-9]{64}$/);
});

test("P10RECEIPT-02 classifies present and absent history without treating absence as failure", async () => {
  const { classifyP10Receipt } = await import("./p10-post-reconciliation-receipt.mjs");
  assert.equal(classifyP10Receipt({ fullDevicesContract: true, historyRowPresent: true }).readyForReleaseAuthorization, true);
  assert.equal(classifyP10Receipt({ fullDevicesContract: true, historyRowPresent: false }).readyForHistoryRegistrationPrep, true);
  assert.equal(classifyP10Receipt({ fullDevicesContract: false, historyRowPresent: false }).readyForReleaseAuthorization, false);
});
