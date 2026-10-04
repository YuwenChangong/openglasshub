# Catalog Migration Packet

Status: preparation only. No Production SQL, import, deployment, or catalog
editing is authorized by this packet. Runtime code must not ship ahead of its
required projections and presentation column.

## Exact Inputs

Run `node scripts/generate-catalog-migration-packet.mjs` offline to generate:

- `artifacts/qa/catalog-migration-packet-v1/manifest.json`
- `artifacts/qa/catalog-migration-packet-v1/canonical-import.sql`
- `artifacts/qa/catalog-migration-packet-v1/canonical-activate.sql`
- `artifacts/qa/catalog-migration-packet-v1/canonical-public-read-hardening.sql`

The manifest records the SHA-256 of all three generated SQL files and these migrations:

- `supabase/migrations/20261004003349_public_device_detail_v1.sql`
- `supabase/migrations/20261004014637_catalog_editor_presentation_v1.sql`

The published cohort is exclusively the observed publication contract, not YAML
presence. Existing publication states and richer/admin-owned rows are preserved.
YAML is an import/reference input, never a competing runtime source after
activation. Do not silently regenerate this packet during an execution window.

## Objects And Writes

Task 3 introduces anonymous, invoker/security-barrier public specification,
source and evidence projections with explicit safe-column grants. The editor
migration adds `devices.catalog_normalized`, `device_specs.presentation`, closed
presentation constraints, invoker/admin-only specification and group save RPCs,
brand identity protection, and private append-only device audit events.

No new canonical catalog tables, service-role editor, or security-definer editor
RPC are introduced. Authenticated ordinary users must not inherit anonymous
specification grants. Every API mutation verifies the server-side admin role;
RPCs and direct table writes remain protected by database RLS.

Import is insert-only for definitions, products, sources, links, typed facts and
evidence. Before inserting facts, it locks matching existing products, rejects
incompatible brand/schema identities, and fills only NULL `schema_type` from the
approved stable identity mapping. Existing non-NULL types, richer copy, facts
and publication states are not overwritten. The manifest gives maximum insertion
counts; actual writes depend on pre-existing tuples. The manifest also caps
NULL-schema initialization, initial known-row
Key Spec presentation metadata, and cohort activation updates. None of those
metadata updates replaces existing factual values. Activation is a separate
transaction and requires every expected stable fact identity. On first activation
only, known rows without an explicit Key Spec flag receive a deterministic top-six
selection/order; existing explicit selections and facts remain untouched. It then
changes the cohort's `catalog_normalized` flags. The database default stays false,
so migrations-before-import cannot accidentally skip initialization. New devices
created by the protected admin API are explicitly canonical from creation;
their administrator chooses the Schema v1 type and Key Specs without bootstrap
defaults. No Auth/user/preference,
forum, email, provider, or P9 writes are included.

## Later Execution Gate

A separate human authorization must name the exact reviewed source commit,
migration/import hashes, Production identity, SQL execution channel, change
window, and rollback operator. Before execution, compare migration ledger and
existing canonical facts with this packet, confirm privileges and backups, and
stop on incompatible definitions, missing facts, source loss, or scope drift.
Do not assume all insert-only rows will be newly written or re-publish an
existing hidden product.

Apply missing migrations in ledger order. Review and execute the insert-only
import transaction separately. Prove the 829 known source facts survive both
storage and public model without fabricated values or private leakage, preserving
any richer existing factual context. Then review activation and deploy the
matching application through the normal release path. After verifying that this
exact application no longer selects legacy `full_specs`/`key_specs`, execute the
separate public-read hardening transaction in the same separately authorized
bounded window. It revokes anonymous table/legacy-column SELECT, grants the exact
safe public device columns, and limits the existing published-row policy to anon;
authenticated staff retain their reviewed policy, ordinary accounts cannot read
legacy JSON. Legacy data is retained for administrators, not deleted or exposed
as a competing public truth. Do not apply hardening ahead of the compatible reader,
and do not declare acceptance before it is applied and verified. Product edits
must then appear from the same canonical rows without a source deployment.

## Local Proof And Rollback

The final acceptance must cite an exact-hash genuine-local receipt covering
admin/A/B/anon RLS, reversible admin editing on multiple devices, all published
products, 829 source values, both locales, actual Worker/browser rendering,
format/media safety and private audit isolation. A generated manifest is not a
replacement for these proofs.

If a migration/import transaction fails, roll it back and stop; do not partially
activate the catalog. After activation, preserve canonical facts and private
audit history. Prefer a reviewed forward fix. Application rollback requires a
reviewed compatible Worker version and inspection of whether it would expose
stale legacy values or query columns revoked by the final public-read hardening.
An old Worker that still selects legacy JSON is not a compatible rollback target;
restoring those grants would require separate security review and authorization.
Do not delete normalized facts, disable RLS, restore stale
YAML over administrator edits, or silently revert publication. Reversing
activation or changing schema requires a separately reviewed SQL packet and
human authorization, not an automatic fallback in application code.
