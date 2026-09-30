# Slice A Evidence-First Acceptance

## Superseding Runtime Contract

The runtime-consent removal hotfix supersedes the historical consent architecture below. Login and signup have no age/legal acknowledgement controls or consent writes. Signup alone has a compact nonblocking linked legal notice. Auth callback establishes a real session and replaces to a safe destination without consent lookup. Normal layout content is not gated or hidden for consent; authenticated mutations retain their existing authentication, ownership, RLS, role, safety and rate-limit checks but do not query consent storage. The legacy legal-consent route redirects safely without recording consent. Historical legal tables, rows, migrations and audit evidence are retained. Terms minimum age 16 and policy bundle 2026-07 remain unchanged.

The exact validator check `NO_RUNTIME_CONSENT_GATE` replaces the old `CONSENT_FLOW` key. Historical consent-recording receipts are not compatible and must not be relabeled PASS. Required observed evidence is: verified user enters the intended destination without policy interstitial; ordinary authenticated functionality is available. Consent persistence is not required. All other real-email receipt/callback, authenticated lifecycle, old-password rejection and new-password login requirements remain unchanged. The sections below containing old consent-recording requirements are historical context, superseded only on this point. This is functional product acceptance, not external legal approval.

Production acceptance: **PARTIAL**, limited to the human-reported signup-verification receipts below. This runbook and local fixtures do not authorize a real request, account creation, mail send, mailbox/provider inspection, password change, SQL, configuration change, merge or deployment. Independent review and further deployed execution remain separate work.

## Auth Email Abuse and UX v1: Scoped Evidence (2026-09-30)

The human reported fresh owned Gmail, QQ, and 163 signup-verification mailbox receipts PASS. A reused, already-registered QQ address produced no new confirmation mail. These observations cover only those signup attempts and providers. They do not establish all Chinese-provider delivery, resend/recovery delivery, callback/session completion, exact Auth duplicate responses, or future delivery. Mainland-China VPN compatibility is DEFERRED. Remaining authenticated lifecycle, password and complete evidence-receipt requirements remain incomplete; Production Slice A stays PARTIAL. No new real mail or provider observation was performed by the Task 6 implementer.

App mode is supplied by the Worker `AUTH_CAPTCHA_MODE` binding. `off` skips the auth widget; `prepare` attempts the widget and permits a no-token fallback. **Prepare is not security enforcement.** Supabase CAPTCHA toggle/provider/secret pairing and Cloudflare Managed mode/canonical-hostname restriction remain separate human configuration gates, not facts proven by local fixtures. The dedicated public auth site key is separate from upload configuration; no real auth key is added here.

Rollout is separately authorized: A is provider OFF/app `off`; B is provider OFF/app `prepare`; C is provider ON/app `prepare` for a bounded transient change/dwell window only; D is provider ON/app `required` after separately authorized deployment and verification. State C requires an approved duration, deadline, rollback owner, success criteria and request budget supplied by the later rollout authorization. This document invents no numeric dwell. Failure to reach and verify D inside that window requires the authorized operator to restore the recorded provider state first and record `BOT_PROTECTION=DEGRADED`; token-capable code must remain while enforcement is ON.

Task 6 preflight engineering evidence is local only. The focused script passed the eight original regressions, all four stale-`off` flows, retained stale-`prepare` cases, widget/token routing, cooldown and pending-state checks. The mode source test was updated to follow Task 5's extracted `configureAuthLoginResponse` helper. The first focused invocation exited 1 before tests: Node's `NODE_OPTIONS` parser consumed Windows backslashes in the quoted preload path, causing MODULE_NOT_FOUND. Changing that guard path to forward slashes yielded a separately recorded focused exit 0. Both results are retained; the correction is not a retry-as-PASS.

The local visual matrix covers login, signup, initial pending 60 seconds, resend ready, forgot, widget interaction/error, `off`/`prepare` unavailable widgets and `prepare` script failure in zh-CN/en at 390/430/1440: 60 states and screenshots. All six contact sheets were inspected; no horizontal overflow, clipping, duplicate primary submit/resend action or runtime-consent control was observed. Widget rendering is a labeled local fake, not live Turnstile acceptance. Visual setup exits 1 (new file missing from the tracked snapshot) and 1 (strict locator matched both widget and form errors) precede a separately recorded 60/60 exit 0 after explicit intent-to-add and a scoped error locator correction.

