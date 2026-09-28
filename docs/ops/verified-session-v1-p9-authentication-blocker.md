# Verified Session v1 AUTH-A database authentication blocker

STATUS=BLOCKED_BEFORE_DATABASE_INVENTORY
AUTH_RELEASE_STATUS=NO_GO
PRODUCTION_CONNECTIONS_IN_THIS_OFFLINE_REVIEW=0
PRODUCTION_WRITES_IN_THIS_OFFLINE_REVIEW=0

This record contains only bounded, user-supplied evidence and offline code
review. It is not an authorization or a new Production observation.

User-reported permanently consumed, non-reusable IDs (nonexhaustive; only
the first two AUTH-A attempts have separate checked-in notes):

- `auth-a-verified-session-1790506675`
- `auth-a-verified-session-1790508308`
- `auth-a-verified-session-1790509367`
- `auth-a-verified-session-1790509805`
- `auth-a-verified-session-1790510207`
- `auth-a-verified-session-1790510443`
- `p9-direct-credential-probe-1790510582`
- `p9-session-pooler-probe-1790550656`
- `p9-session-pooler-probe-1790551659`
- `p9-session-pooler-probe-1790552145`
- `p9-session-pooler-postfix-1790556477646`
- `p9-session-pooler-dns-1790559620976`

## Consumed probe

PROBE_ID=p9-session-pooler-probe-1790552145
AUTHORIZATION_CONSUMED=true
REUSABLE=false
TARGET_HOST=aws-1-ap-northeast-1.pooler.supabase.com
TARGET_PORT=5432
TARGET_DATABASE=postgres
TARGET_USER=postgres.xcbnxzjlsvtgzixurcof
TARGET_PROJECT=xcbnxzjlsvtgzixurcof
TARGET_REGION=ap-northeast-1
TARGET_BINDING=true
TARGET_BINDING_SCOPE=VALIDATED_DSN_NOT_EFFECTIVE_NETWORK_DESTINATION
PASSWORD_SOURCE_EQUIVALENCE=PASS
SUPAVISOR_QUIET_PERIOD_SECONDS=300
PRODUCTION_CONNECTION_ATTEMPTS=1
MAX_SQL_STATEMENTS=1
SQL_PAYLOAD=SELECT_1_ONLY
SQL_EXECUTED=false
PSQL_EXIT_CODE=2
RESULT_CLASS=AUTHENTICATION_FAILED
PRODUCTION_WRITES=0
RETRIES=0

The user supplied these exact Supavisor UTC log events for the same attempt:

- `2026-09-27T23:39:08.578837Z`: `SecretChecker not started, using a one-off auth_query connection`
- `2026-09-27T23:39:08.595064Z`: `ClientHandler: Exchange error: password authentication failed for user "postgres"`

PASSWORD_RESET_UTC=UNKNOWN
PROBE_START_UTC=UNKNOWN
PROBE_END_UTC=UNKNOWN

The password reset was manually confirmed successful in the Dashboard, but
its UTC time was not captured. The 300-second quiet period is not proof of a
300-second reset-to-attempt interval. The direct database endpoint could not
be resolved or reached from the current network; that diagnostic says nothing
about whether the password works on a direct connection. The Supavisor events
support the reported project association, but the earlier client's effective
network destination was not independently proven.

## Offline findings

### Consumed post-fix DNS-stage probe

The operator reports the following one-shot outcome. This offline audit did
not repeat the attempt or independently observe its runtime.

```text
PROBE_ID=p9-session-pooler-postfix-1790556477646
AUTHORIZATION_CONSUMED=true
REUSABLE=false
RESULT_CLASS=DNS_RESOLUTION_BLOCKED
PRODUCTION_CONNECTION_ATTEMPTS=0
SQL_EXECUTED=false
PRODUCTION_WRITES=0
RETRIES=0
PROCESS_EXIT=1
```

No psql dispatch or database connection was reported. This is not a Supabase
authentication failure and adds no password or Supavisor evidence. Never
reuse this ID. Its original generic receipt cannot distinguish a resolver
error, timeout, empty/malformed answer, or rejected first address.

