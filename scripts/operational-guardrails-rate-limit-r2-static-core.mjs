import { createHash } from "node:crypto";

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function requirePattern(text, pattern, finding) {
  if (!pattern.test(text)) throw new Error(finding);
}

export function assertR2ProposalStaticContract(text) {
  requirePattern(text, /UNEXECUTED[\s\S]*REPOSITORY DESIGN PROPOSAL ONLY[\s\S]*NOT A CANONICAL MIGRATION[\s\S]*NOT APPROVED FOR PRODUCTION[\s\S]*DO NOT RUN[\s\S]*R3 LOCAL SIMULATION APPROVAL REQUIRED BEFORE EXECUTION ANYWHERE/, "missing non-execution header");
  requirePattern(text, /CREATE FUNCTION public\.consume_forum_rate_limit\(\s*p_user_id uuid,\s*p_ip_hash text,\s*p_purpose text,\s*p_bytes bigint\s*\)/s, "wrong function signature");
  if ((text.match(/CREATE(?: OR REPLACE)? FUNCTION public\.consume_forum_rate_limit\(/g) ?? []).length !== 1) throw new Error("function overload ambiguity");
  requirePattern(text, /RETURNS TABLE\(allowed boolean, decision text\)/, "wrong return contract");
  requirePattern(text, /SECURITY DEFINER/, "SECURITY DEFINER required");
  if (/SECURITY INVOKER/.test(text)) throw new Error("SECURITY INVOKER is unsafe for the approved contract");
  requirePattern(text, /VOLATILE[\s\S]*PARALLEL UNSAFE[\s\S]*SET search_path = pg_catalog, public, pg_temp[\s\S]*SET lock_timeout = '1s'[\s\S]*SET statement_timeout = '3s'/s, "unsafe function metadata or timeout contract");
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
  requirePattern(text, /WHEN 'post_media_upload' THEN[\s\S]*p_bytes < 1 OR p_bytes > 157286400[\s\S]*WHEN 'external_video_upload' THEN/s, "post-media binary byte ceiling missing");
  requirePattern(text, /WHEN 'external_video_upload' THEN[\s\S]*v_external_video_daily_bytes := true;[\s\S]*p_bytes < 1 OR p_bytes > 157286400/s, "external-video byte ceiling missing");
  requirePattern(text, /SELECT pg_catalog\.count\(\*\)[\s\S]*IF v_current_count >= v_max_attempts THEN[\s\S]*IF v_external_video_daily_bytes THEN[\s\S]*SELECT pg_catalog\.coalesce\(pg_catalog\.sum\(bytes\), 0\)[\s\S]*purpose = 'external_video_upload'[\s\S]*created_at >= v_now - INTERVAL '24 hours'[\s\S]*v_current_bytes > 314572800 - p_bytes[\s\S]*INSERT INTO public\.forum_upload_attempts/s, "count, rolling byte quota, and accepted insert are not ordered atomically");
  requirePattern(text, /PERFORM pg_catalog\.pg_advisory_xact_lock[\s\S]*SELECT pg_catalog\.count\(\*[\s\S]*SELECT pg_catalog\.coalesce\(pg_catalog\.sum\(bytes\), 0\)[\s\S]*INSERT INTO public\.forum_upload_attempts/s, "external-video byte sum is not protected by the shared-IP lock");
  requirePattern(text, /RETURN QUERY SELECT false, 'RATE_LIMITED'::text[\s\S]*RETURN QUERY SELECT false, 'RATE_LIMITED'::text[\s\S]*RETURN QUERY SELECT true, 'ALLOWED'::text/s, "result leaks or does not use the approved allow-deny contract");
  if ((text.match(/RETURN QUERY SELECT false, 'RATE_LIMITED'::text;/g) ?? []).length !== 2 || (text.match(/RETURN QUERY SELECT true, 'ALLOWED'::text;/g) ?? []).length !== 1) throw new Error("unexpected decision result");
  if ((text.match(/INSERT INTO public\.forum_upload_attempts/g) ?? []).length !== 1) throw new Error("attempt insertion precedes a limit decision or denied attempts are recorded");
  if (/RETURN QUERY SELECT[^;]*(?:v_current_count|p_user_id|p_ip_hash|v_max_attempts)/s.test(text)) throw new Error("result leaks internal data");
  if (/consume_verification_email_resend_limit/.test(text)) throw new Error("resend RPC reuse is forbidden");
  if (/PUBLIC_SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY\s*=/.test(text)) throw new Error("secret dependency is forbidden");
  if (/DROP POLICY|CREATE INDEX|supabase\/migrations|wrangler|TODO|-- retry on timeout|-- idempotency token/i.test(text)) throw new Error("proposal contains forbidden execution, retry, idempotency, or unresolved placeholder content");
  if (/FROM public\.post_media\b|JOIN public\.post_media\b/.test(text)) throw new Error("cross-table byte calculation is forbidden");
  if (/INTERVAL '1 day'|date_trunc\s*\(\s*'day'/i.test(text)) throw new Error("calendar-day quota is forbidden");
}
