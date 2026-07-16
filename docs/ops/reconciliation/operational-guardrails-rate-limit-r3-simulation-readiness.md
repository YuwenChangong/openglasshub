# W6 R3 Disposable Simulation Readiness

Status: `ELIGIBLE_PENDING_SEPARATE_APPROVAL`. R3 has no approval yet and no
local database/container may be started for this proposal during R2 closure.

R2 now has approved V1 limits: upload bytes are 1..157286400, external-video
accepted bytes are at most 314572800 per shared IP in a database-clock rolling
24-hour window, V1 has no idempotency guarantee, and the timeouts are 1s lock,
3s statement, and 4s future runtime deadline. The function remains unexecuted.

After `APPROVE_R3_DISPOSABLE_LOCAL_DATABASE_BEHAVIOR_AND_CONCURRENCY_SIMULATION_ONLY`,
a disposable database-only simulation must prove exact-threshold races,
one-above-limit denial, shared-IP hourly and 24-hour atomicity, accepted
reservation charging after later-work failure, transaction rollback on insert
failure, lock release, user/IP isolation, no-row-result leakage, execute denial
for `PUBLIC`/`anon`/`authenticated`, and successful execution only through the
reviewed server role. It must not use Preview, Production, a deployed secret,
or any production export.
