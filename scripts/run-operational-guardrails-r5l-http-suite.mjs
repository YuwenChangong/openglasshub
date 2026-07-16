// LOCAL_R5L_ONLY
// NO_CLOUD_CONTACT
// NO_PRODUCTION_TARGETS
// DISPOSABLE_FIXTURES_ONLY
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  R5L_LOCAL_ONLY_MARKERS,
  startBuiltPagesWorker,
  waitForWorkerResponse,
} from "./lib/r5l-pages-multimodule-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedHead = "6d6a61a574a4efe6d63d59743828a55bafb998f9";
const expectedProposalHash = "10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createLocalAccessToken({ userId, email, jwtSecret }) {
  assert.match(userId, /^[0-9a-f-]{36}$/i, "local fixture user id must be a UUID");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", email, exp: Math.floor(Date.now() / 1000) + 300 }));
  return `${header}.${payload}.${createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url")}`;
}

export function buildLocalBindings({ anonKey, serviceRoleKey, rateLimitSalt }) {
  return {
    ...Object.fromEntries(R5L_LOCAL_ONLY_MARKERS.map((marker) => [marker, "true"])),
    SUPABASE_URL: "http://127.0.0.1:54321",
    PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: anonKey,
    PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    RATE_LIMIT_SALT: rateLimitSalt,
    SENSITIVE_LEXICON_DISABLE_NODE_LOCAL: "true",
    DEV_TURNSTILE_BYPASS: "true",
    OPENAI_MODERATION_ENABLED: "false",
  };
}

export async function postJson(origin, pathname, { token, body, ip = "127.0.0.2", signal } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-forwarded-for": ip },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  return { status: response.status, body: text };
}

export async function runReadinessOnly({ jwtSecret, fixture, port = 8793 }) {
  const token = createLocalAccessToken({ userId: fixture.userId, email: fixture.email, jwtSecret });
  const bindings = buildLocalBindings({ anonKey: token, serviceRoleKey: token, rateLimitSalt: `r5l-${randomUUID()}` });
  const worker = await startBuiltPagesWorker({ repositoryRoot: root, bindings, port });
  try {
    const readiness = await waitForWorkerResponse(worker.origin, { pathname: "/api/forum/search?q=open" });
    if (readiness.status !== 200) throw new Error(`R5L readiness returned ${readiness.status}`);
    return { ready: true, moduleCount: worker.inspected.modules.length };
  } finally {
    await worker.dispose();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configurationPath = process.argv[2];
  if (!configurationPath) throw new Error("R5L runner requires a local ignored configuration path");
  const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
  if (configuration.head !== expectedHead || configuration.proposalHash !== expectedProposalHash) throw new Error("R5L local configuration baseline mismatch");
  if (!configuration.jwtSecret || !configuration.fixture?.userId || !configuration.fixture?.email) throw new Error("R5L local configuration is incomplete");
  const result = await runReadinessOnly({ jwtSecret: configuration.jwtSecret, fixture: configuration.fixture, port: configuration.port });
  console.log(JSON.stringify({ stage: "worker-readiness", ...result }));
}