Actual local HTTP requests to the built Astro `/login/` returned 200, `Cache-Control: no-store` and current hydration modes for `off`, `prepare` and `required`; invalid explicit mode returned 500. The probe used fake local bindings, Miniflare with an outbound-deny handler, and no auth submissions; outbound requests were zero. Setup failures are preserved: v5 constructor requires conversion of v4 options; default module discovery omitted Astro chunks; v4 module-rule conversion is unsupported; the optional assets router lacked a user-worker binding. Explicit built modules and direct Worker serving resolved setup. This proves SSR response behavior, not a deployed response, real widget, provider enforcement or functional Auth acceptance.

The unchanged lock specifies Astro 7.2.10. The worktree's existing ignored `node_modules` junction points at the shared Astro 5 install and is preserved. Verification uses a non-destructive exact tracked-source snapshot with the existing offline-installed unchanged-lock dependencies. Node guards deny non-loopback sockets/DNS/fetch and are reapplied to sanitized QA children; browser HTTP/WebSocket guards block external traffic and synthetic widget-script responses are fulfilled locally. Telemetry is disabled. No dependency, provider configuration, Production/auth/email/SQL/P9, merge or deployment action is authorized by these checks.

The first full Task 6 snapshot (`448b504701840d8e0d6a6b08365a8673be4a8b9b223dcb9693c0ad9e52ebbcb4`) passed focused auth, resend, recovery, visual, Slice A, npm test and build (exit 0 each), but `qa:release` exited 1: 32 PASS, 1 FAIL, retry 0. The failed check was `qa-harness-profiles`, specifically `releaseIncludesSliceALocalChecks`: its exact expected npm-script list omitted the newly registered `npm run test:auth-email-abuse-ux`. Isolated reproduction exited 1 (57/58 PASS). Release's actual Slice A execution passed in 87,758 ms; this was a test-registration mismatch, not a timeout or Auth product failure. The fixture now includes that command and asserts its exact three constituent scripts plus the separately registered visual matrix. Its existing 90-second limit and zero-retry assertions remain intact. The first full release remains FAIL in the evidence history.

The final mandatory verification is a new separately identified snapshot run after that narrow fixture/docs correction, with commands, exact exits, source/dependency hashes and retained earlier failures in `.superpowers/sdd/2026-09-30-auth-email-abuse-ux-v1/task-6-report.md`. This ignored local handoff report is the final-run evidence; preflight success alone is not a full release PASS. Independent whole-branch review is assigned to the controller; push and PR creation remain deferred.

## Authorization and Private Handoffs

Before a future run, obtain fresh, bounded authorization naming the deployed revision/canonical Worker origin, observer, owned QA inboxes/users, permitted browser actions, operator read-only scope, time window and request budget. Confirm the current deployed commit independently; a source commit alone is insufficient. An `AUTHZ-0001` reference indexes the scoped authorization privately and is never an access token or grant generated by the validator. Existing approval from an earlier signup or recovery attempt does not persist automatically.

Confirm current Gmail access/ownership and permission before selecting a unique `openglasshub+qa-acceptance-...@gmail.com` alias. Human supplies the actual owned address privately; do not put it in receipts, chat or logs. Signup, resend, and reset all require primary Gmail evidence. Resend uses a separate unverified owned alias before confirmation, so an already-verified account cannot replace the resend case. Ask for a currently owned Outlook inbox; record unavailable access as a coverage limitation. QQ/163 are additional coverage when owned access exists. No borrowed/public mailbox or assumed prior access.

Budget one send per flow/provider and at most one deliberate resend/retry after cooldown/operator diagnosis. The existing server resend limit is 5/24h and local cooldown is 60 seconds. Observe Inbox/Spam for 15 minutes, record late arrivals independently, and stop on throttling, suppression or bounce. Do not loop, raise limits or destructively clean up accounts. Cleanup requires separate ownership confirmation and authorization through supported product actions; no SQL fallback.

Human opens mail/links and enters all passwords privately. Pause browser automation during email and password/link handoffs. Signup displays the nonblocking legal notice; no separate runtime consent attestation is required. Disable screenshots, traces, URL logs and recordings before secret-bearing navigation; resume only after URLs and screens are sanitized. Do not export storage, HAR, raw auth/provider payloads, mail bodies, OTPs, tokens, DSNs, metadata or credential-derived values. Record only outcomes and bounded references to safe observations. A pending human handoff remains PARTIAL/NOT_RUN.

## Ordered Mail Evidence

Repeat these steps separately for SIGNUP, RESEND and PASSWORD_RESET, with the flow and owned-provider scope recorded:

