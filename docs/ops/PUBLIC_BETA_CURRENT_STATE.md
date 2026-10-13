# Public Beta Current State

Authoritative release/progress baseline. Updated 2026-10-13 by offline inspection
of actual Git/source and existing safe receipts, not by replaying Production tests.
Read this first for every task. This document is not an authorization or GO.
`VERIFIED` is scoped historical evidence, not proof of unchanged live state now.
Missing/uncertain outcomes remain `UNKNOWN`; denied execution remains `BLOCKED`.

## Source and Release Identity

- Released source: `88680a6eaab8de4123199f16b325ec0a430b0b86`.
- Build ID: `d98da799-d41d-41dc-acaf-8c6675fd799a` (not the Worker Version ID).
- Last verified Production Version: `b2b62ec9-bb8d-4159-ac99-08fca5740134`,
  traffic 100%, recovery traffic 0%, from the anonymous E_VERIFY postcheck [E].
  Current live state is UNKNOWN until an independently authorized dynamic check.
- Local product head: `9161ca71e6fcceef984c8129f156667d536c7a44`, parent is
  the released source. Its native destructive-confirmation fix is NOT deployed.
- Continuity branch: `codex/public-beta-release-continuity-20261013`, checkout
  `C:/Temp/ogh-product-beta-development-20261013`. No fetch, push or merge here.
  Local `origin/main` still names the released source; this is not a fresh remote check.
- Current authorization-preparation branch: `codex/group1-free-plan-approval-20261013`,
  based on continuity commit `1e027888`; no unrelated branch was merged.
- Current scoped engineering branch: `codex/group1-asset-reader-fresh-v8-20261013`,
  preserving prior local product/continuity commits and later authorization history.
- Recovery Version `1b327fed-be4b-4873-9fcd-6514e014916c`: verified content [R],
  PRE-HARDENING ONLY. Never use it as the default post-Hardening recovery target.
- `CATALOG_HOLD=ACTIVE`; writers, queues and retries remain held. Current continued
  hold is the owner's instruction, not a newly observed global Provider condition.
- `MAX_ADDITIONAL_COST_USD=0`; paid usage, overages and unverified billing risk
  are NOT accepted. `PUBLIC_BETA_GO=NOT_AUTHORIZED`; full `E_VERIFY=INCOMPLETE`.

## Completed and Open Scope

| Scope | Evidence-backed state | Rule / remaining work |
| --- | --- | --- |
| B_MIGRATIONS | VERIFIED required schema/ledger [B] | Later Stage C proof verifies Stage B schema; preserve earlier failed B receipts, never replay migrations |
| C_IMPORT | VERIFIED PASS, COMMIT and postcommit/close PASS [C] | Completed; never replay import |
| C_ACTIVATION | VERIFIED PASS, COMMIT and postcommit/close PASS [V] | Completed; never replay activation |
| A_DEPLOY | VERIFIED PASS, one main push, smoke 5/5 [A] | Build/source/version distinction resolved; do not redeploy |
| D_HARDENING | VERIFIED PASS, confirmed COMMIT/postcheck/cleanup [D] | Consumed policyfix-v3; 11 SELECT / 33 dispatch / 37 statements; do not rerun |
| Recovery assets/modules/Runtime | VERIFIED pre-Hardening READY [R] | 79/79 bytes, 293/293 modules, Runtime PASS; no new recovery upload |
| E_VERIFY anonymous | VERIFIED 43/43, two Deployment GETs [E] | Consumed authorization/Claim; no rerun, live Auth still NOT_VERIFIED |
| Private intake | VERIFIED READY [I, Z] | 160 fields: 153 completed, required 0, optional circle 4 null, formal approval 3 deferred; no new wizard |
| GROUP_1 engineering | VERIFIED 123/123, 14 scoped mappings [G] | Production outcomes UNKNOWN; not all 50 mandatory cases completed |
| authenticated Catalog RLS | Prepared 16 exact reads [G] | Actual A/B identity, policies/access results UNKNOWN; do not infer from anonymous PASS |
| Zero-cost gate | VERIFIED 9/9 reused; Free-only proof admission PASS offline | Owner plans RECORDED, official policies checked; new binding uses exact proof before OAuth/Claim and child transport |
| GROUP_1 live authorization | CONSUMED / PRODUCTION_ACCEPTANCE_BLOCKED | Fresh GO launched one supervised attempt; LOGIN_A stopped at UNAPPROVED_REQUEST; Claim retained, cleanup PASS; never replay this ID |
| LOGIN_A asset evidence closure | VERIFIED24 protected payloads;23 exact Production paths reviewed and bound;34/34 new offline tests PASS | CtUXEG6g source/purpose verified;16 exact local bytes +7 scoped AST reviews; full GROUP_1 BLOCKED on uncaptured post-login products/admin assets |
| GROUP_2 QA mutations | BLOCKED / NOT_AUTHORIZED | Real stateful acceptance incomplete; media/cleanup controls and cost guarantees unresolved |
| GROUP_3 server bounds | BLOCKED / NOT_AUTHORIZED | Server moderation/cost enforcement proposal exists; no approved product change or deployment |

Receipt reuse does not authorize execution. Historical time conflicts, 20-second
timeout FAIL, unknown upload side effects and retained consumed Claims stay unchanged.

## Evidence Locator

Paths below are existing LOCAL receipts, not new competing progress documents.
If a file is unavailable, report that exact missing evidence; do not restart a
passed stage. Never expose private input or copy frozen implementation into reports.
`Q=C:/Users/1/.codex/worktrees/e-verify-stateful-controls/OpenGlass Hub/tools/e-verify-stateful`.

