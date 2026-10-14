# Public Beta Current State

Authoritative release/progress baseline. Updated 2026-10-14 by offline inspection
of actual Git/source and existing safe receipts, not by replaying Production tests.
Read this first for every task. This document is not an authorization or GO.
`VERIFIED` is scoped historical evidence, not proof of unchanged live state now.
Missing/uncertain outcomes remain `UNKNOWN`; denied execution remains `BLOCKED`.

## Source and Release Identity

- Released source: `88680a6eaab8de4123199f16b325ec0a430b0b86`.
- Build ID: `d98da799-d41d-41dc-acaf-8c6675fd799a` (not the Worker Version ID).
- Last verified Production Version: `b2b62ec9-bb8d-4159-ac99-08fca5740134`,
  traffic 100%, recovery traffic 0%, from the consumed v11 pre-Deployment receipt.
  Current live state is UNKNOWN until an independently authorized dynamic check.
- Local product head: `9161ca71e6fcceef984c8129f156667d536c7a44`, parent is
  the released source. Its native destructive-confirmation fix is NOT deployed.
- Continuity branch: `codex/public-beta-release-continuity-20261013`, checkout
  `C:/Temp/ogh-product-beta-development-20261013`. No fetch, push or merge here.
  Local `origin/main` still names the released source; this is not a fresh remote check.
- Earlier authorization-preparation branch: `codex/group1-free-plan-approval-20261013`,
  based on continuity commit `1e027888`; no unrelated branch was merged.
- Current scoped preparation branch: `codex/group1-turnstile-policy-decision-20261014`,
  based on exact-boundary decision commit `b9ba2394`;
  preserves prior local product/continuity commits and authorization history.
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
| LOGIN_A and post-login static evidence | VERIFIED29 finite Production resources;9 v9 captures reviewed;25/25 new targeted tests PASS | Prior23 preserved, new6 reviewed, ProductDetail285-byte inline matched; no duplicate Production reads or runtime PASS implied |
| Remaining GROUP_1 / full-flow budget | Owner-approved global650 APPLIED in protected version; next full authorization BLOCKED | Original500 preserved, all class caps unchanged; v11 attempt CONSUMED; historical LOGIN_A rejected pathname UNKNOWN, no implicit retry |
| Current GROUP_1 browser identity | Signed installed Chrome156.0.8078.12 VERIFIED locally; v11 CONSUMED | v10 old hash not reusable; old2083-file v11 closure still unchanged; no new browser download/update or Production authorization |
| LOGIN_A other-request repair | VERIFIED local defect and15/15 targeted checks, not historical identity proof | Retained HTML icons reported other; exact declared icon requests excluded without transport. Unknown other denied; next full authorization BLOCKED.3GET draft fails diagnostic-effectiveness review; no new executable Packet |
| LOGIN_A real initialization | PARTIAL;1 new real-Chrome boundary case PASS with NO inert Turnstile Mock or injected unknown |5 islands hydrate,24 retained application responses,3 icons cancelled; genuine Turnstile bootstrap observed/aborted. API/render/challenge/post-token requests UNOBSERVED; full authorization BLOCKED |
| Bounded Turnstile policy decision | FEASIBLE DESIGN, OWNER_APPROVAL_PENDING | Official dynamic-resource/test-key guidance reviewed; proposed per-widget supplier capability40/650 is NOT a URL whitelist or executed control. Isolated official-test-sitekey engineering next, with separate online authorization afterward |
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

### Consolidated Remaining Graph And Budget Preparation (offline, 2026-10-13)

Branch `codex/group1-consolidated-dependencies-20261013` preserves local commit
06ab7797, product9161ca71, previous baselines, all protected inputs and old receipts.
No Production request, OAuth read, private identity output or data/config change.

Searched the task/release evidence directories and two relevant source-identical
worktrees, plus the bound private capture inventory. No verified exact Production
client archive covers the missing roots. The available dist artifacts are local
builds, not proof of Production bytes. Existing24 protected captures remain login
HTML+23 reviewed resources; no duplicate asset reads or builds were performed.

Frozen source graph identifies six missing candidates: products index script,
catalog-compare-dom, products index CSS, AdminDevicesDashboard, useAdminSession
and GlassConfirmDialog. The latter is an existing dependency, not a reimplementation
of the local shared-confirmation fix. A seventh conditional slot comes from the
compiled285-byte ProductDetail inline script: only if actual detail HTML references
an external resource of that exact finite stem. No guessed URLs or whole-site grant.

`tools/e-verify-group1-remaining-assets/` implements the single consolidated reader.
Three fixed HTML GETs: /products/, /products/xreal/xreal-air/, /admin/devices/.
Reuse23 verified protected resources without GET; only explicit page/module parent
edges may admit up to7 missing JS/CSS. Two exact Deployment GETs guard same b2b
Version/Deployment100% and Recovery1510%. Max12 requests, below the previous70;
HTML category changes1->3 and requires explicit new owner approval. Asset category
67->7, max4 concurrent; original2MiB/object,16MiB aggregate,8192 header,15s read,
300/240/60 hard/work/cleanup remain. No Auth/direct RLS/browser execution/writes.

Public products HTML invokes existing anonymous SSR Catalog reads/pagination;
this is not zero internal database reads or authenticated RLS acceptance. Images,
fonts and third-party references are never downloaded. Normal access/security
records may persist. Free-plan evidence and strictUSD0 are reused, not re-audited.

New33/33 tests PASS: actual loopback HTTP, reuse23 graph, unknown edges and hosts,
redirects, request/stream/byte limits, timeouts/deadlines, protected-capture failure,
HTML source markers, full JS parse/fallback refusal, HTML base rejection and
case-insensitive HTML/CSS references, exact Provider schema/traffic, atomic global/
refresh budgets, local-fixture replay and actual entry refusal before GO. Existing
34/123/43/31/9 suites were not rerun. Old1972-file evidence binding remains valid.

Owner budget read value-blind from the protected work copy matches the frozen
USD0 packet: global500, Auth40, REST80, Turnstile40, refresh6; no caps changed.
Original14 mappings and16 RLS reads are preserved in the explicit case matrix.
There are51 fixed non-static success-plan dispatches, up to21 navigation epochs
including optional logout reload, dynamic CAPTCHA and bounded background reads.
The non-tight conservative full-flow bound921 exceeds500; it is NOT a proven
minimum or an automatic421-request increase. Whole-flow sufficiency UNKNOWN.
Managed challenge requests and six manual waits likewise do not imply completion
within40 CAPTCHA requests/work1740 seconds. Pre-dispatch caps still stop safely.
Full Chrome GROUP_1 success/production Auth/RLS remain BLOCKED/NOT_EXECUTED;
evidence-reader tests do not substitute for full-flow simulation or live acceptance.

New pending ID: `e-verify-group1-openglasshub-20261013-remaining-assets-v9`.
Binding: `29bb114ac2fc74d8509d2178658c5ad8afe50a420ff15d9a13c133c7b4e104bd`.
Packet: `59b84fcafd3eba9250d2239a2cff9a9b777e79931df971eba532b865a2191eeb`.
Template: `31f43d50267eefd23911ae832e7df4fbbfb02d6040b4e9d4ed8a23fe8802c6e8`.
Contract: `tools/e-verify-group1-remaining-assets/artifacts/HUMAN_CONSOLIDATED_ASSET_READ_NOT_AUTHORIZED.md`.
All five human gates/times null; no effective authorization, Claim or GO. OAuth
scopes/lifetime will be checked only after separately approved GO; not read now.

Next single action: owner approves this one evidence-only contract's five gates
and actual UTC validity, then separately issues its exact independent GO. After
collection, review all remaining bytes/source/inline references together, repair
the finite full GROUP_1 binding and close its real Chrome Mock/budget trace in one
step. Do not repeat login23/name probes, reuse consumed approvals or auto-increase
budgets. Catalog held; GROUP_2/3/Public Beta unapproved; no post-D Version151 default.

### v9 Production Evidence And Full-flow Offline Closure (2026-10-14)

Local branch `codex/group1-v9-offline-closure-20261013` preserves d81fe228,
06ab7797, product9161ca71 and the earlier continuity commits. Production business
code, private input and all historical authorizations/Claims/receipts are unchanged.

Consumed v9 collected11 GETs:3 HTML,6 new JS/CSS,2 matching Deployment checks,
reusing23 protected assets without GET. Source/link identity remains88680a6e/b2b
at100%, Deployment e8481d68; Build/source comes from the prior frozen release
receipt, not a Deployment API SHA. Cleanup was confirmed. Never replay v9.

`tools/e-verify-group1-v9-closure/` verifies all9 new DPAPI ciphertext/plaintext
captures, frozen2005-file inputs and previous23 review. Four new assets exactly
match source-frozen bytes; AdminDevicesDashboard matches the scoped AST; the
GlassConfirmDialog difference is an exact hash-pinned sibling import order review,
not a general equivalence exception. The ProductDetail285-byte inline script is
exact; no external seventh resource was referenced. All29 literal dependencies
close; runtime branches/Production Auth/RLS outcomes remain NOT_VERIFIED.

New independent QA adapter/gate copies fix source-backed own GET duplication,
refresh generations, and preference adoption timing without changing frozen
originals. Only the three exact approved own GETs are merged within a navigation
and same private Session; every browser attempt still consumes global admission.
Navigation/accepted Session change clears cached responses; Cookie/header/actor
checks remain. Same-generation GETs and all Mutation replays remain refused.
Refresh invalidates identity verification. HTML permits only validated serialized
locale generation/provenance/source changes; code/resources/other props remain
structurally pinned. Unknown paths/actors/stages/resources still fail before wire.

