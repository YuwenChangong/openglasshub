# Forum Phase 2 RLS Test Matrix

## Goal

Verify that permissions match MVP design before starting Auth UI and posting features.

## Roles

- `anon`
- `authenticated` (regular user)
- `moderator`
- `admin`

## Resource/action matrix

Legend:
- `ALLOW`: expected success
- `DENY`: expected permission error or no writable access
- `COND`: allowed only on own rows / scoped rows

### `profiles`

| Action | anon | authenticated | moderator | admin |
|---|---|---|---|---|
| select | ALLOW | ALLOW | ALLOW | ALLOW |
| insert | DENY | COND (self id only) | COND (self id only) | COND (self id only) |
| update | DENY | COND (self only) | ALLOW | ALLOW |
| delete | DENY | DENY | DENY | DENY |

### `circles`

| Action | anon | authenticated | moderator | admin |
|---|---|---|---|---|
| select | ALLOW | ALLOW | ALLOW | ALLOW |
| insert | DENY | DENY | ALLOW | ALLOW |
| update | DENY | DENY | ALLOW | ALLOW |
| delete | DENY | DENY | ALLOW | ALLOW |

### `posts`

| Action | anon | authenticated | moderator | admin |
|---|---|---|---|---|
| select | COND (published only) | COND (published + own) | ALLOW | ALLOW |
| insert | DENY | COND (author=self, status pending default) | ALLOW | ALLOW |
| update | DENY | COND (own only; no privilege escalation) | ALLOW | ALLOW |
| delete | DENY | COND (own only) | ALLOW | ALLOW |

### `comments`

| Action | anon | authenticated | moderator | admin |
|---|---|---|---|---|
| select | COND (published only) | COND (published + own + own-post context) | ALLOW | ALLOW |
| insert | DENY | COND (author=self) | ALLOW | ALLOW |
| update | DENY | COND (own only) | ALLOW | ALLOW |
| delete | DENY | COND (own only) | ALLOW | ALLOW |

### `reports`

| Action | anon | authenticated | moderator | admin |
|---|---|---|---|---|
| select | DENY | COND (own only) | ALLOW | ALLOW |
| insert | DENY | COND (reporter=self) | ALLOW | ALLOW |
| update | DENY | DENY | ALLOW | ALLOW |
| delete | DENY | DENY | DENY | DENY |

### `moderation_actions`

| Action | anon | authenticated | moderator | admin |
|---|---|---|---|---|
| select | DENY | DENY | ALLOW | ALLOW |
| insert | DENY | DENY | COND (moderator_id=self) | COND (moderator_id=self) |
| update | DENY | DENY | DENY | DENY |
| delete | DENY | DENY | DENY | DENY |

### `post_votes`

| Action | anon | authenticated | moderator | admin |
|---|---|---|---|---|
| select | ALLOW | ALLOW | ALLOW | ALLOW |
| insert | DENY | COND (user_id=self) | COND (user_id=self) | COND (user_id=self) |
| update | DENY | COND (user_id=self) | COND (user_id=self) | COND (user_id=self) |
| delete | DENY | COND (user_id=self) | COND (user_id=self) | COND (user_id=self) |

### `bookmarks`

| Action | anon | authenticated | moderator | admin |
|---|---|---|---|---|
| select | DENY | COND (user_id=self) | COND (user_id=self) | COND (user_id=self) |
| insert | DENY | COND (user_id=self) | COND (user_id=self) | COND (user_id=self) |
| update | DENY | COND (user_id=self) | COND (user_id=self) | COND (user_id=self) |
| delete | DENY | COND (user_id=self) | COND (user_id=self) | COND (user_id=self) |

## Pass criteria

1. No `anon` write access to any forum table
2. Regular users cannot mutate non-owned rows
3. Moderation tables are staff-only
4. Hidden/deleted content is not publicly readable
5. Report rows are private to reporter or staff

## Execution script

Use:
- [forum_rls_phase2.sql](D:/OpenGlass%20Hub/supabase/tests/forum_rls_phase2.sql)
