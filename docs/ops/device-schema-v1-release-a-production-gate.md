# Device Schema v1 Release A production gate

This gate evaluates recorded evidence only. It does not open a database
connection, invoke a command-line database tool, apply a migration, or change
any provider state. A successful result is an authorization decision for a
human-controlled next step; it is not an apply operation.

## Offline input contract

`assertReleaseAProductionGate(input)` is exported by
`scripts/qa/test-device-schema-v1-release-a-gate.mjs`. It accepts exactly the
following value-blind evidence shape:

```js
{
  localMigrationTests: {
    status: "PASS",
    migrationSha256: "a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215"
  },
  candidate: { clean: true },
  migrationSha256: "a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215",
  productionSchemaPrecheck: {
    status: "PASS",
    observedMigrationSha256: "a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215"
  },
  authorization: {
    authorizationId: "release-a-approval-001",
    authorizedAt: "2026-09-13T00:00:00.000Z"
  }
}
```

The SHA-256 is the accepted local migration fingerprint recorded with the
Schema v1 recovery receipt. The precheck is only a recorded, exact comparison
of the observed Production schema migration fingerprint; collecting that
evidence is deliberately outside this script.

## Results and safety rules

Without an explicit, well-formed Release A authorization, the evaluator
returns `{ allowed: false, missing: ["RELEASE_A_PRODUCTION_AUTHORIZATION_REQUIRED"] }`
when all other evidence is complete. Missing evidence is reported using fixed
identifiers only:

- `LOCAL_MIGRATION_TESTS_REQUIRED`
- `CLEAN_CANDIDATE_REQUIRED`
- `MIGRATION_FINGERPRINT_REQUIRED`
- `EXACT_PRODUCTION_SCHEMA_PRECHECK_REQUIRED`
- `RELEASE_A_PRODUCTION_AUTHORIZATION_REQUIRED`

The evaluator rejects unknown fields, secret-bearing keys, DSNs, credentialed
HTTP URLs, private-key material, and token-shaped values before evaluating the
gate. It never echoes supplied values. A valid authorization identifier has
the bounded form `release-a-approval-<at least three digits>` and includes a
valid UTC timestamp.

Run the local evaluator with:

```powershell
node scripts/qa/test-device-schema-v1-release-a-gate.mjs
```

Accepted dependency baseline remains unchanged: 5 HIGH findings, runtime
reachable 0, upstream-blocked. The existing definition-seed and release
migration-version baseline blockers are documented in the Task 15 report and
are neither remediated nor hidden by this gate.