25/25 targeted tests PASS. Actual scoped Chrome/Astro/React/SDK uses only synthetic
accounts and loopback HTTP, with deny proxy forwarded0 and Node egress locked.
Native Job hard deadline genuinely launches/drains Chrome. Wrong UUID/role,
Session leakage, concurrent caps, replay/expiry, redirect/Cookie, changed script
and modified inline code are tested. Old123/43/33/9 suites were not rerun. Mock
success is never live Auth/CAPTCHA/RLS acceptance.

Under the unchanged owner500 cap, latest frozen mock admitted500 and dispatched
491 (including1 synthetic Deployment). It verified3 identities/16 RLS mocks and
2 negative Auth mocks, then blocked the last NEGATIVE_PASSWORD resource before
wire; no post-Deployment, cleanup PASS. Therefore500 is insufficient for this
measured scenario, not merely because the old921 conservative bound exceeds it.

An explicit loopback-only counterfactual fixture cap800 (not an owner or Production
budget) completed3 identities,16 RLS,3 negative Auth and2 synthetic Deployments:
511 global admissions versus499 actual dispatches,3 refreshes and12 challenge
fixture requests. Its exact scenario difference is11 admissions. Earlier
development runs varied (up to523 observed); scheduling/manual Managed Turnstile/
refresh/background/logout behavior remain UNKNOWN in Production. Neither511 nor
523 is a proven minimum, recommended universal cap or completion guarantee.
Saved private budget remains500, USD0, Auth40, REST80, Turnstile40, refresh6.

Engineering-only binding:
`904dead9b3043e23e382a83feb2411bca1fa3cc32511639ed19ee40076f489f7`.
`artifacts/BUDGET_CLOSURE_SAFE.json` and both exact Chrome traces record the gap.
No new Production authorization ID/Packet/window/Claim/GO was minted. OAuth was
not read again because the owner budget gate is still blocked; the future full
contract requires account:read/workers_scripts:write and remaining strictly>1860s
before a new1800-second execution/window approval.

Current single blocker/action: obtain the owner's explicit global-admission budget
decision (or explicitly scoped flow amendment) using these measured scenarios,
then mechanically freeze the actual full GROUP_1 entry/contract with14 mappings,
16 RLS reads, Boundary2 residuals and fresh human/UTC/GO approval. Do not repeat
asset reads, billing audit, intake or passed release/anonymous suites. An approved
changed cap remains a hard stop, never a promise of Production completion.
This offline task Production requests/writes0. Catalog held, GROUP_2/3/Public Beta
unapproved; Version151 remains PRE-HARDENING-only recovery evidence.

### Global Admission Candidate650 Evaluated (offline, 2026-10-14)

Branch `codex/group1-budget650-candidate-20261014` preserves607ae175, original v9
evidence and local product commits. `tools/e-verify-group1-budget650/` adds only
candidate budget tests and a pending single-field amendment. Existing executors,
private500 input, source/Production and frozen receipts are unchanged.

New8/8 tests PASS, without repeating25/123/43 or asset reads. The actual isolated
Chrome/SDK full-flow fixture at candidate650 completed3 synthetic identities,
16 exact RLS mocks,3 negative Auth cases and2 synthetic Deployments; cleanup and
native Job drain PASS, alternate proxy forwarding0. It used507 global admissions
and499 physical dispatches (387 static+18 pages+15 Auth+19 REST+46 own/admin reads
+12 challenge fixture+2 Deployment). Eight charged own browser reads were served
through the existing same-Session/navigation coalescing. Admission vs wire counts
are not interchangeable. Owner500 stays unchanged; candidate is not Production
compatible until separately approved/versioned/refrozen.

Candidate650 covers known507/511/up-to523 complete mock runs, but is not a proved
Production worst-case bound. Class caps remain Auth40, REST80, Mutation50,
cleanup20, Turnstile40, refresh6 and USD0. In the new mock, Auth15, REST19,
Mutation12, Turnstile12, refresh3; other conflicts NONE_OBSERVED. Unknown Managed
challenge/background/refresh scheduling may still hit a class/global/time cap.
No automatic retries, quota increase or paid risk waiver.

1000 simultaneous budget attempts admit exactly650 before stopping; challenge41
is refused before transport/global increment under original40. The old500 atomic
stop remains. Even after capped event history, an observed same-stem public script
keeps safe pathname/source/rule/stage/type/rejection/dispatch-false diagnostics;
query secrets are omitted. Truly unknown/private path identity remains blocked,
not guaranteed decipherable. Original25 identity/replay/hard-deadline evidence
is unchanged and reused.

Pending amendment changes ONLY `budget.allBrowserHttpDispatchesMax:500->650`.
The additional150 admit no extra operations, mutations, mail/media or other groups.
`HUMAN_BUDGET_AMENDMENT_NOT_AUTHORIZED.md` provides the single exact owner reply.
No scope reduction or new duplicate optimization was implemented; separate actor
contexts and required page/challenge behavior must not be merged to lower counts.

Candidate engineering binding (NOT execution authorization):
`9199ef067bfd30b37efca2bd5e715dfe592bd309e050af03180b58d676ae2e37`.
Budget proposal SHA (NOT full GROUP_1 authorization Packet):
`12c15aaf8229d8cd55e6a4c23e64336a9f347167ed2425171660945c25f89a1b`.

Next single action: owner explicitly approves this500->650 amendment and unchanged
other limits/zero-cost/scope, accepting a hard cap is not a completion guarantee.
Only after approval may a new protected traceable budget version be created,
preserving the old private input, then the actual full14/16 entry/Packet is frozen
and fresh five-gate/UTC/GO approval requested. No valid authorization/Claim/GO now;
no OAuth/Production request/write, Provider billing change, push or deployment.
Catalog held; GROUP_2/3 and Public Beta remain NOT_AUTHORIZED.

### Owner Budget650 Applied and Full Packet Frozen (offline, 2026-10-14)

The owner explicitly approved ONLY `budget.allBrowserHttpDispatchesMax:500->650`.
The previous candidate section records the earlier pending state, not the current
approval state. This approval is NOT acceptance of the full subset contract or GO.

The original protected500 work copy and original input template are unchanged.
A new protected `STATEFUL_PRIVATE_BINDING_GROUP1_650_V1.json` version retains
all159 other fields, including accounts/media/QA/cleanup and3 deferred formal
fields/4 optional circle fields null. Only the single global cap differs. ACL
inheritance is disabled; owner is the current Windows user; only that user and
SYSTEM have access. Private values were not printed or added to Git.

`tools/e-verify-group1-full650/` freezes an actual full entry/native-supervisor/
child/full14-case runner/current reviewed browser-adapter chain, not a diagnostic
entry. It preserves the16 exact RLS mappings,29 reviewed Production resources,
all class budgets,1800/1740/60 deadlines, strict OAuth>1860 seconds with
account:read/workers_scripts:write, zero-cost Free-only proof and recovery hold.
The previously tested QA corrections are fully disclosed in the pending contract
addendum; no production business code, resource request or side-effect scope was
added. Global650 is enforced but is not a guarantee of Production completion.

New authorization ID: `e-verify-group1-openglasshub-20261014-full650-v10`.
Full execution binding SHA256:
`52ddb07a40dcfaafdd5570cd6708d372fd5e1aa04efe54233bfc52942c3e616c`.
Full Packet SHA256:
`644255e484c4f79e4e967a562bc3c0b3b2173994a39f10ad5176a37cfe39cdd6`.
Thirteen-condition template:
`tools/e-verify-group1-full650/artifacts/HUMAN_FULL_GROUP1_650_AUTHORIZATION_NOT_AUTHORIZED.md`.
Template SHA256:
`aff750c20661e3dc63508a571ecfa0fd4525e69d4f3c959cef5df9c0cde61302`.

New12/12 mechanical consistency checks PASS,2051 bound files zero differences.
Checks cover exact single-field private diff, all prior scopes/budgets, pending
hashes, null gates/times, synthetic-only authorization/OAuth rejection fixtures,
oldID/GO/consumed Claim refusal, noGO actual parent stop, child syntax/full-runner
wiring and13 conditions. The first check receipt records a test-only misspelled
old-version-path key (11/12); corrected test12/12 and that original failure remain
preserved. No production or authorization state was created by either check.
Candidate8/8, affected25/25, original123/43/9 evidence were reused, not rerun.

Current single action: owner reviews the complete new pending contract/addendum
and freshly confirms its five exact humanGates. Before approving real UTC times,
check current default OAuth locally for scopes and remaining strictly>1860s;
then confirm <=60-minute validity covering full1800-second execution/cleanup.
Formal times and all five gates are NULL, no effective authorization/Claim/GO.
Only after valid full approval may the independent new command
`GO_E_VERIFY_GROUP1_FULL650_V10` be sent; do not send it now. All old Claims/GOs
stay unusable. No live OAuth read, Production request/write, push or deployment
in this preparation. Catalog held; GROUP_2/3/E_VERIFY/Public Beta not authorized;
Version151 is not a default post-Hardening recovery target.

### Chrome Identity Repair and Independent v11 (offline, 2026-10-14)

