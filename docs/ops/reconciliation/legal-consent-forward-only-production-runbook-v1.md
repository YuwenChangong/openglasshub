# Legal Consent Forward-Only Production Runbook

This runbook is unexecuted guidance. A future approval must first verify the
reviewed commit and target, execute the sealed read-only preflight, require
`SAFE_TO_CREATE_EXACTLY`, display the proposal SHA-256, and obtain a unique
human confirmation token. Execute the mutation once, then run postflight and
require `LEGAL_CONSENT_CATALOG_EXACT` before a separately approved authenticated
GET smoke and controlled POST. Only then may the existing canary resume.

Never replay migrations, use `db push`, repair the ledger, retry automatically,
edit SQL in the dashboard, print secrets, or proceed when preflight is not exact.
Stop before R7.
