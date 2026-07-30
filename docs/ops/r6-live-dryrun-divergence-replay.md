# R6 Live DryRun Replay Contract

The retired `c49712bf` live DryRun recorded a valid capture, authenticated
check, canonical target binding, and `PENDING` receipt before returning
`R6_PREEXISTING_SECRET_ENV_DENIED`. The failure happened before the canary
child began, so it performed zero writes and created no journal or final
authorization.

| Stage | Live writer | Previous synthetic writer | Correct contract |
| --- | --- | --- | --- |
| Target resolution | `Resolve-DryRunCanonicalTarget` | Direct fixture binding | Resolver credentials exist only while its child process runs. |
| Reservation | `Reserve-ConsumedRun` | Direct state assignment | A `PENDING` receipt means reservation succeeded. |
| Child launch | `Invoke-DryRunRunner` | Direct completed state | Spawn a process, then read and validate its terminal. |
| Child result | Native exit plus terminal | In-memory success | Exit, terminal validity, and terminal success are independent checks. |
| Outer terminal | Validated DryRun terminal | Partial mirrored state | Preserve target, receipt, child, and mutation lifecycle fields on every path. |

The historical divergence was a resolver-scoped access token and anon key that
remained in the parent process. `Set-RunnerEnvironment` correctly rejects
preexisting secrets, but incorrectly saw those wrapper-owned values. The
resolver now clears its exact environment set in `finally`; preexisting values
remain fail-closed.

The replay fixture retains only schema, state order, value types,
classifications, and synthetic hash-compatible data. It contains no provider
response, target identity, credentials, session data, or original filesystem
identity.
