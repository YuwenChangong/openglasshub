# Preview QA Safety

## Rules

- Preview uses production-equivalent runtime values.
- Disposable test data only.
- Never test destructive actions on real users or real content.
- No production migration from preview QA.

## QA user cleanup

- Use dedicated disposable QA accounts only.
- Clean up preview QA accounts and content after test cycles.
- Treat posts, comments, circles, reports, and user safety writes as real shared-data risk.

## Safe cleanup notes

- Use the clear-warning cleanup route when warning-state cleanup is required.
- Do not use preview QA to rehearse destructive moderation or user-safety actions on real accounts.
