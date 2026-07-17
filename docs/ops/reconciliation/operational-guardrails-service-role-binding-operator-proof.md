# W6 Service-Role Binding Operator Proof

This is a future metadata-only operator workflow. Do not run it as part of the
repository design phase. It does not read, reveal, hash, compare, decode, or
export a secret value.

## Packet

Packet version: `openglasshub-service-role-binding-proof-v1`.

After a Cloudflare Pages operator opens the exact `openglasshub` project,
selects either Preview or Production, and inspects Variables and Secrets without
opening or editing a value, they classify the evidence as exactly one approved
result. `SECRET_BINDING_PRESENT` requires all of the following:

- exactly one `SUPABASE_SERVICE_ROLE_KEY` binding exists;
- Cloudflare marks it as a secret, not a plaintext variable;
- no similarly named conflict exists;
- no browser-exposed equivalent exists; and
- the project/environment match this packet.

Otherwise select the matching `BINDING_ABSENT`,
`PLAINTEXT_BINDING_PRESENT`, `CONFLICTING_BINDINGS_PRESENT`,
`BROWSER_EXPOSURE_CONFLICT`, or `INSUFFICIENT_EVIDENCE` result. No binding
name, account identifier, secret value, or secret hash beyond the fixed expected
name is written into the packet.

Use a dedicated non-repository output path, never a shared W6 CSV:

- Preview: `C:\Users\1\Downloads\openglasshub-service-role-binding-preview-proof.json`
- Production: `C:\Users\1\Downloads\openglasshub-service-role-binding-production-proof.json`

The offline runner invokes the writer and then the validator only after a
successful write. If the writer fails, it stops before the validator; if the
packet is a valid non-secret result, it preserves the packet and returns the
validator's intentional nonzero status. It has no network, Cloudflare CLI,
credential, or value input. Its output parent must already exist and must be
strictly outside the repository, including after realpath/symlink resolution:

```powershell
& ".\scripts\run-operational-guardrails-service-role-binding-proof.ps1" -Environment preview -Classification SECRET_BINDING_PRESENT -SourceCommit <approved-40-character-sha> -OutputPath "C:\Users\1\Downloads\openglasshub-service-role-binding-preview-proof.json"
```

Validate it separately:

```powershell
node scripts/validate-operational-guardrails-service-role-binding-proof.mjs "C:\Users\1\Downloads\openglasshub-service-role-binding-preview-proof.json"
```

The packet validator emits only the redacted classification for a structurally
valid packet, but exits nonzero unless it is `SECRET_BINDING_PRESENT`. It fails
closed for a missing binding, duplicate, conflicting name, plaintext
classification, name mismatch, browser-exposed count, malformed schema, wrong
project/environment/version, or any secret-like field. The packet is an
operator-attested metadata record, not an automated Cloudflare API result; an
independent reviewer must compare it to the dashboard before R2.
