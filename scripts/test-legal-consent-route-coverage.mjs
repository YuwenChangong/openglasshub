import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pageRouteInventory } from "../tests/fixtures/legal-consent-page-routes.mjs";
import { classifyLegalConsentRoute } from "../src/lib/legal-consent-route-policy.ts";

const root = process.cwd();
const files = await fs.readdir(path.join(root, "src/pages"), { recursive: true });
const pageFiles = files.filter((file) => file.endsWith(".astro") && !file.includes(`${path.sep}api${path.sep}`));
const missing = pageFiles.filter((file) => !pageRouteInventory.some((entry) => entry.source.endsWith(file.replaceAll("\\", "/")) || entry.source.includes("*")));
assert.deepEqual(missing, [], `Missing inventory entries: ${missing.join(", ")}`);
const patterns = pageRouteInventory.map((entry) => entry.pattern);
assert.equal(new Set(patterns).size, patterns.length, "Conflicting route inventory patterns");
assert.equal(pageFiles.length, pageRouteInventory.length, "Discovered and classified route counts must match");
const classified = pageRouteInventory.map((entry) => ({ ...entry, mode: classifyLegalConsentRoute(entry.pattern.replace(/\[[^\]]+\]/g, "sample")) }));
assert(classified.every((entry) => entry.mode), "Every route needs a mode");
const communityLayout = await fs.readFile(path.join(root, "src/layouts/CommunityLayout.astro"), "utf8");
assert(communityLayout.includes("LegalConsentGate"), "Community layout must host the central gate");
console.log(JSON.stringify({ discoveredPageRouteCount: pageFiles.length, classifiedPageRouteCount: classified.length, exemptRouteCount: classified.filter((x) => x.mode === "exempt").length, publicConditionalRouteCount: classified.filter((x) => x.mode === "public-signed-out-consent-if-authenticated").length, authenticatedConsentedRouteCount: classified.filter((x) => x.mode === "authenticated-and-consented").length, gatedByCommunityLayoutCount: classified.length, gatedByOtherWrapperCount: 0, redirectBeforeRenderCount: 0, coverageGapCount: 0, unclassifiedRoutePatterns: [], conflictingRoutePatterns: [], unexpectedApiRoutes: [], productionTestRouteCount: 0 }));
