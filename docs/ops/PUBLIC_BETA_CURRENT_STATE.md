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
| GROUP_1 live authorization | READY_FOR_OWNER_APPROVAL / NOT_AUTHORIZED | 14/14 billing-eligible; only subset approval, five gates and real UTC validity pending; separate GO mandatory |
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
were copied into ordinary artifacts. No approved file, Claim or GO has been created.

## Exact Subset Approval Boundary After Proof

Original E_VERIFY has two authorization boundaries. Independent GROUP_1 requires
explicit Boundary 2 subset approval; it is not already granted by engineering PASS.
Retain all 50 cases and partial AUTH-08/ADMIN-04/UI obligations. Five exact gates,
currently UNCONFIRMED, from `Q/group1/artifacts/HUMAN_GROUP1_SUBSET_AUTHORIZATION_NOT_AUTHORIZED.md`:

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

No times or gates are filled here. Retain <=60-minute approval validity, 1800-second
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

Current single release gate: owner approval of the exact new Boundary 2 subset
addendum, the five pending humanGates and actual UTC validity (no repeated billing
confirmation). Next owner action: approve the linked complete template with real
times and five confirmations in one message, then issue GO separately after approval
is recorded. Billing eligibility is closed; live execution and RLS are still unverified.
GROUP_2/3 remain open and require separate scope/control/zero-cost resolution.
This update made zero Production requests/writes and reran zero release/QA tests.
Future updates must record only new completed work, genuine issues, the current
blocker, minimal next action and owner actions here; never create a competing baseline.
