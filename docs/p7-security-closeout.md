# P7 Security Closeout

## Decision

`P7=PASS_SECURITY` and `P7_PRODUCT_SECURITY=PASS`.

This is not a Production release authorization. The verified release blockers
remain the canonical migration-history collision and unresolved runtime
dependency advisories.

## Fresh runtime evidence

- P6B full local lifecycle: `2f61d91c`, API 16/16, UI 16/16, cleanup PASS.
- P6C local lifecycle: `03d3d074`, 16/16, canonical public Devices 24,
  cleanup PASS.
- Device admin authorization: `scripts/test-device-admin-auth-sentinel.mjs`.
- Admin API contract: `scripts/test-device-admin-api-matrix.mjs`, 62/62.
- Admin UI contract: `scripts/test-admin-devices-dashboard.mjs`, 20/20.

All runtime evidence is local and run-owned; terminals are deliberately kept
outside the repository because they may contain operational diagnostics.

## Product security matrix

| Area | Result | Executable evidence |
| --- | --- | --- |
| Authentication and server-side staff authorization | PASS | P6B APIINT-01..03; device-admin auth sentinel |
| Privilege escalation and mass assignment | PASS | P4 matrix AUTH/SEC/CREATE/UPDATE cases; profile role-security audit |
| Ownership, IDOR and notification privacy | PASS | `npm run test:forum-permissions`; user-safety and reports regressions |
| RLS role-lockdown | PASS | `npm run test:profile-role-security`; local migration mirror |
| Session invalid/missing-token fail-closed behavior | PASS | P6B APIINT-01..02 and real local Auth fixture verification |
| H49 current account-security equivalent | PASS | Fresh local authenticated/unauthenticated actor matrix above; `A14_REPLAY=false` |
| Redirect and callback continuation | PASS | `src/lib/auth-redirect.ts` is consumed by login, callback, reset and resend paths; unsafe targets fall back to `/` |
| CSRF/origin and CORS | PASS_OR_NOT_APPLICABLE_WITH_PROOF | Sensitive mutations use explicit Supabase bearer authorization; no credentialed wildcard CORS responses are configured |
| XSS/user content and privacy | PASS | moderation regression; media URL privacy audit; no client service-role usage audit |
| Forum search filter injection | PASS | `scripts/test-forum-search-filter-safety.mjs` |
| Profile error sanitization | PASS | `scripts/test-api-error-sanitization.mjs` |
| Security headers | PASS | `scripts/test-security-headers.mjs` against production build output |
| Public Device privacy | PASS | P6C `03d3d074`; unpublished visibility and anonymous write checks |
| Secret audit | PASS | tracked-source private-key pattern audit; no credential values recorded here |

## Regression inventory

The following passed at closeout: default moderation test, user-safety,
reports, media URL privacy, profile role security, forum permissions, P4 API
matrix, P5 UI matrix, P6B full lifecycle, P6C lifecycle, public Device test,
and production build.

## Release blockers

### Migration history

`supabase/migrations` has 35 files, 19 unique version prefixes and 10 collision
groups. Production history is not available in this offline closeout, so:

```text
CANONICAL_MIGRATION_HISTORY_READY=false
CANONICAL_MIGRATION_VERSION_COLLISION_REMAINS=true
CANONICAL_PRODUCTION_HISTORY_COMPATIBILITY_PROVEN=false
P7_PRODUCTION_RELEASE_BLOCKER_MIGRATION_HISTORY=true
```

Historical migrations were not renamed, edited or applied.

### Dependencies

`npm audit --omit=dev` reports 14 vulnerabilities: 10 high and 4 low. High
findings include direct Astro, Cloudflare adapter and Sharp dependencies, plus
transitive build/runtime tooling. A framework-major upgrade is outside this
closeout and was not left partially applied.

```text
P7_DEPENDENCY_AUDIT_TOTAL=14
P7_DEPENDENCY_AUDIT_HIGH=10
P7_DEPENDENCY_SECURITY=BLOCKED_RELEASE
P7_PRODUCTION_RELEASE_BLOCKER_DEPENDENCIES=true
READY_FOR_PRODUCTION_RELEASE_AUTHORIZATION=false
```

## Terminal markers

```text
OPENGLASS_HUB_PUBLIC_BETA_P7_SECURITY_READY
P7=PASS_SECURITY
P7_PRODUCT_SECURITY=PASS
P7_SECURITY_ACCEPTANCE=PASS
P7_ACCOUNT_SECURITY_H49=PASS
ACCOUNT_SECURITY_H49_PAUSED=false
A14_REPLAY=false
P7_P6B_REGRESSION=PASS
P7_P6C_REGRESSION=PASS
P7_BUILD=PASS
P7_SECRET_AUDIT=PASS
P7_PRODUCTION_RELEASE=BLOCKED
READY_FOR_PRODUCTION_RELEASE_AUTHORIZATION=false
```
