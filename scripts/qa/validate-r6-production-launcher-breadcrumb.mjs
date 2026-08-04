import { readFile } from "node:fs/promises";

export function validateProductionLauncherBreadcrumb(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== "r6-production-launcher-stage-breadcrumb-v1" || !/^qa-canary-/.test(String(value.runId)) || value.stage !== "LAUNCHER_ENTRY" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value.createdAt))) throw new Error("R6_PRODUCTION_LAUNCH_BREADCRUMB_INVALID");
  return value;
}

if (process.argv[2]) { validateProductionLauncherBreadcrumb(JSON.parse(await readFile(process.argv[2], "utf8"))); process.stdout.write("R6_PRODUCTION_LAUNCH_BREADCRUMB_OK\n"); }
