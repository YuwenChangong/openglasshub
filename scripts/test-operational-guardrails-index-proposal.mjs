import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const directory = path.join(root, "docs", "ops", "reconciliation");
const preflight = await readFile(path.join(directory, "operational-guardrails-index-execution-preflight.sql"), "utf8");
const stageA = await readFile(path.join(directory, "operational-guardrails-index-stage-a-proposal.sql"), "utf8");
const stageB = await readFile(path.join(directory, "operational-guardrails-index-stage-b-proposal.sql"), "utf8");
const postflight = await readFile(path.join(directory, "operational-guardrails-index-postflight.sql"), "utf8");
const checklist = await readFile(path.join(directory, "operational-guardrails-index-execution-checklist.md"), "utf8");
const executable = (sql) => sql.replace(/--[^\n]*/g, "");

for (const [name, sql] of [["preflight", preflight], ["postflight", postflight]]) {
  assert.match(executable(sql), /^\s*BEGIN TRANSACTION READ ONLY;/, `${name} must start read-only`);
  assert.match(executable(sql), /\nROLLBACK;\s*$/, `${name} must roll back`);
  assert.doesNotMatch(executable(sql), /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/im, `${name} must not write`);
}
for (const [name, sql, indexName, keys] of [
  ["stage A", stageA, "forum_upload_attempts_purpose_ip_created_idx", "purpose, ip_hash, created_at DESC"],
  ["stage B", stageB, "forum_upload_attempts_purpose_user_created_idx", "purpose, user_id, created_at DESC"],
]) {
  assert.match(sql, /UNEXECUTED\. PRODUCTION_REVIEW_PROPOSAL/);
  assert.match(executable(sql), new RegExp(`^\\s*CREATE INDEX CONCURRENTLY ${indexName}\\s+ON public\\.forum_upload_attempts \\(${keys}\\);\\s*$`, "m"), `${name} must contain exactly its standalone concurrent index`);
  assert.doesNotMatch(executable(sql), /\b(?:BEGIN|COMMIT|ROLLBACK|IF NOT EXISTS|DROP|ALTER|GRANT|REVOKE)\b/i, `${name} must have no transactional or unrelated DDL`);
}
assert.match(preflight, /has_table_privilege\(role_name/);
assert.doesNotMatch(preflight, /has_table_privilege\(\s*'PUBLIC'|to_regrole|auth\.users/i);
assert.match(postflight, /authenticated_select/);
assert.match(checklist, /No policy is dropped/);
await assert.rejects(access(path.join(directory, "operational-guardrails-policy-proposal.sql")));

const changedMigrations = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "supabase/migrations"], { cwd: root, encoding: "utf8" }).trim();
const changedRuntime = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const approvedRuntimeFiles = new Set(["src/lib/server/rate-limit.ts", "src/pages/api/forum/posts.ts", "src/pages/api/forum/comments.ts", "src/pages/api/forum/circles.ts", "src/pages/api/forum/media-upload-guard.ts", "src/pages/api/forum/external-video-upload.ts", "src/lib/server/legal-consent-repository.server.ts", "src/pages/api/legal/consent.ts"]);
assert.equal(changedMigrations, "", "canonical migrations must remain unchanged");
assert.deepEqual(changedRuntime.filter((file) => !approvedRuntimeFiles.has(file)), [], "only approved R4/R6G runtime files may change");

const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).split(/\r?\n/).filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containers.length, 1, "LOCAL_DOCKER_ONLY requires exactly one normalized replay container");
const container = containers[0];
const database = "openglass_w6_index_sim";
const psql = (input, databaseName = database) => {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", databaseName], { input, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

try {
  psql(`DROP DATABASE IF EXISTS ${database}; CREATE DATABASE ${database};`, "postgres");
  psql(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE public.forum_upload_attempts (id uuid PRIMARY KEY, user_id uuid, ip_hash text NOT NULL, bytes bigint NOT NULL DEFAULT 0, purpose text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE public.forum_upload_attempts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY forum_upload_attempts_insert_authenticated ON public.forum_upload_attempts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
    CREATE POLICY forum_upload_attempts_select_authenticated ON public.forum_upload_attempts FOR SELECT TO authenticated USING (true);
    CREATE POLICY forum_upload_attempts_insert_self ON public.forum_upload_attempts FOR INSERT TO authenticated WITH CHECK (((purpose = ANY (ARRAY['post_create'::text, 'comment_create'::text, 'circle_create'::text])) AND (user_id = auth.uid())) OR ((purpose = ANY (ARRAY['post_media_upload'::text, 'external_video_upload'::text])) AND ((user_id = auth.uid()) OR (user_id IS NULL))));
    CREATE POLICY forum_upload_attempts_select_self ON public.forum_upload_attempts FOR SELECT TO authenticated USING ((user_id = auth.uid()) OR (user_id IS NULL));
    CREATE INDEX forum_upload_attempts_created_at_idx ON public.forum_upload_attempts (created_at DESC);
    CREATE INDEX forum_upload_attempts_ip_hash_idx ON public.forum_upload_attempts (ip_hash, created_at DESC);
    CREATE INDEX forum_upload_attempts_user_id_idx ON public.forum_upload_attempts (user_id, created_at DESC);
    REVOKE ALL ON public.forum_upload_attempts FROM anon, authenticated, service_role;
  `);
  psql(stageA, database);
  psql(stageB, database);
  const result = psql(`SELECT jsonb_agg(jsonb_build_object('name', ic.relname, 'valid', pi.indisvalid, 'ready', pi.indisready, 'definition', pg_get_indexdef(ic.oid), 'keys', ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(1, pi.indnkeyatts) AS position)) ORDER BY ic.relname) FROM pg_index pi JOIN pg_class ic ON ic.oid = pi.indexrelid WHERE pi.indrelid = 'public.forum_upload_attempts'::regclass AND ic.relname IN ('forum_upload_attempts_purpose_ip_created_idx', 'forum_upload_attempts_purpose_user_created_idx');`);
  const indexes = JSON.parse(result);
  assert.deepEqual(indexes, [
    { name: "forum_upload_attempts_purpose_ip_created_idx", valid: true, ready: true, definition: "CREATE INDEX forum_upload_attempts_purpose_ip_created_idx ON public.forum_upload_attempts USING btree (purpose, ip_hash, created_at DESC)", keys: ["purpose", "ip_hash", "created_at"] },
    { name: "forum_upload_attempts_purpose_user_created_idx", valid: true, ready: true, definition: "CREATE INDEX forum_upload_attempts_purpose_user_created_idx ON public.forum_upload_attempts USING btree (purpose, user_id, created_at DESC)", keys: ["purpose", "user_id", "created_at"] },
  ]);
  assert.equal(psql("SELECT count(*) FROM pg_policy WHERE polrelid = 'public.forum_upload_attempts'::regclass;"), "4", "index stages must not change policies");
  assert.equal(psql("SELECT has_table_privilege('authenticated', 'public.forum_upload_attempts', 'SELECT')::text || ',' || has_table_privilege('authenticated', 'public.forum_upload_attempts', 'INSERT')::text;"), "false,false", "simulation preserves the production privilege hold");
} finally {
  psql(`DROP DATABASE IF EXISTS ${database};`, "postgres");
}

console.log(JSON.stringify({ localDockerOnly: true, stagedIndexesConverged: true, policyRemovalWithheld: true, realProductionOperations: 0 }));
