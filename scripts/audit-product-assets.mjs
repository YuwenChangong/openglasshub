import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "docs/product-asset-sources.json",
    verbose: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input" && argv[index + 1]) {
      args.input = argv[index + 1];
      index += 1;
    } else if (token === "--verbose") {
      args.verbose = true;
    } else if (token === "--strict") {
      args.strict = true;
    }
  }

  return args;
}

function normalizeUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

async function loadManifest(inputPath) {
  const absolutePath = path.resolve(process.cwd(), inputPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw);
}

async function loadSnapshotSpecs() {
  try {
    const absolutePath = path.resolve(process.cwd(), "src/data/device-spec-candidates.json");
    const raw = await fs.readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw);
    return new Map((parsed.items ?? []).map((item) => [item.slug, item]));
  } catch {
    return new Map();
  }
}

async function probeLink(url) {
  if (!url) return { ok: false, status: 0, url, error: "missing" };
  const headers = { "user-agent": "Mozilla/5.0 OpenGlassHubAssetAudit/2.0" };
  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await fetch(url, { method, redirect: "follow", headers });
      if (response.ok || method === "GET") {
        return {
          ok: response.ok,
          status: response.status,
          url,
          finalUrl: response.url,
          contentType: response.headers.get("content-type"),
          error: response.ok ? null : `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      if (method === "GET") {
        return {
          ok: false,
          status: 0,
          url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  return { ok: false, status: 0, url, error: "unreachable" };
}

function readPngSize(bytes) {
  if (bytes.length < 24) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readGifSize(bytes) {
  if (bytes.length < 10) return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function readJpegSize(bytes) {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (!marker) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (offset + 8 >= bytes.length) return null;
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    if (offset + 4 >= bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpSize(bytes) {
  if (bytes.length < 30) return null;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    const width = 1 + bytes.readUIntLE(24, 3);
    const height = 1 + bytes.readUIntLE(27, 3);
    return { width, height };
  }
  if (chunk === "VP8 ") {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  return null;
}

function readSvgSize(text) {
  const viewBox = text.match(/viewBox=["']\s*[\d.\-]+\s+[\d.\-]+\s+([\d.\-]+)\s+([\d.\-]+)\s*["']/i);
  if (viewBox) {
    return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  }
  const width = text.match(/\bwidth=["']([\d.]+)(?:px)?["']/i);
  const height = text.match(/\bheight=["']([\d.]+)(?:px)?["']/i);
  if (width && height) {
    return { width: Number(width[1]), height: Number(height[1]) };
  }
  return null;
}

async function probeImage(url) {
  if (!url) return { ok: false, status: 0, url, error: "missing", contentType: null, dimensions: null };
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 OpenGlassHubAssetAudit/2.0" },
    });
    const contentType = response.headers.get("content-type");
    if (!response.ok) {
      return { ok: false, status: response.status, url, error: `HTTP ${response.status}`, contentType, dimensions: null };
    }
    if (!contentType?.startsWith("image/")) {
      return { ok: false, status: response.status, url, error: `Expected image/*, got ${contentType ?? "unknown"}`, contentType, dimensions: null };
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    let dimensions = null;
    if (contentType.includes("png")) dimensions = readPngSize(bytes);
    else if (contentType.includes("jpeg") || contentType.includes("jpg")) dimensions = readJpegSize(bytes);
    else if (contentType.includes("gif")) dimensions = readGifSize(bytes);
    else if (contentType.includes("webp")) dimensions = readWebpSize(bytes);
    else if (contentType.includes("svg")) dimensions = readSvgSize(bytes.toString("utf8"));

    return {
      ok: true,
      status: response.status,
      url,
      finalUrl: response.url,
      contentType,
      dimensions,
      byteLength: bytes.length,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      error: error instanceof Error ? error.message : String(error),
      contentType: null,
      dimensions: null,
    };
  }
}

function collectDuplicates(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item) continue;
    seen.set(item, (seen.get(item) ?? 0) + 1);
  }
  return Array.from(seen.entries())
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function getRatio(dimensions) {
  if (!dimensions?.width || !dimensions?.height) return null;
  return dimensions.width / dimensions.height;
}

function evaluateLogo(entry, probe) {
  const issues = [];
  if (!entry.logo?.useInUi) return issues;
  if (!probe?.ok) {
    issues.push("logo unavailable");
    return issues;
  }
  const dims = probe.dimensions;
  const ratio = getRatio(dims);
  if (dims && (dims.width < 32 || dims.height < 16)) issues.push("logo too small");
  if (ratio && ratio > 10) issues.push("logo ratio too wide");
  if (ratio && ratio < 0.1) issues.push("logo ratio too tall");
  return issues;
}

function evaluateProductImage(entry, probe) {
  const issues = [];
  if (!entry.image?.useInUi) return issues;
  if (!probe?.ok) {
    issues.push("image unavailable");
    return issues;
  }
  const dims = probe.dimensions;
  const ratio = getRatio(dims);
  const haystack = `${entry.image?.imageUrl ?? ""} ${entry.image?.sourceUrl ?? ""}`.toLowerCase();
  if (dims && (dims.width < 300 || dims.height < 180)) issues.push("image too small");
  if (ratio && ratio > 6) issues.push("image ratio too wide");
  if (ratio && ratio < 0.2) issues.push("image ratio too tall");
  if (/logo|favicon|brand-only|wordmark/.test(haystack)) issues.push("looks like logo asset");
  if (/award|winner|olympic|partner/.test(haystack)) issues.push("contains promo badge text in asset path");
  if (probe?.contentType?.includes("svg")) issues.push("svg image is unlikely to be a product render");
  return issues;
}

function evaluateSpecRisk(snapshotEntry) {
  const issues = [];
  const specs = snapshotEntry?.specs ?? {};
  for (const [field, value] of Object.entries(specs)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (/^0+$/.test(trimmed)) issues.push(`suspicious spec ${field}=${trimmed}`);
    if (/^unknown$/i.test(trimmed)) continue;
    if (field === "weight" && /^([0-9]+)\s*g$/i.test(trimmed)) {
      const grams = Number(trimmed.replace(/[^\d.]/g, ""));
      if (Number.isFinite(grams) && grams > 0 && grams < 12) issues.push(`suspicious spec ${field}=${trimmed}`);
    }
    if (field === "brightness" && /^0+\s*(nits)?$/i.test(trimmed)) issues.push(`suspicious spec ${field}=${trimmed}`);
    if (field === "connectivity" && /wifi 6g \| wifi 8g/i.test(trimmed)) issues.push(`suspicious spec ${field}=${trimmed}`);
  }
  return issues;
}

function formatIssueList(issues) {
  return issues.length ? issues.join(", ") : "none";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest(args.input);
  const snapshotMap = await loadSnapshotSpecs();

  const brandResults = [];
  const productResults = [];
  const brokenAssets = [];
  const warnings = [];
  const advisoryNotes = [];

  for (const brand of manifest.brands ?? []) {
    const logoUrl = normalizeUrl(brand.logo?.logoImageUrl);
    const logoProbe = brand.logo?.useInUi ? await probeImage(logoUrl) : null;
    const issues = evaluateLogo(brand, logoProbe);
    if (logoProbe && !logoProbe.ok) {
      brokenAssets.push({ kind: "brand-logo", slug: brand.brandSlug, url: logoUrl, error: logoProbe.error, status: logoProbe.status });
    }
    if (issues.length > 0 && !brand.assetExceptionReason) {
      warnings.push({ kind: "brand-logo", slug: brand.brandSlug, issues });
    }
    brandResults.push({ brand, logoUrl, logoProbe, issues });
  }

  for (const product of manifest.products ?? []) {
    const imageUrl = normalizeUrl(product.image?.imageUrl);
    const officialProductResult = await probeLink(normalizeUrl(product.officialProductUrl));
    const buyResult = product.buyUrl ? await probeLink(normalizeUrl(product.buyUrl)) : null;
    const sourceResult = product.sourceUrl ? await probeLink(normalizeUrl(product.sourceUrl)) : null;
    const imageProbe = product.image?.useInUi ? await probeImage(imageUrl) : null;
    const issues = evaluateProductImage(product, imageProbe);
    const logoUrl = normalizeUrl(manifest.brands?.find((brand) => brand.brandSlug === product.brandSlug)?.logo?.logoImageUrl);
    const snapshotIssues = evaluateSpecRisk(snapshotMap.get(product.slug));
    if (logoUrl && imageUrl && (logoUrl === imageUrl || imageUrl.includes("logo") || imageUrl.includes("brand"))) {
      issues.push("logo-as-product-image risk");
    }

    if (!officialProductResult.ok && product.officialProductUrl) {
      brokenAssets.push({ kind: "official-product-url", slug: product.slug, url: product.officialProductUrl, error: officialProductResult.error, status: officialProductResult.status });
    }
    if (buyResult && !buyResult.ok) {
      brokenAssets.push({ kind: "buy-url", slug: product.slug, url: product.buyUrl, error: buyResult.error, status: buyResult.status });
    }
    if (sourceResult && !sourceResult.ok) {
      brokenAssets.push({ kind: "source-url", slug: product.slug, url: product.sourceUrl, error: sourceResult.error, status: sourceResult.status });
    }
    if (imageProbe && !imageProbe.ok) {
      brokenAssets.push({ kind: "product-image", slug: product.slug, url: imageUrl, error: imageProbe.error, status: imageProbe.status });
    }
    if (issues.length > 0 && !product.assetExceptionReason) {
      warnings.push({ kind: "product-image", slug: product.slug, issues });
    }
    if (snapshotIssues.length > 0) {
      advisoryNotes.push({ kind: "snapshot-spec", slug: product.slug, issues: snapshotIssues });
    }

    productResults.push({
      product,
      imageUrl,
      officialProductResult,
      buyResult,
      sourceResult,
      imageProbe,
      issues,
      snapshotIssues,
    });
  }

  const brandsWithUsableLogo = brandResults.filter((entry) => entry.brand.logo?.useInUi && entry.logoProbe?.ok).length;
  const brandsFallbackWordmark = brandResults.filter((entry) => !entry.brand.logo?.useInUi || entry.brand.logo?.assetStatus === "fallback-wordmark").length;
  const productsWithUsableImage = productResults.filter((entry) => entry.product.image?.useInUi && entry.imageProbe?.ok && entry.product.assetQaStatus === "usable").length;
  const productsPlaceholder = productResults.filter((entry) => !entry.product.image?.useInUi || entry.product.image?.assetStatus === "placeholder").length;

  const duplicateAssetUrls = collectDuplicates([
    ...brandResults.map((entry) => entry.logoUrl),
    ...productResults.map((entry) => entry.imageUrl),
  ]);
  const duplicateLinks = collectDuplicates(
    productResults.flatMap((entry) => [
      normalizeUrl(entry.product.officialProductUrl),
      normalizeUrl(entry.product.buyUrl),
      normalizeUrl(entry.product.sourceUrl),
    ]),
  );

  console.log(`total brands: ${brandResults.length}`);
  console.log(`brands with usable logo: ${brandsWithUsableLogo}`);
  console.log(`brands fallback wordmark: ${brandsFallbackWordmark}`);
  console.log(`total products: ${productResults.length}`);
  console.log(`products with usable image: ${productsWithUsableImage}`);
  console.log(`products placeholder: ${productsPlaceholder}`);
  console.log(`broken assets: ${brokenAssets.length}`);
  console.log(`warnings: ${warnings.length}`);
  console.log(`advisory notes: ${advisoryNotes.length}`);
  console.log(`duplicated asset urls: ${duplicateAssetUrls.length}`);
  console.log(`duplicated links: ${duplicateLinks.length}`);

  if (args.verbose) {
    console.log("\nbrand asset states:");
    for (const entry of brandResults) {
      const dims = entry.logoProbe?.dimensions ? `${entry.logoProbe.dimensions.width}x${entry.logoProbe.dimensions.height}` : "n/a";
      const probeSummary = entry.logoProbe ? `${entry.logoProbe.status} ${entry.logoProbe.contentType ?? ""} ${dims}`.trim() : "not-probed";
      console.log(`- ${entry.brand.brandSlug}: ${entry.brand.logo?.assetStatus} (${probeSummary}) issues=${formatIssueList(entry.issues)}`);
    }

    console.log("\nproduct asset states:");
    for (const entry of productResults) {
      const dims = entry.imageProbe?.dimensions ? `${entry.imageProbe.dimensions.width}x${entry.imageProbe.dimensions.height}` : "n/a";
      const probeSummary = entry.imageProbe ? `${entry.imageProbe.status} ${entry.imageProbe.contentType ?? ""} ${dims}`.trim() : "not-probed";
      console.log(`- ${entry.product.slug}: ${entry.product.image?.assetStatus ?? "unknown"} qa=${entry.product.assetQaStatus ?? "n/a"} (${probeSummary}) issues=${formatIssueList(entry.issues)} advisory=${formatIssueList(entry.snapshotIssues ?? [])}`);
    }

    if (warnings.length > 0) {
      console.log("\nwarnings:");
      for (const warning of warnings) {
        console.log(`- ${warning.kind} ${warning.slug}: ${warning.issues.join(", ")}`);
      }
    }

    if (advisoryNotes.length > 0) {
      console.log("\nadvisory notes:");
      for (const note of advisoryNotes) {
        console.log(`- ${note.kind} ${note.slug}: ${note.issues.join(", ")}`);
      }
    }

    if (brokenAssets.length > 0) {
      console.log("\nbroken assets:");
      for (const issue of brokenAssets) {
        console.log(`- ${issue.kind} ${issue.slug}: ${issue.url} -> ${issue.status} ${issue.error ?? ""}`.trim());
      }
    }

    if (duplicateAssetUrls.length > 0) {
      console.log("\nduplicated asset urls:");
      for (const duplicate of duplicateAssetUrls) {
        console.log(`- ${duplicate.value} (${duplicate.count})`);
      }
    }

    if (duplicateLinks.length > 0) {
      console.log("\nduplicated links:");
      for (const duplicate of duplicateLinks) {
        console.log(`- ${duplicate.value} (${duplicate.count})`);
      }
    }
  }

  if (args.strict) {
    const strictFailures = [];
    if (brandsWithUsableLogo < 6) strictFailures.push(`logo coverage too low: ${brandsWithUsableLogo}/6 required`);
    if (productsWithUsableImage < 8) strictFailures.push(`usable clean product image coverage too low: ${productsWithUsableImage}/8 required`);
    if (brokenAssets.length > 0) strictFailures.push(`broken assets detected: ${brokenAssets.length}`);
    if (duplicateAssetUrls.length > 0) strictFailures.push(`duplicated asset urls detected: ${duplicateAssetUrls.length}`);

    const blockingWarnings = productResults.filter((entry) =>
      entry.issues.some((issue) =>
        issue === "image unavailable" ||
        issue === "logo unavailable" ||
        issue === "looks like logo asset" ||
        issue === "logo-as-product-image risk"
      ),
    );
    if (blockingWarnings.length > 0) strictFailures.push(`blocking asset heuristics detected: ${blockingWarnings.length}`);
    const wrongImagesStillInUi = productResults.filter(
      (entry) => entry.product.assetQaStatus === "wrong-removed" && entry.product.image?.useInUi,
    );
    if (wrongImagesStillInUi.length > 0) strictFailures.push(`wrong image entries still enabled in UI: ${wrongImagesStillInUi.length}`);

    if (strictFailures.length > 0) {
      console.error("\nSTRICT AUDIT FAILED");
      for (const failure of strictFailures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
    } else {
      console.log("\nSTRICT AUDIT PASSED");
    }
  }
}

main().catch((error) => {
  console.error("asset audit failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