Only `C:/Program Files/Google/Chrome/Application/chrome.exe` differs from v10:
old SHA `d3784ffbf1f6109348416064b3e4cd739b06fa61d89a81b262c780df9f32270c`,
current SHA `5db678875eb6895c802240aab8e9003aaee63124f719697d88077c46a7ed9f2a`.
Windows Authenticode reports Valid/Google LLC; registry and actual launched version
both156.0.8078.12. Local GoogleUpdater logs mention that version. The old version
was not recorded; the exact update event is NOT proven. No trusted old binary was
found in the reviewed install directory, and none was downloaded. This is a
trusted installed binary change, not a claim about the precise installation event.

The actual reviewed Playwright adapter still launches the same path with unchanged
deny proxy, DNS restriction, ephemeral separate profiles, blocked Service Workers/
WebSocket/Worker/RTC paths, background/component-update-disabled launch flags.
CDP process PID and Windows executable image path were correlated in each test;
raw command lines/profile paths were used only in local memory, never receipts.
Existing OS updater settings were not changed or claimed disabled. Any subsequent
binary drift fails preflight/child validation; do not treat a past PASS as current.

Six narrow browser checks PASS: one synthetic login/refresh/logout and source-backed
hydration with clean B/admin contexts; wrong identity rejection; unknown-origin
predispatch rejection and query redaction; actual650 stop with only one loopback
dispatch; concurrent650 reservation; native deadline/Chrome process-tree drain.
No full14-case/16-RLS suite or Production test was replayed. Earlier local test
failures remain in owned Temp receipts: obsolete transitive Chrome guard, probe
method availability and a test-only wrong diagnostic field were resolved without
weakening the network gate. Final9/9 consistency checks PASS; the first8/9 JSON
in-memory-versus-serialized comparison receipt is also preserved.

Independent `tools/e-verify-group1-full650-chrome-v11/` keeps original v10 intact.
All2050 other inherited hashes, private inputs, global650/class caps,14 mappings,
16 RLS steps,29 reviewed resources and source/Production identities are unchanged.
The Packet differs ONLY in the fresh authorization ID. A separate historical
resource-review copy replaces only the obsolete exact Chrome checksum validation:
exact original path/hash -> verified new path/hash. Every content/source/reference
and other-file check remains strict. No arbitrary browser/hash/path exception.
New2083-file closure is fully verified; no effective approval/UTC/Claim/GO exists.

Authorization ID: `e-verify-group1-openglasshub-20261014-full650-chrome-v11`.
Binding SHA256: `c5578e592aa950764fcae09ebca458bd48aa3f16d5a07a27bb63afdda6ce8b5a`.
Packet SHA256: `a6a356005f43b92dc16625ec3109324a08c6d8dd8fa2b88eca23333ef3a54ed8`.
Template: `tools/e-verify-group1-full650-chrome-v11/artifacts/HUMAN_FULL_GROUP1_CHROME_AUTHORIZATION_NOT_AUTHORIZED.md`.
Template SHA256: `65da468fc1d739c5b4e6be400d31e04c50939f7374bbc68c6b20b556fcb6cf0d`.
Independent command: `GO_E_VERIFY_GROUP1_FULL650_CHROME_V11`, NOT issued.

Latest local OAuth checkpoint passed required scopes and>1860s (2283s at check;
expires2026-10-14T03:18:59.698Z), not a Provider/account observation. Recheck before
actual UTC approval and at GO, never automatically refresh or reuse stale timing.
The owner subsequently confirmed all five exact v11 humanGates in a direct
message; `HUMAN_GATES_OWNER_CONFIRMED_SAFE.json` records this gates-only approval,
not formal authorization or GO. Latest local checkpoint2026-10-14T03:04:40.350Z:
OAuth scopes PASS, remaining3008s, expiry2026-10-14T03:54:48.964Z;2083 bindings PASS.
The owner explicitly approved v11 validity2026-10-14T03:06:00Z to03:46:00Z,
not GO. The independent `AUTHORIZED_GROUP1.json` was recorded and validated at
2026-10-14T03:09:32.202Z; SHA256
`3e3ed030dc164a430d1aec75d98418aad3f326ae2606a70aeefc139702d2e2e5`.
`AUTHORIZATION_OWNER_RECORD_SAFE.json` records all5 gates,2083 binding checks,
OAuth scopes PASS/2716s remaining at that checkpoint and actual recording time
separately from the owner-approved validity start. Original null templates remain
unchanged. Authorization is unconsumed; Claim/entry/GO/Production requests0.
The owner subsequently sent exact `GO_E_VERIFY_GROUP1_FULL650_CHROME_V11`.
The frozen entry ran once: Claim created, authorization CONSUMED. Native Job
closed/reaped and child cleanup PASS; elapsed13291ms, real exit1. It stopped at
LOGIN_A/UNAPPROVED_REQUEST. The first rejection is same-origin GET, resourceType
`other`, rule NO_BOUND_RULE, category UNAPPROVED_ROUTE, normalized route
`/:unbound`, unknown pathname privacy-redacted. Its transport was NOT_INVOKED.
Do not infer favicon, script or a specific URL from this record.

Pre-Deployment PASS: exactb2b62ec9 version100%, recovery0%, Deployment
e8481d68-d2d5-473b-8b0c-b82b8fa33fc3. Post-Deployment NOT_RUN. Confirmed25 GETs:
one Provider Deployment plus one login HTML and23 script/style resources;
all25 global admissions,24 browser transport responses completed. Auth/Turnstile
dispatches0, identities0, Catalog/RLS0/16, mutations0, Provider/Production writes0,
retries0. Production login/hydration and full GROUP_1 are NOT passed.
`GROUP1_EXECUTION_SAFE.json` SHA256:
`f9ab908543f4463113e4a0dc4c1d8dbc31f7ac52dea5c87053c741461277e70d`.
Independent `GROUP1_V11_GO_CLOSURE_SAFE.json` preserves bounded diagnostic/counts
and binds child/parent/supervisor hashes. All original frozen/authorization
files and prior receipts remain unchanged; v11 must never be replayed.

Current single action: only offline comparison of already retained login HTML
public-resource references against resourceType=other policy/diagnostic handling;
do not add a guessed path, issue Production probes or auto-repeat. Any new attempt
requires independent fresh binding/authorization/GO. Exact rejected pathname is
not retained in the ordinary receipt and cannot be recovered from it. No automatic
repair, budget expansion, configuration change or recovery is authorized by GO.
GROUP_2/3 remain unapproved; E_VERIFY incomplete and Public Beta NOT_AUTHORIZED.
Budget approval alone is not production authorization.
Production/Provider requests0, Production writes0, no push/deployment/config
change. Catalog held; GROUP_2/3/Public Beta not authorized; no Version151 default
post-Hardening recovery. Prior product/release/intake/resource evidence is retained.

### v11 other-request offline closure (2026-10-14)

The actual v11 safe receipt preserves `/:unbound`, not the original pathname `/`.
That value is the privacy fallback when the route is absent from reviewed sets.
The historical rejected request identity and exact root cause remain UNKNOWN;
it cannot be recovered by reverse-inference from resourceType, count or fallback.

Original Chrome with retained, hash-verified Production login HTML and scripts/
styles over loopback reproduced24 application GETs then a document-icon `other`
rejection. Local first icon `/gaze-icon-v6.svg` is explicitly referenced by HTML;
ICO/PNG fallbacks also appear. This is a proved local resource-category defect,
consistent with v11 but NOT proof of its historical exact request identity.
Hydration passed locally; no public script errors; real Auth/RLS not executed.

Only `tools/e-verify-group1-other-request/` contains the independent QA copy:
after strict HTML validation, exact same-origin document-icon GET/other requests
with the correct main frame, actor/stage and no credentials/query/redirect are
excluded WITHOUT dispatch. No icon download/content verification or broad other/
same-origin/static wildcard allowance.29 resource bindings,14 mappings,16 RLS
steps and all budgets remain unchanged. Unknown requests still fail closed.
Safe predispatch metadata now includes protocol/source/frame/match evidence and
per-run keyed path association. Optional first unknown pathname correlation is
encrypted in an owner+SYSTEM private directory with a DPAPI-protected private
key; no query/header/body/Session/frame URL in logs or persisted path records.
Sensitive paths stay PRIVACY_BLOCKED. Never claim unavailable initiator details.

12 targeted policy/privacy/budget/consumed-Claim checks and3 unique actual Chrome
loopback cases PASS. Native Job/browser cleanup PASS; selective repeats preserve
earlier receipts. No old123/43/production-resource suites were replayed.
All2083 v11 frozen hashes, old approval/Claim/child/closure receipts and both
private budget versions remain unchanged. No full GROUP_1 Packet or effective
production authorization was created. The engineering-only binding SHA256 is
`a85f6f25008d71bfd3b36b7b5a5d8abe94545fb22b13bc707d29f381e9ae1c79`.
It is NOT a Production execution binding.

Current single action: owner reviews
`tools/e-verify-group1-other-request/MINIMUM_OTHER_REQUEST_DIAGNOSTIC_SCOPE_NOT_AUTHORIZED.md`.
Proposed max3 real GETs (pre-Deployment, exact login HTML, conditional post-
Deployment), cached23 verified resources only, no asset redownload or third-party
network. First other captured before dispatch, with public-reference or protected
privacy-safe identity; unknown or privacy-blocked paths are not sent. This is a
scope draft only; an independently frozen entry/new approval/window/GO is needed
before any Production observation. Do not issue GO against the old v11 entry.
GROUP_1 remains BLOCKED; historical Auth0/RLS0/16 unchanged. Production requests/
writes this offline task0. USD0, Catalog hold and GROUP_2/3/Public Beta prohibitions
continue; Version151 is never the default post-Hardening recovery target.

