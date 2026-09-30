export function resolveWorkersBuildEnvironment(context) {
  const ci = context.WORKERS_CI;
  const branch = context.WORKERS_CI_BRANCH;
  if (ci === undefined && branch === undefined) return "production";
  if ((ci !== "true" && ci !== "1") || typeof branch !== "string" || branch.trim() === "" || branch !== branch.trim()) {
    throw new Error("WORKERS_BUILD_CONTEXT_INVALID");
  }
  return branch === "main" ? "production" : "preview";
}