| ID | Existing path | SHA256 inspected for this baseline |
| --- | --- | --- |
| B | `C:/Temp/ogh-stage-c-import-evidence-recovery-44dd0546-v1/safe-state.json` | `6262ea721622c9f0e892e4ff44b8795aa9605eccb9c552f4db90438b2c75adb2` |
| C | `C:/Temp/ogh-stage-c-import-local-supervisor-repair-20261010/attempt-stage-c-import-20261010-supervisor-datefix-v3/child-safe-result.json` | `73f36fb08a7d163ee69a667b52f650e02772cd7c72f82fcd662de304b12cca32` |
| V | `C:/Temp/ogh-stage-c-activation-readiness-20261010/attempt-stage-c-activation-20261010-v1/child-safe-result.json` | `329191b1d368f57dfbe717c6eb0cc27a5f34651a5ef9b8e5a4f846cba6844a02` |
| A | `C:/Temp/ogh-a-deploy-readiness-20261010/final-recovery151-authorization/A_DEPLOY_FINAL_SMOKE_CLOSURE_RESUMED_SAFE.json` | `30562abd0af842b2b0184248e06aff2bb75c196c05269d687dbcb73aa48ce70d` |
| D | `C:/Temp/ogh-d-hardening-policy-baseline-fix-20261012/attempt-d-hardening-openglasshub-20261012-policyfix-v3/D_HARDENING_PRODUCTION_EXECUTION_SAFE.json` | `73ca4934b15e2e054d87ce2c58db41059590c5015c5e0efb312c873dd6cf302c` |
| E | `C:/Temp/ogh-e-verify-production-acceptance-20261012/final-read-only/E_VERIFY_ANONYMOUS_SAFE.json` | `e9cb7f993fa95a2003a20aff6f5cdbc173d70ce19b551a6ac0447bdbaee16293` |
| R | `C:/Temp/ogh-version151-final-assets-fast-track-20261011/fresh-attempt-v2/FINAL_STATIC_VERIFICATION_SAFE.json` | `80bab9f43694e78dbf6cd815a883db6f6a4c1f6ce2a45ce5716f037b8cdf8fa0` |
| I | `C:/Temp/ogh-e-verify-production-acceptance-20261012/stateful-owner-intake/STATEFUL_INTAKE_FINAL_LOCAL_SAFE_5436d939-4ab4-4cf2-b3cc-3f60108fb3f4.json` | `50a07b2ea7d4a1b550bc6f22439eed575cef41a8d278b6298b72f4af7e335b5e` |
| G | `Q/group1/artifacts/GROUP1_OFFLINE_TEST_CLOSURE_SAFE.json` | `b47e0c1368d36b0cd8571746257ceef0e65ee41e8554e9c6f8f3c080bb376691` |
| Z | `Q/zero-cost/artifacts/ZERO_COST_REBIND_SAFE.json` | `284fc28210762353d6c7c3a472b3f6ed5df7ca44fe33a0fc2a74c63051862055` |
| T | `Q/zero-cost/artifacts/ZERO_COST_POLICY_TEST_SAFE.json` | `a0549c54d998830c58a3a34dd61d56f670e64494d9e35e459f887463b640704c` |

Prior zero-cost binding `fae557d85f3b1c51e7e340705749d6e58aba030caaafc2e1676b397b4998b31c`
and packet `fd6d0460f8c461e7c8a69757b0b45b144281a9a2bb23813fef158556f71960a3`
are BLOCKED, with no allowed Production actions. The older GROUP_1 engineering
binding `e28193fe4a40f301550b92871598a5bcf69bc074e9d27d1d410aaaec96beb268`
and USD 2 packet/template are retained evidence, NOT valid execution authority.

## GROUP_1: Billing Evidence Closed, Approval Pending

Only three dependencies apply to the frozen GROUP_1 chain: Workers/Static Assets,
Supabase Auth/PostgREST and Turnstile. `group1/gate.mjs` restricts origins and
operations; `browser.mjs` blocks non-challenge image/media/font requests.
Profile/notification readers return proxy URLs without fetching media or signing
in this scope. No Astro.session use or content-moderation action is in these paths.
R2, Images, Brevo, OpenAI, Pages Builds and other providers are EXCLUDED for this
subset, not claimed free for the whole website or future mutation/media groups.

Official terms checked 2026-10-13 are provider policy evidence, NOT account evidence:

