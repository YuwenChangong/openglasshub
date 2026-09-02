import assert from "node:assert/strict";
import { createP8MigrationHistoryReport } from "./p8-migration-history-report.mjs";

const report = await createP8MigrationHistoryReport();
assert.equal(report.result, "PASS_REQUIRES_PRODUCTION_HISTORY");
assert.equal(report.fileCount, 35);
assert.equal(report.uniqueVersionCount, 19);
assert.equal(report.duplicateVersionGroupCount, 10);
assert(report.duplicateGroups.every((group) => group.files.length > 1 && group.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))));
assert.equal(report.duplicateGroups.find((group) => group.version === "20260829")?.classification, "ORDER_DEPENDENT_DEVICE_LIBRARY_BEFORE_SLUG_LOCK");
console.log("P8_MIGRATION_HISTORY_REPORT_OK");
