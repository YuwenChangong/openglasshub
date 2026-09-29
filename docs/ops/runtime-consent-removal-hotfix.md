# Runtime Consent Removal Hotfix

This product decision supersedes the previous Slice A runtime consent design. The observed Gmail verification receipt did not establish successful authenticated access: the user reported a consent-recording error blocking site entry. QQ nonreceipt is a separate read-only mail diagnosis, not a demonstrated consent defect.

## Runtime Contract

- Login: email, password, login and forgot password; no age/legal acknowledgement controls, consent query/write or legal-consent redirect.
- Signup: email, password, register and compact nonblocking linked legal notice; no separate age/legal checkbox. Existing email verification remains required.
- Callback: real session then safe internal destination, without consent lookup/write.
- Layout: no global consent gate and no main-content hiding for consent. Normal authentication and authorization remain.
- Legacy legal-consent route: safe redirect to internal next or /feed/, rejecting external and self-loop destinations; no consent record.
- Mutation compatibility helper: trusted authenticated actor continues without consulting consent repository; absent identity returns401. Existing role, ownership, RLS, safety and rate-limit checks still execute in their owners.
- Historical acceptance data/migrations/audit evidence are retained. No database migration or Production SQL.
- Terms minimum age16 and policy bundle2026-07 are preserved as substantive policy, not ordinary UI access prerequisites.

## Acceptance

The exact check NO_RUNTIME_CONSENT_GATE replaces CONSENT_FLOW in the local Slice A validator. Real observed proof must show a verified user entering the intended destination without a policy interstitial and using normal authenticated functionality. Historical consent-recording receipts are rejected, not silently upgraded. Email delivery, session, ownership/privacy and complete password-recovery evidence requirements are unchanged. Production acceptance remains NO_GO_PENDING_HOTFIX until a separately authorized merge/deployment and real lifecycle rerun. External legal review remains NOT_CONFIRMED; this document claims no legal attestation.

## QQ Diagnosis

Human operator reported NO_EVENT for the existing QQ verification attempt in the same Brevo account/log source where Gmail has a successful event and actual receipt. QQ event UTC UNKNOWN. This is not proof of a Brevo transport failure or recipient-provider filtering. Correlation must continue upstream at the Supabase Auth request and SMTP submission boundary; no repeated send is permitted here. Auth request UTC, normalized Auth outcome and SMTP submission category are pending operator evidence. A read-only Management Auth-config request returned403; no configuration values were printed and no settings were changed. Current exact root cause UNPROVEN; no justified remediation proposal exists.

Do not change sender, SMTP credentials, DNS, rate limits or provider settings without new exact authorization. No Production writes, SQL, schema changes, P9, Verified Session, Slice B/C, Settings or search redesign are part of this hotfix. This branch may be pushed and submitted as a PR only after focused/full local tests and independent review; it must not be merged or deployed by this task.

A read-only Brevo sender listing did not match the local sender reference. That reference has not been proven to be the deployed SMTP sender, so this is not evidence of an invalid configured sender. SPF and DMARC TXT records were present for the locally referenced domain only; DKIM, actual envelope/From alignment, suppression status and QQ SMTP submission remain UNKNOWN. No sender address, provider payload or credential value was exported. No remediation is justified from these observations alone.

## Local Verification History

Preimplementation browser tests reproduced age/legal controls, login consent writes, callback consent routing, global content gating and the interactive legacy page. Authenticated mutation tests were RED for absent/unavailable consent, then GREEN after the identity-only helper change. The original RED logs and browser evidence remain ignored local artifacts, not a Production acceptance receipt.

The first full local release run returned 32 PASS and 1 FAIL: the QA profile test still expected the historical ten-script sequence, while the strengthened sequence contains thirteen scripts. The exact-list assertion was updated without changing retries, network permissions or the 90-second timeout; its focused rerun passed 58/58. Independent review found no P0/P1 issues and identified historical mutation-wave assertions still requiring consent denial. Those now require authenticated continuation with zero consent reads, preserving anonymous/staff rejection and existing route safety/ownership checks. Their focused rerun passed. The thirteen-script Slice A suite, npm test and build passed after these changes. Final committed-head release verification and review results are recorded in the PR receipt; none of this establishes real Production authenticated acceptance.
