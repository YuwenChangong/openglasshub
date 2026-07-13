export const expectedBatchCount = 6;
export const expectedMethodCount = 66;
export const completedBatchIds = new Set(["phase4a1-trace-batch-1", "phase4a1-trace-batch-2", "phase4a1-trace-batch-3"]);
const methodOrder = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };
export function buildTraceBatches(methodIds, representatives = []) {
  const sorted = [...methodIds].sort((a, b) => { const [af, am] = a.split("#"), [bf, bm] = b.split("#"); return af.localeCompare(bf) || methodOrder[am] - methodOrder[bm]; });
  const size = Math.ceil(sorted.length / expectedBatchCount);
  return Array.from({ length: expectedBatchCount }, (_, index) => { const methodIds = sorted.slice(index * size, (index + 1) * size); const id = `phase4a1-trace-batch-${index + 1}`; return { id, order: index + 1, sourceFiles: [...new Set(methodIds.map((id) => id.split("#")[0]))], methodIds, methodCount: methodIds.length, representativeMethodIds: methodIds.filter((id) => representatives.includes(id)), status: completedBatchIds.has(id) ? "complete" : "pending" }; });
}
export function traceBatchForMethod(methodId, methodIds) { return buildTraceBatches(methodIds).find((batch) => batch.methodIds.includes(methodId))?.id ?? null; }

export const fileTraceProgress = {
  "src/pages/api/forum/circles/[slug]/manage.ts": {
    batchId: "phase4a1-trace-batch-4",
    methodIds: ["src/pages/api/forum/circles/[slug]/manage.ts#GET", "src/pages/api/forum/circles/[slug]/manage.ts#PATCH", "src/pages/api/forum/circles/[slug]/manage.ts#DELETE"],
    status: "complete",
  },
  "src/pages/api/forum/circles/[slug]/comments.ts": {
    batchId: "phase4a1-trace-batch-4",
    methodIds: ["src/pages/api/forum/circles/[slug]/comments.ts#GET", "src/pages/api/forum/circles/[slug]/comments.ts#PATCH", "src/pages/api/forum/circles/[slug]/comments.ts#DELETE"],
    status: "complete",
  },
  "src/pages/api/forum/circles.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/forum/circles.ts#GET", "src/pages/api/forum/circles.ts#POST", "src/pages/api/forum/circles.ts#PATCH"],
    status: "complete",
  },
  "src/pages/api/auth/resend-confirmation.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/auth/resend-confirmation.ts#POST"],
    status: "complete",
  },
  "src/pages/api/admin/users/[id]/warn.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/admin/users/[id]/warn.ts#POST"],
    status: "complete",
  },
  "src/pages/api/admin/users/[id]/unban.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/admin/users/[id]/unban.ts#POST"],
    status: "complete",
  },
  "src/pages/api/admin/users/[id]/suspend.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/admin/users/[id]/suspend.ts#POST"],
    status: "complete",
  },
  "src/pages/api/admin/users/[id]/safety.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/admin/users/[id]/safety.ts#GET"],
    status: "complete",
  },
  "src/pages/api/admin/users/[id]/clear-warning.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/admin/users/[id]/clear-warning.ts#POST"],
    status: "complete",
  },
  "src/pages/api/admin/users/[id]/ban.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/admin/users/[id]/ban.ts#POST"],
    status: "complete",
  },
  "src/pages/api/admin/users.ts": {
    batchId: "phase4a1-trace-batch-3",
    methodIds: ["src/pages/api/admin/users.ts#GET"],
    status: "complete",
  },
  "src/pages/api/admin/reports/[id]/action.ts": {
    batchId: "phase4a1-trace-batch-2",
    methodIds: ["src/pages/api/admin/reports/[id]/action.ts#POST"],
    status: "complete",
  },
  "src/pages/api/admin/reports/[id].ts": {
    batchId: "phase4a1-trace-batch-2",
    methodIds: ["src/pages/api/admin/reports/[id].ts#GET"],
    status: "complete",
  },
};
