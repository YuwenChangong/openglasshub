# W6 Rate-Limit Concurrency Decision

## Comparison

| Design | Concurrent correctness | Current-table fit | Migration need | Decision |
| --- | --- | --- | --- | --- |
| Count then insert without a lock | Two callers can both observe capacity and insert. | Existing behavior. | None. | Rejected. |
| Insert then count | Can record an above-limit attempt and needs compensating cleanup. | Poor audit semantics. | None. | Rejected. |
| Row-level lock | There is no stable per-scope row when the bucket is empty. | Needs a bucket row/table. | Yes. | Not selected. |
| Counter/bucket row | Can be atomic with a uniqueness constraint. | Requires new relation, retention, and recovery policy. | Yes. | Deferred. |
| Unique/exclusion serialization | Does not express a rolling quota by itself. | Needs new constraints or time buckets. | Yes. | Rejected for this scope. |
| Transaction-scoped advisory lock, then count and insert | Serializes each fixed quota scope; accepted attempt and decision share one transaction. | Uses the current attempt table and its two exact purpose/scope/time indexes. | No table-shape migration. | Selected for R2 proposal review. |

## Selected design

The future function takes a transaction-scoped advisory lock before reading
attempts. Its lock key is server-derived from a fixed scope, never caller
selected: `user:<purpose>:<uuid>` for create purposes and
`upload-ip:<sha256>` for the shared upload group. A hash collision may add
unrelated serialization but cannot allow a quota bypass; it is availability
cost only. There is one lock per invocation, so there is no multi-lock ordering
or deadlock cycle. After the lock, the function counts the fixed scope using
the existing `(purpose, user_id, created_at DESC)` or `(purpose, ip_hash,
created_at DESC)` index and inserts only when below its fixed maximum.

The transaction automatically releases the advisory lock on return, error, or
rollback. Errors, timeout, lock cancellation, or an unexpected result cause the
route to reject. No cleanup query, broad deletion, counter reset, dynamic SQL,
or caller-chosen table/column is involved.

The selected design is compatible with the observed table and indexes, but R2
must still choose and test a finite lock-wait/statement-timeout value. The
existing schema does not provide a source-backed number, so this record does
not invent one. R3 must prove exact-threshold races, one-above-threshold
behavior, rollback, and no cross-user or cross-IP leakage in a disposable
database.
