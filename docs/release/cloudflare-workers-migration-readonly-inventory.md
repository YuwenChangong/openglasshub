# Cloudflare Workers migration: read-only inventory

Date: 2026-09-02

This is a value-blind W1 receipt. It contains configuration and binding
names, classifications, counts, and sanitized Cloudflare metadata only. It
does not contain environment values, resource identifiers, OAuth tokens,
secret values, or database evidence. No provider, Supabase, database, DNS,
Pages, Worker, or Git remote mutation was performed.

## Repository receipt

`node scripts/qa/cloudflare-workers-migration-inventory.mjs` reported:

- Source configuration keys: `compatibility_date`, `kv_namespaces`, `name`,
  `pages_build_output_dir`, `r2_buckets`.
- Generated Worker configuration keys: none (a generated artifact was not
  present before the Task 2 canonical build).
- Runtime bindings: `MODERATION_ASSETS` (R2) and `SESSION` (KV) are declared
  at root; both are also declared for preview; `MODERATION_ASSETS` is declared
  for production. The missing production `SESSION` declaration requires review
  before provider configuration changes.
- Preview environment-variable names (26): `DEV_TURNSTILE_BYPASS`,
  `MODERATION_PROVIDER`, `MODERATION_PROVIDER_UNAVAILABLE_POLICY`,
  `OPENAI_CIRCLE_COVER_MODERATION_ENABLED`, `OPENAI_FORUM_POLICY_ENABLED`,
  `OPENAI_FORUM_POLICY_FAIL_MODE`, `OPENAI_FORUM_POLICY_MODEL`,
  `OPENAI_FORUM_POLICY_TIMEOUT_MS`, `OPENAI_MODERATION_ENABLED`,
  `OPENAI_MODERATION_FAIL_MODE`, `OPENAI_MODERATION_LOG_LEVEL`,
  `OPENAI_MODERATION_MODEL`, `OPENAI_MODERATION_TIMEOUT_MS`,
  `OPENAI_POST_IMAGE_MODERATION_ENABLED`,
  `OPENAI_PROFILE_IMAGE_MODERATION_ENABLED`,
  `OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED`, `PUBLIC_SUPABASE_ANON_KEY`,
  `PUBLIC_SUPABASE_URL`, `PUBLIC_TURNSTILE_SITE_KEY`, `R2_ACCOUNT_ID`,
  `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`, `SUPABASE_URL`,
  `UPLOAD_TURNSTILE_MODE`, `VIDEO_POST_FAIL_MODE`, and
  `VIDEO_POST_REQUIRES_THUMBNAIL_MODERATION`.
- Production environment-variable names (31): the same non-public moderation,
  Supabase, R2, Turnstile, and video names, plus
  `PUBLIC_ABUSE_EMAIL`, `PUBLIC_IP_EMAIL`, `PUBLIC_LEGAL_OPERATOR_NAME`,
  `PUBLIC_PRIVACY_EMAIL`, and `PUBLIC_SUPPORT_EMAIL`. The exact, value-blind
  list is reproducible through the collector.
- Route source counts: 91 page files, including 45 API route files and 46
  non-API route files.

## Legacy Pages-origin classifications

The collector finds every legacy Pages-origin occurrence in supported text
files and assigns one classification per file. The current totals are:

| Classification | Occurrences | Locations | Required follow-up |
| --- | ---: | --- | --- |
| `SWITCH_AFTER_WORKER_PASS` | 31 | Astro site configuration, robots, source layouts/helpers/pages/plugins, and published content | Change only during the authorized canonical-origin phase. |
| `ADD_NEW_URL_FIRST` | 4 | package production-check default, production smoke, post-launch check | Add an explicit Worker target while retaining Pages as default. |
| `KEEP_UNCHANGED` | 24 | release/readiness/SEO/device documentation | Treat as historical evidence unless separately reviewed. |
| `UNKNOWN_REQUIRES_REVIEW` | 13 | device-spec tooling, test harnesses, production-canary tooling, and this inventory/test implementation | Resolve ownership before making an origin canonical. |
| `EXTERNAL_PROVIDER_WRITE_REQUIRED` | 0 | none found in supported repository text | Independently inventory provider-side Auth/OAuth/CORS/webhook settings before W3. |

The classification total includes the checker and its fixture because they
intentionally contain the legacy origin for regression coverage. It is not a
runtime dependency.

## Sanitized Cloudflare provider receipt

Authenticated Cloudflare GET requests were limited to account subdomain,
Worker script listing and per-script workers.dev state, and Pages project
metadata. No write endpoint was called.

```json
{
  "schemaVersion": "cloudflare-workers-provider-receipt/v1",
  "accountSubdomain": "liujinyi081",
  "workerScripts": [
    {
      "name": "heph-control-plane",
      "workersDevEnabled": true,
      "previewsEnabled": true
    }
  ],
  "pagesProjects": [
    {
      "name": "openglasshub",
      "buildMetadataKeyNames": [
        "build_command",
        "destination_dir",
        "root_dir",
        "web_analytics_tag",
        "web_analytics_token"
      ]
    }
  ]
}
```

The listed metadata field names are names only; none of their values were
retrieved or recorded. The account subdomain is shared by the existing Worker,
so it must not be changed without a separate impact review. Script-list absence
does not reserve a future Worker name.

## Task 1 decision

The repository remains Pages-configured at this point. Task 2 must replace the
Pages-only source contract and validate a fresh Astro-generated Worker artifact
without changing provider state. Pages remains retained as the legacy fallback.
