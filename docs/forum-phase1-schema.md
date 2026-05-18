# OpenGlass Hub Forum Phase 1: Schema Design

## 1) Schema overview

This MVP schema targets:

- user identity and profile
- circle-based forum organization (device/topic/project)
- posts and comments
- reporting and moderation trail
- optional social actions (votes/bookmarks)

Core tables:

- `profiles`
- `circles`
- `posts`
- `comments`
- `reports`
- `moderation_actions`
- `post_votes`
- `bookmarks`

Supporting decisions:

- UUID primary keys on all public tables
- `profiles.id` references `auth.users(id)` directly
- enum types for all constrained status/type fields
- baseline RLS policies for `anon` and `authenticated`
- staff authorization via `role` (`user` / `moderator` / `admin`)

Migration file:

- [20260518_forum_phase1_schema.sql](D:/OpenGlass%20Hub/supabase/migrations/20260518_forum_phase1_schema.sql)

## 2) Table-by-table explanation

### `profiles`

Purpose:

- maps Supabase Auth user (`auth.users.id`) to forum profile data
- stores user role and trust level for moderation and governance

Key points:

- `username` is optional at signup and unique when present
- `role` is enum-backed for safe authorization checks
- trigger `handle_new_user()` auto-creates profile rows on signup

### `circles`

Purpose:

- forum categorization layer for devices/topics/projects
- stable slug route for frontend URL mapping

Key points:

- `slug` has a lowercase-hyphen format check
- `type` enum prevents uncontrolled categories

### `posts`

Purpose:

- top-level forum content in circles

Key points:

- `type` enum supports MVP content modes (`experience`, `question`, etc.)
- `status` enum supports moderation workflow (`pending`, `published`, `hidden`, `deleted`)
- `last_activity_at` supports activity sorting without join-heavy queries

### `comments`

Purpose:

- replies under posts

Key points:

- separate `comment_status` enum for comment-level moderation
- trigger updates post `last_activity_at` when published comments are created/activated

### `reports`

Purpose:

- user-generated abuse/content issue reports

Key points:

- polymorphic target via `target_type` + `target_id`
- trigger validates target existence (`post` / `comment`)
- `status` enum tracks triage lifecycle (`open`, `reviewed`, `dismissed`)

### `moderation_actions`

Purpose:

- immutable moderation action history for auditability

Key points:

- explicit `moderator_id` + `action` + `reason`
- target validation trigger for post/comment/profile references

### `post_votes` (optional MVP feature included)

Purpose:

- upvote/downvote signal for posts

Key points:

- one vote per user per post (`unique(post_id, user_id)`)
- `vote` constrained to `-1` or `1`

### `bookmarks` (optional MVP feature included)

Purpose:

- save posts for later

Key points:

- one bookmark per user/post pair (`unique(user_id, post_id)`)

## 3) Index recommendations

Implemented indexes in migration:

- `profiles(lower(username))` unique partial index
- `circles(type)`
- `posts(circle_id, status, last_activity_at desc)`
- `posts(author_id)`, `posts(status, created_at desc)`
- `comments(post_id, status, created_at asc)`, `comments(author_id)`
- `reports(status, created_at asc)`, `reports(target_type, target_id)`
- `moderation_actions(target_type, target_id, created_at desc)`
- `moderation_actions(moderator_id, created_at desc)`
- `post_votes(post_id)`, `post_votes(user_id)`
- `bookmarks(user_id, created_at desc)`

Why these indexes:

- keep circle feeds, moderation queues, and user profile pages efficient
- keep report triage and target lookups cheap
- avoid full scans on common per-user actions (votes/bookmarks)

## 4) RLS and role model summary

Role source:

- `profiles.role`

Helper functions:

- `current_user_role()`
- `is_moderator_or_admin()`

Policy model:

- public read for `circles` and published `posts/comments`
- authenticated users can create and manage their own content
- moderators/admins can manage hidden/deleted/review states
- report creation restricted to reporter identity
- moderation actions writable/readable by staff only
- bookmarks and votes are self-owned rows only

## 5) Intentionally excluded from MVP

Not included by design in Phase 1:

- private messages / DMs
- payments / subscriptions
- marketplace / transactions
- media upload pipeline (images/videos/files)
- threaded/nested comments (single-level comments only)
- notification center
- reputation economy beyond basic `trust_level`
- full-text search indexing strategy
- anti-spam automation (rate limits, heuristics, ML moderation)
- multi-tenant org/forum partitioning

## 6) Suggested next step after migration

Before UI implementation:

1. apply migration in Supabase staging
2. seed `circles` with initial device/topic/project entries
3. create one `admin` and one `moderator` profile manually
4. run policy tests for `anon`, normal user, moderator, admin
