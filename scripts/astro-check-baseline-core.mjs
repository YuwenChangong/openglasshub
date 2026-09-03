import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";

export const ASTRO_CHECK_BASELINE_COMMIT = "e2f45dac135edfc10d866fc83df05c0590c1adb9";
export const ASTRO_CHECK_BASELINE_TOOLCHAIN = Object.freeze({
  astro: "7.2.10",
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

function parseDiffPath(line) {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match && match[1] === match[2] ? match[1] : null;
}

export function parseZeroContextDiff(diff) {
  const hunksByPath = new Map();
  let currentPath = null;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentPath = parseDiffPath(line);
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || currentPath === null) continue;
    const parsed = {
      oldStart: Number(hunk[1]),
      oldCount: Number(hunk[2] ?? 1),
      newStart: Number(hunk[3]),
      newCount: Number(hunk[4] ?? 1),
    };
    const hunks = hunksByPath.get(currentPath) ?? [];
    hunks.push(parsed);
    hunksByPath.set(currentPath, hunks);
  }
  return hunksByPath;
}

function hunkCanAffectDiagnosticAnchor(hunk, line) {
  if (hunk.oldCount === 0) return hunk.newStart <= line;
  if (hunk.newCount === 0) return hunk.oldStart <= line;
  const oldEnd = hunk.oldStart + hunk.oldCount - 1;
  const newEnd = hunk.newStart + hunk.newCount - 1;
  return (hunk.oldStart <= line && line <= oldEnd) || (hunk.newStart <= line && line <= newEnd);
}

export function compareDiagnostics({ baseline, current, candidateChangedPaths, candidateZeroContextDiff = "" }) {
  verifyBaselineManifest(baseline);
  const baselineByIdentity = new Map(baseline.diagnostics.map((diagnostic) => [diagnostic.identity, diagnostic]));
  const currentIdentities = new Set(current.diagnostics.map((diagnostic) => diagnostic.identity));
  const newDiagnostics = current.diagnostics.filter((diagnostic) => !baselineByIdentity.has(diagnostic.identity));
  const removedDiagnostics = baseline.diagnostics.filter((diagnostic) => !currentIdentities.has(diagnostic.identity));
  const hunksByPath = parseZeroContextDiff(candidateZeroContextDiff);
  const changedDiagnosticSourceLines = [];
  const unparsedChangedDiagnosticPaths = [];
  for (const diagnostic of baseline.diagnostics) {
    if (!currentIdentities.has(diagnostic.identity) || !candidateChangedPaths.has(diagnostic.path)) continue;
    const hunks = hunksByPath.get(diagnostic.path);
    if (!hunks) {
      unparsedChangedDiagnosticPaths.push(diagnostic.path);
      continue;
    }
    if (hunks.some((hunk) => hunkCanAffectDiagnosticAnchor(hunk, diagnostic.line))) {
      changedDiagnosticSourceLines.push(diagnostic);
    }
  }
  return {
    baselineErrors: baseline.totals.errors,
    currentErrors: current.errorCount,
    baselineAffectedPaths: baseline.totals.affectedPaths,
    currentAffectedPaths: current.affectedPathCount,
    newDiagnostics,
    removedDiagnostics,
    changedDiagnosticSourceLines,
    unparsedChangedDiagnosticPaths: [...new Set(unparsedChangedDiagnosticPaths)].sort(),
    pass: newDiagnostics.length === 0
      && changedDiagnosticSourceLines.length === 0
      && current.errorCount <= baseline.totals.errors
      && current.affectedPathCount <= baseline.totals.affectedPaths
      && unparsedChangedDiagnosticPaths.length === 0,
  };
}
