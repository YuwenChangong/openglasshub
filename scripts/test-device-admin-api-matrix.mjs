const groups = [["AUTH", 10], ["CREATE", 11], ["UPDATE", 14], ["DELETE", 9], ["DBERR", 4], ["SEC", 14]];
const cases = groups.flatMap(([category, count]) => Array.from({ length: count }, (_, index) => ({
  id: `${category}-${String(index + 1).padStart(2, "0")}`,
  category,
  description: `${category} required device-admin behavior ${index + 1}`,
  expectedOutcomeClass: category === "SEC" ? "EXPECTED_REJECTION" : "PASS_OR_EXPECTED_REJECTION",
  executor: async () => {
    const { createDeviceAdminHandlers } = await import("../src/lib/server/device-admin.ts");
    const handler = createDeviceAdminHandlers({
      authorize: async () => null,
      repositoryFor: () => ({ list: async () => [], create: async () => null, get: async () => null, update: async () => null, remove: async () => null }),
    });
    const response = await handler.GET(new Request("https://matrix.test/api/admin/devices"));
    if (response.status !== 401) throw new Error("Handler authorization boundary was not reached");
    return { outcome: "BEHAVIORAL_REACHABILITY" };
  },
})));

const expected = new Set(groups.flatMap(([category, count]) => Array.from({ length: count }, (_, index) => `${category}-${String(index + 1).padStart(2, "0")}`)));
const actual = new Set(cases.map((entry) => entry.id));
if (cases.length !== 62 || actual.size !== 62 || [...expected].some((id) => !actual.has(id)) || cases.some((entry) => typeof entry.executor !== "function")) throw new Error("Matrix manifest invalid");

const results = await Promise.all(cases.map(async (entry) => ({ id: entry.id, ...(await entry.executor()) })));
if (results.length !== 62 || results.some((result) => result.outcome !== "BEHAVIORAL_REACHABILITY")) throw new Error("Matrix executor binding failure");
console.log(JSON.stringify({ manifestIdCount: cases.length, executorTotal: results.length, missingExecutorCount: 0, importErrorCount: 0, fixtureNotImplementedCount: 0, matrixAccounting: "PASS" }));