| Current account state: OWNER_ATTESTED, not an agent Dashboard read | Relevant official boundary |
| --- | --- |
| Cloudflare account `dcb374166b39234a499985145c075f50`, openglasshub: owner confirms Workers Free, applicable paid add-ons None. | Workers Free includes 100,000 daily requests; quota exhaustion rejects requests (1027, or 429 for Worker-first assets). Direct assets have no request/storage charge; Worker-first and caching remain subject to the actual Workers plan. This is NOT unlimited capacity or a Paid-plan invoice cap. [Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). |
| Supabase project `xcbnxzjlsvtgzixurcof`: owner confirms owning Organization Free, applicable paid add-ons None. | Supabase says Free usage is not charged; excess use can lead to service restrictions after notice/grace, not necessarily immediate hard rejection. This proof uses Free, NOT Pro Spend Cap, credits or a quota estimate. [Cost control](https://supabase.com/docs/guides/platform/cost-control), [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq). |
| Actual production Turnstile widget: owner confirms Free Widget. | Free includes all widget types and unlimited challenge/verification requests; Enterprise is separately contracted. [Plans](https://developers.cloudflare.com/turnstile/plans/). |

The project owner's current message closes ACCOUNT_PLAN_UNKNOWN. Do not ask for
the same plan checks, screenshots or Provider enumeration again. Account state is
OWNER_ATTESTED; public policy is PROVIDER_DOCUMENTED; unchanged 14-case request
scope is EXECUTION_PATH_VERIFIED_OFFLINE. Actual Production outcomes are UNKNOWN/
NOT_EXECUTED. Billing eligibility is 14/14, not a live PASS. New paid paths or known
plan/add-on changes must stop; quota exhaustion never permits upgrade or payment.

New independent preparation root:
`C:/Temp/ogh-e-verify-group1-free-plan-authorization-20261013/execution/group1/artifacts`.
Authorization ID: `e-verify-group1-openglasshub-20261013-free-plan-v2`.
Packet: `8bb232165198cd74a79f59758d2b318186bb6aefc63cf8d4360d0faedb31ccac`.
Execution binding: `bb9976a44d58f71a2f3a2f156a3394bb3b68a5032a4da7b893ddcac05e0489a3`.
Complete thirteen-condition template: `HUMAN_GROUP1_FREE_PLAN_AUTHORIZATION_NOT_AUTHORIZED.md`,
SHA256 `8aeb1672812981483ad80cde473dfce8a8f300725258de7cda88514460eabcf6`.
`OWNER_FREE_PLAN_EVIDENCE.json` binds the three evidence levels and exact scope.
`FREE_PLAN_REBIND_SAFE.json` records the new packet and preservation; the local
`FREE_PLAN_LOCAL_CHECK_SAFE.json` records 10/10 affected consistency checks.
1155 prior files have zero differences; 1175 files are now bound. The only runtime
change is exact proof admission in independent entry/child copies. Network,
identity, CAPTCHA, budgets, deadlines, Claims, transport and supervisor are unchanged.
123/123 and 9/9 tests were reused, NOT rerun. No credentials or private metadata
were copied into ordinary artifacts. Preparation created no Claim or GO; the
subsequent independently approved authorization is recorded below.

## Exact Subset Approval Boundary After Proof

Original E_VERIFY has two authorization boundaries. Independent GROUP_1 requires
explicit Boundary 2 subset approval; it is not already granted by engineering PASS.
Retain all 50 cases and partial AUTH-08/ADMIN-04/UI obligations. Five exact gates,
now OWNER_CONFIRMED in the independent approval (original templates remain null),
from `Q/group1/artifacts/HUMAN_GROUP1_SUBSET_AUTHORIZATION_NOT_AUTHORIZED.md`:

1. `subsetBoundary2AndResidualCasesAccepted`: limited subset, precise preference
   cookie exception, anonymous denial mapping and duplicate-read reuse; residuals stay open.
2. `authSecurityLogSideEffectsAccepted`: six authentication submissions, three
   logouts, at most six refreshes and retained Auth/security/session/rate-limit records.
3. `manualTurnstileAndPrivateIdentityReady`: owner-controlled A/B/ADMIN, isolated
   private browser credential entry and genuine manual Turnstile challenge.
4. `catalogHoldAndPostHardeningRecoveryAccepted`: continued hold and accessible
   recovery materials/permissions; no Version 151 default post-Hardening recovery.
5. `operatorAvailableForEntireValidity`: actual uninterrupted owner availability
   throughout the approved UTC validity and bounded stop handling.

Owner approval recorded 2026-10-13T03:48:51.752Z after explicit confirmation of
all five gates, thirteen conditions, subset addendum, frozen hashes and exact
2026-10-13T03:50:00Z to 2026-10-13T04:50:00Z UTC validity. Independent
`AUTHORIZED_GROUP1.json` in the new preparation artifacts has SHA256
`99e3b3a96568fe223ea18fbd22f34e25575d1d23f6ec19b120d8dabea74cfe7c`.
`GROUP1_OWNER_AUTHORIZATION_RECORD_SAFE.json` records schema/binding/window
consistency only, not a received GO or live OAuth validation. No Claim, OAuth read,
Production request or authorization consumption occurred. Original null templates
and protected input are unchanged. Approval is scheduled from its start; do not
execute before then, after expiry, or with insufficient remaining execution time.
Retain <=60-minute approval validity, 1800-second
execution / 1740-second work / 60-second cleanup reserve, OAuth >1860 seconds;
500 global admissions including two Deployment GETs, Auth 40, REST reads 80,
Turnstile 40, refresh 6, exact 16 Catalog reads, zero retry/reconnect/redirect.
This Auth subset has side effects; do not describe it as anonymous zero-write GET QA.
Billing proof cannot by itself authorize those side effects or an execution.

The obsolete USD 2/risk-acceptance clause is replaced ONLY in the new template's
condition 12. The old deny-all packet/module and all historical files stay intact;
never run the old entry under the new approval. New bound entry and child validate
the Free-only evidence before live capabilities can start. No blanket billing-risk
waiver or authorization is implied. Request scope and all noncost caps are unchanged.
The 16 Catalog Data API steps are six anon, five A and five B, not sixteen all-
authenticated reads; all required cross-role obligations remain. After complete
owner approval with actual UTC times, wait for separate `GO_E_VERIFY_GROUP1_V1`.

## Product Continuity and Next Action

Detailed feature/source findings live in the historical
[product snapshot](../product-beta-status-20261013.md), not another current baseline.
The local native-dialog fix has 66/66 browser assertions; report-dialog focus/Escape,
share-button hydration and faint-text contrast remain scoped local product issues.
Billing review does not block local Mock-backed product development. No complete
live feature/mobile/admin acceptance is inferred from local geometry or shells.

The older Pages `docs/production-readiness-gate.md` GO applies to its old source/
origin, not this Workers release. Preserve it as history; this baseline controls
the current NOT_AUTHORIZED Public Beta decision. Do not erase historical PASS/FAIL.

Independent `GO_E_VERIFY_GROUP1_V1` received. At current UTC 2026-10-13T03:52:08Z
the original window was open; the frozen entry was invoked exactly once and
returned exit 1 / OAUTH_COVERAGE_OR_SCOPE before Claim creation. Its preceding
authorization, bound files, Free proof and source HEAD checks passed. This combined
guard does not identify expiry versus scope mismatch; neither cause is invented.
`GROUP1_GO_OAUTH_PREFLIGHT_STOP_SAFE.json` beside the approved authorization
preserves the stop: no child/supervisor, no Claim, authorization unconsumed,
zero Production requests/writes, zero retries or automatic OAuth refreshes.
Owner manually restored default OAuth. Local-only precheck at
2026-10-13T03:56:53.430Z verified updated file, nonempty token, exact required
workers_scripts:write/account:read scopes, expiry 2026-10-13T04:56:00.304Z and
3546 seconds remaining (>1860). Authorization, bound files, source HEAD and
Free-only proof also passed; authorization had 3186 seconds left. Safe receipt:
`GROUP1_LOCAL_OAUTH_RECOVERY_PRECHECK_2026-10-13T03-56-53-431Z.json` in new artifacts.
This is local credential metadata, NOT remote authenticated principal validation;
actual remote identity remains UNKNOWN until a permitted Provider response.
The old replaced credentials' expiration/scopes were not recorded, so the prior
combined failure's specific cause remains UNKNOWN. No identity/whoami request was
added. The approved exact account/Worker target matches; future pre-Deployment
must validate access and production identity using only its original budget.
That local precheck did not invoke the entry or consume approval. A subsequent
fresh GO was received with UTC checked at 2026-10-13T03:59:39Z. The frozen entry
then passed prechecks, created the sole Claim and launched one supervised attempt.
Pre-Deployment verified the exact Production Version at 100%, Version151 at 0%,
Deployment e8481d68-d2d5-473b-8b0c-b82b8fa33fc3. At LOGIN_A, an unapproved
browser request was blocked; child result is BLOCKED / UNAPPROVED_REQUEST.
Global admissions=5 (includes one confirmed Deployment GET); exact completed
HTTP count and rejected URL/method are UNKNOWN because frozen receipts omit
per-request completion/denial identity. Do not invent the path or treat admissions
as successful requests. Auth dispatches=0, identities=0, Catalog RLS=0/16;
post-Deployment NOT_RUN. No mutation dispatch or Provider write was recorded.
Child exit=1, signal=null, timeout=false, elapsed=5125ms; browser cleanup PASS,
process reaped and Windows containment closed. Both frozen execution receipts
exist; `GROUP1_FINAL_ATTEMPT_CLOSURE_SAFE.json` adds a safe summary without
modifying them. Authorization is NOW CONSUMED; sole Claim remains permanently.
Current blocker: historical denied request identity was not recorded and cannot
be recovered from the retained child/supervisor safe receipts. Actual cause/path
remains UNKNOWN, not a guessed favicon/Turnstile/static URL. Source inspection
confirmed diagnostic context was lost from gate -> browser -> runner receipt.

Scoped local repair in `tools/e-verify-group1-login-diagnostics/`: bounded safe
predispatch classification and response-completion journal, propagated through
browser cleanup into final receipts. The original Gate, wire, Node guard,
supervisor and Windows Job broker remain byte-identical. No allowlist expansion,
business source change or alteration of old receipts/Claims/private input.
35/35 affected checks PASS, including six real Chrome local Mock cases using the
original AuthPanel/SDK, atomic admission limits, replay/redirect/cookie/hash
guards, diagnostic Auth/refresh denial and Windows deadline/process cleanup.
Old123/123, zero-cost9/9 and all prior production evidence were reused, not rerun.

New independently frozen diagnostic subset (NOT a full GROUP_1 retry):
`tools/e-verify-group1-login-diagnostics/execution/group1/artifacts/`.
Authorization ID: `e-verify-group1-openglasshub-20261013-login-diagnostic-v3`.
Execution binding SHA256: `f9936ffecafd99c89e8be9cbb4d4741e27f1b3f66ea55f2031d2843c4fa123f6`.
Packet SHA256: `ab3e3346eebb93e0a7043f46aa5e90c1b17f59fa37c3fdf19116818b447b4ba7`.
Template SHA256: `b2cc1efc673811f9ed1062176e7269c37e96cb4453ef848bfa2546903ce7bd05`.
1208 files bound; all1175 prior frozen files and consumed Claim verified unchanged.
New UTC times/five humanGates are null; no approved file, GO or Production Claim.

Only a new independently approved diagnostic may load the exact login URL and
original manifest-bound assets/Turnstile GETs: browser max8, Deployment max2,
global max10; no credentials, manual CAPTCHA, Auth, REST, refresh or mutation.
Hard300/work240/cleanup60 seconds; max10-second post-DOM observation; OAuth>360.
First failure stops without post-Deployment; clean completion alone permits it.
Unknown path/host/query details are safely redacted; no raw private identifiers,
headers, bodies or challenge values. Transport attempts are not socket-write proof.
It is a smaller new Boundary2 diagnostic addendum; owner must explicitly approve
its differences and exact UTC validity, then separately issue
`GO_E_VERIFY_GROUP1_LOGIN_A_DIAGNOSTIC_V1`. A clean diagnostic is NOT login/RLS PASS.
Next single action: approve that exact minimum diagnostic scope and a real UTC
validity; never reuse the consumed free-plan-v2 authorization or original window.
Billing eligibility is closed; live execution and RLS are still unverified.
GROUP_2/3 remain open and require separate scope/control/zero-cost resolution.
This update made zero Production requests/writes and reran zero release/QA tests.
Future updates must record only new completed work, genuine issues, the current
blocker, minimal next action and owner actions here; never create a competing baseline.

### LOGIN_A diagnostic v3 production result (2026-10-13)

Supersedes the pending-approval status above for diagnostic v3 only. Owner approved
all five gates and UTC 04:32:01Z-04:47:01Z, then separately issued
`GO_E_VERIFY_GROUP1_LOGIN_A_DIAGNOSTIC_V1`. The exact frozen entry ran once;
authorization is CONSUMED and `GROUP1_ONCE.claim` remains permanently retained.
No reuse or automatic retry is permitted.

Result BLOCKED / DIAGNOSTIC_ROUTE_FORBIDDEN at LOGIN_A. First rejection:
actor A, BROWSER_RESOURCE, application host openglasshub.ogh.workers.dev,
GET, script, UNAPPROVED_ROUTE, NO_BOUND_RULE, no query or observed redirect/retry.
Its path was redacted as `/:unbound`; the precise file name and the original
free-plan-v2 failure URL remain UNKNOWN. The rejected request did not reach the
controlled transport. Do not invent its identity or expand the allowlist.

Pre-Deployment PASS: e8481d68-d2d5-473b-8b0c-b82b8fa33fc3, released Version
b2b62ec9-bb8d-4159-ac99-08fca5740134 at100%, Version151 at0%.
Provider GETs=1; browser controlled transport attempts=4, completed responses=1
(login document HTTP200); three in-flight responses did not complete successfully.
Global admissions=5, not a completed-HTTP count. Exact socket dispatch count is
not proven by these counters. Post-Deployment NOT_RUN under first-failure stop.
Auth dispatches=0, authenticated RLS=0/16, writes=0, retries=0.
Child exit1, signal null, timeout false, supervisor elapsed1930ms; browser cleanup
PASS, process reaped and Windows containment closed. Catalog remains held.

New immutable safe receipts in the diagnostic artifacts directory:
`GROUP1_EXECUTION_SAFE.json` SHA256
4a3e0a03923fba0b79cd72a8a4b8e02b76f75151394d062783b0fc5ee37b9774;
`GROUP1_SUPERVISOR_SAFE.json` SHA256
ed492b3e44c1c56ba6b6fbaac10f043dfcf2e85326f2c96c70bd8a90f7822041.
No engineering tests were rerun and no in-flight repair was attempted.

Current single blocker: login initialization requested application scripts absent
from the exact diagnostic route bindings; precise denied names were not retained.
Next minimum action is an offline comparison of released login script references
against frozen script bindings. Any additional exact dependency or diagnostic
capture rule requires a separately frozen change and fresh approval before any
new production attempt. This diagnostic is not login, RLS or full E_VERIFY PASS;
GROUP_2/3 and Public Beta GO remain NOT_AUTHORIZED.

### LOGIN_A exact script binding closure (offline, 2026-10-13)

The retained diagnostic's normalizedRoute is `/:unbound`, not `/`. It is an
explicit privacy marker. Code has no root-path rewrite: a real `/` would be
FROZEN_PAGE_GET, not NO_BOUND_RULE. Historical rejected filename is still UNKNOWN;
the old receipt has no pathname or comparable fingerprint to recover it.

Existing A_DEPLOY Build d98da799-d41d-41dc-acaf-8c6675fd799a receipt links source
88680a6eaab8de4123199f16b325ec0a430b0b86 and Production Version
b2b62ec9-bb8d-4159-ac99-08fca5740134. The same-source local candidate build and
frozen manifest verify all67 JS/CSS assets and207 literal dependency edges,
zero missing local bindings/imports and no nonliteral module imports. These
source/build links do NOT prove cloud-build chunk byte equality; that is UNKNOWN.
No exact additional resource can safely be whitelisted from current evidence.

New independent QA copy `tools/e-verify-group1-script-binding/` adds only safe
stable application LOGIN_A GET/script pathname fingerprints and evidence labels,
plus an exact offline finite manifest correlation tool. Hash excludes host/query/
credentials/headers/body; unknown raw paths remain redacted. Gate, browser,
transport, supervisor, static manifest/bytes and owner budgets unchanged.
17/17 new affected tests PASS, including three real Chrome loopback scenarios:
existing compiled AuthPanel/renderer/SDK Astro island hydration and dependencies
without Auth dispatch; denied script fingerprint without wire dispatch; max8
diagnostic admission stop. Constructed island HTML is not Production HTML evidence.
Old123/35/9/43 tests, completed release stages and private intake were not rerun.

Full GROUP_1 retry remains BLOCKED. Minimal missing evidence is the rejected
script's exact pathname fingerprint or a trusted deployed script manifest.
Only a new minimal diagnostic packet is ready for independent owner approval:
ID e-verify-group1-openglasshub-20261013-script-fingerprint-diagnostic-v4;
binding98604720441aa0665e1c6b06e9d80c22c4f8ac6e8099e685bd6359f18bd60c39;
packet c11214d9c398826d46b3891ff49b02a6280e9f58c876fe9e73ed51c1f7f5e7a2;
template1e8fdb3b215feff8570d45847e5eaaced3f3baae76d03f91825e957d8011d3e8.
Same8 browser/2 Deployment/10 global, hard300/work240/cleanup60, USD0, no Auth/
RLS/Supabase wire or mutations. UTC and all five human gates remain null;
no valid authorization, GO or new Claim. Separate required GO is
`GO_E_VERIFY_GROUP1_SCRIPT_FINGERPRINT_DIAGNOSTIC_V1` only after new approval.
Next single action: owner decides on this precise fingerprint-only diagnostic;
do not retry full GROUP_1 or invent a chunk name. Production requests/writes0.
Catalog hold ACTIVE; old consumed authorizations/Claims and historical receipts
remain unchanged. No business code, RLS, database, runtime or deployment change.

### Unknown cloud-build script identity closure (offline, 2026-10-13)

Supersedes the v4 fingerprint-only diagnostic recommendation above. That pending
v4 packet was never approved or executed; the original v3 Claim remains consumed.
Stable hashes alone cannot identify a script outside the local manifest dictionary.
New independent `tools/e-verify-group1-script-identity/` resolves this within the
reviewed public-build-path boundary, without widening any network allowlist.

New journal outcomes: MANIFEST_MATCH; PUBLIC_REFERENCE_UNMATCHED; PRIVACY_BLOCKED.
Exact same-origin public pathname may be retained only for A LOGIN_A GET/script,
a finite reviewed local filename stem plus eight-character build hash, and an
explicit reference in validated anonymous login HTML or a byte-verified bound
script import. Script src/modulepreload/Astro island attributes/literal imports
are parsed locally before browser delivery; references bounded256. Query/fragment
values, URL credentials, headers/body/cookies/sessions and private identifiers
are excluded. Stable pathname fingerprint remains for finite local correlation.

Changed cloud hash absent from all67 local resources can therefore be identified
without requesting that unknown script. Unfamiliar/private/encoded/unreferenced
paths remain explicitly PRIVACY_BLOCKED with no raw pathname; no general identity
guarantee, legitimacy assertion or content verification is made for those paths.
The gate still rejects every unbound request before transport dispatch. Public
reference evidence alone cannot authorize any new request.

15/15 new affected tests PASS, five real Chrome loopback scenarios. They exercise
unknown build names, dynamic import, modulepreload, sensitive-path suppression,
failed static-byte proof, Runner final JSON propagation, new GO and consumed/expired
authorization refusal. Original17/35/123/9/43 tests were not rerun. Existing67/207
local build evidence reused; deployed chunk-byte equality and historical rejected
script remain UNKNOWN. Private binding and every historical receipt/hash preserved.

Only new minimal diagnostic is ready for separate owner approval:
ID e-verify-group1-openglasshub-20261013-safe-script-identity-diagnostic-v5;
binding86277764550654fd96d4102e7b4bf17d752e8bd04e267bd5a2397df2850d410f;
packet0e562e8bc9bf16036db9c028f8c11e0c096c1fb726468fe31a9300e99d50cc11;
template51c83030e8c59e57d901ca9d6c49b317d778d1d457a1967a140cd596ba75768c.
Contract: conditional exact public pathname disclosure only, unchanged8/2/10 GETs,
hard300/work240/cleanup60, USD0, no Auth/RLS/writes. All five gates and UTC null;
no valid production authorization, new Claim or GO. Required independent GO after
complete new approval: GO_E_VERIFY_GROUP1_SAFE_SCRIPT_IDENTITY_DIAGNOSTIC_V1.

Next single action is owner approval of this exact revised evidence disclosure
and real UTC validity. After independently authorized execution: A) safe script
identity -> offline source/purpose review, exact binding fix and affected tests,
then new full GROUP_1 approval only if proven legitimate; B) unauthorized script
-> remain blocked and report source; C) privacy-blocked identity -> remain blocked,
request exact missing trusted manifest/protected owner review, no identical probe.
Full GROUP_1 and E_VERIFY remain incomplete. Catalog held, Public Beta not approved.
Production requests/writes0; no deploy, push, business code, RLS or billing change.

