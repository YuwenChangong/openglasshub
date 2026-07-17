# W6 Service-Role Binding Rotation And Incident Plan

## Blast radius

Rotating `SUPABASE_SERVICE_ROLE_KEY` affects the existing legal-consent writer
and the lazy moderation-notification writer, in addition to the future
rate-limit RPC wrapper. It must not be rotated as a rate-limit-only operation.
The normal bearer-bound forum routes use `SUPABASE_ANON_KEY` and are outside
this key's credential blast radius.

## Procedure

1. On suspected exposure, stop new privileged deployments, record a redacted
   incident reference outside Git, and preserve no secret material.
2. Have the Supabase security owner create/obtain the replacement through its
   approved secret-management process. Never place either key in a command,
   file, log, chat, or test fixture.
3. Under separate approval, set the replacement as the encrypted Cloudflare
   Preview binding and run non-destructive authenticated checks for legal
   consent and moderation notifications. A rate-limit check is added only after
   that runtime exists.
4. Under separate production approval, repeat the encrypted binding cutover in
   Production, then verify only fixed success/failure envelopes and redacted
   binding metadata.
5. If preview or production verification fails, restore the previously known
   encrypted binding through the operator console; do not invent a database or
   code rollback. Record the failure without values.
6. Retire the old Supabase key only after both environments are verified and
   the incident/security owner approves retirement. Confirm old-key rejection
   through approved provider controls, never by printing it.

Required audit evidence is the environment-specific metadata packet, approval
reference, deployed commit, verification result, and retirement confirmation.
No secret value, hash, account token, or raw provider output is evidence.
