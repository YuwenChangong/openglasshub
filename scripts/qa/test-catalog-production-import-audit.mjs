import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileImport, verifyImport, verifyAudit, safeImportFailure } from "./lib/catalog-production-import.mjs";

const time = "2020-01-01T00:00:00.000001+00:00";
const device = { id: "device-a", slug: "owned-device", brand_key: "owned-brand", schema_type: "display_ar", updated_at: time, catalog_normalized: false };
const spec = { id: "spec-a", device_id: device.id, deviceSlug: device.slug, definitionKey: "owned.spec", region: "Global", variant: "", state: "KNOWN", value_text: "existing-admin-value", updated_by: "actor-a", updated_at: time };
const prepared = { sourceSha256: "a".repeat(64), knownValues: 1, initializationSql: "", statements: ["DEVICE", "SPEC"], operations: [
  { entity: "device", row: device }, { entity: "spec", row: { ...spec, value_text: "source-value" } },
] };
const event = { id: "event-a", actor_id: "actor-a", entity_type: "device_spec", entity_id: spec.id, action: "admin_save", changed_fields: { fields: ["valueText"] }, created_at: time };
const fixture = () => ({ devices: [structuredClone(device)], definitions: [], specs: [structuredClone(spec)], sources: [], sourceLinks: [], evidence: [], auditEvents: [structuredClone(event)], auditActor: null });
const provenance = (report, identity = '["owned-device","owned.spec","Global",""]') => report.audit.provenance.find(row => row.identity === identity);

