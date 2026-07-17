export const BINDING_NAME = "SUPABASE_SERVICE_ROLE_KEY";
export const PACKET_VERSION = "openglasshub-service-role-binding-proof-v1";
export const CLOUDFLARE_PAGES_PROJECT = "openglasshub";
export const ENVIRONMENTS = ["preview", "production"];
export const CLASSIFICATIONS = [
  "SECRET_BINDING_PRESENT",
  "BINDING_ABSENT",
  "PLAINTEXT_BINDING_PRESENT",
  "CONFLICTING_BINDINGS_PRESENT",
  "BROWSER_EXPOSURE_CONFLICT",
  "INSUFFICIENT_EVIDENCE",
];

export const expectedPacketKeys = [
  "packet_version",
  "source_commit",
  "cloudflare_pages_project",
  "environment",
  "expected_binding_name",
  "source_binding_name",
  "binding_exists",
  "binding_storage_kind",
  "exact_binding_count",
  "conflicting_binding_count",
  "browser_exposed_binding_count",
  "classification",
  "operator_evidence_scope",
];

export function packetForClassification(classification, environment = "preview") {
  const packet = {
    packet_version: PACKET_VERSION,
    source_commit: "c6d8f4a9047c344a2a668bf1c4c7fc4db96a0c32",
    cloudflare_pages_project: CLOUDFLARE_PAGES_PROJECT,
    environment,
    expected_binding_name: BINDING_NAME,
    source_binding_name: BINDING_NAME,
    binding_exists: true,
    binding_storage_kind: "secret",
    exact_binding_count: 1,
    conflicting_binding_count: 0,
    browser_exposed_binding_count: 0,
    classification,
    operator_evidence_scope: "CLOUDFLARE_DASHBOARD_METADATA_ONLY_NO_VALUE_VIEWED",
  };
  if (classification === "BINDING_ABSENT") Object.assign(packet, { binding_exists: false, binding_storage_kind: "absent", exact_binding_count: 0 });
  if (classification === "PLAINTEXT_BINDING_PRESENT") Object.assign(packet, { binding_storage_kind: "plaintext" });
  if (classification === "CONFLICTING_BINDINGS_PRESENT") Object.assign(packet, { exact_binding_count: 2, conflicting_binding_count: 1 });
  if (classification === "BROWSER_EXPOSURE_CONFLICT") Object.assign(packet, { browser_exposed_binding_count: 1 });
  if (classification === "INSUFFICIENT_EVIDENCE") Object.assign(packet, { binding_exists: false, binding_storage_kind: "unknown", exact_binding_count: 0 });
  return packet;
}

export function validPacket(environment = "preview") {
  return packetForClassification("SECRET_BINDING_PRESENT", environment);
}

export const proofCases = {
  missing: packetForClassification("BINDING_ABSENT"),
  duplicate: packetForClassification("CONFLICTING_BINDINGS_PRESENT"),
  plaintext: packetForClassification("PLAINTEXT_BINDING_PRESENT"),
  browser: packetForClassification("BROWSER_EXPOSURE_CONFLICT"),
  insufficient: packetForClassification("INSUFFICIENT_EVIDENCE"),
  mismatch: { ...validPacket(), source_binding_name: "OTHER_BINDING" },
};
