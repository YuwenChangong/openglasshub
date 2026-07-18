# V1 Superseded By V2

V1 was never executed in Production. It is retained byte-for-byte for audit but
must not be executed: its eligibility depended on an unverifiable shared
`public.set_updated_at()` helper. V2 is the only future eligible packet because
it creates a dedicated legal-consent-only helper and does not alter the shared
helper or its eight existing trigger dependencies.
