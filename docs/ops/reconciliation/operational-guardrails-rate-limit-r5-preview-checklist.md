# W6 R5 Preview Staged Checklist

Status: `R5_READINESS_PACKET_COMPLETE_UNEXECUTED`.

1. R5-A: confirm the approved feature branch/commit, clean worktree, Preview
   target only, and metadata-only `SUPABASE_SERVICE_ROLE_KEY` binding name.
   Do not infer secret correctness. Production is out of scope.
2. R5-B: run only the one-row catalog packet
   `operational-guardrails-rate-limit-r5-preview-preflight.sql`; export outside
   Git and validate no business row or secret is present.
3. R5-C: only after separate execution approval, hash-check and execute the
   exact R2 proposal named in the execution proposal. Stop on existing object,
   overload, owner, ACL, search-path, prerequisite, or transaction mismatch.
4. R5-D: run the unchanged R2 static postflight and verify one overload,
   postgres owner, SECURITY DEFINER, VOLATILE, PARALLEL UNSAFE, non-leakproof,
   fixed settings, service_role-only execute, and no table/policy/index drift.
5. R5-E: deploy the approved branch Preview only. No main merge or Production
   deployment. Roll back to the prior Preview deployment on runtime failure.
6. R5-F: verify ALLOWED, RATE_LIMITED/429, RPC failure/503, post/comment/circle,
   media/external-video, resend unchanged, no browser table/RPC access, and no
   secret exposure. Use no Production traffic or data.
7. R5-G: verify rollback/residue: no unexpected grants, policies, indexes,
   secrets, or Production changes. Retain or remove the Preview RPC only under
   a later explicit database approval.

Future exported proof paths must be outside Git under a dedicated operator
directory. No one-click SQL-plus-deploy command is authorized.

The operator, deployment, behavioral, and rollback/residue details are kept in
their separate R5 Preview checklists alongside this stage index.
