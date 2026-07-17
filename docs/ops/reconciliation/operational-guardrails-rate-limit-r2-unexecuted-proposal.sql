-- UNEXECUTED
-- REPOSITORY DESIGN PROPOSAL ONLY
-- NOT A CANONICAL MIGRATION
-- NOT APPROVED FOR PRODUCTION
-- DO NOT RUN
-- R3 LOCAL SIMULATION APPROVAL REQUIRED BEFORE EXECUTION ANYWHERE
--
-- R2 decision closure: this static proposal defines the complete V1 quota,
-- retry, and timeout contract. It remains non-executable review material.

-- CREATE FUNCTION is intentional: a future approved executor must fail closed
-- if this exact identity or any overload already exists, rather than replacing
-- an unreviewed implementation.
CREATE FUNCTION public.consume_forum_rate_limit(
  p_user_id uuid,
  p_ip_hash text,
  p_purpose text,
  p_bytes bigint
)
RETURNS TABLE(allowed boolean, decision text)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '1s'
SET statement_timeout = '3s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_window_seconds integer;
  v_max_attempts integer;
  v_upload_scope boolean := false;
  v_external_video_daily_bytes boolean := false;
  v_lock_material text;
  v_current_count bigint;
  v_current_bytes numeric;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'rate-limit identity is required';
  END IF;

  IF p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'rate-limit IP hash is invalid';
  END IF;

  IF p_bytes IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'rate-limit bytes are required';
  END IF;

  CASE p_purpose
    WHEN 'post_create' THEN
      v_max_attempts := 10;
      v_window_seconds := 3600;
      IF p_bytes <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'post_create bytes must be zero';
      END IF;
    WHEN 'comment_create' THEN
      v_max_attempts := 60;
      v_window_seconds := 3600;
      IF p_bytes <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'comment_create bytes must be zero';
      END IF;
    WHEN 'circle_create' THEN
      v_max_attempts := 5;
      v_window_seconds := 86400;
      IF p_bytes <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'circle_create bytes must be zero';
      END IF;
    WHEN 'post_media_upload' THEN
      v_max_attempts := 10;
      v_window_seconds := 3600;
      v_upload_scope := true;
      IF p_bytes < 1 OR p_bytes > 157286400 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'post media bytes are invalid';
      END IF;
    WHEN 'external_video_upload' THEN
      v_max_attempts := 10;
      v_window_seconds := 3600;
      v_upload_scope := true;
      v_external_video_daily_bytes := true;
      IF p_bytes < 1 OR p_bytes > 157286400 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'external video bytes are invalid';
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'rate-limit purpose is invalid';
  END CASE;

  -- Every current invocation has exactly one quota scope. Both external-video
  -- constraints use this same shared-IP lock, so their deterministic lock
  -- order is this one acquisition before any count, sum, or insert.
  IF v_upload_scope THEN
    v_lock_material := 'openglasshub:forum-rate-limit:v1:upload-ip:' || p_ip_hash;
  ELSE
    v_lock_material := 'openglasshub:forum-rate-limit:v1:user:' || p_purpose || ':' || p_user_id::text;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_material, 0));

  IF v_upload_scope THEN
    SELECT pg_catalog.count(*)
      INTO v_current_count
      FROM public.forum_upload_attempts
      WHERE purpose IN ('post_media_upload', 'external_video_upload')
        AND ip_hash = p_ip_hash
        AND created_at >= v_now - pg_catalog.make_interval(secs => v_window_seconds);
  ELSE
    SELECT pg_catalog.count(*)
      INTO v_current_count
      FROM public.forum_upload_attempts
      WHERE purpose = p_purpose
        AND user_id = p_user_id
        AND created_at >= v_now - pg_catalog.make_interval(secs => v_window_seconds);
  END IF;

  IF v_current_count >= v_max_attempts THEN
    RETURN QUERY SELECT false, 'RATE_LIMITED'::text;
    RETURN;
  END IF;

  -- The V1 external-video daily ledger is this table only. Once the runtime
  -- migration cuts over, every row for this purpose is an accepted reservation
  -- inserted here by this RPC. It remains charged even if later upload/media
  -- work fails; no cross-table read, reservation status, or cleanup exists.
  IF v_external_video_daily_bytes THEN
    SELECT COALESCE(pg_catalog.sum(bytes), 0::numeric)
      INTO v_current_bytes
      FROM public.forum_upload_attempts
      WHERE purpose = 'external_video_upload'
        AND ip_hash = p_ip_hash
        AND created_at >= v_now - INTERVAL '24 hours';

    IF v_current_bytes > 314572800 - p_bytes THEN
      RETURN QUERY SELECT false, 'RATE_LIMITED'::text;
      RETURN;
    END IF;
  END IF;

  -- A function call is atomic in its caller transaction. Both external-video
  -- limits have passed under the same lock before this one accepted-row insert.
  -- Validation, permission, timeout, or insert failure rolls back the call and
  -- releases the transaction lock without recording an accepted attempt.
  INSERT INTO public.forum_upload_attempts (user_id, ip_hash, bytes, purpose, created_at)
  VALUES (p_user_id, p_ip_hash, p_bytes, p_purpose, v_now);

  RETURN QUERY SELECT true, 'ALLOWED'::text;
END;
$function$;

ALTER FUNCTION public.consume_forum_rate_limit(uuid, text, text, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.consume_forum_rate_limit(uuid, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_forum_rate_limit(uuid, text, text, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.consume_forum_rate_limit(uuid, text, text, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_forum_rate_limit(uuid, text, text, bigint) TO service_role;
