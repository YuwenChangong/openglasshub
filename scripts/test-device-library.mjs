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
  const indexRoute = await read("src/pages/devices/index.astro");
  const detailRoute = await read("src/pages/devices/[slug].astro");
  const navigation = await read("src/lib/site-navigation.ts");
  const discussionHelper = await read("src/lib/device-discussion.ts");
  const feedRoute = await read("src/pages/feed/index.astro");
  const newPostRoute = await read("src/pages/posts/new.astro");

  assert(indexRoute.includes('Astro.redirect("/products/"'), "Legacy /devices/ index should redirect to /products/.");
  assert(detailRoute.includes("getDeviceBySlug"), "Legacy /devices/[slug] route should resolve known products before redirecting.");
  assert(detailRoute.includes('"/products/"'), "Legacy /devices/[slug] route should redirect back into products.");
  assert(!navigation.includes('href: "/devices/"'), "Main navigation should not include /devices/.");
  assert(discussionHelper.includes('libraryHref: "/products/"'), "Discussion helper should point library links back to /products/.");
  assert(discussionHelper.includes("productHref"), "Discussion helper should expose a safe product page link.");
  assert(feedRoute.includes("deviceDiscussion"), "Feed route should keep safe device discussion context handling.");
  assert(newPostRoute.includes("discussionContext.productHref"), "New-post prefill note should link to the product page.");

  console.log("DEVICE_LIBRARY_LEGACY_ROUTE_AUDIT_OK");
}

main().catch((error) => {
  console.error(`DEVICE_LIBRARY_LEGACY_ROUTE_AUDIT_FAIL ${error.message}`);
  process.exitCode = 1;
});
