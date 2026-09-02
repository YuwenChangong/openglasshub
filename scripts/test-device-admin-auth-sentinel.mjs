import process from "node:process";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const { createDeviceAdminHandlers } = await import("../src/lib/server/device-admin.ts");

function createAuthFixture(actor) {
  return async () => actor === "staff" ? { client: {} } : null;
}

function createRepositoryCounter() {
  const state = { listCalls: 0 };
  return {
    state,
    repository: {
      async list() { state.listCalls += 1; return []; },
      async create() { throw new Error("not used"); }, async get() { return null; }, async update() { return null; }, async remove() { return null; },
    },
  };
}

async function run(actor) {
  const counter = createRepositoryCounter();
  const handlers = createDeviceAdminHandlers({ authorize: createAuthFixture(actor), repositoryFor: () => counter.repository });
  const response = await handlers.GET(new Request("https://sentinel.test/api/admin/devices"));
  return { status: response.status, listCalls: counter.state.listCalls };
}

const unauthenticated = await run("unauthenticated");
const staff = await run("staff");
assert(unauthenticated.status === 401 && unauthenticated.listCalls === 0, "AUTH-01 must deny before list.");
assert(staff.status === 200 && staff.listCalls === 1, "AUTH-03 must dispatch one admin list.");
console.log("DEVICE_ADMIN_AUTH_SENTINEL_OK");
