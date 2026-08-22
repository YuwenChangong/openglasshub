# Account security V1 rollout

This is **OpenGlass Email Login Verification**. It is not native Supabase AAL2
or MFA.

The application session gate is keyed to the verified Supabase JWT `session_id`. It is not Supabase AAL2 or MFA.

After a correct password, Supabase may hold an AAL1 Session A locally while the
password-bound email challenge is completed. Session A is intentionally retained
for that challenge but cannot access protected OpenGlass routes. A successful OTP
returns and installs a distinct Session B; only that exact Session B `session_id`
is activated. Activation is per-session, so logout or a later password login
requires email verification again.

Signup and recovery callbacks may create temporary provider sessions, but they
never activate an OpenGlass application session. The callback clears that local
provider state and returns to login.

## Legal-consent age metadata

The current policy has no age gate. Its consent record stores `minimum_age = 0` as explicit non-gating compatibility metadata; positive values represent an actual minimum-age threshold. Negative values are rejected. The removed hard-coded 16+ attestation is not a current product requirement; Terms, Privacy, versioned consent records, and the legal-consent gate remain in place.

## Staged configuration

`public.auth_security_config.enforcement_mode` defaults to `off`. A release operator may set `qa_only` with a fixed `qa_user_id` for the controlled rollout. `all` needs separate explicit approval. This change does not modify any remote configuration.

## Supabase email template

Configure the Supabase **Magic Link / OTP** template to render the OTP token, rather than a confirmation URL, for the login OTP delivery path:

```text
Your OpenGlass Hub verification code is: {{ .Token }}
```

The endpoint uses `signInWithOtp({ shouldCreateUser: false })`. Existing signup confirmation and password recovery keep their own redirect/callback behaviour and never activate an OpenGlass application session.

## Protected route matrix

| Family | Access | Gate |
| --- | --- | --- |
| `/api/forum/*` mutations, circle management, uploads | Protected | shared `requireForumUser` where applicable, with restrictive RLS as the equivalent gate for user-scoped Data API operations |
| `/api/users/me/*`, `/api/legal/consent` | Protected | shared `requireVerifiedApplicationSession` |
| `/api/admin/*` | Protected | `requireModerator` / `requireAdmin`, now backed by the shared gate |
| public feed, circle and device reads | Public | unchanged anonymous reads |
| Supabase authenticated table access and Storage mutations | Protected | restrictive RLS application-session policies, additive to existing owner, membership, role, visibility, legal, and moderation policies |

In `qa_only` and `all`, authenticated table reads and mutations require an activated OpenGlass session. Anonymous public-read policies remain unchanged, so public content remains available without creating an application session.

## Local and preview validation status

Local full OTP E2E requires a local Supabase Auth SMTP/Inbucket configuration. No fixed preview mailbox credential is stored in this repository.

`PREVIEW_FIXED_MAILBOX_E2E=BLOCKED_SECURE_MAILBOX_BINDING`: preview real-mailbox validation remains a separate release-readiness activity and was not completed by local Phase 1 work. Production configuration remains unchanged, and production Turnstile is not enabled by this local Phase 1 work.