### 3GET diagnostic effectiveness review (offline, 2026-10-14)

The earlier max3GET scope draft remains unchanged historical material; it is
NOT ready for authorization. No Production diagnostic entry or Packet was
generated. Existing15/15 tests and receipts were reused, not rerun. The30-file
engineering closure still verifies without changes. No new resource review,
OAuth/billing check, private intake or Production operation was performed.

Numerically,3 real GETs can carry pre-Deployment + login HTML + conditional
post-Deployment while23 verified scripts/styles are served locally. Chrome
still emits real request events for locally fulfilled resources, so the24
application requests do not intrinsically require24 new Production GETs.
The exact retained HTML bytes are the same across the original and corrected
local runs: SHA256
`3d47e816eb1605fa98c203b62372528170d9dc356866ff1a6e61d670ab49468c`.
This is browser observation, not merely inspecting static references. It is
not proof of equivalent live timing, headers, external widget behavior or
the historical rejected request's identity.

The draft stops at the first other BEFORE the known-icon exclusion. Existing
original-local evidence first observes declared icons and24 wire responses
(HTML1 + scripts/styles23). This can repeat the already known icon evidence,
not prove which request v11 rejected. The historical raw pathname was not
retained and is not recoverable from a new event, even if its class/count match.

After exact icon exclusions, `observed-4-local.safe.json` shows3 excluded icons,
zero unknown other events, and25 loopback responses: HTML1 + static23 + one
Turnstile initialization request. That response is an inert local widget Mock,
not captured real Turnstile initialization. Its evidence SHA256 is
`4d0a6ba7ec5eecc4e440a19a55e1957d78e8be6dc52e85599ce946379be7e4ab`.
`unknown-3-local.safe.json` tests an explicitly injected unreviewed icon; it
proves safe blocking/capture, NOT natural Production target reachability.
The3GET draft forbids all third-party requests and must stop if this unbound
initialization appears. It has no validated target-absent preflight and no
frozen runner. Its optional post-Deployment request also cannot be promised
after the first gate anomaly: the draft expressly stops rather than sending it.

Current single technical gap: a naturally reachable, non-reviewed other request
on the unmodified initialization chain is not demonstrated after the known
icon exclusion; the inert Turnstile fixture cannot establish that equivalence.
Only a narrowly scoped offline validation of that initialization boundary,
using trustworthy existing inputs rather than an injected target or fabricated
live widget, can justify a revised observation design. If such inputs/target
cannot be established, stay BLOCKED and do not consume Production authorization.
An absence of an unknown event is INCONCLUSIVE, never historical identity PASS.

Do not freeze or approve the present3GET draft, or propose4/higher as a sufficient
upper bound: the observed one mock widget request does not bound real challenge
requests or identify v11. No additional Production GET budget is recommended
now. No full GROUP_1 Packet, authorization, Claim or GO. Original500/approved650
and class budgets remain unchanged. USD0, Catalog hold, GROUP_2/3 and Public Beta
NOT_AUTHORIZED continue. Production requests/writes this review0.

### Real LOGIN_A initialization observation (offline, 2026-10-14)

`tools/e-verify-group1-real-initialization/artifacts/INITIALIZATION_CLOSURE_SAFE.json`
binds the final real Chrome observation and native Job cleanup receipts.
Existing Production HTML and29 reviewed assets reused, with byte authentication
on local read; no repeated source audit, Chrome identity tests, old15/123/43
suites, billing/OAuth checks or private intake. No new main build substituted.
New single boundary case1/1 PASS; early local metadata-pin/receipt-copy failures
remain preserved. No fake third-party script or injected target in this case.

Observed29 routed page attempts:24 approved local HTML/script/style responses,
one preexisting nonessential-image exclusion,3 exact HTML icon other exclusions,
one genuine Turnstile script request cancelled before network.5 Astro/React
islands hydrate; login fields remain empty; no Auth Session entry, Auth/RLS
transport or CAPTCHA frame. No natural unbound application request in the
covered interval. CDP shows the bootstrap script initiated from the verified
AuthPanel.DgqtsVwn.js/client.C9ykwJRQ.js modules. The real unavailable/error UI
appears after cancellation, with no window.turnstile API substitute.
14 browser proxy attempts are denied without forwarding; no page/initiator
attribution is available, so do not guess they are internal Chrome or page
requests. They also consume the same global admission budget; final39/650.
Request/parse order is recorded, not a claim of total JS evaluation order.
Browser/native Job cleanup PASS; no credential, URL query, Cookie, Session or
header values in safe evidence. Original frozen files and Claims remain intact.

The exact uncovered boundary is the external API implementation and real
render()/challenge-frame/resource/token-callback execution; these bytes and
dynamic responses are absent from the29 application assets. Overall real
initialization remains PARTIAL, original v11 identity UNKNOWN, future unknown
request reachability UNPROVEN. Zero unknowns before the aborted API does not
prove zero unknowns after a real widget. Stop constructing offline Mock evidence.

The owner subsequently permitted OFFLINE preparation of a separately bounded
real Turnstile diagnostic, not network activity or production authorization.
Known bootstrap reachability is PROVEN; the historical missing request is not. See scoped
`tools/e-verify-group1-real-initialization/INITIALIZATION_BOUNDARY.md` for exact
source/coverage and network lower bound, NOT a new contract or permission.
Do not claim4 GETs suffice for dynamic challenges or automatically widen the
3GET draft. No Production Packet, authorization, Claim or GO created here.
Production GET max0 until independent approval. USD0/global650 unchanged;
Catalog held, GROUP_2/3/Public Beta unapproved, no push/deploy/Production writes.

### Exact Turnstile diagnostic boundary decision (offline, 2026-10-14)

Preparation remains BLOCKED on one precise prerequisite: no trusted real SDK/
dynamic-endpoint evidence supports a finite exact third-party request policy.
The current owner's scope forbids wildcard paths. The unchanged original
`tools/e-verify-group1-v9-closure/gate.mjs` lines80-81 accepts GET/POST under a
challenge-platform path regex, not only individually bound concrete targets;
the frozen Packet explicitly describes that subtree capability. It must NOT
be silently inherited as an exact allowlist for this new diagnostic.

Only the GET to the fixed public bootstrap URL is source-backed.29 retained
resources are all application-host resources; the real-init receipt confirms no
third-party response supplied and API/render/challenge coverage unavailable.
The old third-party class40/global650 ceilings bound quantity, not authority,
target identity or enough capacity to finish a real challenge. Do not replace
the missing protocol evidence with another Mock, fabricated endpoint, arbitrary
3/4GET budget or broad regex. Render/challenge reachability stays UNPROVEN.

Single minimum resolution direction: obtain trustworthy actual SDK and endpoint
protocol evidence sufficient to bind each allowed dynamic request's exact origin,
method, target derivation and payload/privacy boundary. If a finite exact policy
cannot be justified, the owner would need an explicit separately approved change
to the strict concrete-target requirement; this task does not authorize that change.
An exact bootstrap-only read is not full real-initialization completion or proof
of the historical missing request. No complete diagnostic entry/Packet/GO/Claim
or new Production binding was fabricated. Existing1/1 and15/15 evidence reused;
no tests rerun and no original executor, frozen receipt, private input or budgets
changed. Actual external request allowance remains0, Production requests/writes0,
USD0/Catalog hold preserved, GROUP_2/3/Public Beta NOT_AUTHORIZED.

### Official Turnstile protocol policy decision (2026-10-14)

Owner explicitly allowed reading four official public documents; all four were
read, not live SDK or Provider/Production endpoints. The CSP document describes
nonce-propagated dynamic resources and official-origin scripts/frames. Rendering
requires the live official api.js, not a cached/self-hosted replacement. Testing
docs support official dummy keys/localhost/automated tools and require separation
from Production. These documents do NOT publish an exhaustive stable internal
URL list or a maximum request-count guarantee. Do not continue blind path searches.

Decision A: a fixed exact bootstrap URL remains usable; full stable real-challenge
automation is not presently feasible with only exhaustive concrete URLs.
Decision B: FEASIBLE DESIGN ONLY, pending explicit new owner scope approval:
per-widget runtime capability, exact HTTPS challenges.cloudflare.com:443, GET/POST
type restrictions, SDK-rooted initiator/registered frame lineage, atomic class40
and global650 limits, redirects/other-host/unknown-source denial, closed unobserved
channels and ephemeral token-status-only receipts. No host-only fallbacks; no
relabeling a supplier capability as an exhaustive URL whitelist. Vendor updates
and same-host behavior carry additional supplier-trust risk. Existing route/proxy
code is not automatically compliant with official live SDK loading or capable of
attributing every channel; implementation must fail closed if that is not proven.

