# OpenGlass Hub Legal & Trust Policy Management

## Phase 1 scope

Phase 1 adds public legal and trust content only. It covers centralized policy configuration, bilingual public policy pages, restrained public legal links, the `/register/` redirect into the combined login/register page, and offline validation for this surface.

Phase 1 does not authorize production deployment by itself. It also does not add a consent checkbox, consent persistence, database migration, RLS, authenticated gating, or mutation-route enforcement.

## Central configuration

The single source of truth is [src/lib/legal-policy.ts](/D:/OpenGlass%20Hub%20interaction-release-fresh/src/lib/legal-policy.ts).

Current platform policy values:

- Platform name: `OpenGlass Hub`
- Minimum age: `16`
- Bundle version: `2026-07`
- Terms version: `2026-07`
- Privacy version: `2026-07`
- Guidelines version: `2026-07`
- Effective date: `2026-07-12`
- Supported languages: `zh-CN`, `en`

Update these values intentionally. Versions are explicit release constants and must not be derived automatically from build time.

## Updating policy content

When updating the legal bundle:

1. Update the relevant version constant in [src/lib/legal-policy.ts](/D:/OpenGlass%20Hub%20interaction-release-fresh/src/lib/legal-policy.ts).
2. Update the effective date intentionally.
3. Revise both Chinese and English content together.
4. Keep Chinese and English meaning aligned even if wording is not literal.
5. Re-run `npm run test:legal-content` and the full regression suite.

Chinese and English parity is required for every public legal page in this phase.

## Public contact configuration

Public operator and contact configuration is read from public environment variables, not secrets:

- `PUBLIC_LEGAL_OPERATOR_NAME`
- `PUBLIC_SUPPORT_EMAIL`
- `PUBLIC_ABUSE_EMAIL`
- `PUBLIC_PRIVACY_EMAIL`
- `PUBLIC_IP_EMAIL`

These values must be genuine public launch values before launch. Do not add fake placeholders, private developer email addresses, or non-working forms.

Missing public operator/contact configuration blocks a fully ready legal launch classification. Phase 1 may be classified as configuration-required until those public values exist.

## Review requirements

Every policy revision should go through:

- product/ops review for feature accuracy
- bilingual content review for parity
- visual review on desktop and mobile
- qualified lawyer review before public launch

The `16+` rule is a platform policy, not a universal legal-compliance guarantee. Users remain subject to mandatory applicable local laws.

## Deferred follow-up phases

Phase 2:
- one combined, unchecked-by-default `16+` acknowledgement checkbox on every password login and registration attempt
- agreement to the Terms of Service and Community Guidelines, plus acknowledgement of the Privacy Policy
- separate, keyboard-accessible policy links within that one checkbox label
- frontend/auth-entry enforcement only, with no server acceptance record, localStorage proof, or cookie proof
- password recovery and resend confirmation remain recovery/verification actions, not acceptance
- policy links open without submitting or changing the current auth mode

Phase 3:
- consent migration
- consent persistence
- RLS/API/authenticated gate wiring

Phase 4:
- mutation-route enforcement
- release gate for versioned consent requirements

Do not treat Phase 1 alone as permission to deploy a full legal-compliance system.
