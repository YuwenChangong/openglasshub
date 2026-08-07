CREATE OR REPLACE FUNCTION public.can_access_comment_reaction_target(target_comment_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ select exists ( select 1 from public.comments as c join public.posts as p on p.id = c.post_id join public.circles as circle_ref on circle_ref.id = p.circle_id where c.id = target_comment_id and c.status = 'published' and c.moderation_status = 'published' and p.status = 'published' and p.moderation_status = 'published' and circle_ref.status = 'active' and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle') and lower(coalesce(circle_ref.name, '')) not like '%rls test%' ); $function$;

ALTER FUNCTION public.can_access_comment_reaction_target(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_access_public_circle_cover_object(target_object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ select target_object_name ~ '^circle-covers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,12}-[a-z0-9._-]{1,240}$' and exists ( select 1 from public.circles as circle_ref where circle_ref.image_path = target_object_name and public.can_access_public_circle(circle_ref.id) ); $function$;

ALTER FUNCTION public.can_access_public_circle_cover_object(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_access_public_comment_read_target(target_comment_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ select exists ( select 1 from public.comments as comment_ref join public.posts as post_ref on post_ref.id = comment_ref.post_id join public.circles as circle_ref on circle_ref.id = post_ref.circle_id where comment_ref.id = target_comment_id and comment_ref.status = 'published' and comment_ref.moderation_status = 'published' and post_ref.status = 'published' and post_ref.moderation_status = 'published' and circle_ref.status = 'active' and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle') and lower(coalesce(circle_ref.name, '')) not like '%rls test%' ); $function$;

ALTER FUNCTION public.can_access_public_comment_read_target(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_access_public_profile_media_object(target_object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ select target_object_name ~ '^profile-(avatars|banners)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,12}-[a-z0-9._-]{0,240}$' and exists ( select 1 from public.profiles profile_ref where split_part(target_object_name, '/', 2) = profile_ref.id::text and ( (target_object_name like 'profile-avatars/%' and profile_ref.avatar_url = target_object_name) or (target_object_name like 'profile-banners/%' and profile_ref.banner_url = target_object_name) ) ); $function$;

ALTER FUNCTION public.can_access_public_profile_media_object(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_create_comment_target(target_post_id uuid, target_parent_comment_id uuid DEFAULT NULL::uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ select exists ( select 1 from public.posts as p join public.circles as circle_ref on circle_ref.id = p.circle_id where p.id = target_post_id and p.status = 'published' and p.moderation_status = 'published' and circle_ref.status = 'active' and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle') and lower(coalesce(circle_ref.name, '')) not like '%rls test%' and ( target_parent_comment_id is null or exists ( select 1 from public.comments as parent_comment where parent_comment.id = target_parent_comment_id and parent_comment.post_id = p.id and parent_comment.status = 'published' and parent_comment.moderation_status = 'published' ) ) ); $function$;

ALTER FUNCTION public.can_create_comment_target(uuid,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_create_user_report_target(target_type_input text, target_id_input uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ select case target_type_input when 'post' then exists ( select 1 from public.posts as post_ref join public.circles as circle_ref on circle_ref.id = post_ref.circle_id where post_ref.id = target_id_input and post_ref.status = 'published' and post_ref.moderation_status = 'published' and circle_ref.status = 'active' and public.can_access_public_circle(circle_ref.id) ) when 'comment' then exists ( select 1 from public.comments as comment_ref join public.posts as post_ref on post_ref.id = comment_ref.post_id join public.circles as circle_ref on circle_ref.id = post_ref.circle_id where comment_ref.id = target_id_input and comment_ref.status = 'published' and comment_ref.moderation_status = 'published' and post_ref.status = 'published' and post_ref.moderation_status = 'published' and circle_ref.status = 'active' and public.can_access_public_circle(circle_ref.id) ) when 'circle' then exists ( select 1 from public.circles as circle_ref where circle_ref.id = target_id_input and circle_ref.status = 'active' and public.can_access_public_circle(circle_ref.id) ) when 'user' then exists ( select 1 from public.profiles as profile_ref where profile_ref.id = target_id_input ) else false end; $function$;

ALTER FUNCTION public.can_create_user_report_target(text,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.is_canonical_post_media_object_key(object_key text, actor_id uuid, target_post_id uuid, allow_temporary boolean) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$ select object_key is not null and position('?' in object_key) = 0 and position('#' in object_key) = 0 and position('%' in object_key) = 0 and position(chr(92) in object_key) = 0 and ( object_key ~ ('^' || actor_id::text || '/' || target_post_id::text || '/[^/]+$') or ( allow_temporary and object_key ~ ('^tmp/' || actor_id::text || '/' || target_post_id::text || '/[^/]+$') ) ); $function$;

ALTER FUNCTION public.is_canonical_post_media_object_key(text,uuid,uuid,boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_access_public_post_media_object(target_object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ select exists ( select 1 from public.post_media pm join public.posts p on p.id = pm.post_id where p.status = 'published' and p.moderation_status = 'published' and public.can_access_public_circle(p.circle_id) and ( ( pm.storage_path = target_object_name and ( (pm.kind = 'image' and public.is_canonical_post_media_object_key(target_object_name, pm.user_id, pm.post_id, false)) or (pm.kind = 'video' and public.is_canonical_post_media_object_key(target_object_name, pm.user_id, pm.post_id, true)) ) ) or ( pm.thumbnail_url = target_object_name and public.is_canonical_post_media_object_key(target_object_name, pm.user_id, pm.post_id, false) ) ) ); $function$;

ALTER FUNCTION public.can_access_public_post_media_object(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_bind_post_media_provenance(media_kind text, media_storage_path text, media_url text, actor_id uuid, target_post_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$ select case when media_kind = 'image' then public.is_canonical_post_media_object_key(media_storage_path, actor_id, target_post_id, false) when media_kind = 'video' then public.is_canonical_post_media_object_key(media_storage_path, actor_id, target_post_id, true) when media_kind = 'video_link' then media_storage_path is null and media_url is not null else false end; $function$;

ALTER FUNCTION public.can_bind_post_media_provenance(text,text,text,uuid,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.record_current_legal_policy_acceptance(p_user_id uuid, p_bundle_version text, p_terms_version text, p_privacy_version text, p_guidelines_version text, p_minimum_age smallint, p_source text) RETURNS legal_policy_acceptances LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$ declare jwt_role text; acceptance public.legal_policy_acceptances; begin jwt_role := current_setting('request.jwt.claim.role', true); if current_user <> 'postgres' and jwt_role <> 'service_role' then raise exception 'LEGAL_CONSENT_WRITE_FORBIDDEN' using errcode = '42501'; end if; if p_user_id is null or btrim(coalesce(p_bundle_version, '')) = '' or btrim(coalesce(p_terms_version, '')) = '' or btrim(coalesce(p_privacy_version, '')) = '' or btrim(coalesce(p_guidelines_version, '')) = '' or p_minimum_age is null or p_minimum_age <= 0 or p_source not in ('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback') then raise exception 'LEGAL_CONSENT_INVALID_INPUT' using errcode = '22023'; end if; insert into public.legal_policy_acceptances ( user_id, bundle_version, terms_version, privacy_version, guidelines_version, minimum_age, first_acceptance_source, last_confirmation_source ) values ( p_user_id, p_bundle_version, p_terms_version, p_privacy_version, p_guidelines_version, p_minimum_age, p_source, p_source ) on conflict (user_id, bundle_version) do update set last_confirmed_at = now(), last_confirmation_source = excluded.last_confirmation_source, confirmation_count = public.legal_policy_acceptances.confirmation_count + 1, updated_at = now() returning * into acceptance; return acceptance; end; $function$;

ALTER FUNCTION public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text) OWNER TO postgres;

CREATE INDEX IF NOT EXISTS posts_view_count_idx ON public.posts USING btree (view_count DESC);

UPDATE storage.buckets SET public = false, file_size_limit = 104857600, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'] WHERE id = 'post-media';

DROP POLICY IF EXISTS "comment_reactions_delete_self" ON "public"."comment_reactions";

CREATE POLICY "comment_reactions_delete_self" ON "public"."comment_reactions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((user_id = auth.uid()) AND can_access_comment_reaction_target(comment_id)));

DROP POLICY IF EXISTS "comment_reactions_insert_self" ON "public"."comment_reactions";

CREATE POLICY "comment_reactions_insert_self" ON "public"."comment_reactions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((user_id = auth.uid()) AND can_access_comment_reaction_target(comment_id)));

DROP POLICY IF EXISTS "comment_reactions_select_accessible" ON "public"."comment_reactions";

CREATE POLICY "comment_reactions_select_accessible" ON "public"."comment_reactions" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (can_access_public_comment_read_target(comment_id));

DROP POLICY IF EXISTS "comment_reactions_update_self" ON "public"."comment_reactions";

CREATE POLICY "comment_reactions_update_self" ON "public"."comment_reactions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((user_id = auth.uid()) AND can_access_comment_reaction_target(comment_id))) WITH CHECK (((user_id = auth.uid()) AND can_access_comment_reaction_target(comment_id)));

DROP POLICY IF EXISTS "comments_insert_self" ON "public"."comments";

CREATE POLICY "comments_insert_self" ON "public"."comments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((author_id = auth.uid()) AND ((((status)::text = 'published'::text) AND (moderation_status = 'published'::text)) OR (((status)::text = 'pending'::text) AND (moderation_status = 'pending_review'::text))) AND can_create_comment_target(post_id, parent_id)));

DROP POLICY IF EXISTS "comments_select_public_or_staff" ON "public"."comments";

CREATE POLICY "comments_select_public_or_staff" ON "public"."comments" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ((can_access_public_comment_read_target(id) OR (author_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM posts post_ref WHERE ((post_ref.id = comments.post_id) AND (post_ref.author_id = auth.uid())))) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin)));

DROP POLICY IF EXISTS "post_media_insert_self" ON "public"."post_media";

CREATE POLICY "post_media_insert_self" ON "public"."post_media" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM posts p WHERE ((p.id = post_media.post_id) AND (p.author_id = auth.uid())))) AND can_bind_post_media_provenance(kind, storage_path, url, auth.uid(), post_id)));

DROP POLICY IF EXISTS "post_media_select_public_or_owner" ON "public"."post_media";

CREATE POLICY "post_media_select_public_or_owner" ON "public"."post_media" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ((((EXISTS ( SELECT 1 FROM posts p WHERE ((p.id = post_media.post_id) AND (p.status = 'published'::post_status) AND (p.moderation_status = 'published'::text) AND can_access_public_circle(p.circle_id)))) AND (((kind = 'image'::text) AND is_canonical_post_media_object_key(storage_path, user_id, post_id, false)) OR ((kind = 'video'::text) AND is_canonical_post_media_object_key(storage_path, user_id, post_id, true))) AND ((thumbnail_url IS NULL) OR is_canonical_post_media_object_key(thumbnail_url, user_id, post_id, false))) OR (user_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin)));

DROP POLICY IF EXISTS "post_media_update_self_or_staff" ON "public"."post_media";

CREATE POLICY "post_media_update_self_or_staff" ON "public"."post_media" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((user_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))) WITH CHECK ((( SELECT is_moderator_or_admin() AS is_moderator_or_admin) OR ((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM posts p WHERE ((p.id = post_media.post_id) AND (p.author_id = auth.uid())))) AND can_bind_post_media_provenance(kind, storage_path, url, auth.uid(), post_id))));

DROP POLICY IF EXISTS "posts_delete_self_or_staff" ON "public"."posts";

CREATE POLICY "posts_delete_self_or_staff" ON "public"."posts" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((status = 'published'::post_status) AND (moderation_status = 'published'::text) AND can_access_public_circle(circle_id) AND ((author_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))));

DROP POLICY IF EXISTS "posts_insert_self" ON "public"."posts";

CREATE POLICY "posts_insert_self" ON "public"."posts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((author_id = auth.uid()) AND (status = ANY (ARRAY['published'::post_status, 'pending'::post_status])) AND (moderation_status = ANY (ARRAY['published'::text, 'pending_review'::text])) AND can_access_public_circle(circle_id)));

DROP POLICY IF EXISTS "posts_select_published_public" ON "public"."posts";

CREATE POLICY "posts_select_published_public" ON "public"."posts" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ((((status = 'published'::post_status) AND (moderation_status = 'published'::text) AND can_access_public_circle(circle_id)) OR (author_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin)));

DROP POLICY IF EXISTS "posts_update_self_or_staff" ON "public"."posts";

CREATE POLICY "posts_update_self_or_staff" ON "public"."posts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((author_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))) WITH CHECK ((((author_id = auth.uid()) AND (status = ANY (ARRAY['pending'::post_status, 'published'::post_status, 'deleted'::post_status])) AND (moderation_status = ANY (ARRAY['published'::text, 'pending_review'::text])) AND can_access_public_circle(circle_id)) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin)));

DROP POLICY IF EXISTS "reports_insert_self" ON "public"."reports";

CREATE POLICY "reports_insert_self" ON "public"."reports" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((reporter_id = auth.uid()) AND (status = 'open'::report_status) AND (priority = 'normal'::text) AND (assigned_to IS NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (resolution_note IS NULL) AND can_create_user_report_target((target_type)::text, target_id)));

DROP POLICY IF EXISTS "circle_cover_objects_select_public" ON "storage"."objects";

CREATE POLICY "circle_cover_objects_select_public" ON "storage"."objects" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (((bucket_id = 'post-media'::text) AND (can_access_public_circle_cover_object(name) OR (((storage.foldername(name))[1] = 'circle-covers'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))));

DROP POLICY IF EXISTS "post_media_objects_select_public_or_owner" ON "storage"."objects";

CREATE POLICY "post_media_objects_select_public_or_owner" ON "storage"."objects" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (((bucket_id = 'post-media'::text) AND (can_access_public_post_media_object(name) OR (owner = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))));

DROP POLICY IF EXISTS "profile_avatar_objects_select_public" ON "storage"."objects";

CREATE POLICY "profile_avatar_objects_select_public" ON "storage"."objects" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (((bucket_id = 'post-media'::text) AND can_access_public_profile_media_object(name)));

DROP POLICY IF EXISTS "profile_banner_objects_select_public" ON "storage"."objects";

CREATE POLICY "profile_banner_objects_select_public" ON "storage"."objects" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (((bucket_id = 'post-media'::text) AND can_access_public_profile_media_object(name)));

DROP TRIGGER IF EXISTS "trg_legal_policy_acceptances_set_updated_at" ON "public"."legal_policy_acceptances";

CREATE TRIGGER trg_legal_policy_acceptances_set_updated_at BEFORE UPDATE ON legal_policy_acceptances FOR EACH ROW EXECUTE FUNCTION set_updated_at();

REVOKE ALL ON FUNCTION public.can_access_comment_reaction_target(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_access_comment_reaction_target(uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_comment_reaction_target(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.can_access_public_circle_cover_object(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_access_public_circle_cover_object(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_public_circle_cover_object(text) TO "authenticated";

REVOKE ALL ON FUNCTION public.can_access_public_comment_read_target(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_access_public_comment_read_target(uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_public_comment_read_target(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.can_access_public_post_media_object(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_access_public_post_media_object(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_public_post_media_object(text) TO "authenticated";

REVOKE ALL ON FUNCTION public.can_access_public_profile_media_object(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_access_public_profile_media_object(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_public_profile_media_object(text) TO "authenticated";

REVOKE ALL ON FUNCTION public.can_bind_post_media_provenance(text,text,text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_bind_post_media_provenance(text,text,text,uuid,uuid) TO PUBLIC;

REVOKE ALL ON FUNCTION public.can_create_comment_target(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_create_comment_target(uuid,uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.can_create_user_report_target(text,uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_create_user_report_target(text,uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.is_canonical_post_media_object_key(text,uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_canonical_post_media_object_key(text,uuid,uuid,boolean) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_access_comment_reaction_target(uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_comment_reaction_target(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.can_access_comment_reaction_target(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION public.can_access_public_circle_cover_object(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_public_circle_cover_object(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.can_access_public_circle_cover_object(text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.can_access_public_comment_read_target(uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_public_comment_read_target(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.can_access_public_comment_read_target(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION public.can_access_public_post_media_object(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_public_post_media_object(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.can_access_public_post_media_object(text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.can_access_public_profile_media_object(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.can_access_public_profile_media_object(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.can_access_public_profile_media_object(text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.can_bind_post_media_provenance(text,text,text,uuid,uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION public.can_bind_post_media_provenance(text,text,text,uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_create_comment_target(uuid,uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.can_create_comment_target(uuid,uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION public.can_create_user_report_target(text,uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.can_create_user_report_target(text,uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION public.is_canonical_post_media_object_key(text,uuid,uuid,boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION public.is_canonical_post_media_object_key(text,uuid,uuid,boolean) TO PUBLIC;
