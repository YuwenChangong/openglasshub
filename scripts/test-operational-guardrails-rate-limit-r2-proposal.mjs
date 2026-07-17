import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  negativeFixtureNames,
  r2ExecutionStatus,
  r2Function,
  r2PurposeMatrix,
} from "../tests/fixtures/operational-guardrails-rate-limit-r2-proposal.mjs";
import { assertR2ProposalStaticContract, sha256Hex } from "./operational-guardrails-rate-limit-r2-static-core.mjs";

const paths = {
  proposal: "docs/ops/reconciliation/operational-guardrails-rate-limit-r2-unexecuted-proposal.sql",
  review: "docs/ops/reconciliation/operational-guardrails-rate-limit-r2-proposal-review.md",
  postflight: "docs/ops/reconciliation/operational-guardrails-rate-limit-r2-static-postflight.sql",
  manifest: "docs/ops/reconciliation/operational-guardrails-rate-limit-r2-proposal-manifest.md",
  r3: "docs/ops/reconciliation/operational-guardrails-rate-limit-r3-simulation-readiness.md",
  fingerprint: "docs/ops/reconciliation/operational-guardrails-rate-limit-r2-expected-fingerprint.md",
  runtime: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-runtime-plan.md",
};
const source = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, file]) => [key, await readFile(file, "utf8")])));

assert.equal(r2Function.identity, "public.consume_forum_rate_limit(uuid, text, text, bigint)");
assert.deepEqual(r2Function.arguments, [["p_user_id", "uuid"], ["p_ip_hash", "text"], ["p_purpose", "text"], ["p_bytes", "bigint"]]);
assert.equal(r2Function.returns, "TABLE(allowed boolean, decision text)");
assert.equal(r2Function.owner, "postgres");
assert.equal(r2Function.trustedRole, "service_role");
assert.deepEqual(r2Function.rejectedRoles, ["PUBLIC", "anon", "authenticated"]);
assert.equal(r2ExecutionStatus.r2StaticDesign, "COMPLETE_STATICALLY_VALID");
assert.equal(r2ExecutionStatus.r3Eligible, false);
assert.equal(r2ExecutionStatus.r3LocalSimulation, "R3_PASSED_LOCAL_DISPOSABLE_ONLY");
assert.equal(r2ExecutionStatus.stageC, "BLOCKED_RUNTIME_MIGRATION_REQUIRED");
assert.equal(r2ExecutionStatus.productionIdentity, "PRODUCTION_BINDING_METADATA_READY_R6_SCOPE_BLOCKED");
assert.deepEqual(r2PurposeMatrix.map((row) => row.purpose), ["post_create", "comment_create", "circle_create", "post_media_upload", "external_video_upload", "verification_email_resend"]);
assert.deepEqual(r2PurposeMatrix.filter((row) => row.status === "HUMAN_DECISION_REQUIRED").map((row) => row.purpose), []);
assert.equal(r2PurposeMatrix.find((row) => row.purpose === "post_media_upload")?.bytes, "1..157286400");
assert.equal(r2PurposeMatrix.find((row) => row.purpose === "external_video_upload")?.dailyByteMaximum, 314572800);
assert.equal(r2PurposeMatrix.find((row) => row.purpose === "external_video_upload")?.dailyWindowSeconds, 86400);
assert.equal(r2ExecutionStatus.lockTimeout, "1s");
assert.equal(r2ExecutionStatus.statementTimeout, "3s");
assert.equal(r2ExecutionStatus.futureRuntimeDeadlineMs, 4000);
assert.equal(r2ExecutionStatus.retryPolicy, "NO_AUTOMATIC_RETRY");
assert.equal(r2ExecutionStatus.idempotencyPolicy, "NO_V1_IDEMPOTENCY_GUARANTEE");

assertR2ProposalStaticContract(source.proposal);
assert.match(source.review, /post_media_upload[\s\S]*1\.\.157286400[\s\S]*APPROVED/s);
assert.match(source.review, /external_video_upload[\s\S]*314572800[\s\S]*APPROVED/s);
assert.match(source.review, /No SQL has been executed[\s\S]*Cloudflare or Supabase/s);
assert.match(source.r3, /R3_PASSED_LOCAL_DISPOSABLE_ONLY/);
assert.match(source.postflight, /pg_proc[\s\S]*prosecdef[\s\S]*provolatile[\s\S]*proparallel[\s\S]*proleakproof[\s\S]*proconfig/s);
assert.match(source.postflight, /p\.proconfig,[\s\S]*p\.proowner,[\s\S]*pg_get_userbyid\(p\.proowner\)[\s\S]*acldefault\('f', functions\.proowner\)/s);
assert.match(source.postflight, /grantee = 0[\s\S]*PUBLIC[\s\S]*aclexplode/s);
assert.match(source.manifest, /UNEXECUTED_REPOSITORY_DESIGN_ONLY/);
assert.match(source.manifest, /R3 passed only in a disposable local database/);
assert.match(source.manifest, /no operator runner/);
assert.match(source.review, /Stage C[\s\S]*BLOCKED_RUNTIME_MIGRATION_REQUIRED/s);
assert.match(source.runtime, /4s maximum[\s\S]*no automatic (?:RPC )?retry/is);
assert.match(source.fingerprint, new RegExp("SHA-256: `" + sha256Hex(source.proposal) + "`"));

