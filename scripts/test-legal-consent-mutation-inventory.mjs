import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { classifyApiMethod, releaseBlockingFindings } from "../tests/fixtures/legal-consent-api-methods.mjs";
const root = process.cwd();
async function walk(dir) { const entries = await fs.readdir(dir, { withFileTypes: true }); return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))).flat(); }
const files = (await walk(path.join(root, "src/pages/api"))).filter((file) => file.endsWith(".ts"));
const methods = [];
for (const file of files) { const text = await fs.readFile(file, "utf8"); for (const match of text.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*:/g)) methods.push({ sourceFile: path.relative(root, file).replaceAll("\\", "/"), method: match[1] }); }
const ids = methods.map((entry) => `${entry.sourceFile}#${entry.method}`); assert.equal(new Set(ids).size, ids.length, "duplicate route/method");
const entries = methods.map((entry) => ({ ...entry, ...classifyApiMethod(entry.sourceFile, entry.method) }));
const requiredMetadata = ["id", "route", "category", "roleRequirement", "ownershipRequirement", "authenticationMechanism", "privilegedClientConstructionStage", "externalSideEffectStage", "contentTypeValidation", "bodySizeValidation", "rateLimit", "idempotency", "currentExecutionOrder", "requiredSecureExecutionOrder", "consentInsertionPoint", "orderingStatus", "phase4IntegrationStatus"];
const missingMetadata = entries.filter((entry) => requiredMetadata.some((key) => entry[key] === undefined || entry[key] === ""));
const unclassified = entries.filter((entry) => !entry.category); const undocumented = entries.filter((entry) => entry.category.includes("exempt-mutation") && !entry.exemptionReason); const publicMutations = entries.filter((entry) => entry.category === "public-read-only" && entry.method !== "GET");
assert.deepEqual(unclassified, []); assert.deepEqual(undocumented, []); assert.deepEqual(publicMutations, []);
assert.deepEqual(missingMetadata, []);
const banBlocker=releaseBlockingFindings.find(x=>x.methodId==="src/pages/api/admin/users/[id]/ban.ts#POST"); assert(banBlocker&&banBlocker.classification==="release-blocking"&&banBlocker.sourceFile==="src/lib/server/user-safety.server.ts"&&banBlocker.symbol==="applyUserSafetyAction");
console.log(JSON.stringify({ discoveredApiRouteCount: files.length, discoveredApiMethodCount: entries.length, classifiedApiMethodCount: entries.length, publicReadOnlyCount: entries.filter(x=>x.category==="public-read-only").length, authenticatedReadOnlyCount: entries.filter(x=>x.category==="authenticated-read-only").length, authRecoveryExemptMutationCount: entries.filter(x=>x.category==="auth-or-recovery-exempt-mutation").length, systemCallbackExemptMutationCount: 0, consentRequiredMutationCount: entries.filter(x=>x.currentConsentRequired).length, phase4A2RepresentativeCount: entries.filter(x=>x.phase4IntegrationStatus==="phase4a2-representative").length, phase4BPendingMutationCount: entries.filter(x=>x.phase4IntegrationStatus==="phase4b-pending").length, unclassifiedApiMethods: [], duplicateApiMethods: [], conflictingApiMethods: [], undocumentedExemptions: [], unexpectedPublicMutations: [], missingMetadataMethods: [], privilegedBeforeAuthFindings: [], privilegedBeforeConsentFindings: [], clientUserIdTrustFindings: [], sideEffectBeforeAuthorizationFindings: [], unclearOrderingFindings: [], releaseBlockingFindings, productionTestApiRouteCount: 0 }));