Current single action: owner approves or rejects the scoped B policy proposal in
`tools/e-verify-group1-real-initialization/BOUNDED_TURNSTILE_POLICY_DECISION_NOT_AUTHORIZED.md`,
initially for local engineering of an isolated official-test-sitekey harness.
Approval permits implementation/local safety checks, NOT immediate external SDK
testing. Such online isolated testing needs separate explicit execution scope,
time/budgets and GO. No real credentials, Supabase Auth, Siteverify or RLS are in
that harness. No test keys in Production. Official TEST sitekey/live SDK is online
integration, not offline Mock; it does not pass a real Production widget/account
or16 RLS cases. Real Production challenges may require an owner and may fail in
automation. Full GROUP_1 still needs fresh complete authorization/GO and real
identities; v11 stays consumed and its raw request UNKNOWN.

No executor/gate/old frozen contract/private budget was changed, no tests rerun,
no SDK/Production call, no effective authorization/Packet/Claim/GO. Only approved
public documentation reads and local design/progress changes. Production requests/
writes0, original650/other caps/USD0/Catalog hold and GROUP_2/3/Public Beta bans retained.

### B isolated executor implementation (2026-10-14, LOCAL ONLY)

Owner explicitly approved B only for isolated QA engineering, offline checks and
a pending independent online Packet. Implemented in
`tools/e-verify-turnstile-isolated/`; original GROUP_1/v11 executors, private input,
historical authorizations/Claims/assets and Production business code unchanged.

46/46 new targeted checks PASS:33 gate/authorization,11 real Chrome loopback plus
native Job Object containment,2 frozen runtime/no-GO checks.193 bound files/runtime
identities match. Test SDKs are synthetic local fixtures, NOT real Turnstile.
No historical123/43/asset/budget/Chrome suites rerun. Real SDK init unexecuted;
original v11 unknown request remains UNKNOWN, full GROUP_1 remains BLOCKED.

Closed reviewed egress: exact official HTTPS origin/SDK, per-instance widget and
registered frame/CDP initiator capability; unique frame-parent join and paused
OOPIF observation before subresource execution. Unknown/ambiguous proof denies.
GET/POST/frame share third40/global650 pre-dispatch atomic reservations. Native
proxy never forwards HTTP/CONNECT; worker/SW/WS/RTC and general Node exit closed.
Normal cleanup and real Chrome descendant forced deadline/drain both tested.
This bounds reviewed pinned runtime, NOT arbitrary compromised native code.

Pending contract explicitly discloses fresh Node-TLS/browser fulfillment delivery,
NOT native Chrome TLS or vendor-certified loading; official guidance discourages
SDK proxying. Actual mediation compatibility remains NOT_VERIFIED. No opaque
CONNECT fallback permitted. Vendor updates, cookies, workers, automation and
missing initiators may safely prevent completion. Body caps are not total socket-
byte or billing hard limits. Supplier trust is not an exhaustive URL whitelist.

Pending independent ID:
`e-verify-turnstile-isolated-openglasshub-20261014-b1`
Execution Binding SHA256:
`cf89bfda28134b8a2a28ea82949e04023c1820d7ceb5b8bf6af158d8ce528431`
Packet SHA256:
`80418264782a7cbc6f2fd6d5c2e80d894ea37281426d1c0c231aa97d761974d8`
Contract:
`tools/e-verify-turnstile-isolated/artifacts/HUMAN_ISOLATED_TURNSTILE_AUTHORIZATION_NOT_AUTHORIZED.md`

Five new owner gates null; UTC null; no approved auth/Claim/GO. Next single action:
owner reviews this isolated pending contract, especially mediation compatibility
and supplier-trust scope, then explicitly confirms gates before UTC proposal.
Separate online approval/GO mandatory; applying B to Production GROUP_1 requires
isolated live evidence and another separately approved contract change.
Production requests/writes0, third-party live requests0, USD0, Catalog ACTIVE;
GROUP_2/3 and Public Beta NOT_AUTHORIZED. No push/deploy/new recovery action.

### B1 isolated online attempt (2026-10-14, STOPPED)

Owner separately confirmed all five B1 gates and the exact UTC window
2026-10-14T05:37:15Z..06:07:15Z, then sent the independent B1 GO.
Fresh preflight: approved authorization hash, contract/Packet/Binding and193 files
matched; instance unused and remaining validity1448 seconds. No OAuth needed.
Only the frozen run-online entry was invoked once. B1 authorization CONSUMED,
ONLINE_ONCE.claim CREATED; never reuse this instance, authorization or GO.

Actual result BLOCKED at SDK_LOAD: firstFailure REDIRECT_OR_LOCATION. One exact
official SDK GET dispatched; no redirect followed or retry. Existing response
guard rejects HTTP3xx OR any Location header. HTTP status and safe Location
classification were not retained, so neither a specific301/302 nor legitimate
redirect target is proven. No SDK bytes validated, render/frame/callback all
unobserved. Original v11 request identity remains UNKNOWN.

Global admissions13: one local harness, one supplier GET,11 denied native proxy
attempts. Supplier POST0, proxy forwarding0, real credentials/Auth/RLS/Siteverify0.
Browser cleanup PASS, supervisor EXIT_ZERO, Windows Job drained/closed; total
supervisor duration1546ms. Exit zero is process cleanup, NOT diagnostic PASS.

Read-only source review found live-child's final object spreads result.status over
its aggregate status string. This receipt field-collision is a separate QA defect;
the actual response denial and absent stages independently prove BLOCKED here.
No frozen code/receipt altered and no second request or auto-repair performed.

Immutable raw receipts ONLINE_SAFE.json, ONLINE_FINAL_SAFE.json and
ONLINE_SUPERVISOR_SAFE.json retained; independent hash-linked closure at
`tools/e-verify-turnstile-isolated/artifacts/B1_GO_CLOSURE_SAFE.json`.
Next single action: offline QA repair of privacy-safe response rejection evidence
and aggregate/phase status collision, without weakening redirect policy. Do not
invent missing response fields or request another full GROUP_1 attempt on these
results. Any further online attempt requires a fresh independent instance and
explicit authorization/GO, not the remaining B1 window.
Production requests/writes0; third-party live GET1 (not0). Strict USD0 policy and
Catalog ACTIVE maintained; GROUP_2/3/Public Beta NOT_AUTHORIZED. No Production
code/config/database/deployment change; no historical test rerun or push.

### B1 safe response and receipt repair; B2 pending (2026-10-14)

Offline only, in independent `tools/e-verify-turnstile-response-b2/` copy.193 B1
bound files verified unchanged; old receipts/authorization/Claim untouched.
All B1 retained online receipts contain no response status/headers; historical
HTTP status and Location presence remain UNKNOWN, redirect root cause UNKNOWN.
Do not infer301/302/307/308 or future response equivalence.

Response journal now captures bounded safe metadata immediately at headers,
before encoding/Content-Length/body failure. Records status code/class, observed
headers, Location presence/finite origin class/same-allowed-origin boolean,
independent redirect-vs-header trigger flags and bounded rejection code. No raw
Location/URL/query/body/credentials/Token/Cookie retained. Failure before headers
stays UNKNOWN, not falsely200 or no-Location. Existing3xx OR any Location rejection
unchanged, even same-origin or200+Location; no following, retry or CONNECT bypass.

Receipt v2 separates executionStatus/failureStage/failureCode/stageResults/
cleanupStatus. New parent and child use a shared validator/compatibility parser.
Cleanup and native containment are independently required; historical B1 phase
object is correctly read as BLOCKED, never a success string. No missing response
metadata invented. New schema rejects unexpected sensitive response fields.

44/44 targeted OFFLINE PASS:32 response/receipt/policy checks,6 actual loopback
HTTP/stream tests,4 real Chrome/loopback response-only cases,2 frozen/no-GO checks.
Historical46/123/43/15 and unrelated stages NOT rerun. Request-admission logic
identical except response-journal registration; response policy equivalence tested.

Minimum B2 has proven local observation value: one fresh browser-generated GET
to the exact same SDK URL; supplier GET max1, POST/frame0, global650 ceiling,
300s total with original request/body/work/cleanup bounds. It aborts before SDK
delivery/execution, widget/render/frame/callback, Auth/RLS/Siteverify/Production.
Thus another response at the same stop point yields precise safe diagnostics;
network/preheaders failure is still possible and will remain explicitly UNKNOWN.
No evidence justifies any redirect exception; such a change needs separate target
evidence and explicit contract approval, not the pending B2 diagnostic.

Pending ID: `e-verify-turnstile-sdk-response-openglasshub-20261014-b2`
Binding SHA256: `536da169c1ec472181fb33cf7f7e1baaaae620d7913dd3dd9f2c24201a2d3592`
Packet SHA256: `526b4ead89966a3cbe2c0766d5c9161d25ce30645d869d79b349c3d748984f17`
214 bound files match. Contract:
`tools/e-verify-turnstile-response-b2/artifacts/HUMAN_B2_SDK_RESPONSE_AUTHORIZATION_NOT_AUTHORIZED.md`.
Fresh five owner gates and UTC remain null; effective authorization/Claim/GO absent.
Next single action: owner reviews this exact one-response B2 contract for fresh
human approval and later exact UTC/independent GO. Never reuse consumed B1.
This task Production requests/writes0, third-party live requests0; strictUSD0 and
Catalog ACTIVE preserved, GROUP_2/3/Public Beta NOT_AUTHORIZED. No deployment/push,
production business change, billing change, real account operation or recovery.

### B2 exact SDK response observed (2026-10-14, STOPPED)

