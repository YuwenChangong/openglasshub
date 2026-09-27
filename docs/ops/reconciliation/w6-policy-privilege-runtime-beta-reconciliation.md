# W6 Policy, Privilege, and Runtime Beta Reconciliation

Status: `REPOSITORY_ONLY_PUBLIC_BETA_RUNTIME_GATE`. This record authorizes no
Production action. R6P's single-use sealed recovery classified the R6-5
rate-limit RPC mutation `COMMITTED_EXACTLY` and closed R6-6 SQL catalog
recovery. Its authorization is consumed; R6-5 must never be replayed.

The two purpose-leading indexes are applied and postflight-verified, so
`W6_INDEX_PENDING_COUNT=0`. Technical reconciliation still has two objects:
`forum_upload_attempts_insert_self` and `forum_upload_attempts_select_self`.
Both policies are permissive and apply to `authenticated`. The insert policy
is narrower than the canonical `forum_upload_attempts_insert_authenticated`
`WITH CHECK (user_id = auth.uid() OR user_id IS NULL)`. The select policy is
narrower than the canonical `forum_upload_attempts_select_authenticated`
`USING true`. Permissive policies combine with OR, so retaining either extra
policy adds no capability beyond its canonical policy in the reviewed catalog.
RLS is enabled. The reviewed catalog reports no effective table SELECT or
INSERT privilege for `PUBLIC`, `anon`, `authenticated`, or `service_role`;
`postgres` has both. RLS policies alone do not grant table access.

Current `src` has zero direct `forum_upload_attempts` references and exactly
one `consume_forum_rate_limit` reference, inside the server-only wrapper.
There are no browser table or RPC callers. All five protected forum operations
use `rate-limit.ts` with fixed purposes and server-derived actor, IP hash, and
byte inputs. The wrapper creates its own service-role client, invokes one
fixed-name RPC with `p_user_id`, `p_ip_hash`, `p_purpose`, and `p_bytes`, and
accepts only an exact single-row `ALLOWED` result. `RATE_LIMITED` maps to 429;
configuration, transport, RPC, malformed-result, and timeout failures deny the
protected action. The deadline is 4,000 ms, with zero automatic retries and no
direct-table fallback. The exact seven direct service-role consumers are
individually reviewed by the source-inventory contract; all seven have zero
privileged-surface scanner findings. The scanner now distinguishes `Array.from`
from dynamic client table calls, and the login-challenge client invokes only
literal `ogh_reserve_login_challenge`, `ogh_finalize_login_delivery`, and
`ogh_consume_login_challenge` RPC names.

The focused scanner, service-role scope, R4 runtime, login-challenge, resend,
signup, logout, and verified-session tests pass offline. These tests do not
prove the current R4 runtime is deployed in Production. The historical direct
table path failed open on storage errors; current repository source is
fail-closed. Because Production deployment and runtime behavior have not been
verified, `R6_RUNTIME_DEPLOYMENT_BETA_GATE=P1_REQUIRED_BEFORE_BETA` for the
protected forum and upload/quota paths, including the zero-paid-infra boundary.
The next Production release gate is a separately approved deployment of the
reviewed fail-closed runtime, exact target/commit and server-only binding
verification, low-volume runtime smoke/canary, and residue/direct-access
postflight. No part of that sequence is authorized here.

Both policies are `SAFE_TO_RETAIN_DURING_BETA`:
`TECHNICAL_RECONCILIATION_PENDING=2`, but
`PUBLIC_BETA_BLOCKING_POLICY_OBJECTS=0`. Policy cleanup is not required merely
to open Beta. Retain both through Beta unless a separately reviewed post-runtime
Stage C cleanup is authorized. `R7_STAGE_C_ALLOWED=false`; Stage C still needs
runtime/canary/residue proof and separate approval. Production remains `NO_GO`
pending the runtime gate and independent global release blockers. No provider,
Production, deployment, SQL, or migration action occurred in this reconciliation.
