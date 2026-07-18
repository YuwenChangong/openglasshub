# Legal Consent Forward-Only Rollback Analysis

The packet is one transaction. Any precondition or DDL failure rolls back all
new legal-consent objects. It has no automatic post-commit drop script.

Before the first acceptance record, a future destructive reversal could be
considered only under separate approval and after a catalog/data proof. After a
record exists, dropping the table would destroy legal acknowledgement evidence;
application rollback plus a forward repair is the normal path and requires legal
review. The migration ledger remains untouched in every case.
