# Astro Check Baseline Ratchet

`e2f45dac135edfc10d866fc83df05c0590c1adb9` has 177 pre-existing Astro static-analysis errors across 90 source or test paths when checked with Astro `7.2.10`, `@astrojs/check` `0.9.4`, and TypeScript `5.7.3`. This is debt, not an acceptance of the errors.

The frozen machine-readable record is [astro-check-baseline-e2f45dac.json](../../scripts/fixtures/astro-check-baseline-e2f45dac.json). It records every parsed diagnostic, its message hash, the baseline Git blob identity, the normalized set hash, and a manifest integrity hash.

`npm run test:astro-check-ratchet` always runs the local checker. The raw checker still exits `1` while the baseline debt remains; the ratchet passes only when there are no new diagnostics and no higher error or affected-path count. Existing diagnostics may disappear, but the command never rewrites the baseline.

For a candidate edit in a file that already contains baseline debt, the ratchet compares the immutable baseline to the candidate through a zero-context Git diff. A non-diagnostic hunk is permitted. A hunk that touches a still-present baseline diagnostic source line fails. Insertions or deletions at or before such an anchor fail closed because they can change its source position. If a changed debt path cannot be mapped to zero-context hunks, it also fails closed. This deliberately replaces only the former whole-file/blob debt prohibition; baseline identity, toolchain, integrity, new-diagnostic, and nonincreasing-count safeguards remain unchanged.

The manifest builder is intentionally separate and is restricted to a detached worktree at the named baseline commit. Updating the baseline requires explicit review; it is never part of ordinary test or release execution.
