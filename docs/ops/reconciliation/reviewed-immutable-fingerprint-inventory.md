# Reviewed Immutable Fingerprint Inventory

The release inventory is enforced by
`scripts/test-reviewed-immutable-fingerprint-contracts.mjs`. It covers the 38
tracked SQL artifacts whose raw SHA-256 is an explicit reviewed repository
contract, including the historical migration-integrity records.

Thirteen reviewed artifacts have canonical LF bytes and exact-path checkout
rules in `.gitattributes`: the R2 proposal, the authenticated-privilege and
current-catalog packets, four R6 catalog packets, and six `20260713` forward
migrations. Their validators hash raw bytes; CRLF, a BOM, whitespace, a changed
final newline, and a one-byte change fail the fingerprint.

The remaining 25 historical migration artifacts are already exact raw matches,
including their deliberately preserved CRLF/BOM bytes where present. They have
no checkout defect and are not normalized by this release. The inventory test
fails if the discovered set expands, contracts conflict, or any listed raw
artifact differs from its reviewed SHA-256.
