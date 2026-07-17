const fs = require("fs");
const path = require("path");

const LEGAL_REPOSITORY = "src/lib/server/legal-consent-repository.server.ts";
const LEGAL_ROUTE = "src/pages/api/legal/consent.ts";
const LEGAL_API = "src/lib/server/legal-consent-api.server.ts";
const MODERATION_REPOSITORY = "src/lib/server/moderation-notifications.server.ts";
const RATE_LIMIT_REPOSITORY = "src/lib/server/consume-forum-rate-limit.server.ts";
const MODERATION_ROUTES = [
  "src/pages/api/admin/users/[id]/ban.ts",
  "src/pages/api/admin/users/[id]/clear-warning.ts",
  "src/pages/api/admin/users/[id]/suspend.ts",
  "src/pages/api/admin/users/[id]/unban.ts",
  "src/pages/api/admin/users/[id]/warn.ts",
  "src/pages/api/admin/reports/[id]/action.ts",
];

function read(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function collectServiceRoleHits(rootDir, directory) {
  const hits = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (fs.readFileSync(fullPath, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY")) {
        hits.push(fullPath.replace(rootDir + path.sep, "").replaceAll("\\", "/"));
      }
    }
  };
  walk(directory);
  return hits;
}

function postHandlerSource(apiSource) {
  const start = apiSource.indexOf("export async function handleLegalConsentPost");
  return start === -1 ? "" : apiSource.slice(start);
}

