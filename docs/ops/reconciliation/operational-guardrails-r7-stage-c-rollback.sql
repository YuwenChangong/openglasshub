-- UNEXECUTED R7 ROLLBACK. Requires separate approval and matching fresh
-- preflight fingerprints; do not use if catalog policy definitions differ.
BEGIN;
CREATE POLICY forum_upload_attempts_insert_self ON public.forum_upload_attempts
FOR INSERT TO authenticated WITH CHECK (((purpose = ANY (ARRAY['post_create'::text, 'comment_create'::text, 'circle_create'::text])) AND (user_id = auth.uid())) OR ((purpose = ANY (ARRAY['post_media_upload'::text, 'external_video_upload'::text])) AND ((user_id = auth.uid()) OR (user_id IS NULL))));
CREATE POLICY forum_upload_attempts_select_self ON public.forum_upload_attempts
FOR SELECT TO authenticated USING ((user_id = auth.uid()) OR (user_id IS NULL));
COMMIT;
