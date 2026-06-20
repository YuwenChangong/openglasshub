import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "third_party/sensitive-lexicons/source-manifest.json");
const outputPath = path.join(repoRoot, "src/data/moderation/sensitive-lexicon.generated.json");
const outputManifestPath = path.join(repoRoot, "src/data/moderation/sensitive-lexicon-manifest.generated.json");
const customAllowPath = path.join(repoRoot, "src/data/moderation/custom-allowlist.json");
const customReviewPath = path.join(repoRoot, "src/data/moderation/custom-reviewlist.json");
const customDenyPath = path.join(repoRoot, "src/data/moderation/custom-denylist.json");

const MAX_TERM_LENGTH = 80;
const MIN_MULTI_BYTE_LENGTH = 2;
const MIN_ASCII_LENGTH = 3;

function normalizeTerm(term) {
  return String(term ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildCondensed(term) {
  return normalizeTerm(term).replace(/[\s\p{P}\p{S}_-]+/gu, "");
}

function isMostlyAscii(term) {
  return /^[a-z0-9\s._-]+$/i.test(term);
}

function shouldSkipTerm(term) {
  const normalized = normalizeTerm(term);
  if (!normalized) return true;
  if (normalized.startsWith("#")) return true;
  if (normalized.length > MAX_TERM_LENGTH) return true;
  if (/[<>{}\[\]]/.test(normalized)) return true;
  if (normalized.includes("http://") || normalized.includes("https://")) return false;
  if (isMostlyAscii(normalized) && buildCondensed(normalized).length < MIN_ASCII_LENGTH) return true;
  if (!isMostlyAscii(normalized) && buildCondensed(normalized).length < MIN_MULTI_BYTE_LENGTH) return true;
  return false;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readLines(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, "").trim())
    .filter(Boolean);
}

function createKey(entry) {
  return [
    entry.match,
    entry.category,
    entry.severity,
    entry.normalized ?? "",
    entry.pattern ?? "",
  ].join("::");
}

function makeEntry(base) {
  if (base.match === "regex") {
    return {
      ...base,
      normalized: null,
      condensed: null,
    };
  }

  return {
    ...base,
    normalized: normalizeTerm(base.term),
    condensed: buildCondensed(base.term),
  };
}

function sortTerms(terms) {
  return [...terms].sort((left, right) => {
    if (left.severity !== right.severity) {
      const order = { reject: 0, review: 1, soft_review: 2, allow: 3 };
      return order[left.severity] - order[right.severity];
    }
    return (right.condensed?.length ?? right.pattern?.length ?? 0) - (left.condensed?.length ?? left.pattern?.length ?? 0);
  });
}

async function main() {
  const manifest = await readJson(manifestPath);
  const customAllow = toArray(await readJson(customAllowPath));
  const customReview = toArray(await readJson(customReviewPath));
  const customDeny = toArray(await readJson(customDenyPath));
  const deduped = new Map();
  const importedFiles = [];
  let totalRawTerms = 0;

  for (const source of toArray(manifest.sources)) {
    for (const entry of toArray(source.imports)) {
      const sourceFile = path.join(repoRoot, "third_party/sensitive-lexicons", source.id, entry.sourcePath);
      importedFiles.push({
        source: source.id,
        file: path.relative(repoRoot, sourceFile).replace(/\\/g, "/"),
        category: entry.category,
        severity: entry.severity,
        match: entry.match,
      });

      const lines = await readLines(sourceFile);
      totalRawTerms += lines.length;

      for (const term of lines) {
        if (shouldSkipTerm(term)) continue;
        const normalized = normalizeTerm(term);
        const condensed = buildCondensed(term);
        const skipBecauseCommon =
          entry.severity !== "allow" &&
          [
            "ar",
            "ai",
            "xr",
            "mr",
            "vr",
            "wearable",
            "glasses",
            "smart glasses",
            "display",
            "rayneo",
            "xreal",
            "rokid",
            "viture",
            "vision pro",
          ].includes(normalized);
        const isExternalAsciiNoise =
          isMostlyAscii(normalized) &&
          !normalized.includes("http") &&
          !normalized.includes(".") &&
          condensed.length < 6;
        if (skipBecauseCommon) continue;
        if (isExternalAsciiNoise) continue;

        const generated = {
          term,
          normalized,
          condensed,
          category: entry.category,
          severity: entry.severity,
          source: source.id,
          match: entry.match,
        };
        deduped.set(createKey(generated), generated);
      }
    }
  }

  const customEntries = [
    ...customAllow.map((item) => ({ ...item, source: "openglass_custom_allow" })),
    ...customReview.map((item) => ({ ...item, source: "openglass_custom_review" })),
    ...customDeny.map((item) => ({ ...item, source: "openglass_custom_deny" })),
  ];

  for (const item of customEntries) {
    const match = item.match === "regex" ? "regex" : item.match === "exact" ? "exact" : "contains";
    const generated = makeEntry({
      term: item.term ?? null,
      pattern: item.pattern ?? null,
      category: item.category,
      severity: item.severity,
      source: item.source,
      match,
    });
    if (generated.match !== "regex" && shouldSkipTerm(generated.term)) continue;
    deduped.set(createKey(generated), generated);
  }

  const terms = sortTerms([...deduped.values()]);
  const output = {
    version: `lexicon-${new Date().toISOString().slice(0, 10)}`,
    generatedAt: new Date().toISOString(),
    sources: manifest.sources.map((source) => ({
      id: source.id,
      repoUrl: source.repoUrl,
      commit: source.commit,
      license: source.license,
    })),
    terms,
  };

  const outputManifest = {
    version: output.version,
    generatedAt: output.generatedAt,
    totalRawTerms,
    totalTerms: terms.length,
    importedFiles,
    customFiles: [
      "src/data/moderation/custom-allowlist.json",
      "src/data/moderation/custom-reviewlist.json",
      "src/data/moderation/custom-denylist.json",
    ],
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await fs.writeFile(outputManifestPath, `${JSON.stringify(outputManifest, null, 2)}\n`, "utf8");

  console.log(`Generated ${path.relative(repoRoot, outputPath)} with ${terms.length} terms.`);
}

main().catch((error) => {
  console.error("import-sensitive-lexicons failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
