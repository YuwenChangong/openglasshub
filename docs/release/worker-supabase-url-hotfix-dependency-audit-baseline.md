# Worker `SUPABASE_URL` Hotfix — Dependency Audit Baseline

Date: 2026-09-09

This is a one-hotfix evidence record for `hotfix/worker-supabase-url-config-v1`.
It does not change the repository-wide dependency-audit policy or suppress any
advisory.

## Comparison

The same command was run in a clean detached worktree at current `origin/main`
and in the hotfix candidate:

```text
npm audit --omit=dev --json
```

Both results exit non-zero and report the identical vulnerability set:

```text
DEPENDENCY_AUDIT=BASELINE_BLOCKED
BASE_AUDIT_HIGH=5
HOTFIX_AUDIT_HIGH=5
BASELINE_ADVISORY_SET_MATCH=true
DEPENDENCY_MANIFEST_DIFF=0
DEPENDENCY_AUDIT_INTRODUCED_BY_HOTFIX=0
```

The identical high-severity dependency chain is:

```text
@astrojs/cloudflare
  -> @cloudflare/vite-plugin / wrangler
  -> miniflare
  -> sharp (GHSA-rgj7-g3m4-5g8c)
```

The five affected package identities are `@astrojs/cloudflare`,
`@cloudflare/vite-plugin`, `miniflare`, `sharp`, and `wrangler`. Their affected
ranges, dependency paths, and `fixAvailable` results matched exactly between
the baseline and the candidate.

## Authorized Exception

```text
HOTFIX_DEPENDENCY_BASELINE_EXCEPTION=AUTHORIZED
```

The exception applies only to this availability hotfix: it preserves the
non-secret `SUPABASE_URL` runtime variable in the generated Workers deployment
configuration. The hotfix changes no dependency manifest or lockfile. A
separate dependency-security remediation task is required for the baseline
findings.