The DNS stage now emits allowlisted error/address classifications, without
raw error messages or addresses. Synthetic tests prove distinct timeout,
ENOTFOUND, ENODATA, SERVFAIL, REFUSED, configuration and generic-error paths,
empty/malformed results, rejected private/loopback/reserved/invalid addresses,
and first-address-only selection. The address validator previously accepted
documentation-only IPv4 ranges; that local safety defect is fixed, but no
evidence links it to this consumed probe's failure.

The former production resolver used `new Resolver().resolve4()`. Node's
`lookup({ family: 4 })` uses OS
getaddrinfo facilities, whereas resolve4 uses DNS directly through c-ares;
an independent Resolver starts with default server settings. Global
resolve4 is the same direct-DNS API family, not an OS-backed substitute.
Windows OS policy/cache/hosts behavior can therefore differ. libpq uses
hostname resolution when hostaddr is absent; the pinned numeric hostaddr in
this probe deliberately bypasses that later lookup.

### Consumed DNS-only discriminator and offline correction

The operator reports consumed diagnostic `p9-session-pooler-dns-1790559620976`:
resolve4 BLOCKED / OTHER_RESOLVER_ERROR / 192 ms / UNKNOWN count; OS IPv4 lookup
PASS / SUCCESS_MULTIPLE_IPV4 / 205 ms / count 3. Set/count comparison was
UNKNOWN, exit code 1, retries 0, with zero DB connections, psql and writes.
This task does not repeat or independently observe that runtime. Never reuse
the ID. The differential outcome demonstrates local resolve4-path
incompatibility sufficiently to justify an offline mechanism correction;
the internal c-ares error cause remains UNKNOWN, and database authentication
after correction remains UNPROVEN.

The database probe now uses one canonical OS lookup with
`{ family: 4, all: true, verbatim: true }`, not a fallback chain. It preserves
returned order and inspects only the first result for selection. Unsafe or
malformed first results BLOCK even if a later address is public. One address
only can reach PGHOSTADDR; PGHOST retains the fixed hostname, verify-full and
system CA roots remain enabled, and reviewed GSS behavior is unchanged.

`scripts/lib/p9-bounded-os-lookup.mjs` derives child isolation from the reviewed
DNS-only runner without launching it or changing its authorization. It has
no credential loading or independent DNS launcher/entrypoint. The probe alone
launches its frozen Node worker source, after consuming its existing gate.
The child inherits no credentials or NODE_OPTIONS. It returns only first
record metadata and a count through a private, capped pipe; raw errors never
leave it. The parent preserves the existing address safety classifications.

The local runtime is Node v24.14.1. Its inspected built-in promises.lookup
implementation delegates to GetAddrInfoReqWrap/getaddrinfo and exposes no
Resolver.cancel equivalent or AbortSignal control. The application deadline
is 5000 ms; the parent requests SIGKILL and the child also self-exits on its
own timer. No psql or final receipt is permitted until authoritative child
close. After 500 ms without confirmed closure, the pending failure class
becomes DNS_TERMINATION_UNCONFIRMED, but the parent keeps waiting rather than
emitting a receipt while its DNS child may still be active. If OS termination
fails, final completion has no provable hard wall-clock bound and requires
operator intervention. This is explicit, not a claim of hard cancellation.
Shared OS resolver-service retransmissions/wire packets are also not under
Node cancellation control; no additional application lookup is issued.

References reviewed for Node v24 and PostgreSQL 17:

- https://nodejs.org/docs/latest-v24.x/api/dns.html
- https://www.postgresql.org/docs/17/libpq-connect.html

The DNS-only discriminator above is consumed. The next action is to obtain
a fresh human authorization for the corrected one-shot database probe only
after offline tests/review/pinning pass. No authorization is granted here.

