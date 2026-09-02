import process from "node:process";
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const {
    createDeviceAdminHandlers,
    mapDatabaseError,
    toDeviceRow,
  } = await import("../src/lib/server/device-admin.ts");
  const { requireModerator } = await import("../src/lib/server/admin-auth.ts");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify(token === "staff" ? { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } : { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/rest/v1/profiles")) {
      return new Response(JSON.stringify([{ role: token === "staff" ? "admin" : "user", username: null, display_name: null, avatar_url: null }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  };
  const env = { SUPABASE_URL: "https://local.test", SUPABASE_ANON_KEY: "test-key" };

  const rows = new Map();
  const repository = {
    async list() { return [...rows.values()]; },
    async create(row) { const result = { ...row, id: "11111111-1111-4111-8111-111111111111", slugLocked: false }; rows.set(result.id, result); return result; },
    async get(id) { return rows.get(id) ?? null; },
    async update(id, changes) { const current = rows.get(id); if (!current) return null; const result = { ...current, ...changes, slugLocked: current.slugLocked || changes.publicationStatus === "published" }; rows.set(id, result); return result; },
    async remove(id) { const current = rows.get(id); if (!current) return null; rows.delete(id); return current; },
  };
  const handlers = createDeviceAdminHandlers({
    authorize: async (request) => {
      try { return await requireModerator(request, env); }
      catch (error) { return error instanceof Response ? error : null; }
    },
    repositoryFor: () => repository,
  });
  const base = {
    brandKey: "test-brand", brandName: "Test Brand", name: "Test Device", shortDescription: "Short", longDescription: "Long",
    imageAlt: "Test device", category: "smart_glasses", routeLabel: "Smart", routeDescription: "Smart glasses",
    bestFor: ["Testing"], notIdealFor: ["Production"], media: { imageAlt: "Test", imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    keySpecs: [{ field: "weight", label: "Weight", value: "20g" }], fullSpecs: { physical: { weight: "20g" } },
  };

  const unauthorized = await handlers.GET(new Request("https://example.test/api/admin/devices"));
  assert(unauthorized.status === 401, "Unauthenticated GET must be rejected.");
  const nonstaff = await handlers.GET(new Request("https://example.test/api/admin/devices", { headers: { authorization: "Bearer user" } }));
  assert(nonstaff.status === 403, "Authenticated nonstaff GET must be rejected by requireModerator.");
  const created = await handlers.POST(new Request("https://example.test/api/admin/devices", { method: "POST", headers: { authorization: "Bearer staff" }, body: JSON.stringify(base) }));
  assert(created.status === 201, "Staff can create a draft.");
  const createdBody = await created.json();
  assert(createdBody.device.publicationStatus === "draft" && createdBody.device.slug === "test-device", "Create must default to draft and generate slug.");
  const unknown = await handlers.POST(new Request("https://example.test/api/admin/devices", { method: "POST", headers: { authorization: "Bearer staff" }, body: JSON.stringify({ ...base, role: "admin" }) }));
  assert(unknown.status === 400, "Server-managed and unknown fields must be rejected.");
  const published = await handlers.PATCH(new Request("https://example.test/api/admin/devices", { method: "PATCH", headers: { authorization: "Bearer staff" }, body: JSON.stringify({ id: createdBody.device.id, publicationStatus: "published" }) }));
  assert(published.status === 200 && (await published.clone().json()).device.slugLocked === true, "First publish must lock slug.");
  const lockedSlug = await handlers.PATCH(new Request("https://example.test/api/admin/devices", { method: "PATCH", headers: { authorization: "Bearer staff" }, body: JSON.stringify({ id: createdBody.device.id, slug: "changed" }) }));
  assert(lockedSlug.status === 400, "Locked slug changes must be rejected.");
  const deletePublished = await handlers.DELETE(new Request("https://example.test/api/admin/devices", { method: "DELETE", headers: { authorization: "Bearer staff" }, body: JSON.stringify({ id: createdBody.device.id, confirmPermanentDelete: true }) }));
  assert(deletePublished.status === 400, "Non-archived hard delete must be rejected.");
  assert(mapDatabaseError({ code: "23505" }).code === "DEVICE_SLUG_CONFLICT", "Duplicate errors must be sanitized.");
  assert(mapDatabaseError({ code: "23503" }).code === "DEVICE_REFERENCED", "FK errors must be sanitized.");
  assert(toDeviceRow({ ...base, slug: "test-device", publicationStatus: "draft" }).brand_key === "test-brand", "Repository mapping must use P3 column names.");
  const slugLockMigration = await readFile("supabase/migrations/20260829_device_slug_lock.sql", "utf8");
  assert(slugLockMigration.includes("slug_locked boolean not null default false"), "Slug lock must be durable.");
  assert(slugLockMigration.includes("where publication_status = 'published'"), "Existing published devices must be backfilled locked.");
  assert(slugLockMigration.includes("before insert or update"), "First publication must lock at the database boundary.");
  assert(slugLockMigration.includes("old.slug_locked and new.slug is distinct from old.slug"), "Database must reject locked slug mutation.");
  globalThis.fetch = originalFetch;
  console.log("DEVICE_ADMIN_API_AUDIT_OK");
}

main().catch((error) => { console.error(`DEVICE_ADMIN_API_AUDIT_FAIL ${error.message}`); process.exitCode = 1; });
