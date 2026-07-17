import {
  BINDING_NAME,
  CLASSIFICATIONS,
  CLOUDFLARE_PAGES_PROJECT,
  ENVIRONMENTS,
  PACKET_VERSION,
  expectedPacketKeys,
} from "../tests/fixtures/operational-guardrails-service-role-binding-proof.mjs";

const shaPattern = /^[0-9a-f]{40}$/i;

export function inspectServiceRoleBindingPacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) throw new Error("packet must be one JSON object");
  const keys = Object.keys(packet).sort();
  const expected = [...expectedPacketKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error("packet keys are not exact metadata-only schema");
  if (packet.packet_version !== PACKET_VERSION) throw new Error("wrong packet version");
  if (!shaPattern.test(packet.source_commit ?? "")) throw new Error("invalid source commit");
  if (packet.cloudflare_pages_project !== CLOUDFLARE_PAGES_PROJECT) throw new Error("unexpected Cloudflare Pages project");
  if (!ENVIRONMENTS.includes(packet.environment)) throw new Error("invalid environment");
  if (packet.expected_binding_name !== BINDING_NAME || packet.source_binding_name !== BINDING_NAME) throw new Error("binding name mismatch");
  if (!CLASSIFICATIONS.includes(packet.classification)) throw new Error("invalid classification");
  if (!Number.isInteger(packet.exact_binding_count) || packet.exact_binding_count < 0) throw new Error("invalid binding count");
  if (!Number.isInteger(packet.conflicting_binding_count) || packet.conflicting_binding_count < 0) throw new Error("invalid conflicting binding count");
  if (!Number.isInteger(packet.browser_exposed_binding_count) || packet.browser_exposed_binding_count < 0) throw new Error("invalid browser-exposed binding count");
  const expectedClassificationMetadata = {
    SECRET_BINDING_PRESENT: [true, "secret", 1, 0, 0],
    BINDING_ABSENT: [false, "absent", 0, 0, 0],
    PLAINTEXT_BINDING_PRESENT: [true, "plaintext", 1, 0, 0],
    CONFLICTING_BINDINGS_PRESENT: [true, "secret", 2, 1, 0],
    BROWSER_EXPOSURE_CONFLICT: [true, "secret", 1, 0, 1],
    INSUFFICIENT_EVIDENCE: [false, "unknown", 0, 0, 0],
  }[packet.classification];
  if ([packet.binding_exists, packet.binding_storage_kind, packet.exact_binding_count, packet.conflicting_binding_count, packet.browser_exposed_binding_count].some((value, index) => value !== expectedClassificationMetadata[index])) throw new Error("classification does not match metadata");
  if (packet.operator_evidence_scope !== "CLOUDFLARE_DASHBOARD_METADATA_ONLY_NO_VALUE_VIEWED") throw new Error("invalid operator evidence scope");
  const serialized = JSON.stringify(packet).toLowerCase();
  if (/authorization|access[_-]?token|api[_-]?key|password|secret[_-]?(?:value|hash)|jwt|eyj[a-z0-9_-]{10,}/.test(serialized)) throw new Error("packet contains secret-like material");
  return {
    packetVersion: packet.packet_version,
    environment: packet.environment,
    project: packet.cloudflare_pages_project,
    binding: packet.expected_binding_name,
    classification: packet.classification,
    metadataOnly: true,
  };
}

export function validateServiceRoleBindingPacket(packet) {
  const result = inspectServiceRoleBindingPacket(packet);
  if (result.classification !== "SECRET_BINDING_PRESENT") throw new Error(result.classification);
  return result;
}
