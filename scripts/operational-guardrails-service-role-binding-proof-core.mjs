import {
  BINDING_NAME,
  CLOUDFLARE_PAGES_PROJECT,
  ENVIRONMENTS,
  PACKET_VERSION,
  expectedPacketKeys,
} from "../tests/fixtures/operational-guardrails-service-role-binding-proof.mjs";

const shaPattern = /^[0-9a-f]{40}$/i;

export function validateServiceRoleBindingPacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) throw new Error("packet must be one JSON object");
  const keys = Object.keys(packet).sort();
  const expected = [...expectedPacketKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error("packet keys are not exact metadata-only schema");
  if (packet.packet_version !== PACKET_VERSION) throw new Error("wrong packet version");
  if (!shaPattern.test(packet.source_commit ?? "")) throw new Error("invalid source commit");
  if (packet.cloudflare_pages_project !== CLOUDFLARE_PAGES_PROJECT) throw new Error("unexpected Cloudflare Pages project");
  if (!ENVIRONMENTS.includes(packet.environment)) throw new Error("invalid environment");
  if (packet.expected_binding_name !== BINDING_NAME || packet.source_binding_name !== BINDING_NAME) throw new Error("binding name mismatch");
  if (packet.binding_exists !== true) throw new Error("required binding is missing");
  if (packet.binding_storage_kind !== "secret") throw new Error("binding is not a secret");
  if (packet.exact_binding_count !== 1) throw new Error("binding is duplicated or missing");
  if (!Array.isArray(packet.conflicting_binding_names) || packet.conflicting_binding_names.length !== 0) throw new Error("conflicting binding exists");
  if (packet.browser_exposed_binding_count !== 0) throw new Error("browser-exposed binding exists");
  if (packet.operator_evidence_scope !== "CLOUDFLARE_DASHBOARD_METADATA_ONLY_NO_VALUE_VIEWED") throw new Error("invalid operator evidence scope");
  const serialized = JSON.stringify(packet).toLowerCase();
  if (/authorization|access[_-]?token|api[_-]?key|password|secret[_-]?(?:value|hash)|jwt|eyj[a-z0-9_-]{10,}/.test(serialized)) throw new Error("packet contains secret-like material");
  return {
    packetVersion: packet.packet_version,
    environment: packet.environment,
    project: packet.cloudflare_pages_project,
    binding: packet.expected_binding_name,
    metadataOnly: true,
  };
}
