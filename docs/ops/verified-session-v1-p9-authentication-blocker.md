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

AUTH_A_READY=false
NEXT_DIAGNOSTIC_AUTHORIZATION_REQUIRED=true

The most practical next discriminator is one freshly authorized Session
Pooler reconnect against the Dashboard-confirmed target, after verifying the
effective child environment is free of inherited libpq overrides. Scope it
to one connection, at most one constant `SELECT 1`, zero writes, zero retries,
and no AUTH-A dispatch. A reviewed one-shot probe mechanism and a new human
authorization are prerequisites; this document supplies neither. A success
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