1. Identify the fresh authorization, deployed commit, observer and owned inbox; privately label this single attempt. A label/probe ID is not a timestamp or acceptance evidence.
2. Observe the browser request and normalized request Auth response, recording exact request and response UTC. This response evidence is required; an UNKNOWN `authOutcome` remains incomplete even when a message arrives. Request acceptance alone does not prove an account exists or an email arrived; public reset/resend responses stay generic.
3. Obtain additional operator Auth logs if available and explicitly authorized. Join Auth and provider records by owned recipient, flow/template and narrow UTC interval privately. If correlation is ambiguous or logs are unavailable, record UNKNOWN in the safe referenced observation, including unavailable UTC. This optional log access does not replace the required observed request Auth response. Do not guess from event order, IDs or manual reset recollection.
4. Operator verifies SMTP enabled/configured state, credential-type validity, sender/domain ownership, From/reply/contact alignment, Site URL/redirect allowlist, confirmation mode/templates, and limits/suppression, without exporting values. Privately inspect SPF/DKIM/DMARC and received Authentication-Results. Source config presence is not deployed SMTP proof.
5. Correlate Brevo ACCEPTED/REJECTED/DEFERRED/bounce/blocked/suppressed/SENT/DELIVERED event and exact UTC when available. Preserve the original category privately without payload/body/link; map it to the contract below. DELIVERED proves transport only; UNKNOWN stages stay UNKNOWN.
6. Human independently checks Inbox and Spam, then reports receipt and exact receipt UTC. No receipt within the window is false `mailboxReceived`, UNKNOWN receipt time and pending callback, never an invented bounce. Receipt in either folder counts as receipt; record folder/window/late-arrival disposition in the safe referenced observation.
7. Human follows the link privately. Resume on the sanitized app screen and confirm actual verified or recovery session/callback outcome. Open/click telemetry is insufficient. A real receipt without a working callback remains incomplete or failed.

If operator Auth logs, SMTP or Brevo evidence is unavailable, record that operator stage as UNKNOWN and its coverage limitation in the safe referenced observation. Actual receipt/callback, together with the required observed request Auth response, can establish functional delivery in that provider scope without inventing operator evidence. Missing request Auth response remains incomplete. A claimed known transport event needs its actual UTC; UNKNOWN event time remains incomplete. A known rejection/bounce/failed callback stays FAIL even if inbox access is later marked unavailable. Do not infer Gmail success rules out another provider failure.

Diagnose before proposing SMTP/DNS/template/limit changes. This runbook grants no provider mutation or direct database access. Any justified remediation needs separate reviewed authorization, before/after safe evidence and rollback; never add a webhook, alternate sender/session system, SQL/profile repair or Production credential inspection here.

## Lifecycle Observations

Use safe references to record each complete observed case, not merely that its source or HTTP endpoint exists:

| Check | Required human/browser evidence |
| --- | --- |
| AUTH_SIGNUP | Fresh owned signup with compact nonblocking linked legal notice and no age/legal checkbox; request/response and account outcome. |
| AUTH_EMAIL_VERIFICATION | SIGNUP Gmail receipt, private link handoff, verified session and safe callback destination; invalid/reused/expired callback remains actionable without unsafe redirect. |
| AUTH_LOGIN | Human signs in; browser session becomes usable. |
| AUTH_SESSION_PERSISTENCE | Same owned session survives refresh, normal navigation, and context close/reopen; one header screenshot is insufficient. |
| DEFAULT_IDENTITY | Immediate nonblank private name/initial, including slow/unavailable optional summary; own profile route usable; unavailable stats are not fabricated zero. |
| NO_RUNTIME_CONSENT_GATE | Verified user enters the safe intended destination without consent lookup/write or policy interstitial; normal authenticated functionality remains available without historical consent. |
| AUTH_RESEND_VERIFICATION | Separate unverified owned alias, bounded deliberate resend, RESEND Gmail receipt and private verification callback before confirmation. |
| AUTH_LOGOUT | Normal logout clears the usable browser signed-in state; do not claim immediate revocation of every existing JWT. |
| AUTH_RELOGIN | Human signs back in successfully and sees own usable identity/profile. |
| AUTH_PASSWORD_RECOVERY | Complete recovery handoff below, including independent old-password rejection and new-password login. |
| EMAIL_DELIVERY | All three primary Gmail receipt/callback cases; report actual provider scope and operator limitations separately. |

Recovery sequence is: request -> human Inbox/Spam receipt and private link -> browser validated recovery session -> human enters new password -> observed password update -> logout -> exactly one human old-password login attempt rejected -> human new-password login accepted. Pause automation for each password input. Do not retry the old password, log passwords or count an already-open session as a fresh login. Successful local adapter tests, update HTTP success, or a manually asserted reset alone do not prove rejection/acceptance. Each password outcome in the receipt is boolean only; false means proof is absent/incomplete, never inferred from another step.

