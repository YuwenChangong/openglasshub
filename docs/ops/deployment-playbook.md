# Deployment Playbook

## Scope

This project deploys to Cloudflare Pages as an Astro + Cloudflare adapter app.

## Normal production deployment path

- Production auto-deploy is triggered by pushes to `main`.
- Do not deploy production manually unless there is an explicit incident or release need.
- Do not push `main` for preview-only QA.

## Preview deployment path

- Preview deployments can be created from non-`main` branches.
- Correct manual preview deploy command:

```bash
npx wrangler pages deploy dist --project-name openglasshub --branch <branch-name>
```

- `pages deploy` does **not** support `--env`.
- `wrangler pages secret list` and `wrangler pages secret put` can use `--env preview`.

## URL handling

- Cloudflare Pages may show an older branch preview URL and a newer deployment URL at the same time.
- Confirm the deployment timestamp and commit before treating a preview URL as current.
- Prefer the latest deployment URL shown for the branch you just deployed.

## When not to deploy

- Do not deploy when the worktree is dirty and unrelated changes are present.
- Do not deploy when build or smoke checks are failing.
- Do not deploy preview for routine write QA when it shares production data. Production-backed previews require the exceptional destructive-QA contract in `preview-qa-safety.md`.
- Do not deploy production just to test secrets, bindings, or migration assumptions.

## Active runtime path

- Active runtime routes come from `src/pages/**`.
- Astro generates the runtime output in `dist/`.
- The legacy `functions/` directory is not the active runtime path for the current Cloudflare Pages deployment.