The P9 transport previously inherited `PG*` libpq variables from its parent
process. A synthetic test showed that `PGHOSTADDR` could reach the `psql`
child alongside the validated `PGHOST`; libpq may use `hostaddr` as the actual
network destination. The transport now removes inherited `PG*` entries before
adding the six validated connection variables. Synthetic tests also prove
one URI decode into `PGPASSWORD`. No evidence shows that `PGHOSTADDR` was
present during the consumed probe, so this local defect is not assigned as
its cause. The reviewed AUTH-A entrypoint reads `process.env`; it does not
load `.codex/.env` itself. The external file-to-process handoff was reported
as equivalent but was not repeated or credential-inspected in this review.

Supabase's current connection guide documents the shared Session Pooler on
port 5432 with `postgres.[PROJECT-REF]`, the shared Transaction Pooler on
6543, and the direct endpoint on 5432 over IPv6 by default. It says to copy
the pooler hostname from the Dashboard's Connect panel rather than derive
it from the region. Reserved password characters in a URI must be encoded.
Supabase also documents a transient shared-pooler credential cache after
password rotation, including for SCRAM and the built-in `postgres` role. A
reconnect can trigger refresh after an idle period. These documents do not
establish why this particular authentication failed or that its one-off
`auth_query` completed successfully. No customer repair procedure for the
`SecretChecker` log line was found.

Official references:

- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/troubleshooting/supavisor-error-password-authentication-failed-after-password-rotation
- https://supabase.com/docs/guides/troubleshooting/fatal-password-authentication-failed
- https://supabase.com/docs/guides/troubleshooting/how-do-i-reset-my-supabase-database-password-oTs5sB
- https://www.postgresql.org/docs/current/libpq-connect.html

ROOT_CAUSE_STATUS=NARROWED
ROOT_CAUSE=SESSION_POOLER_SCRAM_AUTHENTICATION_REJECTED_SPECIFIC_CAUSE_UNKNOWN

## Next bounded decision

### Dedicated DNS-only runner (historical implementation contract)

Its latest operator-reported execution is recorded above as consumed. The
implementation task itself did not execute it; no repeat is authorized here.

The new `scripts/qa/p9-dns-only-diagnostic.mjs` is separate from the database
probe and credential handoff. Its gate and worker sources are byte-pinned in
`docs/ops/verified-session-v1-p9-dns-only-review.json` with canonical LF rules.
Offline synthetic verification and independent review are prerequisites to
publishing a fresh authorization candidate. Neither implementation nor a
candidate constitutes approval to execute it.

The consumed database probe `p9-session-pooler-postfix-1790556477646` and stale
design candidate `p9-session-pooler-dns-1790557464040` must not be reused.
Require a new ID, strict millisecond UTC timestamp, final source HEAD, runner
hash and manifest hash. Authorization expires after 900 seconds, allows at
most 30 seconds of future skew, and binds the exact feature branch and clean
worktree. Unknown fields and all alternate target/override settings block.

For a separately authorized future run, the entrypoint is
`node scripts/qa/p9-dns-only-diagnostic.mjs` with the complete authorization
as a JSON object on standard input (all values are strings). It accepts no
CLI arguments, environment authorization, credential input or config file.
Do not run it as part of implementation/testing. Git observation uses the
fixed system Git binary with bounded commands; an unavailable binary blocks.
The repository-scoped `ogh-p9-dns-only-consumed/<DIAGNOSTIC_ID>` sentinel is
atomically created under the Git common directory before first dispatch.
Deleting a sentinel is forbidden; consumed IDs are permanently non-reusable.