Keep Terms minimumAge=16 and bundle/version=2026-07 unchanged, with no runtime age/consent prerequisite. Report `LEGAL_EXTERNAL_REVIEW_STATUS` separately as CONFIRMED, NOT_CONFIRMED, or REQUIRED_FOR_POLICY_CHANGE. External review remains NOT_CONFIRMED; this is not lawyer/compliance approval. REQUIRED_FOR_POLICY_CHANGE stops that specific substantive change; the validator refuses acceptance of such a receipt while unaffected engineering can continue.

## Version 1 Receipt Contract

The validator is a local, pure structure/evidence gate; it cannot authenticate an observer, prove authorization or detect a fabricated OBSERVED assertion. A human must verify referenced observations and the deployed revision. A fixture PASS is **only a validator test**, never Production acceptance. No real receipt has been collected in Task 7.

Exact objects reject missing or extra keys, arbitrary payloads, accessors, URLs and free text. All strings are fixed enums, exact UTC, deployed SHA or numeric references. No mailbox address, origin URL, observer name, message ID or raw error field is accepted. References are labels indexing safe redacted evidence privately; they never contain secret material or grant access. Actual tested origin/observer/case dispositions remain in the separately authorized referenced record.

| Object | Exact required keys and bounds |
| --- | --- |
| Root | `schemaVersion` exactly 1; `deployedCommit` 40 lowercase hex characters, excluding the all-zero placeholder; `observedAtUtc`; `authorizationRef` exactly `AUTHZ-` plus four digits; `legalExternalReviewStatus`; `checks`; `mailCases`; `passwordOutcomes`. |
| `checks` | Exactly the eleven check names above. Each value has only `status`, `evidenceKind`, `evidenceRefs`. |
| Check status | PASS, PARTIAL, FAIL, NOT_RUN. |
| Evidence kind | OBSERVED, SOURCE_ONLY, LOCAL_FIXTURE, UNKNOWN. Only OBSERVED with nonempty safe references supports a functional PASS. |
| `evidenceRefs` | Array of 0-8 unique labels, each exactly `EV-` plus four digits. Empty references are incomplete. No paths, URLs, credentials or external IDs. |
| `mailCases` | Array of 0-12 cases; at most one per provider/flow. No duplicate attempt overwriting a failure. Summarize an authorized retry honestly in the referenced evidence; a prior supplied failure cannot disappear from the run's result. |
| Mail case | Exactly `flow`, `provider`, `ownedInbox`, `evidenceKind`, `evidenceRefs`, `requestAtUtc`, `responseAtUtc`, `eventAtUtc`, `receiptAtUtc`, `appOutcome`, `authOutcome`, `smtpOutcome`, `brevoOutcome`, `mailboxReceived`, `callbackOutcome`. |
| Flow/provider | SIGNUP, RESEND, PASSWORD_RESET / GMAIL, OUTLOOK, QQ, 163. |
| Booleans | `ownedInbox` and `mailboxReceived` are actual booleans, never string truthiness. |
| App/Auth outcomes | REQUEST_ACCEPTED, AUTH_REJECTED, RATE_LIMITED, UNAVAILABLE, UNKNOWN. |
| SMTP outcome | SMTP_ACCEPTED, REJECTED, RATE_LIMITED, UNAVAILABLE, UNKNOWN. |
| Brevo outcome | ACCEPTED, SENT, DELIVERED, DEFERRED, SOFT_BOUNCED, HARD_BOUNCED, BLOCKED, SUPPRESSED, REJECTED, UNKNOWN. |
| Callback outcome | VERIFIED_SESSION for signup/resend; RECOVERY_SESSION for reset; otherwise FAILED, NOT_RUN, UNKNOWN. Ordinary signed-in state is not validated recovery proof. |
| UTC fields | Exact valid `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ`, or literal UNKNOWN. No offsets, impossible dates, IDs or guessed times. |
| `passwordOutcomes` | Exactly `evidenceKind`, `evidenceRefs`, and booleans `recoverySessionEstablished`, `passwordUpdated`, `loggedOut`, `oldPasswordRejected`, `newPasswordAccepted`. No password values. |

Missing/malformed required fields, unsafe types/strings or extra keys produce FAIL/SCHEMA_INVALID without echoing the input. Structurally valid incomplete evidence produces PARTIAL; any supplied check FAIL, rejection, throttling, unavailable request/SMTP outcome, deferred/bounced/blocked/suppressed provider event or failed callback produces FAIL. Missing primary Gmail flow, ownership, actual receipt, expected callback, request/response/receipt UTC, nonempty observed references or any password proof cannot PASS. UNKNOWN observation UTC is incomplete. No timestamps are synthesized or inputs mutated.

