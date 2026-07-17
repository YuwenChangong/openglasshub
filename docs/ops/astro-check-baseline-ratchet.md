# Astro Check Baseline Ratchet

`cd87f54bc486acb7d12c1bcd6c55e38c8749b0a6` has 156 pre-existing Astro static-analysis errors across 51 source or test paths when checked with Astro `5.18.2`, `@astrojs/check` `0.9.4`, and TypeScript `5.7.3`. This is debt, not an acceptance of the errors.

The frozen machine-readable record is [astro-check-baseline-cd87f54.json](../../scripts/fixtures/astro-check-baseline-cd87f54.json). It records every parsed diagnostic, its message hash, the baseline Git blob identity, the normalized set hash, and a manifest integrity hash.

`npm run test:astro-check-ratchet` always runs the local checker. The raw checker still exits `1` while the baseline debt remains; the ratchet passes only when there are no new diagnostics, no diagnostics in candidate-changed paths, no changed baseline error blobs, and no higher error or affected-path count. Existing diagnostics may disappear, but the command never rewrites the baseline.

The manifest builder is intentionally separate and is restricted to a detached worktree at the named baseline commit. Updating the baseline requires explicit review; it is never part of ordinary test or release execution.