### v5 safe script identity production diagnostic (2026-10-13)

Supersedes pending v5 approval above. Owner confirmed all five gates and approved
UTC05:48:12Z-06:03:12Z, then separately issued the exact v5 GO. Frozen entry
invoked once after UTC05:54:18Z; prechecks passed and permanent Claim created.
Authorization v5 is now CONSUMED, never reusable. No second attempt or repair ran.

Diagnostic BLOCKED at LOGIN_A / DIAGNOSTIC_ROUTE_FORBIDDEN. Precise safe identity
captured from VALIDATED_LOGIN_HTML, PUBLIC_REFERENCE_UNMATCHED:
`/_astro/SiteHeader.astro_astro_type_script_index_0_lang.CtUXEG6g.js`.
It is application-origin GET/script, NO_BOUND_RULE / UNAPPROVED_ROUTE, no query,
no observed redirect/retry, denied before controlled transport dispatch. Frozen
local corresponding stem is `SiteHeader.astro_astro_type_script_index_0_lang.DaQNT1ww.js`
(1168 bytes, SHA2564550699f9e06afc37000e20f4dbd2c9223f0786afd03769713785325d047c0ca).
The exact path mismatch is proven; new script contents/bytes, full build equality,
legitimacy and historical v2/v3 failure identity are NOT proven by this reference.

