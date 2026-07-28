# Task-Scoped Normalized Replay

The reconciliation gates require exactly one disposable normalized-replay database for the current test task. They do not require global uniqueness across every historical Docker Compose project on the host.

`OPENGLASS_NORMALIZED_REPLAY_TASK_ID` is mandatory for the two replay-backed reconciliation gates. The accepted value is a fresh `r6-final-contract-<uuid>` identifier. Discovery fails closed unless Docker context is `desktop-linux` and exactly one container has all of these labels:

- `io.openglasshub.replay.project=openglasshub`
- `io.openglasshub.replay.role=normalized-replay`
- `io.openglasshub.replay.task-id=<task-id>`
- `io.openglasshub.replay.disposable=true`
- `io.openglasshub.replay.contract-version=openglass-normalized-replay-task-v1`

The helper counts all container states before requiring the selected task container to be running. Name prefixes, creation order, and unrelated Compose labels are not identity proof. A missing, duplicate, non-disposable, unsupported-version, wrong-role, or non-local-context target fails closed.

`scripts/qa/create-task-scoped-normalized-replay.mjs` uses the offline cached Supabase CLI and its `db reset --local` path to initialize the BOM-safe 43-migration mirror. It clones only that short-lived bootstrap database volume into a separate, labelled disposable task volume, then removes the bootstrap stack. The resulting task container has an isolated network and volume; it does not attach to, read, start, stop, or remove any pre-existing Compose resource.

After gates finish, `scripts/qa/cleanup-task-scoped-normalized-replay.mjs --task-id <task-id>` removes only the exact labelled task container, its exact labelled volume, and its exact labelled network. It has no prune path.
