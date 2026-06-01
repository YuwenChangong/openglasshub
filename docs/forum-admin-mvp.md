# Forum Admin MVP

This phase adds minimal moderator governance endpoints and pages:

- `/admin/forum/`
- `/admin/media/`
- `/admin/reports/`

## Auth model

No service role key is used in browser code.

Admin APIs require:

1. `Authorization: Bearer <access_token>`
2. Supabase `auth.getUser()` validation
3. Moderator check from `public.profiles.role` (`moderator` or `admin`)

If role is not moderator/admin, API returns `403 Forbidden`.

## APIs

- `GET /api/admin/forum/posts`
- `PATCH /api/admin/forum/posts` (`hide` / `restore`)
- `DELETE /api/admin/forum/posts?id=...`
- `GET /api/admin/forum/media`
- `DELETE /api/admin/forum/media?id=...`
- `GET /api/admin/forum/reports`

## Media deletion behavior

Post deletion and single media deletion both run storage cleanup:

- R2 objects (`tmp/...` or `posts/...`) are deleted via S3-compatible API.
- Supabase Storage objects in `post-media` are removed for image paths.
- `post_media` rows are removed after storage deletion.

Failures are returned with structured `error` + `details`; no silent success.

## Grant moderator access

Use SQL in Supabase:

```sql
update public.profiles
set role = 'moderator'
where id = '<your-user-uuid>';
```

or by email:

```sql
update public.profiles p
set role = 'moderator'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('your-email@example.com');
```

## Notes

- Public navigation is unchanged.
- Regular user posting/comment/media flows are unchanged.
- Existing RLS is preserved; only moderator role gating is used.
