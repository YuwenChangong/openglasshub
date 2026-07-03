import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const dataSource = await read("src/data/devices.ts");
  const indexRoute = await read("src/pages/devices/index.astro");
  const detailRoute = await read("src/pages/devices/[slug].astro");
  const navigation = await read("src/lib/site-navigation.ts");
  const explorer = await read("src/components/devices/DeviceLibraryExplorer.tsx");

  const slugMatches = [...dataSource.matchAll(/slug:\s*"([^"]+)"/g)].map((match) => match[1]);
  const verificationMatches = [...dataSource.matchAll(/verification_level:\s*"([^"]+)"/g)].map((match) => match[1]);
  const sourceLinksCount = [...dataSource.matchAll(/source_links:/g)].length;

  assert(slugMatches.length >= 8, `Expected at least 8 seed devices, found ${slugMatches.length}.`);
  assert(slugMatches.includes("xreal-one"), "Missing expected seed device slug: xreal-one.");
  assert(slugMatches.includes("ray-ban-meta"), "Missing expected seed device slug: ray-ban-meta.");
  assert(slugMatches.includes("apple-vision-pro"), "Missing expected seed device slug: apple-vision-pro.");
  assert(verificationMatches.length >= 8, "Expected verification levels on the seeded device entries.");
  assert(sourceLinksCount >= 8, "Expected source links on the seeded device entries.");

  assert(indexRoute.includes("DeviceLibraryExplorer"), "Device index route should render DeviceLibraryExplorer.");
  assert(indexRoute.includes('activeSection="devices"'), "Device index route should set activeSection to devices.");
  assert(indexRoute.includes("轻量对比") || explorer.includes("轻量对比"), "Device library should contain comparison UI copy.");
  assert(explorer.includes("maxCompareCount = 3"), "Comparison UI should cap selection at 3 devices.");
  assert(explorer.includes("toggleCompare"), "Comparison UI should include comparison toggle logic.");

  assert(detailRoute.includes("Astro.response.status = 404"), "Device detail route should set a 404 status for missing devices.");
  assert(detailRoute.includes('href="/devices/"'), "Device detail route should link back to /devices/.");
  assert(detailRoute.includes("来源与确认度"), "Device detail route should show verification/source information.");
  assert(detailRoute.includes("限制与注意点"), "Device detail route should render limitations when present.");
  assert(
    detailRoute.includes('href="/feed/"') || detailRoute.includes('href="/circles/"'),
    "Device detail route should include a community CTA.",
  );

  assert(navigation.includes('href: "/devices/"'), "Main navigation should include the /devices/ entry.");
  assert(!dataSource.includes("NaN"), "Device data source should not contain obviously broken values.");

  console.log(`DEVICE_LIBRARY_AUDIT_OK seedDevices=${slugMatches.length}`);
}

main().catch((error) => {
  console.error(`DEVICE_LIBRARY_AUDIT_FAIL ${error.message}`);
  process.exitCode = 1;
});
