# W6 R1 Service-Role Binding Readiness

| Environment | Classification | Reason and next action |
| --- | --- | --- |
| Local | `CONFIGURATION_REQUIRED` | `.env.example` intentionally has no service-role value. A local operator must provide a secret only through approved local secret handling before privileged local tests. |
| Preview | `PREVIEW_R1_READY` | Operator-held metadata-only proofs at source commit `b4f55642407420f56f0b677d4de37a4022fbfbff` show the reviewed transition `BINDING_ABSENT` to exactly one encrypted `SECRET_BINDING_PRESENT` record for `SUPABASE_SERVICE_ROLE_KEY`. No plaintext, `PUBLIC_`, browser-exposed, or duplicate binding is attested. |
| Production | `PRODUCTION_BINDING_METADATA_READY` | One exact encrypted `SECRET_BINDING_PRESENT` record was created under separate approval and verified metadata-only. The repository boundary is `R6_STAGE1_BINDING_READY`; no Production SQL has executed. |

Preview R1 is `PREVIEW_R1_READY`, while the overall trusted-identity state is
`R6_STAGE1_BINDING_READY`: local configuration remains separately unproven,
while Production binding metadata is ready and raw privileged-client exports
are removed. The three proof files remain
outside Git:

- `C:\Users\1\Downloads\openglasshub-service-role-binding-preview-proof.json`
- `C:\Users\1\Downloads\openglasshub-service-role-binding-preview-postcreation-proof.json`
- `C:\Users\1\Downloads\openglasshub-service-role-binding-production-proof.json`

Metadata presence proves only the binding record. It does not prove the secret
value, its Supabase project, validity, future RPC existence, runtime behavior,
or deployment readiness. R4/R6/R7 remain ineligible until their own approvals
and evidence exist. R2 is limited to separately approved repository-only,
unexecuted proposal design. Stage C remains
`BLOCKED_RUNTIME_MIGRATION_REQUIRED`; no RPC SQL, runtime migration, policy
removal, grant, or deployment follows from this checklist.

The next safe approval is `APPROVE_R6_CONTINUE_PRODUCTION_RPC_SQL_EXECUTION`.
If a future proof reports absent, duplicate, plaintext, or browser-exposed
metadata, stop for separate conflict remediation approval.