Pre-Deployment PASS: e8481d68-d2d5-473b-8b0c-b82b8fa33fc3, expectedProduction
b2b62ec9-bb8d-4159-ac99-08fca5740134 at100%, Version1510%. Post-Deployment NOT_RUN.
Global admissions5 includes confirmed ProviderGET1; browser transport attempts4,
completed browser responses1 (login HTTP200); three in-flight responses failed
or were aborted. Exact socket-dispatch count is UNKNOWN, not admissions-as-GETs.
Auth0, RLS0/16, mutations/Provider writes0, retries0. Child exit1/signalnull,
timeoutfalse, supervisor elapsed2148ms, browser cleanup PASS, process reaped and
Windows containment closed. No credential input, CAPTCHA solve or live patch.

New v5 artifacts `GROUP1_EXECUTION_SAFE.json` SHA256
cffacd0b0708b8d4b5b1c24cc506fb284eb31157dd664683cdd94b2d0eefcdff;
`GROUP1_SUPERVISOR_SAFE.json` SHA256
0fdabb4b587d445b119c518ef5a47536750b4401cf655777546dceace4bd3c1e.
Current single action: offline correlate this exact public script with trusted
released Build artifacts/source and purpose, then exact QA manifest/byte binding
repair plus affected tests and fresh full GROUP_1 approval only if proven safe.
No further initialization-only probe is needed merely to learn this filename.
Catalog held; E_VERIFY incomplete; GROUP_2/3 and Public Beta not authorized.

