# W6 R5 Preview Deployment Checklist

Status: `UNEXECUTED_PREVIEW_ONLY`.

1. Confirm the exact approved feature branch and commit, a clean worktree, and
   a branch Preview deployment target. Main and Production are not targets.
2. Confirm only the metadata-only Preview binding named
   `SUPABASE_SERVICE_ROLE_KEY` is present. Do not reveal, inspect, or infer the
   secret value. Production binding is not a prerequisite for this Preview run.
3. Run the separate R5 catalog preflight and preserve its redacted one-row
   export outside Git. Stop for any function, overload, owner, ACL,
   search-path, table, policy, or index conflict.
4. Execute the exact R2 proposal only under its separate database approval and
   verify the reviewed SHA-256 before transmission. No table grants, policy
   deletion, index change, canonical migration, main merge, or Production
   deployment is authorized.
5. Deploy the approved branch Preview only after SQL postflight succeeds.
   Record the prior Preview deployment identifier outside Git as the rollback
   target. Stop on a binding, deployment, or runtime health mismatch.

No combined SQL-and-deploy command is approved.
