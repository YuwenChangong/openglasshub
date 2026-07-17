import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";

export const ASTRO_CHECK_BASELINE_COMMIT = "cd87f54bc486acb7d12c1bcd6c55e38c8749b0a6";
export const ASTRO_CHECK_BASELINE_TOOLCHAIN = Object.freeze({
  astro: "5.18.2",
  check: "0.9.4",
  typescript: "5.7.3",
});

const ansi = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const errorLine = /^(?<file>.+?):(?<line>\d+):(?<column>\d+)[ \t]+-[ \t]+error(?:[ \t]+(?<kind>\w+)\((?<code>[^)]+)\):)?[ \t]+(?<message>[^\r\n]+)$/gm;
const summary = /Result \(\d+ files\):\s*\r?\n- (?<errors>\d+) errors\s*\r?\n- \d+ warnings\s*\r?\n- \d+ hints/m;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  return JSON.stringify(value);
}

export function normalizeMessage(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeRepositoryPath(value, repositoryRoot) {
  const normalized = value.replace(/\\/g, "/");
  const root = repositoryRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const relative = normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
  assert.ok(!path.posix.isAbsolute(relative), `Astro diagnostic path is not repository-relative: ${value}`);
  assert.ok(!relative.startsWith("../"), `Astro diagnostic path escapes repository: ${value}`);
  assert.ok(relative.length > 0, "Astro diagnostic path is empty");
  return relative;
}

export function diagnosticIdentity(diagnostic) {
  return stableJson([
    diagnostic.path,
    diagnostic.severity,
    diagnostic.code,
    diagnostic.line,
    diagnostic.column,
    diagnostic.message,
  ]);
}

export function parseAstroCheckOutput(output, { repositoryRoot }) {
  const clean = output.replace(ansi, "");
  const diagnostics = [];
  for (const match of clean.matchAll(errorLine)) {
    const diagnostic = {
      path: normalizeRepositoryPath(match.groups.file, repositoryRoot),
      severity: "error",
      code: match.groups.kind && match.groups.code ? `${match.groups.kind}(${match.groups.code})` : null,
      line: Number(match.groups.line),
      column: Number(match.groups.column),
      message: normalizeMessage(match.groups.message),
    };
    diagnostic.messageSha256 = sha256(diagnostic.message);
    diagnostic.identity = diagnosticIdentity(diagnostic);
    diagnostics.push(diagnostic);
  }

  const markedErrors = (clean.match(/\s-\serror(?:\s|$)/g) ?? []).length;
  assert.equal(diagnostics.length, markedErrors, "Astro output contained an unparsed error diagnostic");
  const result = clean.match(summary);
  assert.ok(result, "Astro output did not contain a complete result summary");
  assert.equal(diagnostics.length, Number(result.groups.errors), "Astro parsed error count differs from reported summary");

  const identities = new Set(diagnostics.map((diagnostic) => diagnostic.identity));
  assert.equal(identities.size, diagnostics.length, "Astro output contained duplicate diagnostic identities");
  return {
    diagnostics: diagnostics.sort((left, right) => left.identity.localeCompare(right.identity)),
    errorCount: diagnostics.length,
    affectedPathCount: new Set(diagnostics.map((diagnostic) => diagnostic.path)).size,
  };
}

export function createBaselineManifest({ parsed, resolveGitBlob, nodeVersion }) {
  const diagnostics = parsed.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    baselineGitObjectId: resolveGitBlob(diagnostic.path).objectId,
    baselineGitBlobSha256: resolveGitBlob(diagnostic.path).sha256,
  }));
  const body = {
    schemaVersion: 1,
    baselineCommit: ASTRO_CHECK_BASELINE_COMMIT,
    toolchain: { ...ASTRO_CHECK_BASELINE_TOOLCHAIN, node: nodeVersion },
    totals: { errors: parsed.errorCount, affectedPaths: parsed.affectedPathCount },
    diagnostics,
    normalizedDiagnosticSetSha256: sha256(stableJson(diagnostics.map((diagnostic) => diagnostic.identity))),
  };
  return {
    ...body,
    integrity: {
      algorithm: "sha256",
      contentSha256: sha256(stableJson(body)),
    },
  };
}