const mutations = {
  "missing-public-revoke": (value) => value.replace("REVOKE ALL ON FUNCTION public.consume_forum_rate_limit(uuid, text, text, bigint) FROM PUBLIC;", ""),
  "anon-grant": (value) => value.replace("TO service_role;", "TO anon;"),
  "authenticated-grant": (value) => value.replace("TO service_role;", "TO authenticated;"),
  "public-grant": (value) => value.replace("TO service_role;", "TO PUBLIC;"),
  "unsafe-search-path": (value) => value.replace("SET search_path = pg_catalog, public, pg_temp", "SET search_path = public"),
  "unqualified-table": (value) => value.replace("FROM public.forum_upload_attempts", "FROM forum_upload_attempts"),
  "security-invoker": (value) => value.replace("SECURITY DEFINER", "SECURITY INVOKER"),
  "unexpected-owner": (value) => value.replace("OWNER TO postgres", "OWNER TO authenticated"),
  "wrong-signature": (value) => value.replace("p_bytes bigint", "p_bytes integer"),
  "overload-ambiguity": (value) => `${value}\nCREATE FUNCTION public.consume_forum_rate_limit(p_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';`,
  "decimal-mib-cap": (value) => value.replaceAll("157286400", "150000000"),
  "wrong-binary-post-media-cap": (value) => value.replace("WHEN 'post_media_upload' THEN\n      v_max_attempts := 10;\n      v_window_seconds := 3600;\n      v_upload_scope := true;\n      IF p_bytes < 1 OR p_bytes > 157286400", "WHEN 'post_media_upload' THEN\n      v_max_attempts := 10;\n      v_window_seconds := 3600;\n      v_upload_scope := true;\n      IF p_bytes < 1 OR p_bytes > 157286399"),
  "wrong-binary-external-video-cap": (value) => value.replace("WHEN 'external_video_upload' THEN\n      v_max_attempts := 10;\n      v_window_seconds := 3600;\n      v_upload_scope := true;\n      v_external_video_daily_bytes := true;\n      IF p_bytes < 1 OR p_bytes > 157286400", "WHEN 'external_video_upload' THEN\n      v_max_attempts := 10;\n      v_window_seconds := 3600;\n      v_upload_scope := true;\n      v_external_video_daily_bytes := true;\n      IF p_bytes < 1 OR p_bytes > 157286399"),
  "wrong-daily-byte-quota": (value) => value.replace("314572800 - p_bytes", "300000000 - p_bytes"),
  "untyped-byte-sum-zero": (value) => value.replace("COALESCE(pg_catalog.sum(bytes), 0::numeric)", "COALESCE(pg_catalog.sum(bytes), 0)"),
  "calendar-day-window": (value) => value.replace("INTERVAL '24 hours'", "INTERVAL '1 day'"),
  "cross-table-byte-calculation": (value) => value.replace("FROM public.forum_upload_attempts\n      WHERE purpose = 'external_video_upload'", "FROM public.forum_upload_attempts JOIN public.post_media ON true\n      WHERE purpose = 'external_video_upload'"),
  "byte-sum-outside-lock": (value) => value.replace("PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_material, 0));", "-- lock removed"),
  "insert-before-all-limits-pass": (value) => value.replace("IF v_external_video_daily_bytes THEN", "INSERT INTO public.forum_upload_attempts (user_id, ip_hash, bytes, purpose, created_at) VALUES (p_user_id, p_ip_hash, p_bytes, p_purpose, v_now);\n\n  IF v_external_video_daily_bytes THEN"),
  "denied-attempt-insert": (value) => value.replace("RETURN QUERY SELECT false, 'RATE_LIMITED'::text;", "INSERT INTO public.forum_upload_attempts (user_id, ip_hash, bytes, purpose, created_at) VALUES (p_user_id, p_ip_hash, p_bytes, p_purpose, v_now);\n    RETURN QUERY SELECT false, 'RATE_LIMITED'::text;"),
  "missing-lock-timeout": (value) => value.replace("SET lock_timeout = '1s'\n", ""),
  "wrong-statement-timeout": (value) => value.replace("SET statement_timeout = '3s'", "SET statement_timeout = '4s'"),
  "automatic-retry": (value) => `${value}\n-- retry on timeout`,
  "hidden-idempotency": (value) => `${value}\n-- idempotency token`,
  "non-atomic-count-insert": (value) => value.replace("PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_material, 0));", ""),
  "session-advisory-lock": (value) => value.replace("pg_catalog.pg_advisory_xact_lock", "pg_catalog.pg_advisory_lock"),
  "inconsistent-lock-order": (value) => value.replace("PERFORM pg_catalog.pg_advisory_xact_lock", "PERFORM pg_catalog.pg_advisory_xact_lock\n  PERFORM pg_catalog.pg_advisory_xact_lock"),
  "leaking-result": (value) => value.replace("RETURN QUERY SELECT true, 'ALLOWED'::text;", "RETURN QUERY SELECT true, v_current_count::text;"),
};
assert.deepEqual(Object.keys(mutations), negativeFixtureNames);
for (const [name, mutate] of Object.entries(mutations)) assert.throws(() => assertR2ProposalStaticContract(mutate(source.proposal)), undefined, name);

console.log(JSON.stringify({ staticOnly: true, negativeFixtures: negativeFixtureNames.length, proposalSha256: sha256Hex(source.proposal), r3LocalSimulation: r2ExecutionStatus.r3LocalSimulation }));
