# W6 R5 Preview Behavioral Verification Checklist

Status: `UNEXECUTED_PREVIEW_ONLY`.

Use Preview-only, authenticated, non-destructive verification. Do not route
traffic or data to Production and do not disclose the service-role binding.

1. Verify an `ALLOWED` RPC result permits exactly one protected continuation.
2. Verify `RATE_LIMITED` returns the source-compatible `429` response and
   prevents post, comment, circle, media, or external-video continuation.
3. Verify missing, permission-denied, timeout, transport, and malformed RPC
   results return a sanitized `503` and do not continue the protected action.
4. Verify post, comment, circle, media guard, and external-video requests use
   their reviewed purpose, server-derived identity, and byte inputs. Verify the
   external-video reservation precedes R2 signing.
5. Verify verification-email resend remains on its separate RPC and is not
   routed through `consume_forum_rate_limit`.
6. Verify no browser bundle calls the rate-limit RPC, reads
   `forum_upload_attempts`, receives a service-role key, or exposes an internal
   RPC/database error.

Capture only redacted pass/fail evidence outside Git. A failed check requires
Preview rollback and stops this wave.