Owner independently approved B2 five gates/full frozen contract and exact UTC
2026-10-14T06:05:25Z..06:35:25Z, then sent exact separate B2 GO. Fresh preflight
matched approved authorization/contract/Packet/Binding and214 files; remaining
validity1648s, instance unused. Frozen entry invoked exactly once; B2 consumed,
ONLINE_ONCE.claim created. Never reuse this authorization/instance/GO.

New concrete evidence: the exact SDK GET returned HTTP302 (3xx) WITH Location.
Safe target classification SAME_ALLOWED_ORIGIN, same allowed host true. BOTH
redirect-status and Location-header guards triggered REDIRECT_OR_LOCATION at
SDK_LOAD. Target pathname/content NOT retained/verified under the approved scope;
same origin alone is NOT authorization to follow. B1 historical response remains
UNKNOWN and original v11 identity remains UNKNOWN; do not infer them from B2.

One supplier GET, POST/frame0, global admissions10 (local harness1, supplier1,
native proxy denied8), proxy forwarded0. No retry or redirect follow. SDK never
delivered/executed; render/widget/challenge/callback unobserved. New separated
execution/failure/stage/cleanup fields correctly show BLOCKED and cleanup PASS,
native Job drained/closed, supervisor EXIT_ZERO, elapsed1240ms. Process success
is not diagnostic execution PASS. No live Auth/RLS/Siteverify or real credentials.

Raw ONLINE_SAFE.json, ONLINE_FINAL_SAFE.json and ONLINE_SUPERVISOR_SAFE.json kept
unchanged; hash-linked independent closure:
`tools/e-verify-turnstile-response-b2/artifacts/B2_GO_CLOSURE_SAFE.json`.
Response diagnosis objective now has actual evidence; do NOT repeat B1/B2 merely
to rediscover response status. Next single action is separate review of the minimum
SDK redirect-contract adjustment AND the missing exact-target evidence. No current
permission to follow a302, broaden paths, request its target, run SDK or retry.
Any future online operation requires fresh independently approved scope/window/GO.
This task third-party live GET1, Production requests/writes0. StrictUSD0, Catalog
ACTIVE, GROUP_2/3/Public Beta NOT_AUTHORIZED; no Production/code/config/schema/
billing/deployment change, no test rerun or push.

### Final B2 loading-strategy decision (OFFLINE ONLY, 2026-10-14)

B2 raw receipt hashes and all214 frozen files rechecked, no tests or external
requests. The original302 WITH Location at SDK_LOAD is CONFIRMED. Exact target
pathname/query was deliberately discarded by ResponseJournal; no protected raw
Location evidence file/index exists in the B2 artifacts or writer code. Do NOT
recover invented targets, infer B1 status, or reuse consumed B1/B2 instances.

Actual source-bound request: Node https.request to challenges.cloudflare.com:443,
TLS SNI that hostname, rejectUnauthorized:true, GET
`/turnstile/v0/api.js?render=explicit`. Host is generated by Node for the fixed
origin, not arbitrary browser Host forwarding. Browser-derived headers are
filtered to accept/content-type/origin/referer/user-agent/sec-fetch-site/mode/dest
when present; Cookie/Authorization/proxy-authorization/apikey are forbidden.
Node adds accept-encoding:identity. No headers/values were snapshotted, so which
optional headers were actually present and their exact values remain UNKNOWN.
Do not claim that a particular User-Agent/Accept/Referer caused302.

This is not native Chrome transport: Node HTTP/TLS implementation and encoding
negotiation differ, browser client-hint headers are not forwarded, and cookies
or automatic redirect continuation are forbidden. Those are proven source
differences, NOT a proven server-side explanation. Browser native negotiation
for this endpoint has never been observed. Upstream302 was observed before
gate.validateResponse rejected it; route.fulfill was never reached, and B2
response-only mode never delivered SDK bytes to Chrome. The QA mediator did not
synthesize this302. WHY the endpoint redirected remains UNKNOWN.

Official evidence reused from the previously read2026-10-14 rendering/CSP sources
and the stored decision in
`tools/e-verify-group1-real-initialization/BOUNDED_TURNSTILE_POLICY_DECISION_NOT_AUTHORIZED.md`:
live SDK at official URL, no cached/self-hosted/proxied replacement; dynamic
script/frame/nonce trust, not an exhaustive stable internal URL list or request
guarantee. No official page was refetched under this task's no-network restriction.
CSP authorization is NOT proof of QA budget enforcement or redirect-target safety.

Options and decision, scoped to the EXISTING architecture (not all possible tools):

- A, Node fetch/Chrome fulfillment: compatibility UNVERIFIED. Fresh bytes/exact
  original URL do not establish official/native equivalence. Following302 would
  not solve mediation, TLS/context or future dynamic-channel uncertainties.
- B, native Chrome SDK: BLOCKED with current executor. deny proxy rejects every
  CONNECT and DNS is restricted; replacing fulfill with continue cannot load SDK.
  Allowing same-host opaque CONNECT alone provides no HTTP path/method/body or
  per-request admission proof inside TLS/connection reuse. Current page/CDP routes
  and disabled SW/WS do not establish a fail-closed gate for EVERY browser/network-
  service/OS egress source. No unmonitored tunnel, wildcard, disabled gate, TLS
  interception certificate or unproven header/flag workaround is approved.
  A future native design must prove coverage below all actual egress sources,
  native official TLS, immutable owner caps/byte limits, redirects BEFORE their
  target dispatch, and closed/unobservable channels. This capability is NOT
  implemented or proven here; no promise of a small browser-adapter fix.
- C, exact single redirect: BLOCKED NOW. Same-origin class alone cannot bind a
  target pathname/query, verify content or authorize redirect semantics. A new
  separately approved response observation could privately retain the exact
  target for offline review, but it is NOT the only remaining prerequisite and
  cannot prove native SDK compatibility. Do not prepare/execute such a header-only
  Packet merely to repeat the Node mediation cycle. Obtaining a target would NOT
  authorize fetching it; a later exact contract approval would still be required.

ONE practical recommended approach: stop this mediated automated SDK-diagnostic
route and have the owner decide on a separately approved native-Chrome MANUAL
acceptance contract. This could exercise the genuine SDK/browser/user flow without
representing Node mediation as vendor-supported loading. It is NOT executable or
authorized here: normal manual browsing cannot honestly inherit automated hard650/
class40 pre-dispatch/response-byte enforcement, nor close every invisible channel.
The owner must explicitly decide whether that DIFFERENT acceptance boundary is
acceptable; never silently replace the current contract with action counts,
post-hoc logs, an opaque CONNECT exception or unrestricted browser access.
USD0/Free-only/no Production credential disclosure, exact test identities/origins,
owner challenge handling, retained-log risks, Catalog hold and phase separation
would still be mandatory. Real Production login/RLS need their own exact scope;
isolated test-sitekey success is NOT a Production Auth/RLS result.

If the owner requires the unchanged strict automated contract, remain BLOCKED:
only actual proven native full-egress enforcement could satisfy it, and that is
absent, not a small known header/redirect fix. No new B3/B4/header-only Packet or
speculative engineering subtask is created. Next single owner action is to accept
or reject preparing that explicitly different manual acceptance contract; neither
choice is permission to browse/execute, and rejection keeps all online work stopped.
Existing Mock/offline/RLS-preparation evidence is reused, never relabeled real
Production PASS. Production16 RLS and full GROUP_1 remain incomplete/unexecuted,
GROUP_2/3/Public Beta unapproved.

Full GROUP_1 BLOCKED; no new code, SDK/Provider/Production/documentation request,
test suite, authorization, Claim, GO or budget change. Original contracts/receipts
and product commits preserved. This task third-party live0, Production requests/
writes0, USD0/Catalog ACTIVE. Only this sole progress baseline updated locally.

### Native Chrome two-layer manual plan (LOCAL ONLY, 2026-10-14)

Owner approved isolated native-manual design/QA preparation only, NOT online
execution/Production/login/GO. Implemented scoped tools and frozen manual contract
in `tools/e-verify-native-manual/`. B1/B2/v11 and original budgets/claims/receipts,
product code and private160-field input untouched. No B3/B4 mediator diagnosis.

Layer1: loopback nonce/CSP harness, exact official SDK script tag and fixed TEST
Sitekey, genuine Chrome Fetch.continueRequest/native HTTP/TLS (no Node SDK fetch,
proxy or fulfillment). New owned temporary empty profile plus incognito target,
no extensions/sync/existing cookies/accounts. Start/render manual once; test
widget may require no human interaction, recorded honestly, never Production PASS.
No Auth/RLS/Siteverify/pre-clearance/Production/business operations. No token,
headers/query/body/Session/storage/HAR/trace/fingerprint export. Only typed safe
stages/counts/status codes and explicit owner visibility/interaction attestations.

Network PARTIAL, not global HARD or old650/40 inheritance. Target request-stage
Fetch/CSP origin/method/type/frame controls and Node/SW/WS/worker/RTC restrictions
are actual scoped measures; native same-origin supplier redirects/dynamic GET/POST
and transient vendor state are expressly NEW pending permissions. Browser/OS and
racing unobserved channel traffic remains UNKNOWN;40 vendor/650 target observed
events are SOFT stop triggers, not all-browser dispatch/invoice/byte caps. No
opaque CONNECT bypass, TLS-intercept CA or production security change introduced.

New isolated deadline600s includes startup/drain; child520s, supervisor work540s,
cleanup reserve60s inside total, >610s validity remaining, UTC<=60min. Close/drain
and exact owned-profile removal required. Parent can remove that recorded profile
after abnormal child exit only when Job drain proven. No secure-erasure/provider/
OS-log removal claim; real user profile cannot pass cleanup-path validation.

