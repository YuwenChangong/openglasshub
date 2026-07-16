# W6 Service-Role Binding Operator Proof

This is a future metadata-only operator workflow. Do not run it as part of the
repository design phase. It does not read, reveal, hash, compare, decode, or
export a secret value.

## Packet

Packet version: `openglasshub-service-role-binding-proof-v1`.

After a Cloudflare Pages operator opens the exact `openglasshub` project,
selects either Preview or Production, and inspects Variables and Secrets without
opening or editing a value, they attest only that:

- exactly one `SUPABASE_SERVICE_ROLE_KEY` binding exists;
- Cloudflare marks it as a secret, not a plaintext variable;
- no similarly named conflict exists;
- no browser-exposed equivalent exists; and
- the project/environment match this packet.

Use a dedicated non-repository output path, never a shared W6 CSV:

- Preview: `C:\Users\1\Downloads\openglasshub-service-role-binding-preview-proof.json`
- Production: `C:\Users\1\Downloads\openglasshub-service-role-binding-production-proof.json`

The offline writer emits only the fixed attested metadata after the operator's
inspection. It has no network, Cloudflare CLI, credential, or value input:

```powershell
node scripts/write-operational-guardrails-service-role-binding-proof.mjs --environment preview --source-commit <approved-40-character-sha> --output "C:\Users\1\Downloads\openglasshub-service-role-binding-preview-proof.json"
```

Validate it separately:

```powershell
node scripts/validate-operational-guardrails-service-role-binding-proof.mjs "C:\Users\1\Downloads\openglasshub-service-role-binding-preview-proof.json"
```

The packet validator fails closed for a missing binding, duplicate, conflicting
name, plaintext classification, name mismatch, browser-exposed count, malformed
schema, wrong project/environment/version, or any secret-like field. The packet
is an operator-attested metadata record, not an automated Cloudflare API result;
an independent reviewer must compare it to the dashboard before R2.
