# R6 V4 DryRun Orchestration State Machine

`r6-v4-dry-run-terminal-result-v4` is the source of truth for DryRun lifecycle
state. `r6-v4-capture-authcheck-dryrun-orchestration-terminal-result-v4` copies
the verified fields below only after the DryRun terminal passes its validator.
The wrapper never reconstructs lifecycle state from exception text.

| Lifecycle transition | DryRun writer fields | Orchestration mirror fields | Required invariant |
| --- | --- | --- | --- |
| Before DryRun | `reservationAttempted=false`, `receiptState=NOT_CREATED_OR_UNCONFIRMED` | matching `dryRun*` values | no receipt, executor, journal, or final authorization |
| Target resolution failure | target diagnostics populated, reservation fields false | matching diagnostics and lifecycle | target binding absent |
| Reservation attempted | `reservationAttempted=true` | `dryRunReservationAttempted=true` | executor is false |
| Reservation completed | `reservationCompleted=true`, `receiptCreated=true`, `receiptState=PENDING` | matching receipt fields | runner commit is present |
| Pre-tooling failure | receipt remains `PENDING`, tooling commit absent | matching receipt and tooling fields | executor and mutation counts remain zero |
| Child launch | `childStarted`, `canaryChildStarted`, `childCompleted` | matching `dryRunExecutor*` fields | receipt and tooling commits are present |
| DryRun success or failure | counts, journal, and authorization fields complete | matching counts and lifecycle fields | DryRun mutation, Supabase write, journal, and final authorization counts remain zero |

The v4 validators reject impossible orderings. In particular, an orchestration
terminal cannot claim a completed receipt without an attempted reservation, a
child cannot start before a pending receipt, and an unstarted DryRun cannot
carry receipt or executor state. Historic v1-v3 artifacts remain readable by
their existing schemas; v4 is used for newly generated artifacts.

The local fixture suite covers the success path plus auth failure, target
failure, reservation failure, pre-tooling failure, post-reservation failure,
target-binding tamper rejection, stale attestation, and malformed terminal
branches. Fixtures use test-mode synthetic inputs only.
