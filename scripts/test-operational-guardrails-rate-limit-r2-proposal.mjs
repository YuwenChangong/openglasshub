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
assert.equal(r2ExecutionStatus.r2StaticDesign, "COMPLETE_BUT_NOT_EXECUTABLE");
assert.equal(r2ExecutionStatus.r3Eligible, false);
assert.equal(r2ExecutionStatus.stageC, "BLOCKED_RUNTIME_MIGRATION_REQUIRED");
assert.equal(r2ExecutionStatus.productionIdentity, "BINDING_ABSENT_PRODUCTION_BLOCKED");
assert.deepEqual(r2PurposeMatrix.map((row) => row.purpose), ["post_create", "comment_create", "circle_create", "post_media_upload", "external_video_upload", "verification_email_resend"]);
assert.deepEqual(r2PurposeMatrix.filter((row) => row.status === "HUMAN_DECISION_REQUIRED").map((row) => row.purpose), ["post_media_upload", "external_video_upload"]);

assertR2ProposalStaticContract(source.proposal);
assert.match(source.review, /post_media_upload[\s\S]*HUMAN_DECISION_REQUIRED/s);
assert.match(source.review, /external_video_upload[\s\S]*HUMAN_DECISION_REQUIRED/s);
assert.match(source.review, /No SQL has been executed[\s\S]*Cloudflare or Supabase/s);
assert.match(source.r3, /R3 is not eligible[\s\S]*HUMAN_DECISION_REQUIRED/s);
assert.match(source.postflight, /pg_proc[\s\S]*prosecdef[\s\S]*provolatile[\s\S]*proparallel[\s\S]*proleakproof[\s\S]*proconfig/s);
assert.match(source.postflight, /grantee = 0[\s\S]*PUBLIC[\s\S]*aclexplode/s);
assert.match(source.manifest, /UNEXECUTED_REPOSITORY_DESIGN_ONLY/);
assert.match(source.manifest, /R3 blocked/);
assert.match(source.manifest, /no operator runner/);
assert.match(source.review, /Stage C[\s\S]*BLOCKED_RUNTIME_MIGRATION_REQUIRED/s);
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
  "guessed-post-media-cap": (value) => value.replace("v_window_seconds := 3600;\n      v_upload_scope := true;", "v_window_seconds := 3600;\n      IF p_bytes > 10485760 THEN RAISE EXCEPTION 'cap'; END IF;\n      v_upload_scope := true;"),
  "todo-quota": (value) => `${value}\n-- TODO choose a quota`,
  "non-atomic-count-insert": (value) => value.replace("PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_material, 0));", ""),
  "session-advisory-lock": (value) => value.replace("pg_catalog.pg_advisory_xact_lock", "pg_catalog.pg_advisory_lock"),
  "inconsistent-lock-order": (value) => value.replace("PERFORM pg_catalog.pg_advisory_xact_lock", "PERFORM pg_catalog.pg_advisory_xact_lock\n  PERFORM pg_catalog.pg_advisory_xact_lock"),
  "leaking-result": (value) => value.replace("RETURN QUERY SELECT true, 'ALLOWED'::text;", "RETURN QUERY SELECT true, v_current_count::text;"),
};
assert.deepEqual(Object.keys(mutations), negativeFixtureNames);
for (const [name, mutate] of Object.entries(mutations)) assert.throws(() => assertR2ProposalStaticContract(mutate(source.proposal)), undefined, name);

console.log(JSON.stringify({ staticOnly: true, negativeFixtures: negativeFixtureNames.length, proposalSha256: sha256Hex(source.proposal), r3Eligible: r2ExecutionStatus.r3Eligible }));
