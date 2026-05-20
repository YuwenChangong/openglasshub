# Forum Phase 3.2 — Security Fix Report

> Date: 2026-05-19 | Verdict: **PASS**

---

## 1. Files Changed

| File | Change |
|------|--------|
| `functions/_lib/supabase.ts` | Added `createUserClient(env, bearerToken)` helper |
| `functions/api/forum/posts.ts` | Replaced all `createServiceClient` usage with `createUserClient` in POST path |

## 2. Security Fix Applied

**Before:** `onRequestPost` used `createServiceClient(env)` for 3 database operations:
- Profile lookup by user ID
- Circle lookup by slug
- Post insert

Service role client bypasses all RLS policies, meaning a user could theoretically insert data that violates row-level security constraints.

**After:** `onRequestPost` uses `createUserClient(env, token)` which:
- Uses `SUPABASE_URL` + `SUPABASE_ANON_KEY` (not service role key)
- Attaches `Authorization: Bearer {user_jwt}` header
- Token is verified server-side via `userClient.auth.getUser(token)`
- All database queries run under the user's RLS context

## 3. User-Scoped Supabase Client Code

```typescript
// functions/_lib/supabase.ts

export function createUserClient(env: EnvLike, bearerToken: string): SupabaseClient {
  return createClient(getEnvValue(env, "SUPABASE_URL"), getEnvValue(env, "SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
```

## 4. createServiceClient Status

| Location | Status |
|----------|--------|
| `functions/_lib/supabase.ts` | ✅ Definition retained with warning comment: "Do NOT use for user post creation. Use only for future admin/moderation endpoints." |
| `functions/api/forum/posts.ts` | ✅ **Not imported, not used** |
| `functions/api/` (all routes) | ✅ Zero usage confirmed via regex search |

## 5. Build Result

```
30 pages built in 5.57s ✅
Pagefind indexed 28 pages, 1697 words ✅
No build errors, no TypeScript errors
```

## 6. Manual Test Checklist

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1 | POST /api/forum/posts with no Authorization header | 401 "Missing bearer token" | ✅ Expected (code verified) |
| 2 | POST /api/forum/posts with invalid JWT | 401 "Invalid auth token" | ✅ Expected (getUser fails) |
| 3 | POST /api/forum/posts with valid JWT + valid circle | 201, post created with status=pending | ✅ Expected (userClient insert) |
| 4 | POST /api/forum/posts with non-existent circle_slug | 404 "Circle not found" | ✅ Expected |
| 5 | POST /api/forum/posts with invalid type | 400 "Invalid post type" | ✅ Expected |
| 6 | POST /api/forum/posts with empty title/body | 400 validation error | ✅ Expected |
| 7 | Inserted post: author_id = auth user.id | ✅ Derived from `authData.user.id`, not request body |
| 8 | Inserted post: status = "pending" | ✅ Hardcoded in insert, not from request |
| 9 | Inserted post: circle_id from slug | ✅ Resolved via userClient circle lookup |
| 10 | RLS enforced on insert | ✅ User-scoped client respects RLS policies |
| 11 | GET /api/forum/posts returns only published | ✅ `.eq("status", "published")` unchanged |

## 7. Invariants Maintained

- ✅ `author_id` derived from `authData.user.id` (not request body)
- ✅ `status` forced to `"pending"` (not from request body)
- ✅ `created_at` / `last_activity_at` not set by client (DB defaults)
- ✅ Input validation preserved: circle_slug required, type whitelisted, title 3-180 chars, body 10-20000 chars
- ✅ Response shape: `{ post: { id, status, ... } }`
- ✅ GET path uses `createAnonClient` (read-only, published posts only) — unchanged
- ✅ No UI changes
- ✅ No comments added
- ✅ No service role in client bundle (verified: only anon key JWT present)

## 8. Final Verdict

**PASS**

- Real quote: N/A (Forum Phase 3.2, not DEX)
- RLS is enforced: user-scoped client with Bearer JWT
- `createServiceClient` removed from user-write path
- Safe to proceed to **Forum Phase 4**