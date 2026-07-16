export const BINDING_NAME = "SUPABASE_SERVICE_ROLE_KEY";
export const PACKET_VERSION = "openglasshub-service-role-binding-proof-v1";
export const CLOUDFLARE_PAGES_PROJECT = "openglasshub";
export const ENVIRONMENTS = ["preview", "production"];

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
  "conflicting_binding_names",
  "browser_exposed_binding_count",
  "operator_evidence_scope",
];

export function validPacket(environment = "preview") {
  return {
    packet_version: PACKET_VERSION,
    source_commit: "c6d8f4a9047c344a2a668bf1c4c7fc4db96a0c32",
    cloudflare_pages_project: CLOUDFLARE_PAGES_PROJECT,
    environment,
    expected_binding_name: BINDING_NAME,
    source_binding_name: BINDING_NAME,
    binding_exists: true,
    binding_storage_kind: "secret",
    exact_binding_count: 1,
    conflicting_binding_names: [],
    browser_exposed_binding_count: 0,
    operator_evidence_scope: "CLOUDFLARE_DASHBOARD_METADATA_ONLY_NO_VALUE_VIEWED",
  };
}

export const proofCases = {
  missing: { ...validPacket(), binding_exists: false, exact_binding_count: 0 },
  duplicate: { ...validPacket(), exact_binding_count: 2 },
  plaintext: { ...validPacket(), binding_storage_kind: "plaintext" },
  mismatch: { ...validPacket(), source_binding_name: "OTHER_BINDING" },
};
