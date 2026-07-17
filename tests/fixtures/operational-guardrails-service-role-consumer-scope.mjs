export const SERVICE_ROLE_BINDING = "SUPABASE_SERVICE_ROLE_KEY";

export const ACTIVE_CONSUMERS = [
  {
    path: "src/lib/server/legal-consent-repository.server.ts",
    purpose: "legal-consent acceptance RPC",
    importerPaths: ["src/pages/api/legal/consent.ts"],
  },
  {
    path: "src/lib/server/moderation-notifications.server.ts",
    purpose: "moderation notification RPC",
    importerPaths: [
      "src/pages/api/admin/reports/[id]/action.ts",
      "src/pages/api/admin/users/[id]/ban.ts",
      "src/pages/api/admin/users/[id]/clear-warning.ts",
      "src/pages/api/admin/users/[id]/suspend.ts",
      "src/pages/api/admin/users/[id]/unban.ts",
      "src/pages/api/admin/users/[id]/warn.ts",
    ],
  },
  {
    path: "src/lib/server/consume-forum-rate-limit.server.ts",
    purpose: "fixed forum rate-limit RPC",
    importerPaths: ["src/lib/server/rate-limit.ts"],
  },
];

export function assertExactConsumerAllowlist(allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length !== ACTIVE_CONSUMERS.length) {
    throw new Error("service-role consumer allowlist must contain the exact reviewed paths");
  }
  const expected = new Set(ACTIVE_CONSUMERS.map((consumer) => consumer.path));
  const actual = new Set();
  for (const entry of allowlist) {
    if (typeof entry !== "string" || entry.includes("*") || entry.endsWith("/") || !expected.has(entry)) {
      throw new Error("service-role consumer allowlist must use exact reviewed file paths only");
    }
    if (actual.has(entry)) throw new Error("service-role consumer allowlist must not contain duplicate paths");
    actual.add(entry);
  }
  for (const entry of expected) {
    if (!actual.has(entry)) throw new Error("service-role consumer allowlist is missing a reviewed path");
  }
  return true;
}

export const EXACT_APPROVED_ALLOWLIST = ACTIVE_CONSUMERS.map((consumer) => consumer.path);