function legalConsentServiceRoleFinding({ relativePath, repositorySource, routeSource, apiSource }) {
  if (relativePath !== LEGAL_REPOSITORY) return "service-role usage is not the narrowly audited legal-consent writer";

  const postHandler = postHandlerSource(apiSource);
  const authIndex = postHandler.indexOf("const auth = await dependencies.authenticate(request);");
  const payloadIndex = postHandler.indexOf("const payload = await parseLegalConsentPostPayload(request);");
  const writerIndex = postHandler.indexOf("const writeRepository = dependencies.createWriteRepository(auth.userId);");
  const firstWriterIndex = postHandler.indexOf("dependencies.createWriteRepository(");
  const writerCallCount = [...postHandler.matchAll(/dependencies\.createWriteRepository\(/g)].length;
  const serviceKeyUses = repositorySource.match(/SUPABASE_SERVICE_ROLE_KEY/g) ?? [];

  const repositoryIsNarrow = [
    /createClient\(requireEnv\(env, "SUPABASE_URL"\), requireEnv\(env, "SUPABASE_SERVICE_ROLE_KEY"\)/.test(repositorySource),
    /function createLegalConsentWriteClient\(env: RuntimeEnv\): Pick<SupabaseClient, "rpc">/.test(repositorySource),
    /export function createLegalConsentWriteRepository\(\s*env: RuntimeEnv,\s*verifiedUserId: string,\s*\)/s.test(repositorySource),
    /const client = createLegalConsentWriteClient\(env\);/.test(repositorySource),
    /client\.rpc\("record_current_legal_policy_acceptance", \{[\s\S]*?p_user_id: verifiedUserId/.test(repositorySource),
    !/client\.(?:from|storage|functions)\(/.test(repositorySource),
    (repositorySource.match(/\.rpc\(/g) ?? []).length === 1,
    serviceKeyUses.length === 1,
    !/(?:console\.|logger\.|throw new Error\([^)]*SUPABASE_SERVICE_ROLE_KEY)/.test(repositorySource),
  ].every(Boolean);

  const routeBindsActor = [
    /const token = getBearerToken\(request\);[\s\S]*?const client = createUserClient\(env, token\);[\s\S]*?client\.auth\.getUser\(token\)/.test(routeSource),
    /userId: data\.user\.id,/.test(routeSource),
    /createWriteRepository:\s*\(verifiedUserId\)\s*=>\s*createLegalConsentWriteRepository\(env, verifiedUserId\)/.test(routeSource),
  ].every(Boolean);

  const apiOrdersWriterAfterAuthAndPayload = authIndex !== -1
    && payloadIndex !== -1
    && writerIndex !== -1
    && firstWriterIndex > payloadIndex
    && payloadIndex < writerIndex
    && writerCallCount === 1;

  if (repositoryIsNarrow && routeBindsActor && apiOrdersWriterAfterAuthAndPayload) return null;
  return "legal-consent service-role writer is missing the exact authenticated actor-bound RPC boundary";
}

function moderationNotificationServiceRoleFinding({ relativePath, repositorySource, routeSources }) {
  if (relativePath !== MODERATION_REPOSITORY) return "service-role usage is not a narrowly audited writer";

  const repositoryIsNarrow = [
    /createClient\(requireEnv\(env, "SUPABASE_URL"\), requireEnv\(env, "SUPABASE_SERVICE_ROLE_KEY"\)/.test(repositorySource),
    /createModerationNotificationWriter\(\s*env: RuntimeEnv,\s*verifiedActorId: string,/s.test(repositorySource),
    /client\.rpc\("insert_forum_notification", \{[\s\S]*?p_actor_id: verifiedActorId/.test(repositorySource),
    !/client\.(?:from|storage|functions)\(/.test(repositorySource),
    (repositorySource.match(/\.rpc\(/g) ?? []).length === 1,
    (repositorySource.match(/SUPABASE_SERVICE_ROLE_KEY/g) ?? []).length === 1,
    /if \(!normalized \|\| !isUuid\(verifiedActorId\) \|\| normalized\.recipientId === verifiedActorId\) return false;/.test(repositorySource),
    !/(?:console\.|logger\.|throw new Error\([^)]*SUPABASE_SERVICE_ROLE_KEY)/.test(repositorySource),
  ].every(Boolean);

  const routesBindTheWriter = MODERATION_ROUTES.every((relativePath) => {
    const source = routeSources[relativePath] ?? "";
    const auth = source.indexOf("requireModerator(request, env)");
    const consent = source.indexOf("const consent = await requireAuthenticatedLegalConsent");
    const writer = source.indexOf("createModerationNotificationWriter(env, auth.user.id)");
    return auth !== -1 && consent > auth && writer > consent && source.includes("notificationWriter,");
  });

  if (repositoryIsNarrow && routesBindTheWriter) return null;
  return "moderation notification writer is missing the exact authenticated actor-bound fixed-RPC boundary";
}

function rateLimitServiceRoleFinding({ relativePath, repositorySource }) {
  if (relativePath !== RATE_LIMIT_REPOSITORY) return "service-role usage is not a narrowly audited writer";
  const safe = [
    /createClient\(requireEnv\(env, "SUPABASE_URL"\), requireEnv\(env, "SUPABASE_SERVICE_ROLE_KEY"\)/.test(repositorySource),
    /client\.rpc\("consume_forum_rate_limit", \{[\s\S]*p_user_id: input\.userId[\s\S]*p_ip_hash: input\.ipHash[\s\S]*p_purpose: input\.purpose[\s\S]*p_bytes: input\.bytes/s.test(repositorySource),
    !/client\.(?:from|storage|functions)\(/.test(repositorySource),
    (repositorySource.match(/\.rpc\(/g) ?? []).length === 1,
    (repositorySource.match(/SUPABASE_SERVICE_ROLE_KEY/g) ?? []).length === 1,
    /RATE_LIMIT_RUNTIME_DEADLINE_MS = 4_000/.test(repositorySource),
    /controller\.abort\(\)/.test(repositorySource),
    !/(?:console\.|logger\.|throw new Error\([^)]*SUPABASE_SERVICE_ROLE_KEY)/.test(repositorySource),
  ].every(Boolean);
  return safe ? null : "rate-limit service-role wrapper is not a narrow fail-closed fixed-RPC boundary";
}

function findUnsafeServiceRoleUsage(rootDir, srcDir) {
  const routeSource = read(rootDir, LEGAL_ROUTE);
  const apiSource = read(rootDir, LEGAL_API);
  const routeSources = Object.fromEntries(MODERATION_ROUTES.map((relativePath) => [relativePath, read(rootDir, relativePath)]));

  return collectServiceRoleHits(rootDir, srcDir).flatMap((relativePath) => {
    const repositorySource = read(rootDir, relativePath);
    const finding = relativePath === LEGAL_REPOSITORY
      ? legalConsentServiceRoleFinding({ relativePath, repositorySource, routeSource, apiSource })
      : relativePath === RATE_LIMIT_REPOSITORY
        ? rateLimitServiceRoleFinding({ relativePath, repositorySource })
        : moderationNotificationServiceRoleFinding({ relativePath, repositorySource, routeSources });
    return finding ? [`${relativePath}: ${finding}`] : [];
  });
}

module.exports = { findUnsafeServiceRoleUsage, legalConsentServiceRoleFinding, moderationNotificationServiceRoleFinding, rateLimitServiceRoleFinding };