test("same-count audit content tampering cannot pass verification or keep approval digest", () => {
  const before = fixture(), after = fixture(); after.auditEvents[0].changed_fields.fields = ["presentation"];
  assert.throws(() => verifyImport(prepared, before, after, reconcileImport(prepared, before)), /AUDIT/);
  assert.notEqual(reconcileImport(prepared, before).reconciliationSha256, reconcileImport(prepared, after).reconciliationSha256);
});
test("wrong-object event is not provenance for the intended specification", () => {
  const before = fixture(); before.auditEvents[0].entity_id = "other-spec";
  assert.equal(provenance(reconcileImport(prepared, before)).classification, "ADMIN_MARKER_UNAUDITED");
  assert.equal(provenance(reconcileImport(prepared, before)).eventCount, 0);
});
test("contradictory actor for the row's exact latest write is detected", () => {
  const before = fixture(); before.auditEvents[0].actor_id = "actor-b";
  assert.ok(reconcileImport(prepared, before).blockers.some(row => row.classification === "BLOCK_AUDIT_ACTOR_CONTRADICTION"));
});
test("valid admin values and audit events remain unchanged", () => {
  const before = fixture(), plan = reconcileImport(prepared, before);
  assert.equal(plan.blockers.length, 0);
  assert.equal(provenance(plan).classification, "RECORDED_ADMIN_WRITE");
  assert.equal(verifyImport(prepared, before, fixture(), plan), true);
  const changed = fixture(); changed.specs[0].value_text = "source-value";
  assert.throws(() => verifyImport(prepared, before, changed, plan), /EXISTING_ROW_CHANGED/);
});
test("historical row without audit evidence is preserved without fabricated provenance", () => {
  const before = fixture(); before.auditEvents = []; before.specs[0].updated_by = null;
  const plan = reconcileImport(prepared, before);
  assert.equal(plan.blockers.length, 0);
  assert.equal(provenance(plan).classification, "UNAUDITED_NO_PROOF");
  assert.equal(verifyImport(prepared, before, structuredClone(before), plan), true);
});
test("unrelated event does not establish target ownership but is bound and preserved", () => {
  const before = fixture(); before.auditEvents[0].entity_id = "unrelated-device"; before.auditEvents[0].entity_type = "device"; before.auditEvents[0].action = "update";
  const plan = reconcileImport(prepared, before);
  assert.equal(provenance(plan).eventCount, 0);
  assert.equal(plan.audit.unlinkedEventCount, 1);
  assert.equal(verifyImport(prepared, before, structuredClone(before), plan), true);
});
test("audit deletion and identity substitution are rejected", () => {
  const before = fixture(); const removed = fixture(); removed.auditEvents = [];
  assert.throws(() => verifyImport(prepared, before, removed, reconcileImport(prepared, before)), /AUDIT/);
  const substituted = fixture(); substituted.auditEvents[0].id = "substituted";
  assert.throws(() => verifyImport(prepared, before, substituted, reconcileImport(prepared, before)), /AUDIT/);
});
test("unexpected audit insertion cannot pass an otherwise idempotent import", () => {
  const before = fixture(), after = fixture(); after.auditEvents.push({ ...event, id: "unexpected" });
  assert.throws(() => verifyImport(prepared, before, after, reconcileImport(prepared, before)), /AUDIT/);
});
test("safe reconciliation exposes neither actors nor payloads", () => {
  const before = fixture(); const report = reconcileImport(prepared, before);
  assert.ok(report.audit.eventsSha256);
  const text = JSON.stringify(report);
  for (const privateText of ["actor-a", "event-a", "valueText", "existing-admin-value"]) assert.ok(!text.includes(privateText));
});
test("same-time different actors remain ambiguous rather than ordered by random UUID", () => {
  const before = fixture(); before.auditEvents.push({ ...event, id: "event-b", actor_id: "actor-b" });
  assert.ok(reconcileImport(prepared, before).blockers.some(row => row.classification === "BLOCK_AUDIT_OWNERSHIP_AMBIGUOUS"));
});
test("later unaudited history cannot be labelled a verified latest administrator write", () => {
  const before = fixture(); before.specs[0].updated_at = "2020-01-01T00:00:00.000002+00:00";
  before.specs[0].updated_by = "actor-b";
  const plan = reconcileImport(prepared, before);
  assert.equal(plan.blockers.length, 0);
  assert.equal(provenance(plan).classification, "AUDIT_HISTORY_ONLY");
});
test("group provenance requires exact device, group, write time and complete count", () => {
  const before = fixture(); before.specs[0].presentation = { groupKey: "owned_group" };
  before.auditEvents = [{ ...event, entity_type: "device", entity_id: device.id, action: "admin_group_save", changed_fields: { group: "owned_group", count: 1 } }];
  assert.equal(provenance(reconcileImport(prepared, before)).classification, "RECORDED_ADMIN_WRITE");
  before.auditEvents[0].changed_fields.count = 2;
  assert.equal(provenance(reconcileImport(prepared, before)).classification, "ADMIN_MARKER_UNAUDITED");
  assert.ok(reconcileImport(prepared, before).audit.issues.some(issue => issue.classification === "AUDIT_GROUP_MEMBERSHIP_UNVERIFIABLE"));
});
test("unverifiable relevant history blocks proposed NULL initialization, not untouched historical rows", () => {
  const before = fixture(); before.auditEvents = [{ ...event, entity_type: "device", entity_id: device.id, action: "legacy_unknown" }];
  assert.equal(reconcileImport(prepared, before).blockers.length, 0);
  before.devices[0].schema_type = null;
  assert.ok(reconcileImport(prepared, before).blockers.some(row => row.classification === "BLOCK_AUDIT_ACTION_UNVERIFIABLE"));
});
test("only exact trigger-generated device changes are permitted, including postcommit event identity", () => {
  const before = fixture(); before.auditActor = "actor-a"; before.devices[0].schema_type = null;
  const after = structuredClone(before); after.devices[0].schema_type = "display_ar";
  const generated = { ...event, id: "generated", entity_type: "device", entity_id: device.id, action: "update", changed_fields: { fields: ["schema_type"] } };
  after.auditEvents.push(generated);
  const plan = reconcileImport(prepared, before);
  assert.equal(verifyImport(prepared, before, after, plan), true);
  assert.equal(verifyAudit(after, structuredClone(after), { actions: [] }), undefined);
  const substituted = structuredClone(after); substituted.auditEvents[1].id = "substituted-after-commit";
  assert.throws(() => verifyAudit(after, substituted, { actions: [] }), /AUDIT_EXISTING/);
  for (const change of [{ actor_id: "actor-b" }, { entity_id: "other-device" }, { action: "admin_save" }, { changed_fields: { fields: ["publication_status"] } }]) {
    const unexpected = structuredClone(after); Object.assign(unexpected.auditEvents[1], change);
    assert.throws(() => verifyImport(prepared, before, unexpected, plan), /AUDIT/);
  }
  const noActor = fixture(); noActor.devices[0].schema_type = null;
  const unaudited = structuredClone(noActor); unaudited.devices[0].schema_type = "display_ar";
  assert.equal(verifyImport(prepared, noActor, unaudited, reconcileImport(prepared, noActor)), true);
});
test("audit projection fails closed on missing data, overflow and duplicate event identity", () => {
  const before = fixture(); delete before.auditEvents;
  assert.throws(() => reconcileImport(prepared, before), /AUDIT_SNAPSHOT/);
  const large = fixture(); large.auditEvents = Array(50001).fill(event);
  assert.throws(() => reconcileImport(prepared, large), /AUDIT_SNAPSHOT/);
  const duplicate = fixture(); duplicate.auditEvents.push({ ...event });
  assert.throws(() => reconcileImport(prepared, duplicate), /AUDIT_SNAPSHOT/);
  const safe = safeImportFailure(Object.assign(new Error("private event payload"), { importCode: "IMPORT_AUDIT_UNEXPECTED_EVENT" }), "VERIFY", 1, true);
  assert.equal(safe.failureClass, "IMPORT_AUDIT_UNEXPECTED_EVENT");
  assert.ok(!JSON.stringify(safe).includes("payload"));
});
