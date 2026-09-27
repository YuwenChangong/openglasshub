# Reviewed Immutable Fingerprint Inventory

The release inventory is enforced by
`scripts/test-reviewed-immutable-fingerprint-contracts.mjs`. It covers the 50
tracked SQL artifacts whose raw SHA-256 is an explicit reviewed repository
contract, including the historical migration-integrity records.

Eighteen reviewed artifacts have canonical LF bytes and exact-path checkout
rules in `.gitattributes`: the R2 proposal, the authenticated-privilege and
current-catalog packets, four R6 catalog packets, six `20260713` forward
migrations, the P8 production-history packet, the P9 migration-history packet,
the Verified Session hosted catalog packet, and its Foundation and Enforcement
migrations. Their validators hash raw bytes; CRLF, a BOM, whitespace, a changed
final newline, and a one-byte change fail the fingerprint.

The remaining 32 historical migration artifacts are already exact raw matches,
including their deliberately preserved CRLF/BOM bytes where present. They have
no checkout defect and are not normalized by this release. The seven newly
registered source-byte-preserved contracts are the `20260518` forum phase 1,
`20260703` moderation notifications, `20260814` circle lifecycle/safe purge,
both `20260829` device migrations, `20260902042807` device reconciliation, and
`20260904054013` security privilege reconciliation migrations. The inventory
test fails if the discovered set expands, contracts conflict, or any listed raw
artifact differs from its reviewed SHA-256.
