import { createHash } from "node:crypto";

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function requirePattern(text, pattern, finding) {
  if (!pattern.test(text)) throw new Error(finding);
}

export function assertR2ProposalStaticContract(text) {
  requirePattern(text, /UNEXECUTED[\s\S]*REPOSITORY DESIGN PROPOSAL ONLY[\s\S]*NOT A CANONICAL MIGRATION[\s\S]*DO NOT RUN/, "missing non-execution header");
  requirePattern(text, /CREATE FUNCTION public\.consume_forum_rate_limit\(\s*p_user_id uuid,\s*p_ip_hash text,\s*p_purpose text,\s*p_bytes bigint\s*\)/s, "wrong function signature");
  if ((text.match(/CREATE(?: OR REPLACE)? FUNCTION public\.consume_forum_rate_limit\(/g) ?? []).length !== 1) throw new Error("function overload ambiguity");
  requirePattern(text, /RETURNS TABLE\(allowed boolean, decision text\)/, "wrong return contract");
  requirePattern(text, /SECURITY DEFINER/, "SECURITY DEFINER required");
  if (/SECURITY INVOKER/.test(text)) throw new Error("SECURITY INVOKER is unsafe for the approved contract");
  requirePattern(text, /VOLATILE[\s\S]*PARALLEL UNSAFE[\s\S]*SET search_path = pg_catalog, public, pg_temp/s, "unsafe function metadata");
  requirePattern(text, /ALTER FUNCTION public\.consume_forum_rate_limit\(uuid, text, text, bigint\) OWNER TO postgres/, "unexpected owner");
  for (const role of ["PUBLIC", "anon", "authenticated"]) requirePattern(text, new RegExp(`REVOKE ALL ON FUNCTION public\\.consume_forum_rate_limit\\(uuid, text, text, bigint\\) FROM ${role}`), `missing ${role} revoke`);
  requirePattern(text, /GRANT EXECUTE ON FUNCTION public\.consume_forum_rate_limit\(uuid, text, text, bigint\) TO service_role/, "missing trusted-role grant");
  if (/GRANT EXECUTE[\s\S]*TO\s+(?:PUBLIC|anon|authenticated)/.test(text)) throw new Error("browser-callable execute grant");
  if (/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*ON\s+TABLE/i.test(text)) throw new Error("direct table grant is forbidden");
  requirePattern(text, /public\.forum_upload_attempts/g, "unqualified or missing attempt relation");
  if (/\bFROM forum_upload_attempts\b|\bINSERT INTO forum_upload_attempts\b/.test(text)) throw new Error("unqualified attempt relation");
  requirePattern(text, /pg_catalog\.pg_advisory_xact_lock/, "transaction advisory lock required");
  if (/pg_advisory_lock\(/.test(text)) throw new Error("session-level advisory lock is forbidden");
  if ((text.match(/pg_catalog\.pg_advisory_xact_lock/g) ?? []).length !== 1) throw new Error("inconsistent multi-lock ordering");
  requirePattern(text, /pg_catalog\.now\(\)/, "database clock required");
  requirePattern(text, /SELECT pg_catalog\.count\(\*\)[\s\S]*INSERT INTO public\.forum_upload_attempts/s, "count and accepted-attempt insert are not ordered atomically");
  requirePattern(text, /RETURN QUERY SELECT false, 'RATE_LIMITED'::text[\s\S]*RETURN QUERY SELECT true, 'ALLOWED'::text/s, "result leaks or does not use the approved allow-deny contract");
  if (/RETURN QUERY SELECT[^;]*(?:v_current_count|p_user_id|p_ip_hash|v_max_attempts)/s.test(text)) throw new Error("result leaks internal data");
  if (/consume_verification_email_resend_limit/.test(text)) throw new Error("resend RPC reuse is forbidden");
  if (/PUBLIC_SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY\s*=/.test(text)) throw new Error("secret dependency is forbidden");
  if (/DROP POLICY|CREATE INDEX|supabase\/migrations|wrangler|TODO/i.test(text)) throw new Error("proposal contains forbidden execution or unresolved placeholder content");
  const postMediaSection = text.split("WHEN 'post_media_upload' THEN")[1]?.split("WHEN 'external_video_upload' THEN")[0] ?? "";
  if (/p_bytes\s*>\s*\d+/.test(postMediaSection)) throw new Error("generic upload cap was guessed");
  requirePattern(text, /external_video_upload'[\s\S]*p_bytes < 1 OR p_bytes > 157286400/s, "external video source-backed byte ceiling missing");
}
