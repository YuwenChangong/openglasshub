# Task 5 Report: Server guard and session-state API

Base: `bf17ba4afe7f416328f50404457dd5e7b21add51` on `feature/auth-verified-session-v1`.

## Changes

- `requireModerator` and `requireForumUser` now require signed claims plus the live user-token verified-session predicate before profile, role, or ownership reads. Admin identity comes from signed claims; the forum provider user is checked against the signed subject. Existing role/owner checks remain after verification.
- A separate verified mutation helper checks the policy-only predicate after session verification. The existing consent helper remains available for the narrow bootstrap path and is not made dependent on session verification.
- `GET /api/auth/session-state` returns only `state` and `policy` on success. Anonymous and malformed/expired token responses are anonymous; a valid pending session can independently report current or missing policy. Verification infrastructure failures return a no-store 503. No private rows or user identifiers are returned.

## TDD Evidence

- RED 1: `node --experimental-strip-types scripts/test-verified-session-routes.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for the absent `src/pages/api/auth/session-state.ts`.
- RED 2: after the first implementation, the policy-only expectation exited 1 at `VERIFIED_POLICY_CURRENT` (`false !== true`) because the helper still used the legacy consent record.
- GREEN: the same focused command exited 0 with 20 passing named cases, including anonymous, malformed bearer, stale token, pending and verified policy states, DB/Auth outages, no pending profile/consent lookup, and verified role denial.

## Verification

- `npm run test:legal-consent-mutation-guard`: pass, 13 offline cases.
- `node scripts/test-device-admin-api-matrix.mjs`: pass, 62 descriptors. The plan's `npm run test:device-admin-api-matrix` alias does not exist in this checkout; that invocation exited 1 with `Missing script` before the direct file run.
- `npm run test:auth-redirect-safety`: pass, 10 valid and 27 rejected cases.
- `npm test`: pass. Existing moderation fallback and Vite port warnings appeared.
- `npm run build`: pass. Existing CSS pseudo-class and prerender route-conflict warnings appeared.
- `git diff --check`: pass, with line-ending conversion notices.
- `npx astro check`: exit 1 with 176 repository diagnostics. The new route has the same unresolved `cloudflare:workers` virtual-module type diagnostic as existing routes; no other new diagnostics were reported for the Task 5 files.

## Concerns and Handoff

- This is Task 5 only. Other route-local `getUser` paths and direct data surfaces are not covered until Tasks 6 and 7. Do not describe this branch as fully enforcing Verified Session v1.
- Existing `requireAuthenticatedLegalConsent` callers still use the historical age-bearing consent read model. Task 10 must migrate those callers to policy-only consent while preserving pending consent bootstrap. The new verified mutation helper is ready for protected callers but is not wired into their routes in this task.
- No Production access, deployment, real email, environment-secret read, or live external call was used.
