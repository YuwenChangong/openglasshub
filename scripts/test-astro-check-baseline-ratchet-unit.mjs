import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ASTRO_CHECK_BASELINE_COMMIT, ASTRO_CHECK_BASELINE_TOOLCHAIN, compareDiagnostics, createBaselineManifest, parseAstroCheckOutput, verifyBaselineManifest } from "./astro-check-baseline-core.mjs";

const output = (diagnostics) => `${diagnostics.join("\n")}\nResult (1 files):\n- ${diagnostics.length} errors\n- 0 warnings\n- 0 hints\n`;
const baselineDiagnostic = "src/example.ts:1:2 - error ts(1001): Existing diagnostic.";
const parsedBaseline = parseAstroCheckOutput(output([baselineDiagnostic]), { repositoryRoot: process.cwd() });
const manifest = createBaselineManifest({ parsed: parsedBaseline, nodeVersion: process.version, resolveGitBlob: () => ({ objectId: "a".repeat(40), sha256: "b".repeat(64) }) });
verifyBaselineManifest(manifest);
assert.equal(manifest.baselineCommit, ASTRO_CHECK_BASELINE_COMMIT);
assert.deepEqual(manifest.toolchain.astro, ASTRO_CHECK_BASELINE_TOOLCHAIN.astro);

const accepted = compareDiagnostics({ baseline: manifest, current: parsedBaseline, candidateChangedPaths: new Set(), resolveCandidateGitObject: () => "a".repeat(40) });
assert.equal(accepted.pass, true);

const newError = parseAstroCheckOutput(output([baselineDiagnostic, "src/new.ts:1:1 - error ts(2002): New diagnostic."]), { repositoryRoot: process.cwd() });
assert.equal(compareDiagnostics({ baseline: manifest, current: newError, candidateChangedPaths: new Set(), resolveCandidateGitObject: () => "a".repeat(40) }).pass, false, "a simulated new diagnostic must fail");
assert.equal(compareDiagnostics({ baseline: manifest, current: parsedBaseline, candidateChangedPaths: new Set(["src/example.ts"]), resolveCandidateGitObject: () => "a".repeat(40) }).pass, false, "a diagnostic in a changed file must fail");
const removed = parseAstroCheckOutput(output([]), { repositoryRoot: process.cwd() });
assert.equal(compareDiagnostics({ baseline: manifest, current: removed, candidateChangedPaths: new Set(), resolveCandidateGitObject: () => "a".repeat(40) }).pass, true, "removing a baseline diagnostic must pass");
assert.throws(() => parseAstroCheckOutput("src/example.ts:1:2 - error\nResult (1 files):\n- 1 errors\n- 0 warnings\n- 0 hints\n", { repositoryRoot: process.cwd() }), /unparsed error diagnostic/, "unknown output must fail closed");
const mismatch = structuredClone(manifest);
mismatch.toolchain.typescript = "0.0.0";
assert.throws(() => verifyBaselineManifest(mismatch), /TypeScript baseline version changed/, "tool-version mismatch must fail");
const ratchetSource = await readFile(new URL("./test-astro-check-baseline-ratchet.mjs", import.meta.url), "utf8");
assert.doesNotMatch(ratchetSource, /writeFile|--update|baseline.*=/i, "ordinary ratchet execution cannot update the baseline");
console.log(JSON.stringify({ status: "PASS", assertions: 8 }));