export function verifyBaselineManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1, "Unexpected Astro baseline manifest schema version");
  assert.equal(manifest.baselineCommit, ASTRO_CHECK_BASELINE_COMMIT, "Astro baseline commit changed");
  assert.deepEqual(manifest.toolchain.astro, ASTRO_CHECK_BASELINE_TOOLCHAIN.astro, "Astro baseline version changed");
  assert.deepEqual(manifest.toolchain.check, ASTRO_CHECK_BASELINE_TOOLCHAIN.check, "Astro check baseline version changed");
  assert.deepEqual(manifest.toolchain.typescript, ASTRO_CHECK_BASELINE_TOOLCHAIN.typescript, "TypeScript baseline version changed");
  assert.equal(manifest.totals.errors, manifest.diagnostics.length, "Astro baseline total is inconsistent");
  assert.equal(manifest.totals.affectedPaths, new Set(manifest.diagnostics.map((diagnostic) => diagnostic.path)).size, "Astro baseline path total is inconsistent");
  assert.equal(manifest.normalizedDiagnosticSetSha256, sha256(stableJson(manifest.diagnostics.map((diagnostic) => diagnostic.identity))), "Astro baseline diagnostic-set hash changed");
  const { integrity, ...body } = manifest;
  assert.equal(integrity?.algorithm, "sha256", "Astro baseline integrity algorithm changed");
  assert.equal(integrity?.contentSha256, sha256(stableJson(body)), "Astro baseline integrity hash changed");
  for (const diagnostic of manifest.diagnostics) {
    assert.equal(diagnostic.messageSha256, sha256(diagnostic.message), `Astro baseline message hash changed for ${diagnostic.path}`);
    assert.equal(diagnostic.identity, diagnosticIdentity(diagnostic), `Astro baseline identity changed for ${diagnostic.path}`);
    assert.ok(/^[a-f0-9]{40}$/i.test(diagnostic.baselineGitObjectId), `Astro baseline Git object is invalid for ${diagnostic.path}`);
    assert.ok(/^[a-f0-9]{64}$/i.test(diagnostic.baselineGitBlobSha256), `Astro baseline Git blob hash is invalid for ${diagnostic.path}`);
  }
}

export function compareDiagnostics({ baseline, current, candidateChangedPaths, resolveCandidateGitObject }) {
  verifyBaselineManifest(baseline);
  const baselineByIdentity = new Map(baseline.diagnostics.map((diagnostic) => [diagnostic.identity, diagnostic]));
  const currentIdentities = new Set(current.diagnostics.map((diagnostic) => diagnostic.identity));
  const newDiagnostics = current.diagnostics.filter((diagnostic) => !baselineByIdentity.has(diagnostic.identity));
  const removedDiagnostics = baseline.diagnostics.filter((diagnostic) => !currentIdentities.has(diagnostic.identity));
  const changedPathErrors = current.diagnostics.filter((diagnostic) => candidateChangedPaths.has(diagnostic.path));
  const baselineBlobChanges = [];
  for (const [path, diagnostic] of new Map(baseline.diagnostics.map((item) => [item.path, item])).entries()) {
    const currentObjectId = resolveCandidateGitObject(path);
    if (currentObjectId !== diagnostic.baselineGitObjectId) baselineBlobChanges.push(path);
  }
  return {
    baselineErrors: baseline.totals.errors,
    currentErrors: current.errorCount,
    baselineAffectedPaths: baseline.totals.affectedPaths,
    currentAffectedPaths: current.affectedPathCount,
    newDiagnostics,
    removedDiagnostics,
    changedPathErrors,
    baselineBlobChanges,
    pass: newDiagnostics.length === 0
      && changedPathErrors.length === 0
      && current.errorCount <= baseline.totals.errors
      && current.affectedPathCount <= baseline.totals.affectedPaths
      && baselineBlobChanges.length === 0,
  };
}
