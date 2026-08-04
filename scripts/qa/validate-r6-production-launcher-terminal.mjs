import { readFile } from "node:fs/promises";

export function validateProductionLauncherTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== "r6-production-launcher-terminal-result-v1" || typeof value.success !== "boolean" || !/^R6_PRODUCTION_LAUNCH_[A-Z0-9_]+$/.test(String(value.classification)) || !/^qa-canary-/.test(String(value.runId)) || typeof value.wrapperStarted !== "boolean" || typeof value.wrapperEntryConfirmed !== "boolean" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value.createdAt))) throw new Error("R6_PRODUCTION_LAUNCH_TERMINAL_INVALID");
  if (Object.keys(value).some((key) => /(password|token|secret|authorization|anon|session|slug|account.?id)/i.test(key))) throw new Error("R6_PRODUCTION_LAUNCH_TERMINAL_INVALID");
  if (value.success && (value.classification !== "R6_PRODUCTION_LAUNCH_VALIDATE_ONLY_READY" || value.wrapperStarted || value.wrapperEntryConfirmed)) throw new Error("R6_PRODUCTION_LAUNCH_TERMINAL_INVALID");
  return value;
}

if (process.argv[2]) { validateProductionLauncherTerminal(JSON.parse(await readFile(process.argv[2], "utf8"))); process.stdout.write("R6_PRODUCTION_LAUNCH_TERMINAL_OK\n"); }
