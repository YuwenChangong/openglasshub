# W6 R5 Preview Execution Proposal

Status: `UNEXECUTED_PREVIEW_ONLY`. This is not an operator runner and does not
authorize SQL or deployment.

The only permitted function SQL is the exact R3-passed source file
`operational-guardrails-rate-limit-r2-unexecuted-proposal.sql`, SHA-256
`10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb`.
R5 execution must stop unless the file hash, clean approved branch/commit,
Preview-only target identity, and R5 preflight all match. Do not apply a
canonical migration, table grant, index change, or policy change. Execute the
reviewed function proposal in its reviewed transaction-compatible form, then
run the unchanged R2 static postflight. Existing function/overload, owner, ACL,
or search-path conflict requires a new review; no replacement is authorized.