Non-Gmail cases absent entirely yield `<PROVIDER>_NOT_RUN`; absent flows on a supplied provider yield `<PROVIDER>_<FLOW>_NOT_RUN`. Optional unavailable owned access yields `<PROVIDER>_<FLOW>_OWNED_ACCESS_UNAVAILABLE` and is not a test PASS. A supplied owned case without receipt/callback remains PARTIAL, and any known failure remains FAIL before availability is considered. Primary Gmail is mandatory for all three flows. UNKNOWN SMTP/Brevo operator stages yield named limitations; when Brevo is known, DELIVERED and its UTC are required. Neither SENT nor DELIVERED substitutes for Inbox/Spam receipt and callback proof.

## Local Validation and Reporting

The deterministic engineering suite runs sixteen Slice A scripts serially (including the three-script focused auth-email-abuse command) and stops on the first failure:

```sh
npm run test:product-recovery-slice-a
```

It covers ungated login/signup and callback behavior, legacy visual compatibility, redirect safety, identity-only mutation guards, actor-scoped summary, immediate header identity, redacted email diagnostics, recovery/callback handling and the evidence validator. RELEASE selects `product-recovery-slice-a` and invokes this npm script locally with no retries. The existing 90-second check timeout is retained. The production QA profile and generic execution/network authorization boundaries are unchanged. Run local engineering with external-network denial in Node subprocesses and browser HTTP/WebSocket guards; this command does not grant provider or Production access.

Focused verification is registered as `npm run test:auth-email-abuse-ux`; the separate 60-state screenshot matrix is `npm run test:auth-email-abuse-visual`. The visual matrix remains separate from the 90-second release Slice A check; no timeout was increased.

Integration verification on 2026-09-29 is **not GREEN**. The registration regression failed before registration and then the QA profile tests passed 58/58. An initially stale auth-flow source assertion was reconciled under controller authorization: it now verifies both assignment from `consent.current` and routing through `current ? safeNext`. Its focused RED exited 1 and GREEN exited 0; no check was skipped or deleted. The full ten-script Slice A npm suite, profile suite, `npm test`, build and diff check then exited 0. Existing real-component current/outdated-consent and malicious-destination callback tests passed unchanged. Both subsequent full `qa:release` runs exited 1 with 34 PASS and 1 FAIL: the existing local `forum-search` response timeout. The Slice A release check passed. Earlier isolated and full-release search passes are retained alongside these failures; the latest clean full release is still FAIL. No search/product/generic timeout was changed and no readiness PASS is claimed.

The consent matrix exercised 32/32 states, 78 screenshots, nine checked-state screenshot assertions and six redirect states, with zero unexpected external requests. Actual identity, consent, login and empty recovery-form screenshots were inspected at widths 390, 430 and 1440; selected surfaces showed visible identity and no clipping. Browser controls and recovery edges were exercised with explicit fakes. Independent review is pending; real inbox delivery, authenticated lifecycle acceptance and old/new-password verification remain NOT_RUN. `LEGAL_EXTERNAL_REVIEW_STATUS=NOT_CONFIRMED`; no policy change or readiness claim is made.

Local tests create explicit synthetic receipts and deny networking:

```sh
node scripts/test-slice-a-acceptance.mjs
```

For a later, separately authorized private receipt, use the local CLI:

```sh
node scripts/lib/slice-a-acceptance.mjs --receipt .tmp/slice-a-acceptance.json
```

Keep the receipt ephemeral, private and unstaged. The CLI rejects UNC, device namespace, reserved device-name and URI paths before filesystem I/O, preserving ordinary local relative/absolute paths. It reads a local regular file of at most 65,536 bytes, with canonical compact JSON as produced by `JSON.stringify` (optional surrounding whitespace). Canonical encoding rejects duplicate keys, alternate escaped keys and malformed JSON; pretty-printed/noncanonical input is rejected rather than ambiguously normalized. The API accepts the exact object contract directly. Both expose only `{status, missing, providerLimitations}` with fixed names and status; paths, payloads, authorization/evidence references and deployed SHA are never printed. Exit code is 0 only for PASS, 1 otherwise. Invalid arguments/read/parse errors use the same safe FAIL summary, without a stack or echoed filename.

Publish only a human-reviewed redacted outcome summary with actual tested provider scope, limitations, legal-review status and incomplete cases. Do not label local source/build/fixture results as authenticated acceptance, universal delivery, Slice B/C readiness or large-scale capacity. Current Production status is PARTIAL for the scoped human signup receipts above; further cases require fresh authorization and observed evidence.
