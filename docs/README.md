# OpenGlass Hub Docs

## Ops

- `D:\OpenGlass Hub\docs\ops\deployment-playbook.md`
- `D:\OpenGlass Hub\docs\ops\environment-and-secrets-checklist.md`
- `D:\OpenGlass Hub\docs\ops\production-smoke-checklist.md`
- `D:\OpenGlass Hub\docs\ops\migration-runbook.md`
- `D:\OpenGlass Hub\docs\ops\rollback-runbook.md`
- `D:\OpenGlass Hub\docs\ops\post-release-monitoring.md`
- `D:\OpenGlass Hub\docs\ops\preview-qa-safety.md`

## Existing release docs

- `D:\OpenGlass Hub\docs\production-readiness-gate.md`
- `D:\OpenGlass Hub\docs\production-incident-runbook.md`
- `D:\OpenGlass Hub\docs\post-launch-watchlist.md`
- `D:\OpenGlass Hub\docs\functions-deprecated-risk.md`
- `D:\OpenGlass Hub\docs\openai-moderation-setup.md`
- `D:\OpenGlass Hub\docs\moderation-policy.md`

## Notes

- Treat `docs/ops/*` as the primary source for post-release hardening and day-2 operations.
- Treat preview QA as production-equivalent data risk because preview currently uses production-equivalent non-secret runtime values.

## Device Library MVP

- Device Library MVP uses static local data only and adds no DB migration.
- Device entries intentionally stay conservative; uncertain specs should remain sparse, marked `TBD`, or omitted.
- Planned follow-up areas: sourced spec ingestion, comparison views, user reviews, and device-specific discussion surfaces.