27/27 targeted OFFLINE PASS:14 scope/evidence,5 actual Chrome native loopback
(normal/redirect/unknown-origin/deadline/proxy-close fixture),5 authorization/profile,
3 frozen/scope/no-GO consistency.202 files bound. Browser window ordering ensures
the new target exists before closing the default blank window. Real official SDK,
widget/challenge/CAPTCHA and Production remain NOT_EXECUTED. Existing43/46/44/123/
15-stage evidence reused, not rerun. Superseded unapproved LOCAL draft retained
in artifacts/unapproved-local-draft-before-window-order-fix; no approved contract
was rewritten or reused. Source-freeze Packet scope unchanged by window fix.

Layer2 is a future NOT_AUTHORIZED evidence plan: exact14 scoped IDs, loginActions,
3 identity labels and16 exact RLS targets/assertions preserved from source Packet
and50-case matrix. RLS is anon6+A5+B5, not16 authenticated positive reads. Expected
A/B projection denial and signed-in anonymous SSR product-page behavior remain
distinct. Private session-to-RLS adapter/Production contract deferred until actual
Layer1 live success plus independent approval; no QA identity values read/output.
Registration/mail/media/forum/admin writes and GROUP_2/3 remain excluded.

Pending ID: `e-verify-native-turnstile-manual-openglasshub-20261014-v1`
Binding SHA256: `3de16445b5ca449c847a81fbf080b132a55d7d0edaf523290275266096d0d386`
Packet SHA256: `3b09b0d2fe08647c7112ae701aea6aa655e5023519df6c93d65b646a6b8dee39`
Contract:
`tools/e-verify-native-manual/artifacts/HUMAN_NATIVE_ISOLATED_MANUAL_AUTHORIZATION_NOT_AUTHORIZED.md`.
Six NEW owner gates and UTC null; no effective authorization, live Claim or GO.
One current next action: owner accepts/rejects this changed manual/network/state
contract and confirms trusted unmetered/no-additional-charge connection. Existing
Turnstile Free evidence reused, no repeat billing audit. Cost EXECUTION gate remains
BLOCKED on that unconfirmed connection fact; no risk waiver or increased USD0 cap.
After actual confirmations, propose UTC, obtain approval, then STOP for separate GO.
Production requests/writes0, third-party live0; Catalog ACTIVE, GROUP_2/3/Public
Beta NOT_AUTHORIZED. No deployment/push/production/config/database/billing change.

### Native manual v1 owner confirmation, pending exact UTC approval

At local verification UTC 2026-10-14T07:33:26Z, all202 frozen files and the
existing binding/Packet hashes matched. No native preflight, Claim or approved
authorization file exists. Owner explicitly confirmed all six native gates,
full contract/bindings, readiness, unlimited home broadband with no incremental
traffic/service fees and no paid proxy/VPN/cloud exit. These are OWNER_ATTESTED
facts, not direct Provider/network inspection. Together with existing Free
Turnstile evidence, zero-additional-cost gate PASS; USD0 remains unchanged.
Separate safe confirmation record:
`tools/e-verify-native-manual/artifacts/OWNER_HUMAN_CONFIRMATION_PENDING_WINDOW_SAFE.json`.
Proposed UTC 2026-10-14T07:33:26Z to 2026-10-14T08:03:26Z is NOT approved.
Effective authorization times remain null. Sole blocker/next action: owner
explicit approval of this exact window; then record authorization and STOP for
independent GO. Require >610s remaining at actual start; never auto-extend.
Network PARTIAL/soft40/650 unchanged. No tests rerun or live requests issued;
Production requests/writes0, third-party live0, Catalog ACTIVE, GROUP_2/3 and
Public Beta NOT_AUTHORIZED. Frozen templates/Packet/binding remain unchanged.

### Native manual v1 exact UTC owner approval recorded

Owner explicitly approved UTC 2026-10-14T07:33:26Z to 2026-10-14T08:03:26Z,
with the six gates, full contract and both frozen hashes unchanged. Independent
`tools/e-verify-native-manual/artifacts/AUTHORIZATION_APPROVED.json` records the
approved window, not the receipt creation time. Local pre-record verification at
2026-10-14T07:35:22Z matched202 files and confirmed >610s window coverage and no
native preflight/Claim. Previous pending confirmation record remains historical.
No live execution is permitted without separate owner GO. Sole next action:
`GO_E_VERIFY_NATIVE_CHROME_ISOLATED_MANUAL_V1`, subject to fresh execution gates.
No automatic window extension, no OAuth gate, no tests rerun. Network PARTIAL,
soft40/650, USD0 and isolation limits unchanged. Production requests/writes0,
third-party live0; Catalog ACTIVE, GROUP_2/3/Public Beta NOT_AUTHORIZED.

### Native manual v1 consumed GO: work deadline before SDK observation

Owner sent exact `GO_E_VERIFY_NATIVE_CHROME_ISOLATED_MANUAL_V1`. Frozen
202-file binding, approved-file SHA and >610s window checks passed before the
single frozen entry invocation. Native preflight and Claim now exist and the
authorization is CONSUMED; never replay this instance or GO.
`tools/e-verify-native-manual/artifacts/NATIVE_FINAL_SAFE.json`: BLOCKED,
cleanup PASS, native containment closed, owned profile removed. Child
`NATIVE_SAFE.json`: stopReason WORK_DEADLINE; sdkLoaded/renderStarted/
renderReturned/callback false, observedFrames0, observedVendorRequests0,
observedTargetRequests1, ownerFinished false, owner visibility/interaction null.
Supervisor elapsed520803ms, reaped=true, native Job closed, receipt written.
EXIT_ZERO means receipt delivery/child exit, NOT diagnostic success.
Only observed target/vendor events are counts; unobserved native browser/OS
traffic remains UNKNOWN, not a zero-global-egress claim. No Production/business
access or writes; no credentials used. Real SDK compatibility remains UNVERIFIED.
Evidence does not establish whether the owner saw/clicked the QA window or why
SDK dispatch was not reached. Sole next action: owner describes whether the QA
window appeared and Start was clicked, without tokens/screenshots/private data;
resolve that exact handoff issue offline before proposing any fresh instance.
No automatic retry/new authorization. USD0, Catalog ACTIVE, GROUP_2/3/Public Beta
NOT_AUTHORIZED and full GROUP_1 BLOCKED remain unchanged.

### Native v1 timeout explained; fresh-v2 pending approval

Owner subsequently attested QA_WINDOW_VISIBLE=true, START_CLICKED=false,
OWNER_FINISHED=false and no other actions. Harness appends the SDK script ONLY
in Start.onclick; native-browser waits for Finish/stop with a520s work timer.
Together with vendor observed0, pageError0 and successful cleanup, this proves
the v1 WORK_DEADLINE was waiting for manual Start, not an observed SDK/redirect
failure. No new pre-SDK technical blocker is evidenced. Post-Start real vendor
behavior remains UNVERIFIED and is the purpose of the next isolated live test.

Fresh independent pending instance: `tools/e-verify-native-manual-fresh-v2/`.
ID `e-verify-native-turnstile-manual-openglasshub-20261014-fresh-v2`.
Binding `a42e0fadf2cb291c83680ab4417ba5a2022b1489a5cc09ca907b9367feb9ff31`.
Packet `02d111eda15bcef2c4068eb6d40ef219ccc5667032b23fac2be2393d170ac43a`.
Necessary consistency only:202/202 frozen files match;17 root files identical to
v1 except new ID/GO constants; Packet differs only in ID/GO. Reused27/27 offline
evidence, no tests rerun. Old202-file freeze/authorization/Claim/receipts intact.
All six fresh gates and UTC remain null, no approved authorization/preflight/Claim
or GO. Contract remains PARTIAL/soft40/650, USD0,600s total, >610s at actual start.

Owner next accepts fresh identity/unchanged contract and confirms gates current;
then propose/approve exact UTC and STOP for a NEW independent GO. When launched:
click Start once promptly; observe real widget, click Widget visible, then the
truthful Interaction observed OR No interaction required; Finish only when real
observations/callback agree. Stop on error/uncertainty; never reload/retry/reset.
No live requests in this preparation, no Production changes, Catalog ACTIVE,
GROUP_2/3/Public Beta NOT_AUTHORIZED, full GROUP_1 BLOCKED.

### Fresh-v2 owner gates recorded, exact UTC approval pending

Owner explicitly accepted fresh-v2 unchanged contract and all six gates, current
zero-additional-charge trusted connection, readiness/full-window attendance and
manual Start-once operation. At trusted UTC 2026-10-14T08:01:28Z local verification
matched202/202 frozen files, binding/Packet/template SHA. Exact contract comparison
to v1 differs only in ID/GO/corresponding hashes; Packet only ID/GO. No additional
substantive permission, cost, risk, control or scope change. These are local
comparisons plus OWNER_ATTESTED facts, not live SDK/Provider verification.
Independent confirmation is in fresh-v2 artifacts/
`OWNER_HUMAN_CONFIRMATION_PENDING_WINDOW_SAFE.json`; frozen files unchanged.
Proposed UTC 2026-10-14T08:01:28Z to 2026-10-14T08:31:28Z is PENDING explicit
owner approval; effective authorization fields remain null. Sole next action:
approve that exact window, then record formal authorization and STOP for fresh
independent GO. No effective authorization/preflight/Claim/GO or live requests;
no tests rerun. USD0, soft40/650/PARTIAL, Catalog ACTIVE, full GROUP_1 BLOCKED,
GROUP_2/3/Public Beta NOT_AUTHORIZED unchanged. Old v1 remains consumed.

