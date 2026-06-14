import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { input: "docs/product-asset-sources.json", verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input" && argv[index + 1]) {
      args.input = argv[index + 1];
      index += 1;
    } else if (token === "--verbose") {
      args.verbose = true;
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

async function probeUrl(url, { expectImage = false } = {}) {
  if (!url) {
    return { ok: false, status: 0, url, contentType: null, error: "missing" };
  }

  const headers = { "user-agent": "Mozilla/5.0 OpenGlassHubAssetAudit/1.0" };
  const methods = ["HEAD", "GET"];

  for (const method of methods) {
    try {
      const response = await fetch(url, { method, redirect: "follow", headers });
      const contentType = response.headers.get("content-type");
      const ok = response.ok && (!expectImage || Boolean(contentType?.startsWith("image/")));
      if (ok || method === "GET") {
        return {
          ok,
          status: response.status,
          url,
          finalUrl: response.url,
          contentType,
          error: ok ? null : expectImage ? `Expected image/*, got ${contentType ?? "unknown"}` : `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      if (method === "GET") {
        return { ok: false, status: 0, url, contentType: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  return { ok: false, status: 0, url, contentType: null, error: "unreachable" };
}

function collectDuplicates(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item) continue;
    seen.set(item, (seen.get(item) ?? 0) + 1);
  }
  return Array.from(seen.entries()).filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest(args.input);

  const brandResults = [];
  const productResults = [];
  const brokenAssets = [];

  for (const brand of manifest.brands ?? []) {
    const logoUrl = normalizeUrl(brand.logo?.logoImageUrl);
    const logoResult = brand.logo?.useInUi ? await probeUrl(logoUrl, { expectImage: true }) : null;
    if (logoResult && !logoResult.ok) {
      brokenAssets.push({ kind: "brand-logo", slug: brand.brandSlug, url: logoUrl, error: logoResult.error, status: logoResult.status });
    }
    brandResults.push({ brand, logoUrl, logoResult });
  }

  for (const product of manifest.products ?? []) {
    const imageUrl = normalizeUrl(product.image?.imageUrl);
    const officialProductResult = await probeUrl(normalizeUrl(product.officialProductUrl));
    const buyResult = product.buyUrl ? await probeUrl(normalizeUrl(product.buyUrl)) : null;
    const sourceResult = product.sourceUrl ? await probeUrl(normalizeUrl(product.sourceUrl)) : null;
    const imageResult = product.image?.useInUi ? await probeUrl(imageUrl, { expectImage: true }) : null;

    if (!officialProductResult.ok) {
      brokenAssets.push({ kind: "official-product-url", slug: product.slug, url: product.officialProductUrl, error: officialProductResult.error, status: officialProductResult.status });
    }
    if (buyResult && !buyResult.ok) {
      brokenAssets.push({ kind: "buy-url", slug: product.slug, url: product.buyUrl, error: buyResult.error, status: buyResult.status });
    }
    if (sourceResult && !sourceResult.ok) {
      brokenAssets.push({ kind: "source-url", slug: product.slug, url: product.sourceUrl, error: sourceResult.error, status: sourceResult.status });
    }
    if (imageResult && !imageResult.ok) {
      brokenAssets.push({ kind: "product-image", slug: product.slug, url: imageUrl, error: imageResult.error, status: imageResult.status });
    }

    productResults.push({
      product,
      imageUrl,
      officialProductResult,
      buyResult,
      sourceResult,
      imageResult,
    });
  }

  const brandsWithUsableLogo = brandResults.filter((entry) => entry.brand.logo?.useInUi && entry.logoResult?.ok).length;
  const brandsFallbackWordmark = brandResults.filter((entry) => !entry.brand.logo?.useInUi || entry.brand.logo?.assetStatus === "fallback-wordmark").length;
  const productsWithUsableImage = productResults.filter((entry) => entry.product.image?.useInUi && entry.imageResult?.ok).length;
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
  console.log(`duplicated asset urls: ${duplicateAssetUrls.length}`);
  console.log(`duplicated links: ${duplicateLinks.length}`);

  if (args.verbose) {
    console.log("");
    console.log("brand asset states:");
    for (const entry of brandResults) {
      console.log(`- ${entry.brand.brandSlug}: ${entry.brand.logo?.assetStatus}${entry.logoResult ? ` (${entry.logoResult.status} ${entry.logoResult.contentType ?? ""})` : ""}`);
    }

    console.log("");
    console.log("product asset states:");
    for (const entry of productResults) {
      const imageState = entry.product.image?.assetStatus ?? "unknown";
      const imageProbe = entry.imageResult ? `${entry.imageResult.status} ${entry.imageResult.contentType ?? ""}` : "not-probed";
      console.log(`- ${entry.product.slug}: ${imageState} (${imageProbe})`);
    }

    if (brokenAssets.length > 0) {
      console.log("");
      console.log("broken assets:");
      for (const issue of brokenAssets) {
        console.log(`- ${issue.kind} ${issue.slug}: ${issue.url} -> ${issue.status} ${issue.error ?? ""}`.trim());
      }
    }

    if (duplicateAssetUrls.length > 0) {
      console.log("");
      console.log("duplicated asset urls:");
      for (const duplicate of duplicateAssetUrls) {
        console.log(`- ${duplicate.value} (${duplicate.count})`);
      }
    }

    if (duplicateLinks.length > 0) {
      console.log("");
      console.log("duplicated links:");
      for (const duplicate of duplicateLinks) {
        console.log(`- ${duplicate.value} (${duplicate.count})`);
      }
    }
  }
}

main().catch((error) => {
  console.error("asset audit failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