### Production asset binding repair evidence gap (offline, 2026-10-13)

Production source commit88680a6eaab8de4123199f16b325ec0a430b0b86 is supported by
the retained exact Build/source/version receipts. Source configs and lockfile are
unchanged at that commit. Cloud Build environment/install-result equality remains
UNKNOWN, not inferred from source equality. Candidate offline build has DaQNT1ww;
newer unpushed product checkout has B7dE5HsA and cannot replace Production evidence.
No CtUXEG6g bytes or full Production login HTML were saved in the v5 receipts.
CtUXEG6g's actual content, asset-manifest equality, graph and safe compiled purpose
remain BLOCKED. Underlying hash/build-input cause UNKNOWN. No QA alias or allowlist
change is justified. Header source imports SettingsPage for settings-navigation
confirmation and registers UI listeners, not proof of unknown compiled bytes.

`tools/e-verify-group1-asset-provenance/` provides a scoped offline analysis and
explicit evidence-read proposal, not a ready executable Production entry. Proposed
read: pre-Deployment, exact anonymous login HTML, at most67 unique JS/CSS references
including the already identified exact CtUXEG6g path, post-Deployment: max70 GETs.
Dependency paths are resolved only from current HTML/parent literal imports into
the original finite stems/types/multiplicity. No /_astro/* wildcard, blind67 old
paths, query/private route, third-party fetch, JS execution, Auth/RLS/write, retry
or redirects. New70-request scope needs independent owner approval; original
owner500 ceiling unchanged and old10-request Claims never reused. Hard300/work240/
cleanup60 and exact reader/private capture must be frozen before any later GO.

11/11 new offline read-plan tests PASS: exact path selection, old-alias exclusion,
finite imports, multiplicity, privacy/origin/query/method controls, replay, bad
responses and actual-hash-vs-provenance distinction. These are not full GROUP_1 or
Production executor tests. Original15/17/35/123/9/43 evidence reused, not rerun.

Read-scope proposal ID e-verify-group1-openglasshub-20261013-production-assets-proof-v6;
offline-only plan binding2eab397cc8ca17591d6cf0aa52ef839a585b5ad452421582bfb5e9c24462bb17;
packet95fddd76f69291362eab8e6b9d1401ed4ece14dae87d89c317731eca6f7060db;
template3833264610706c01cca84076d6be5e8ef43bd7f22cd74df62c9665f00897a8ef.
These hashes do not bind an executable reader or grant Production permission.
No effective authorization/UTC/true human gates/Claim/GO created. Full GROUP_1
reauthorization BLOCKED; its500-request sufficiency remains UNKNOWN until the
actual dependency graph is verified/countable. Missing evidence is actual compiled
payloads plus their current page/import graph, not the already identified filename.
Next single action: owner review/approve the bounded content-proof scope (or provide
trusted same-Build offline assets); bind exact reader before a separately approved GO.
Production requests/writes0, USD0, Catalog held, GROUP_2/3 and Public Beta not approved.

### Runnable Production Asset Evidence Reader (offline, 2026-10-13)

`tools/e-verify-group1-asset-reader/` is now executable and frozen, but NOT AUTHORIZED.
Only the final `artifacts/HUMAN_PRODUCTION_ASSET_READ_AUTHORIZATION_NOT_AUTHORIZED.md`
is the pending current contract. Its new ID is
`e-verify-group1-openglasshub-20261013-production-asset-reader-v7`.
The v6 offline proposal and in-turn superseded review candidate have no execution
authority. Historical v3/v5 consumed Claims and receipts were verified unchanged.

31/31 new affected tests PASS: real bounded loopback HTTP, required changed-hash
script first, literal dependency/CSS imports, forbidden or ambiguous references,
size/header/request/category/concurrent byte admission, failed reads/timeouts,
failure cancellation, exact runtime/fixed target, synthetic OAuth expiry/scopes,
authorization expiry/schema/GO/Claim replay, genuine Windows DPAPI private capture
and hash-checked recovery, and Job Object contained child success/missing receipt/
hard stop/cleanup. Original 11/15/17/35/123/9/43 evidence was NOT rerun.

Pre/post exact Deployment and retained Build/source link guard the expected b2b62ec9
version at100%, Recovery1510%. Deployment JSON does not expose a source SHA; no fake
field or current Provider observation was added. Current login HTML must reference
the exact CtUXEG6g script before its GET. Subsequent reads require actually parsed
HTML/parent literal references and original finite stem/type/multiplicity rules,
never blind67 resources or /_astro/* admission. JS/CSS are not executed.
Max70 GETs, static concurrency4, hard300/work240/cleanup60, request15 seconds,
headers8192, body2MiB, aggregate anonymous accepted/reserved body16MiB; API bodies
separately max128KiB each. Physical wire tail and billing are NOT falsely guaranteed
by body limits. Existing USD0 Workers Free evidence is reused, no billing/OAuth read.

Necessary raw HTML/script evidence uses owner-only Windows DPAPI storage outside Git.
Safe receipts retain byte/SHA256, parent graph, exact public path, timestamps and
first safe error only. Preflight occurs before the new Claim. First failure stops
new requests and cancels/drains in-flight operations; no extra postcheck on failure,
retry or automatic full GROUP_1 continuation. Missing child evidence stays UNKNOWN.

Execution binding SHA256:
`e1b9adcb80afee170b3d2aa4850bd7019c9d95e05c56393a63aec16c295d693d`.
Packet SHA256:
`24b1cb56bff0d76c8fe97fd7a45dde3fb20eb54887bf01d23e8dd1436866d990`.
Pending template SHA256:
`a4433acc52cd311b295c7ec061065d097e19a28ceb9ac7dd908d175f7009254c`.
1444 exact bound files verified, original SQL/business/source/historical files unchanged.
Original pending template retains five null gates and null UTC fields unchanged.
Owner explicitly confirmed all five gates and approved the exact UTC validity
2026-10-13T07:06:26Z through 2026-10-13T08:06:26Z. Separate
`artifacts/AUTHORIZED_ASSET_READ.json` recorded and validated at
2026-10-13T07:15:19.955Z, SHA256
`0659a1df64a4a22f3df5ef7ca2973275bba84577e83a1154e6c28b660d6e4864`.
`AUTHORIZATION_RECORD_SAFE.json` records explicit owner approval, not an execution GO.
Binding/Packet/template unchanged;1444 bound files verified without rerunning tests.
At authorization recording: unconsumed, no Claim, GO, OAuth read or Production request/write.

The owner subsequently issued exact `GO_E_VERIFY_GROUP1_PRODUCTION_ASSET_PROOF_V1`.
At trusted UTC2026-10-13T07:26:11Z the approved four hashes matched and no Claim existed.
The frozen bound Node entry was invoked exactly once and stopped locally at
`OAUTH_COVERAGE` (exit1) before Claim or supervisor startup. Default OAuth was read
privately; it was not printed, refreshed or retried. Its expiration check did not
meet the parseable and strictly>360-second coverage requirement; precise expiration
subtype/value was not retained and is not guessed. Deployment/HTML/assets GETs0,
total Production requests0, writes0, retries0, Claimfalse, authorization unconsumed.
Original failure receipt `artifacts/ASSET_READ_LOCAL_FAILURE_SAFE.json` retained;
independent `ASSET_READ_GO_CLOSURE_SAFE.json` records the final zero-request stop.

Owner requested local-only OAuth recovery diagnosis. At2026-10-13T07:35:20.574Z,
the exact frozen-entry default file exists, token present, scopes
workers_scripts:write/account:read PASS, expiration parseable but expired at
2026-10-13T06:53:54.543Z (-2487 seconds at observation). Its mtime is
2026-10-13T05:53:55.547Z. Historical check order proves scope absence was not the
v7 blocker; no historical credential snapshot was retained, so unchanged secret
identity/previous exact metadata is not invented. No remote identity was queried.
Installed Wrangler4.106.0 source confirms login --scopes accepts these exact names,
updates default global auth, and its local default path matches the entry here
(no legacy ~/.wrangler directory, XDG or staging override). Command shown to owner;
no login/logout/refresh executed by Codex. Safe local diagnosis retained separately
as `artifacts/OAUTH_LOCAL_DIAGNOSIS_SAFE_20261013T073520Z.json`.

At the pre-recovery stop: wait for owner `OAUTH_LOGIN_COMPLETED`, then recheck exact
remaining lifetime/scopes locally and prepare the fresh independent instance only
if coverage passes. No new ID/Packet/window/Claim/GO has been generated. The failed
v7 instance cannot be reinvoked: its frozen contract and existing failure receipt
prohibit replay even though no Claim was created. No automatic retry/new approval.
Real content/provenance, full GROUP_1 budget sufficiency, Auth and
16 RLS results remain BLOCKED/UNKNOWN until their separately authorized evidence.
Collection success is not GROUP_1/E_VERIFY PASS. Catalog held; GROUP_2/3 and Public
Beta not authorized. Local product commit9161ca71 and continuity1e027888 preserved,
not merged into or claimed as deployed Production code.

### Fresh v8 After Owner Manual OAuth Recovery (offline, 2026-10-13)

Owner replied `OAUTH_LOGIN_COMPLETED`. The exact frozen local checker PASS at
2026-10-13T07:42:50.556Z: required scopes account:read/workers_scripts:write present,
expiration2026-10-13T08:41:40.553Z, remaining3529 seconds; default file updated at
2026-10-13T07:41:41.556Z. Remote account identity NOT_VERIFIED; no Provider request.
Later preparation check PASS at2026-10-13T07:49:57.920Z, remaining3102 seconds.
OAuth observations are point-in-time, not a future validity guarantee. No automatic
login/logout/refresh, no secret/fingerprint output or private identity changes.

`tools/e-verify-group1-asset-reader-fresh-v8/` contains the new independent instance.
Runtime copies differ only by the unique authorization ID and exact new GO constant;
file/receipt/private-capture paths derive from the separate instance and ID. Same
source/Version/Deployment,70 GET cap, finite conditional references,2MiB/16MiB body
bounds, max4 concurrency,300 hard/240 work/60 cleanup, zero retry/redirect/Auth/RLS/
writes and USD0. All thirteen contract conditions byte-identical to v7's conditions.
Original31/31 runtime evidence reused, not rerun. Only7/7 mechanical identity/GO/
budget/scope/null-gate/path/replay/frozen-history consistency checks executed.
No Production operation or current Free-plan re-audit. V7 stop receipts retained;
its unconsumed authorization does not make that failed instance reusable.

New pending authorization ID:
`e-verify-group1-openglasshub-20261013-production-asset-reader-fresh-v8`.
Execution binding SHA256:
`036172b39d01ad036a5b3c2ec060f1c1d7752bc18d73d669a8049b2030554497`.
Packet SHA256:
`41ae34c6e074e8deb6425b2bf1cfe40bd0f715ab8e5b8547cd81f592a7d84cb5`.
Pending full template SHA256:
`0fb49b853ba1fcea6d767ad7de6e513d7a80bc4935354daa0650c96c85746eab`.
Current contract: new instance's
`artifacts/HUMAN_PRODUCTION_ASSET_READ_AUTHORIZATION_NOT_AUTHORIZED.md`.

Owner explicitly confirmed all five fresh-v8 gates, full contract/bindings and
continuous supervision, then approved exact validity2026-10-13T07:59:51Z through
2026-10-13T08:29:51Z. Separate `artifacts/AUTHORIZED_ASSET_READ.json` recorded and
validated at2026-10-13T08:04:34.469Z, SHA256
`b418e8a09273a570f225d223c9f2051e4218e67dea6d0bf66c84052334d8403b`.
`AUTHORIZATION_RECORD_SAFE.json` records explicit owner approval and no GO received.
Original pending template retains five null gates and null UTC fields unchanged.
1469 bound files verified without rerunning tests; binding/Packet/template unchanged.
Authorization unconsumed, no Claim, execution, OAuth read or Production request/write
at authorization recording. V7 and its old approval/GO remain permanently non-reusable.

At authorization recording, next action was to wait for the owner's separate exact
`GO_E_VERIFY_GROUP1_PRODUCTION_ASSET_PROOF_FRESH_V8` within full time coverage.
Do not execute on approval alone. No independent GO has been issued.
OAuth must still be strictly>360 seconds at execution check and all dynamic gates
must pass. At that pre-execution snapshot, Ct bytes/full GROUP_1/Auth/RLS outcomes
were UNKNOWN/BLOCKED and requests/writes0. See the actual execution outcome below.

### Fresh v8 Real Asset Evidence Collection Completed (2026-10-13)

Owner issued exact `GO_E_VERIFY_GROUP1_PRODUCTION_ASSET_PROOF_FRESH_V8`. At trusted
UTC2026-10-13T08:10:11Z the approved binding/Packet/template/authorization hashes
matched; the bound frozen entry was invoked exactly once. Dynamic prechecks passed,
fresh Claim was created and this authorization is now CONSUMED, never reusable.
No automatic refresh, repair, second attempt or additional Production query ran.

Child CONTENT_EVIDENCE_COLLECTED, no first failure. Actual completed GETs26:
Deployment2, anonymous current login HTML1, referenced JS/CSS23. Literal dependency
graph closes over those23 observed paths; this is not all67 local files or complete
runtime/browser/third-party coverage. Anonymous accepted body bytes726384, inFlight0;
24 raw evidence files are DPAPI encrypted in the bound owner-only private directory.
Their ciphertext hashes and receipt count/byte totals were verified locally.
No raw HTML/code, OAuth, Cookie, Token or Session was printed or copied into Git.

Required actual script
`/_astro/SiteHeader.astro_astro_type_script_index_0_lang.CtUXEG6g.js`:
1168 bytes, SHA256
`d38ccb187c70064b9bec7e27993090ade0408ca524cccef2aec7312521240902`.
Its bytes do not match the old local frozen header. Byte observation alone is not
source/provenance or safe-purpose PASS. Source review/build-byte equality remains
PENDING_OFFLINE_REVIEW/UNKNOWN; the current GROUP_1 allowlist was NOT modified.

Both Deployment checks return e8481d68-d2d5-473b-8b0c-b82b8fa33fc3, Production
b2b62ec9-bb8d-4159-ac99-08fca5740134 at100%, Recovery1510%. Provider Set-Cookie
presence recorded after strict JSON validation; never saved or forwarded.
Read interval2026-10-13T08:10:49.490Z to08:10:55.978Z, work6489ms. Supervisor7456ms,
EXIT_ZERO, exit0/signalnull, timeoutfalse, receipt present, child reaped and native
Job containment drained/closed with no error. Cleanup PASS on normal exit.

Independent `artifacts/ASSET_READ_GO_CLOSURE_SAFE.json` records this outcome and
hashes the immutable child, supervisor and parent receipts. Auth submissions0,
RLS0/16, retries0, redirects0, Provider/Production writes0. No full GROUP_1 attempt,
GROUP_2/3 operation or Public Beta GO. All1469 frozen files still match after reads.

Current single action: private OFFLINE comparison of the23 acquired payloads and
literal reference graph to approved source/build evidence. Only proven safe
Production paths/bytes may enter a new exact GROUP_1 binding; any missing source
proof remains BLOCKED. Do not repeat script-name diagnostics or these consumed
asset reads. Full GROUP_1 still needs independent fresh approval for actual A/B/
ADMIN/CAPTCHA and16 RLS checks. Catalog held; GROUP_2/3 and Public Beta not authorized.

### Production Login Assets Reviewed And Precisely Bound (offline, 2026-10-13)

`tools/e-verify-group1-production-binding/` is the isolated QA repair. All24 DPAPI
payloads verify ciphertext/plaintext SHA and bytes; the child/supervisor/parent
receipt chain and all1469 frozen reader inputs verify. No old evidence was changed.
The prior release receipt supplies the Build/source/Version link; the Deployment
response itself does not supply a source SHA. Both captured deployments match.

Of23 captured JS/CSS,16 match frozen local artifact bytes. Seven match scoped AST
source review, retaining code operations/literals/calls/exports and known imports.
Only exact hash-pinned pairs permit the two reviewed import-order differences and
one lazy React initializer placement difference. This is not general equivalence.
CtUXEG6g is source-consistent with SiteHeader.astro's settings/menu/keyboard script;
its direct import is the reviewed Production SettingsPage chunk. Historical Cloud
build environment parity and the exact build-pipeline cause of hash differences
remain UNKNOWN. Do not call the different hashes a Production build failure.

The new finite23-resource policy binds Host/GET/path/type/version/stage/actor and
checks actual bytes/SHA before Chrome receives a script. OldDaQNT1ww and arbitrary
URLs stay blocked. Every HTML response additionally requires a reviewed body hash,
preventing unreviewed inline scripts. Owner budgets remain unchanged. The candidate
adapter is not a Production entry or effective authorization.

New targeted tests34/34 PASS, including real Chrome hydration of all23 acquired
resources on a synthetic local shell, unknown/old paths, query redaction, concurrent
pre-dispatch budget exhaustion, modified inline-code refusal and consumed-Claim
replay refusal. The raw Production HTML was NOT executed. All physical test traffic
used127.0.0.1 and the deny proxy forwarded zero requests. Existing123/43/31/9 suites
were not rerun. This turn Production requests/writes0; no OAuth or private QA account
input was read. Auth and16 RLS outcomes remain unexecuted.

Engineering-only binding SHA256:
`5f5a838041c71ba00c8f0f5debf85726666e42ce2294b0f6aad012e395e24477`.
Artifact: `artifacts/EXECUTION_BINDING_PRODUCTION_ASSETS_OFFLINE_BLOCKED.json`.
No new authorization ID/Packet, approved human gates, UTC, Claim or GO was created.

Current single blocker: the acquired graph covers login only. The products index
script/catalog-compare-dom and AdminDevicesDashboard/useAdminSession lie outside
it. Approved source explicitly requires these post-login roots; their actual
Production hashes/content are UNKNOWN. Local hashes cannot substitute. Full
GROUP_1 readiness remains BLOCKED and total-flow budget sufficiency UNKNOWN.

Next minimum evidence: reuse the same Build's existing complete client artifact
manifest/bytes, if retained, to cover only those unproven page roots and their
finite dependencies. Do not repeat the23 acquired resources or script-name probes.
If no such archive exists, any uncovered-resource reads require separate exact
authorization; none is generated or executed here. Full GROUP_1 approval waits
for this specific evidence, not another broad audit. Keep Catalog held, USD0,
GROUP_2/3 and Public Beta unapproved, and no Version151 default recovery after D.