### Fresh-v2 formal authorization recorded; waiting independent GO

Owner explicitly approved UTC 2026-10-14T08:01:28Z to 2026-10-14T08:31:28Z,
unchanged frozen contract/hashes and all six gates, with full-window attendance.
At local UTC 2026-10-14T08:03:18Z,202 frozen files/Packet/template matched and
the original authorization validator passed exact schema, gates and >610s
remaining coverage. Expected GO constant was used only for validator consistency;
no actual GO was received/issued. No execution entry/preflight/Claim invoked.
Independent fresh-v2 artifacts/AUTHORIZATION_APPROVED.json SHA256:
`b03d0146e3b18ea24e8096888bc66e6bcbb88f925dec028112138bc0f5430d6e`.
Separate AUTHORIZATION_RECORD_SAFE.json preserves verification and owner source.
Frozen files, pending confirmation record and consumed v1 remain unchanged.
Sole next action: owner sends `GO_E_VERIFY_NATIVE_CHROME_ISOLATED_MANUAL_FRESH_V2`;
fresh execution checks still required, no automatic window extension or retry.
After launch owner must promptly click Start once and truthfully complete widget
observations/Finish, or Stop on uncertainty. SDK live behavior still UNVERIFIED.
No tests rerun; Production requests/writes0, third-party live0. USD0, PARTIAL
soft40/650, Catalog ACTIVE, full GROUP_1 BLOCKED, GROUP_2/3/Public Beta unapproved.

### Fresh-v2 GO consumed: native SDK/render/frame reached, manual abort

Owner sent exact `GO_E_VERIFY_NATIVE_CHROME_ISOLATED_MANUAL_FRESH_V2`.
Local202-file/binding/template/approved-file SHA and >610s window checks PASS,
then exactly one frozen run-manual entry. Fresh-v2 authorization/preflight/Claim
are CONSUMED; no replay or retry. NATIVE_FINAL_SAFE.json outcome BLOCKED,
cleanup PASS, native containment closed and owned temp profile removed.
NATIVE_SAFE.json stopReason HUMAN_ABORT, sdkLoaded/renderStarted/renderReturned
true, observedFrames1, callback false; owner visibility/interaction null and
ownerFinished false. Native SDK loading and render/frame were observed LIVE
with official TEST Sitekey; callback/completion and Production CAPTCHA remain
UNVERIFIED. Observed supplier response codes302,200,200; one native redirect.
Observed target requests4, vendor requests3 (NOT all-browser wire dispatch counts).
pageErrorCount0, credentialsUsed=false, rawTokensOrUrlsPersisted=false.
Supervisor elapsed14707ms, EXIT_ZERO/reaped/native Job closed/receipt written;
EXIT_ZERO is receipt delivery, NOT diagnostic PASS. Profile absence separately
verified after completion. Unobserved native browser/OS traffic remains UNKNOWN.
Receipts: tools/e-verify-native-manual-fresh-v2/artifacts/NATIVE_FINAL_SAFE.json,
NATIVE_SAFE.json, NATIVE_SUPERVISOR_SAFE.json. Old v1 remains unchanged.
Sole next action: owner describes non-sensitive widget/page status before Stop
and reason for stopping; do not invent a callback failure cause or start another
instance. No automatic new authorization/GO. Production requests/writes0, USD0,
Catalog ACTIVE, full GROUP_1 BLOCKED, GROUP_2/3/Public Beta NOT_AUTHORIZED.

### Fresh-v2 owner observation: browser unsupported during challenge

Owner reported Cloudflare anti-bot UI showed browser unsupported. This is
OWNER_OBSERVED, not a preserved SDK error-code event. Combined with reached SDK/
render/frame and HUMAN_ABORT receipt, the current blocker is challenge browser
compatibility, not missing Start, SDK transport or absent static resources.
Exact vendor error code and underlying reason remain UNKNOWN. Frozen QA context
blocks Service Workers and removes Worker/SharedWorker/EventSource/RTC/WebTransport
APIs; these are possible compatibility constraints, NOT a proven vendor cause.
No safety settings changed, no rerun/new live authorization or request issued.
Next minimal evidence: any already-observed non-sensitive vendor error code or
exact wording, if owner remembers; do not reopen test merely to collect it.
Then assess only relevant local QA compatibility constraints before considering
any separately approved control change. Fresh-v2 remains consumed, cleanup PASS,
USD0/Catalog ACTIVE/full GROUP_1 BLOCKED/GROUP_2/3/Public Beta unapproved.

### Fresh-v2 precise owner observation and offline capability review

OWNER_OBSERVED: CLOUDFLARE_CHALLENGE_FRAME_VISIBLE=true; unsupported message
location=CLOUDFLARE_CHALLENGE_FRAME; message="browser unsupported"; exact error
code UNKNOWN; SUCCESS_CALLBACK_OBSERVED=false. Owner did not record/remember
any code or additional wording; never infer it. This is not a QA/product message.

New scoped offline Chrome capability checks8/8 PASS;27/123/43/history not rerun.
Proof: frozen initScript removes/locks six APIs including Worker/SharedWorker in
main AND cross-origin iframe. Native baseline has Workers; Worker-only LOCAL
experiment executes child Worker while other five removals remain. Main harness
worker-src:none independently blocks main Worker, not a separately served frame.
Local Worker fetch WAS intercepted (XHR, registered frame) and NativeScope
classified VENDOR_WIDGET_FLOW. Initial assumed bypass assertion was falsified;
its original safe receipts retained, not hidden. Current worker-target exclusion
is a supervision limitation, NOT proof every Worker request bypasses parent Fetch.
Service Worker remains blocked; no evidence it is required by this vendor.

Vendor ROOT_CAUSE=UNKNOWN; WORKER_COMPATIBILITY=POSSIBLE, not a proven vendor
defect or fix. Actual vendor content not replayed/executed. Tests headless and
loopback only; rejecting proxy/no non-loopback DNS/no forwarding/Node guard,
native Job drained and owned-profile removal confirmed. Source includes current
launch flags and isolation; no fingerprint spoofing or automation evasion applied.

Candidate NOT applied: restore only Dedicated Worker in verified vendor frame,
but FIRST prove owner/target chain, paused-before-run worker supervision and
worker/nested-channel request/credential/cleanup controls. Existing frame gate
alone is not comprehensive proof. Other controls/soft40/650/USD0 unchanged.
Security boundary change needs independent approval. Review and offline evidence:
`tools/e-verify-native-compatibility-review/COMPATIBILITY_DECISION_PENDING_APPROVAL.md`;
`artifacts/offline-1791965741491/CAPABILITIES_SAFE.json` and SUPERVISOR_SAFE.json.
Only next decision: approve/reject this bounded OFFLINE candidate engineering,
not live access. No new authorization/Claim/GO, no Production/third-party live
requests; old v1/fresh-v2 files intact/consumed. Catalog ACTIVE, full GROUP_1
BLOCKED, GROUP_2/3/Public Beta NOT_AUTHORIZED.

### Dedicated Worker minimal offline route: explicit feasibility exit

Owner conditionally approved OFFLINE Worker compatibility engineering only.
Reused existing8/8 capability results; new focused supervision checks5/5 PASS
as measurement tests, with safety feasibility outcome BLOCKED, not a live fix.
Evidence: tools/e-verify-native-compatibility-review/artifacts/
worker-feasibility-1791966406351/WORKER_FEASIBILITY_SAFE.json and SUPERVISOR_SAFE.json.
Actual Chrome Worker target waitingForDebugger=true and body execution0, never
resumed. Owner Frame proof false; initial local Worker script GET1 without
registered-frame admission proof. Worker-target Fetch.enable returned
CDP_METHOD_NOT_AVAILABLE. Therefore current minimal CDP route cannot establish
required worker identity/pre-dispatch containment. No claim all possible browser
architectures are impossible; STOP rather than add proxy/Worker-engine complexity.
Profile removed, native Job closed/child reaped; no vendor SDK or live request.

Worker ROOT_CAUSE remains UNKNOWN; local constructor capability is demonstrated,
but vendor browser-unsupported cause/compatibility still UNVERIFIED. No removal
of live protections, no new live Packet/authorization/Claim/UTC/GO, consumed
v1/fresh-v2 and frozen files remain intact.
Decision: tools/e-verify-native-compatibility-review/WORKER_FEASIBILITY_DECISION.md.
Sole proposed alternative is STANDARD_NATIVE_MANUAL_ALTERNATIVE_NOT_AUTHORIZED.md:
standard-capability clean Chrome manual Layer1, explicit MONITOR_ONLY Worker/
third-party coverage, no claimed hard unknown-origin or40/650 enforcement.
Material change NOT covered by existing approval; owner must accept/reject that
boundary before further implementation or any independently authorized live run.
If hard Worker unknown-origin denial remains mandatory, alternative stays BLOCKED.
USD0/Catalog ACTIVE/full GROUP_1 BLOCKED/GROUP_2/3/Public Beta NOT_AUTHORIZED;
Production requests/writes0, third-party live0, no deployment/push.
