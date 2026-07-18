# Legal Consent Forward-Only V2 Runbook

Validate the exact v2 commit and packet hashes, validate the Production target,
run only v2 preflight and require `SAFE_TO_CREATE_DEDICATED_HELPER_V2`, obtain a
fresh unique confirmation, submit v2 once, then require
`LEGAL_CONSENT_CATALOG_V2_EXACT`. Verify the shared helper and its eight trigger
dependencies are unchanged and the migration ledger has no `20260712` entry.
Stop before any authenticated consent POST or canary. V1 is ineligible.
