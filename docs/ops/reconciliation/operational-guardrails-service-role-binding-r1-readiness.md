# W6 R1 Service-Role Binding Readiness

| Environment | Classification | Reason and next action |
| --- | --- | --- |
| Local | `CONFIGURATION_REQUIRED` | `.env.example` intentionally has no service-role value. A local operator must provide a secret only through approved local secret handling before privileged local tests. |
| Preview | `PREVIEW_R1_READY` | Operator-held metadata-only proofs at source commit `b4f55642407420f56f0b677d4de37a4022fbfbff` show the reviewed transition `BINDING_ABSENT` to exactly one encrypted `SECRET_BINDING_PRESENT` record for `SUPABASE_SERVICE_ROLE_KEY`. No plaintext, `PUBLIC_`, browser-exposed, or duplicate binding is attested. |
| Production | `BINDING_ABSENT_PRODUCTION_BLOCKED` | The separately validated production metadata-only proof remains `BINDING_ABSENT`. Production secret creation is not implied or approved by the Preview result. |

Preview R1 is `PREVIEW_R1_READY`, while the overall trusted-identity state is
`SERVICE_ROLE_CONFIGURATION_PARTIALLY_READY`: the local binding and separately
required Production binding remain unproven. The three proof files remain
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

The next safe approval is R2: repository-only design of an unexecuted atomic,
server-only, fail-closed rate-limit RPC proposal and static ACL/owner/
search-path validation. Production secret creation remains deferred. If a
future proof reports absent, duplicate, plaintext, or browser-exposed metadata,
stop for separate conflict remediation approval.
