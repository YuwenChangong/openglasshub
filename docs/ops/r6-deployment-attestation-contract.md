# R6 Deployment Attestation Contract

`r6-production-deployment-attestation-v1` is an external, non-Git JSON record
for the Production canary runner. A future approved read-only Cloudflare Pages
preflight creates it beneath
`C:\Users\1\OpenGlassHub-R6-Proof\deployment-attestations`.

Required fields are `schemaVersion`, `provider`, `projectName`, `environment`,
`canonicalBaseUrl`, `immutableDeploymentUrl`, `deploymentId`, `sourceCommit`,
`observedAt`, `expiresAt`, `queryOrProviderEvidenceSha256`,
`targetIdentityHash`, and `classification`.

The runner accepts only `cloudflare-pages`, project `openglasshub`, environment
`production`, canonical URL `https://openglasshub.pages.dev`, an HTTPS
`*.openglasshub.pages.dev` immutable URL, an exact lowercase 40-character source
SHA, and classification `PRODUCTION_DEPLOYMENT_IDENTITY_EXACT`. The raw file
SHA-256 must exactly equal `QA_DEPLOYMENT_ATTESTATION_SHA256`; the record must
be fresh, valid for no more than 15 minutes, non-symlinked where detectable,
and within the evidence root.

No public-response header, HTML content, immutable hostname, repository HEAD,
or cache metadata is a deployed-commit fallback. The attestation contains no
credentials, user data, or provider tokens.

The runner completes runner commit, target, base URL, deployment attestation,
write acknowledgement, run-ID, and journal-eligibility guards before it can
construct a mutation-capable HTTP adapter or write a canary journal.
