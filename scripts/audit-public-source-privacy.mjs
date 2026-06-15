import fs from "node:fs/promises";
import path from "node:path";

const DIST_TERMS = [
  "vr52.com",
  "product-data-sources",
  "sourceurl",
  "sourcenotes",
  "source ledger",
  "参数来源",
  "资料来源",
  "最后核对",
  "已确认参数",
  "needsreviewfields",
  "missingfields",
  "confirmedfields",
  "lastchecked",
  "data status",
  "docs/product-data-sources",
];

const SRC_RENDER_TERMS = [
  "参数来源",
  "资料来源",
  "sourceurl",
  "sourcenotes",
  "lastchecked",
  "confirmedfields",
  "needsreviewfields",
  "missingfields",
];

const DIST_INCLUDE = [/devices/i, /products/i, /device-catalog/i, /product-public-data/i];
const SRC_INCLUDE = [
  /src\\pages\\devices/i,
  /src\\pages\\products/i,
  /src\\components\\products/i,
  /src\\lib\\device-catalog\.ts$/i,
];

function parseArgs(argv) {
  const getValue = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] ?? fallback : fallback;
  };
  return {
    dist: getValue("--dist", "dist"),
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
  };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

async function scanFiles(files, terms) {
  const hits = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8").catch(() => null);
    if (content == null) continue;
    const lowered = content.toLowerCase();
    for (const term of terms) {
      if (lowered.includes(term.toLowerCase())) {
        hits.push({ file, term });
      }
    }
  }
  return hits;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distPath = path.resolve(process.cwd(), args.dist);
  if (!(await exists(distPath))) {
    console.error(`dist not found at ${distPath}; run npm run build first.`);
    process.exitCode = 1;
    return;
  }

  const distFiles = (await walk(distPath)).filter((file) => DIST_INCLUDE.some((pattern) => pattern.test(file)));
  const srcRoots = [path.resolve(process.cwd(), "src/pages"), path.resolve(process.cwd(), "src/components"), path.resolve(process.cwd(), "src/lib")];
  const srcFiles = [];
  for (const root of srcRoots) {
    if (await exists(root)) srcFiles.push(...(await walk(root)));
  }
  const filteredSrcFiles = srcFiles.filter((file) => SRC_INCLUDE.some((pattern) => pattern.test(file)));

  const distHits = await scanFiles(distFiles, DIST_TERMS);
  const srcHits = await scanFiles(filteredSrcFiles, SRC_RENDER_TERMS);

  console.log(`product-facing dist files scanned: ${distFiles.length}`);
  console.log(`product source files scanned: ${filteredSrcFiles.length}`);
  console.log(`dist hits: ${distHits.length}`);
  console.log(`src hits: ${srcHits.length}`);

  if (args.verbose) {
    for (const hit of distHits) console.log(`[dist] ${path.relative(process.cwd(), hit.file)} -> ${hit.term}`);
    for (const hit of srcHits) console.log(`[src] ${path.relative(process.cwd(), hit.file)} -> ${hit.term}`);
  }

  if (distHits.length > 0 || srcHits.length > 0) {
    console.error("\nPUBLIC SOURCE PRIVACY AUDIT FAILED");
    process.exitCode = 1;
    return;
  }

  console.log("\nPUBLIC SOURCE PRIVACY AUDIT PASSED");
}

main().catch((error) => {
  console.error("public source privacy audit failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
