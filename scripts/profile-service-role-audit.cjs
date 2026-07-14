const fs = require("fs");
const path = require("path");

const LEGAL_REPOSITORY = "src/lib/server/legal-consent-repository.server.ts";
const LEGAL_ROUTE = "src/pages/api/legal/consent.ts";
const LEGAL_API = "src/lib/server/legal-consent-api.server.ts";

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
  const writerCallCount = [...postHandler.matchAll(/dependencies\.createWriteRepository\(/g)].length;
  const serviceKeyUses = repositorySource.match(/SUPABASE_SERVICE_ROLE_KEY/g) ?? [];

  const repositoryIsNarrow = [
    /createClient\(requireEnv\(env, "SUPABASE_URL"\), requireEnv\(env, "SUPABASE_SERVICE_ROLE_KEY"\)/.test(repositorySource),
    /createLegalConsentWriteRepository\(\s*client: SupabaseClient,\s*verifiedUserId: string,\s*\)/s.test(repositorySource),
    /client\.rpc\("record_current_legal_policy_acceptance", \{[\s\S]*?p_user_id: verifiedUserId/.test(repositorySource),
    !/client\.(?:from|storage|functions)\(/.test(repositorySource),
    (repositorySource.match(/\.rpc\(/g) ?? []).length === 1,
    serviceKeyUses.length === 1,
    !/(?:console\.|logger\.|throw new Error\([^)]*SUPABASE_SERVICE_ROLE_KEY)/.test(repositorySource),
  ].every(Boolean);

  const routeBindsActor = [
    /const token = getBearerToken\(request\);[\s\S]*?const client = createUserClient\(env, token\);[\s\S]*?client\.auth\.getUser\(token\)/.test(routeSource),
    /userId: data\.user\.id,/.test(routeSource),
    /createWriteRepository:\s*\(verifiedUserId\)\s*=>\s*createLegalConsentWriteRepository\(\s*createLegalConsentServiceClient\(env\),\s*verifiedUserId,\s*\)/s.test(routeSource),
  ].every(Boolean);

  const apiOrdersWriterAfterAuthAndPayload = authIndex !== -1
    && payloadIndex !== -1
    && writerIndex !== -1
    && authIndex < payloadIndex
    && payloadIndex < writerIndex
    && writerCallCount === 1;

  if (repositoryIsNarrow && routeBindsActor && apiOrdersWriterAfterAuthAndPayload) return null;
  return "legal-consent service-role writer is missing the exact authenticated actor-bound RPC boundary";
}

function findUnsafeServiceRoleUsage(rootDir, srcDir) {
  const routeSource = read(rootDir, LEGAL_ROUTE);
  const apiSource = read(rootDir, LEGAL_API);

  return collectServiceRoleHits(rootDir, srcDir).flatMap((relativePath) => {
    const finding = legalConsentServiceRoleFinding({
      relativePath,
      repositorySource: read(rootDir, relativePath),
      routeSource,
      apiSource,
    });
    return finding ? [`${relativePath}: ${finding}`] : [];
  });
}

module.exports = { findUnsafeServiceRoleUsage, legalConsentServiceRoleFinding };
