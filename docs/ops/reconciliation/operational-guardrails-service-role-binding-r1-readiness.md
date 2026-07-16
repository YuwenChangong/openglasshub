# W6 R1 Service-Role Binding Readiness

| Environment | Classification | Reason and next action |
| --- | --- | --- |
| Local | `CONFIGURATION_REQUIRED` | `.env.example` intentionally has no service-role value. A local operator must provide a secret only through approved local secret handling before privileged local tests. |
| Preview | `BINDING_PROOF_REQUIRED` | Checked-in Wrangler variables do not prove an encrypted preview binding. Obtain a separately approved metadata-only proof packet. |
| Production | `BINDING_PROOF_REQUIRED` | Checked-in Wrangler variables do not prove an encrypted production binding. Obtain a separately approved metadata-only proof packet. |

Metadata presence does not complete R1 or make R2/R4/R6/R7 eligible. It proves
only the binding record. R1 completes only after the security owner approves
the narrow caller allowlist, rotation owner, and environment-specific evidence.
Stage C remains `BLOCKED_RUNTIME_MIGRATION_REQUIRED`; no RPC SQL, runtime
migration, policy removal, grant, or deployment follows from this checklist.

If a future approved proof says the binding is absent, the next action is not a
write command. It is a separate explicit approval for encrypted Preview or
Production secret creation, followed by a fresh proof packet. If duplicate or
plaintext metadata appears, stop for conflict remediation approval.
