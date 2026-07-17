# W6 R5 Preview Rollback and Residue Checklist

Status: `UNEXECUTED_PREVIEW_ONLY`.

1. On a runtime or behavioral failure, roll Preview back to the recorded prior
   Preview deployment. Do not merge main or deploy Production.
2. Verify the rollback restores the prior runtime behavior and does not alter
   Preview or Production secrets.
3. Verify no unexpected table grants, policies, indexes, migrations, or
   unrelated objects changed. The R5 proposal does not authorize any of them.
4. Retain or remove the Preview RPC only with a later explicit database
   approval; do not infer cleanup authority from runtime rollback.
5. Record redacted residue evidence outside Git and confirm no Production
   traffic, data, binding, SQL, or deployment was involved.

Any ambiguous SQL or deployment state stops automatic retry and requires a
fresh read-only verification before a new approval.
