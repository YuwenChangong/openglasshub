# W6 R3 Disposable Simulation Readiness

Status: `NOT_ELIGIBLE`. R3 has no approval and no local database/container may
be started for this proposal.

R3 is not eligible while the R2 purpose matrix contains
`HUMAN_DECISION_REQUIRED` for the generic `post_media_upload` byte ceiling and
the external-video daily cross-table quota. It also requires approved retry,
timeout, and production-owner decisions.

After those decisions and a separate R3 approval, a disposable database-only
simulation must prove exact-threshold races, one-above-limit denial,
transaction rollback on insert failure, lock release, user/IP isolation,
no-row-result leakage, execute denial for `PUBLIC`/`anon`/`authenticated`, and
successful execution only through the reviewed server role. It must not use
Preview, Production, a deployed secret, or any production export.