Each method runs in a separate Node child with no inherited environment,
except fixed Windows system-directory entries where needed. Each worker also
re-observes the repository, validates the complete authorization, and requires
the parent consumption marker before atomically claiming its own method slot.
The marker binds the complete authorization digest and the consuming parent's
PID, checked against the worker's OS-reported parent PID. A different parent
or retimed/rebound authorization cannot use an old consumption marker.
An IPC parent alone cannot authorize a resolver call. Each slot is permanently
one-use, including across new processes. Method 2 additionally requires a
parent marker recording confirmed closure of method 1. Direct invocation
without IPC or complete valid authorization is rejected. Git global/system
configuration is disabled during observation. Method 1 is
`new dns.promises.Resolver().resolve4()`; method 2 is OS-backed IPv4-only
`dns.promises.lookup(..., { family: 4, all: true })`. Both receive only the
frozen hostname. There is no retry, public DNS override or database access.
Continuing after an ordinary first-method failure is explicitly within the
two-method authorization. Unconfirmed child termination instead blocks the
second method. Each parent deadline is 5000 ms, with at most 500 ms to confirm
termination. Workers also have a self-exit deadline. The entrypoint has a
24000 ms overall deadline including bounded authorization input and Git
preflight. These are application bounds, not DNS wire-packet guarantees:
configured resolvers, OS caches and API-internal retransmission remain possible.

Raw results stay in memory and the private parent pipe, capped at 128 entries
and 8192 bytes. Raw errors never cross that pipe. Standard output contains
only method status/class/duration/count, address-set/count equality and zero
retries. Skipped methods are BLOCKED with OTHER_RESOLVER_ERROR, zero duration
and UNKNOWN count; they are not evidence of an attempted DNS call. Counts are
validated raw result counts; address-set equality ignores duplicate addresses
and order. Private, loopback and reserved/documentation results are blocked.
Any method failure makes both comparisons UNKNOWN. No raw address or resolver
configuration is printed or persisted. AUTH_A_READY remains false.

AUTH_A_READY=false
NEXT_DIAGNOSTIC_AUTHORIZATION_REQUIRED=true

Before any new database connection, require new approval bound to the
corrected OS-lookup implementation, current HEAD and current manifest hashes.
One freshly authorized Session
Pooler reconnect against the Dashboard-confirmed target, after verifying the
effective child environment is free of inherited libpq overrides. Scope it
to one connection, at most one constant `SELECT 1`, zero writes, zero retries,
and no AUTH-A dispatch. A reviewed one-shot probe mechanism and a new human
authorization are prerequisites; this document supplies neither. The probe
implementation and its source/binary pinning manifest are present for offline
review in this worktree. The operator reports one consumed post-fix probe
authorization that stopped at DNS, with zero database connections.
The future probe performs one OS IPv4 lookup of the fixed host after consuming authorization,
selects one numeric address as a reviewed `PGHOSTADDR`, and launches one
`psql`/libpq connect invocation. It does not fall through to additional DNS
addresses. The effective child `PGHOST` remains the fixed Session Pooler host.
The probe forces `verify-full` with system CA roots and disables GSS preference,
so a redirected address without a trusted certificate for that host blocks.
A success
supports, but does not prove, the documented pooler-cache explanation. If
authentication fails again, stop and escalate rather than repeating probes.
The previous direct-endpoint diagnostic is inconclusive, so direct IPv6 is
not a default next step on this network. No paid IPv4 workaround is allowed.

## Support handoff and recovery

If escalation is needed, send the probe ID, project ref, region, Session
Pooler host/port/user/database above, the two UTC Supavisor events, the
bounded client outcome, the Dashboard-confirmed password reset with its time
marked UNKNOWN, the 300-second quiet period, and the direct-endpoint
reachability limitation. Ask the operator or Supabase for the password-reset
event's exact UTC time; without it, the reset-to-failure interval is UNKNOWN.
Ask Supabase to determine whether the one-off `auth_query` returned the
current credential and why the SCRAM exchange failed. Do not send a password,
fingerprint, DSN, API token, private key, or raw client log.

When Supabase replies, record its explanation and exact UTC evidence, review
any proposed action against zero-paid-infra and zero-write constraints, and
require a new bounded authorization before any additional connection. After
database authentication is positively resolved, recheck the branch, HEAD,
clean worktree, transport and packet hashes, then request a fresh single-use
AUTH-A authorization. Even an AUTH-A PASS does not authorize AUTH-B: capacity
review and separate later authorization remain required.
