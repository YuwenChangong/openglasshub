const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const LEGAL_REPOSITORY = "src/lib/server/legal-consent-repository.server.ts";
const LEGAL_ROUTE = "src/pages/api/legal/consent.ts";
const LEGAL_API = "src/lib/server/legal-consent-api.server.ts";
const MODERATION_REPOSITORY = "src/lib/server/moderation-notifications.server.ts";
const RATE_LIMIT_REPOSITORY = "src/lib/server/consume-forum-rate-limit.server.ts";
const LOGIN_CHALLENGE = "src/lib/server/login-challenge.server.ts";
const LOGOUT_ROUTE = "src/pages/api/auth/logout.ts";
const SIGNUP_ROUTE = "src/pages/api/auth/signup-confirm.ts";
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
    /client\.rpc\("ogh_record_policy_acceptance", \{[\s\S]*?p_user_id: verifiedUserId/.test(repositorySource),
    !/record_current_legal_policy_acceptance|p_minimum_age|\.from\(/.test(repositorySource),
    !/client\.(?:from|storage|functions)\(/.test(repositorySource),
    (repositorySource.match(/\.rpc\(/g) ?? []).length === 2,
    /client\.rpc\("ogh_has_current_policy_acceptance", \{/.test(repositorySource),
    serviceKeyUses.length === 1,
    !/(?:console\.|logger\.|throw new Error\([^)]*SUPABASE_SERVICE_ROLE_KEY)/.test(repositorySource),
  ].every(Boolean);

  const tokenIndex = routeSource.indexOf("const token = getBearerToken(request);");
  const claimsIndex = routeSource.indexOf("claims = await getTrustedSessionClaims(token, env);");
  const liveUserIndex = routeSource.indexOf("await getLiveProviderSessionUser(token, env, claims);");
  const clientIndex = routeSource.indexOf("const client = createUserClient(env, token);");
  const actorIndex = routeSource.indexOf("userId: claims.userId,");
  const routeBindsActor = tokenIndex !== -1
    && tokenIndex < claimsIndex && claimsIndex < liveUserIndex
    && liveUserIndex < clientIndex && clientIndex < actorIndex
    && /createWriteRepository:\s*\(verifiedUserId\)\s*=>\s*createLegalConsentWriteRepository\(env, verifiedUserId\)/.test(routeSource);

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

function verifiedSessionServiceRoleFinding(relativePath, source) {
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nodes = [];
  const visit = (node) => { nodes.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  const member = (node) => ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
  const callName = (node) => ts.isCallExpression(node) ? (ts.isIdentifier(node.expression) ? node.expression.text : member(node.expression)) : null;
  const calls = nodes.filter(ts.isCallExpression);
  const functions = new Map(nodes.filter(ts.isFunctionDeclaration).filter((node) => node.name).map((node) => [node.name.text, node]));
  const functionCalls = (name) => {
    const body = functions.get(name)?.body;
    return body ? calls.filter((node) => node.pos >= body.pos && node.end <= body.end) : [];
  };
  const keyIn = (node) => {
    let found = false;
    const scan = (part) => {
      if ((ts.isIdentifier(part) || ts.isStringLiteralLike(part)) && part.text === "SUPABASE_SERVICE_ROLE_KEY") found = true;
      ts.forEachChild(part, scan);
    };
    if (node) scan(node);
    return found;
  };
  const isServiceCreate = (node) => callName(node) === "createClient" && keyIn(node.arguments[1]);
  const serviceCreates = calls.filter(isServiceCreate);
  const firstCall = (within, name) => within.find((node) => callName(node) === name);
  const guardedBefore = (within, guard, create) => {
    const guardCall = firstCall(within, guard);
    const createCall = within.find(create);
    return Boolean(guardCall && createCall && guardCall.pos < createCall.pos);
  };
  const objectValue = (node, key) => ts.isObjectLiteralExpression(node)
    ? node.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(tree) === key)?.initializer
    : null;
  const isClaimsMember = (node, field) => ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === "claims" && node.name.text === field;
  const namedRpcCalls = calls.filter((node) => callName(node) === "rpc"
    && node.arguments.some((arg) => ts.isStringLiteralLike(arg) && arg.text.startsWith("ogh_")));
  const rpcName = (node) => node.arguments.find((arg) => ts.isStringLiteralLike(arg) && arg.text.startsWith("ogh_"))?.text;
  const rpcArgs = (node) => node.arguments.find(ts.isObjectLiteralExpression);
  const expected = relativePath === LOGIN_CHALLENGE
    ? ["ogh_consume_login_challenge", "ogh_finalize_login_delivery", "ogh_reserve_login_challenge"]
    : relativePath === LOGOUT_ROUTE
      ? ["ogh_revoke_verified_session"]
      : ["ogh_activate_signup_session", "ogh_record_policy_acceptance"];
  const rpcNames = namedRpcCalls.map(rpcName).sort();
  const directRpcCalls = calls.filter((node) => member(node.expression) === "rpc");
  const callsFixedRpc = JSON.stringify(rpcNames) === JSON.stringify(expected)
    && directRpcCalls.length === (relativePath === LOGIN_CHALLENGE ? 1 : expected.length)
    && namedRpcCalls.every((node) => isClaimsMember(objectValue(rpcArgs(node), "p_user_id"), "userId")
      && (rpcName(node) === "ogh_record_policy_acceptance" || isClaimsMember(objectValue(rpcArgs(node), "p_session_id"), "sessionId")));
  const noBroadClient = !nodes.some((node) => {
    const property = member(node);
    if (!["from", "storage", "functions", "admin"].includes(property)) return false;
    const globalArray = property === "from" && ts.isIdentifier(node.expression) && node.expression.text === "Array"
      && !nodes.some((part) => ts.isVariableDeclaration(part) && ts.isIdentifier(part.name) && part.name.text === "Array");
    return !globalArray;
  });
  const serviceKeyUsesMatch = serviceCreates.length === 1;
  const actorBound = relativePath === LOGIN_CHALLENGE
    ? serviceCreates[0]?.pos >= functions.get("serviceClient")?.body?.pos
      && serviceCreates[0]?.end <= functions.get("serviceClient")?.body?.end
      && guardedBefore(functionCalls("issue"), "signedClaims", (node) => callName(node) === "serviceClient")
      && guardedBefore(functionCalls("verifyChallenge"), "signedClaims", (node) => callName(node) === "serviceClient")
      && Boolean(firstCall(functionCalls("issue"), "getCurrentConfirmedAuthUser"))
    : relativePath === LOGOUT_ROUTE
      ? guardedBefore(functionCalls("handleLogout"), "getTrustedSessionClaims", isServiceCreate)
        && guardedBefore(functionCalls("handleLogout"), "getLiveProviderSessionUser", isServiceCreate)
      : guardedBefore(functionCalls("handleSignupConfirm"), "verifyOtp", isServiceCreate)
        && guardedBefore(functionCalls("handleSignupConfirm"), "getTrustedSessionClaims", isServiceCreate)
        && guardedBefore(functionCalls("handleSignupConfirm"), "getCurrentConfirmedAuthUser", isServiceCreate)
        && functionCalls("handleSignupConfirm").some((node) => {
          if (callName(node) !== "verifyOtp") return false;
          const type = objectValue(node.arguments[0], "type");
          return type && ts.isStringLiteralLike(type) && type.text === "signup";
        });
  return callsFixedRpc && noBroadClient && serviceKeyUsesMatch && actorBound
    ? null : "verified-session service-role caller is not limited to actor-bound fixed RPCs";
}

function findUnsafeServiceRoleUsage(rootDir, srcDir) {
  const routeSource = read(rootDir, LEGAL_ROUTE);
  const apiSource = read(rootDir, LEGAL_API);
  const routeSources = Object.fromEntries(MODERATION_ROUTES.map((relativePath) => [relativePath, read(rootDir, relativePath)]));

  return collectServiceRoleHits(rootDir, srcDir).flatMap((relativePath) => {
    const repositorySource = read(rootDir, relativePath);
    const finding = [LOGIN_CHALLENGE, LOGOUT_ROUTE, SIGNUP_ROUTE].includes(relativePath)
      ? verifiedSessionServiceRoleFinding(relativePath, repositorySource)
      : relativePath === LEGAL_REPOSITORY
      ? legalConsentServiceRoleFinding({ relativePath, repositorySource, routeSource, apiSource })
      : relativePath === RATE_LIMIT_REPOSITORY
        ? rateLimitServiceRoleFinding({ relativePath, repositorySource })
        : moderationNotificationServiceRoleFinding({ relativePath, repositorySource, routeSources });
    return finding ? [`${relativePath}: ${finding}`] : [];
  });
}

module.exports = { findUnsafeServiceRoleUsage, legalConsentServiceRoleFinding, moderationNotificationServiceRoleFinding, rateLimitServiceRoleFinding, verifiedSessionServiceRoleFinding };
