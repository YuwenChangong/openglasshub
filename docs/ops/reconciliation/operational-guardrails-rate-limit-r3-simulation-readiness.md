# W6 R3 Disposable Simulation Readiness

Status: `R3_PASSED_LOCAL_DISPOSABLE_ONLY`. The separately approved local
simulation completed with no external target. See
[the R3 local review](operational-guardrails-rate-limit-r3-local-simulation-review.md).

R2 now has approved V1 limits: upload bytes are 1..157286400, external-video
accepted bytes are at most 314572800 per shared IP in a database-clock rolling
24-hour window, V1 has no idempotency guarantee, and the timeouts are 1s lock,
3s statement, and 4s future runtime deadline. The function remains unexecuted.

R3 proved exact-threshold races, one-above-limit denial, shared-IP hourly and
24-hour atomicity, accepted reservation charging after later-work failure,
rollback on insert failure, lock release, user/IP isolation, narrow results,
execute denial for `PUBLIC`/`anon`/`authenticated`, and successful execution
only through the reviewed server role. It used neither Preview, Production, a
deployed secret, nor a production export. The next approval is R4 repository-
only fail-closed runtime migration design; R3 does not unblock Stage C.
