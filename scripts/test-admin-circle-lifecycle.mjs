import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflareWorkersTestPlugin } from "./lib/cloudflare-workers-test-plugin.mjs";

const root = path.resolve(".");
const migrationPath = path.join(root, "supabase/migrations/20260814_admin_circle_lifecycle_and_safe_purge.sql");
const feedPath = path.join(root, "src/lib/forum-feed.ts");
const circlesApiPath = path.join(root, "src/pages/api/admin/forum/circles.ts");

function test(name, run) {
  return Promise.resolve()
    .then(run)
    .then(() => console.log(`PASS ${name}`));
}

const vite = await createServer({ root, plugins: [react(), cloudflareWorkersTestPlugin()], server: { middlewareMode: true }, appType: "custom" });
const { handleAdminCirclePurge } = await vite.ssrLoadModule("/src/lib/server/admin-circle-purge.server.ts");
const {
  getGlassConfirmDialogButtonState,
  shouldCloseGlassConfirmDialogOnEscape,
} = await vite.ssrLoadModule("/src/components/common/GlassConfirmDialog.tsx");

const env = {
  SUPABASE_URL: "https://xcbnxzjlsvtgzixurcof.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SECRET_KEY: "test-secret-key",
};

function preview(overrides = {}) {
  return {
    circle_exists: true,
    current_status: "deleted",
    circle_name: "Disposable Circle",
    post_count: 0,
    circle_report_count: 0,
    direct_notification_count: 0,
    image_path: null,
    allowed: true,
    reason_code: "PURGE_ALLOWED",
    ...overrides,
  };
}

function fakeClient({ previewRow, purgeRow = { purged: true, reason_code: "PURGED" }, storageError = null }) {
  const calls = { preview: 0, purge: 0, storage: 0 };
  return {
    calls,
    rpc: async (name) => {
      if (name === "admin_circle_purge_preview_v1") {
        calls.preview += 1;
        return { data: [previewRow], error: null };
      }
      if (name === "admin_purge_circle_v1") {
        calls.purge += 1;
        return { data: [purgeRow], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: {
      from: () => ({
        remove: async () => {
          calls.storage += 1;
          return { error: storageError };
        },
      }),
    },
  };
}

function request(payload) {
  return new Request("https://example.test/api/admin/forum/circles/purge", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", ...payload }),
  });
}

const authorized = async () => ({ user: { id: "admin-user" }, profile: { role: "admin", username: null, display_name: null, avatar_url: null }, client: {} });

await test("migration permits exactly active hidden deleted", async () => {
  const migration = await fs.readFile(migrationPath, "utf8");
  assert.match(migration, /pg_catalog\.pg_get_expr/i);
  assert.match(migration, /ADMIN_CIRCLE_LIFECYCLE_SCHEMA_PRECONDITION_FAILED/);
  assert.match(migration, /format_type\(attribute\.atttypid, attribute\.atttypmod\)/i);
  assert.match(migration, /'''active''::text'/i);
  assert.match(migration, /\[\[:space:\]\]\+/i);
  assert.match(migration, /constraint_row\.convalidated/i);
  assert.match(migration, /drop constraint circles_status_check;/i);
  assert.doesNotMatch(migration, /drop constraint if exists circles_status_check/i);
  assert.match(migration, /check \(status in \('active', 'hidden', 'deleted'\)\)/i);
  assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete)\s+on\s+table\s+public\.circles\s+to\s+service_role/i);
});

await test("purge RPCs use hardened security definer grants", async () => {
  const migration = await fs.readFile(migrationPath, "utf8");
  for (const functionName of ["admin_circle_purge_preview_v1", "admin_purge_circle_v1"]) {
    assert.match(migration, new RegExp(`create function public\\.${functionName}[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`, "i"));
    assert.doesNotMatch(migration, new RegExp(`create or replace function public\\.${functionName}`, "i"));
    assert.match(migration, new RegExp(`alter function public\\.${functionName}\\(uuid\\) owner to postgres;`, "i"));
    assert.match(migration, new RegExp(`revoke all on function public\\.${functionName}\\(uuid\\) from public;[\\s\\S]*?from anon;[\\s\\S]*?from authenticated;[\\s\\S]*?grant execute on function public\\.${functionName}\\(uuid\\) to service_role;`, "i"));
  }
  assert.match(migration, /ADMIN_CIRCLE_LIFECYCLE_RPC_PRECONDITION_FAILED/);
  assert.match(migration, /ADMIN_CIRCLE_REPORT_VALIDATOR_PRECONDITION_FAILED/);
  assert.match(migration, /create or replace function public\.validate_report_target\(\)[\s\S]*?for key share;/i);
  assert.match(migration, /before insert or update of target_type, target_id on public\.reports/i);
  assert.doesNotMatch(migration, /lock table public\.reports in share mode;/i);
});

await test("anonymous and ordinary callers are rejected before elevation", async () => {
  for (const status of [401, 403]) {
    const response = await handleAdminCirclePurge(request({ action: "preview" }), env, {
      authorize: async () => { throw new Response("Denied", { status }); },
      createAdminClient: () => { throw new Error("must not create elevated client"); },
    });
    assert.equal(response.status, status);
  }
});

await test("moderators cannot reach elevated purge preview or hard purge", async () => {
  for (const action of ["preview", "purge"]) {
    let trustedClientCreated = false;
    const response = await handleAdminCirclePurge(request({ action, confirmationName: "Disposable Circle" }), env, {
      authorize: async () => {
        throw new Response("Forbidden", { status: 403 });
      },
      createAdminClient: () => {
        trustedClientCreated = true;
        throw new Error("must not create elevated client");
      },
    });
    assert.equal(response.status, 403);
    assert.equal(trustedClientCreated, false);
  }
});

await test("ordinary circle operations retain main moderator and legal-consent guards", async () => {
  const source = await fs.readFile(circlesApiPath, "utf8");
  for (const operation of ["POST", "PATCH"]) {
    const start = source.indexOf(`export const ${operation}:`);
    assert.notEqual(start, -1);
    const nextRoute = source.indexOf("export const ", start + 1);
    const handler = source.slice(start, nextRoute === -1 ? undefined : nextRoute);
    assert.match(handler, /requireModerator\(request, env\)/);
    assert.match(handler, /requireAuthenticatedLegalConsent/);
    assert.doesNotMatch(handler, /requireAdmin\(request, env\)/);
  }
  assert.match(source, /createLegalConsentReadRepository/);
});

await test("feed uses active-circle inner joins without changing public filtering", async () => {
  const source = await fs.readFile(feedPath, "utf8");
  assert.equal((source.match(/circles:circle_id!inner\(slug, name, status\)/g) ?? []).length, 4);
  assert.equal((source.match(/\.eq\("circles\.status", "active"\)/g) ?? []).length, 4);
  assert.match(source, /filterPublicVisibleFeedPosts/);
});

await test("admin circles GET resolves and invokes the strict admin guard", async () => {
  const authModuleId = "\0admin-circles-get-runtime-auth";
  const getClient = {
    from: () => ({
      select: () => ({
        order: async () => ({ data: [], error: null }),
      }),
    }),
  };
  globalThis.__adminCirclesGetAuthHit = false;
  globalThis.__adminCirclesGetClient = getClient;

  const isolatedVite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "custom",
    plugins: [cloudflareWorkersTestPlugin(), {
      name: "admin-circles-get-runtime-auth",
      enforce: "pre",
      resolveId(id, importer) {
        if (id === "../../../../lib/server/admin-auth" && importer?.endsWith("/src/pages/api/admin/forum/circles.ts")) {
          return authModuleId;
        }
        return null;
      },
      load(id) {
        if (id !== authModuleId) return null;
        return `
          export const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status });
          export const requireAdmin = async () => {
            globalThis.__adminCirclesGetAuthHit = true;
            return { user: { id: "admin-user" }, profile: { role: "admin" }, client: globalThis.__adminCirclesGetClient };
          };
          export const requireModerator = requireAdmin;
        `;
      },
    }],
  });

  try {
    const { GET } = await isolatedVite.ssrLoadModule("/src/pages/api/admin/forum/circles.ts");
    const response = await GET({ request: new Request("https://example.test/api/admin/forum/circles"), locals: { runtime: { env: {} } } });
    assert.equal(globalThis.__adminCirclesGetAuthHit, true);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { circles: [] });
  } finally {
    delete globalThis.__adminCirclesGetAuthHit;
    delete globalThis.__adminCirclesGetClient;
    await isolatedVite.close();
  }
});

await test("purge preview rejects non-deleted circles", async () => {
  const client = fakeClient({ previewRow: preview({ current_status: "active", allowed: false, reason_code: "CIRCLE_NOT_DELETED" }) });
  const response = await handleAdminCirclePurge(request({ action: "preview" }), env, { authorize: authorized, createAdminClient: () => client });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.preview.allowed, false);
  assert.equal(body.preview.reasonCode, "CIRCLE_NOT_DELETED");
  assert.equal(body.preview.image_path, undefined);
});

await test("purge is blocked by posts and reports", async () => {
  for (const blocked of [
    preview({ post_count: 1, allowed: false, reason_code: "CIRCLE_HAS_POSTS" }),
    preview({ circle_report_count: 1, allowed: false, reason_code: "CIRCLE_HAS_REPORTS" }),
  ]) {
    const client = fakeClient({ previewRow: blocked });
    const response = await handleAdminCirclePurge(request({ action: "purge", confirmationName: "Disposable Circle" }), env, { authorize: authorized, createAdminClient: () => client });
    assert.equal(response.status, 409);
    assert.equal(client.calls.storage, 0);
    assert.equal(client.calls.purge, 0);
  }
});

await test("typed purge confirmation keeps cancel available and gates confirm exactly", async () => {
  const expected = "CIRCLETST-1782617673014 Circle";
  for (const value of ["", "CIRCLETST", "circletst-1782617673014 circle"]) {
    assert.deepEqual(
      getGlassConfirmDialogButtonState({ loading: false, confirmDisabled: false, confirmationText: expected, confirmationValue: value }),
      { cancelDisabled: false, confirmDisabled: true },
    );
  }
  assert.deepEqual(
    getGlassConfirmDialogButtonState({ loading: false, confirmDisabled: false, confirmationText: expected, confirmationValue: expected }),
    { cancelDisabled: false, confirmDisabled: false },
  );
  assert.deepEqual(
    getGlassConfirmDialogButtonState({ loading: false, confirmDisabled: true, confirmationText: expected, confirmationValue: expected }),
    { cancelDisabled: false, confirmDisabled: true },
  );
  assert.deepEqual(
    getGlassConfirmDialogButtonState({ loading: true, confirmDisabled: false, confirmationText: expected, confirmationValue: expected }),
    { cancelDisabled: true, confirmDisabled: true },
  );
  assert.equal(shouldCloseGlassConfirmDialogOnEscape("Escape", false), true);
  assert.equal(shouldCloseGlassConfirmDialogOnEscape("Escape", true), false);
  assert.equal(shouldCloseGlassConfirmDialogOnEscape("Enter", false), false);
});

await test("storage failure prevents database purge", async () => {
  const client = fakeClient({ previewRow: preview({ image_path: "circle-covers/11111111-1111-4111-8111-111111111111/1752451200000-cover.webp" }), storageError: { message: "failed" } });
  const response = await handleAdminCirclePurge(request({ action: "purge", confirmationName: "Disposable Circle" }), env, { authorize: authorized, createAdminClient: () => client });
  assert.equal(response.status, 502);
  assert.equal(client.calls.storage, 1);
  assert.equal(client.calls.purge, 0);
});

await test("dependency-free deleted circle purges only after exact confirmation", async () => {
  const client = fakeClient({ previewRow: preview() });
  const response = await handleAdminCirclePurge(request({ action: "purge", confirmationName: "Disposable Circle" }), env, { authorize: authorized, createAdminClient: () => client });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { purged: true, reasonCode: "PURGED" } });
  assert.equal(client.calls.purge, 1);
});

await test("server rejects a programmatic wrong-name purge before mutation", async () => {
  const client = fakeClient({ previewRow: preview() });
  const response = await handleAdminCirclePurge(request({ action: "purge", confirmationName: "Disposable" }), env, { authorize: authorized, createAdminClient: () => client });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "PURGE_CONFIRMATION_NAME_MISMATCH" });
  assert.equal(client.calls.purge, 0);
  assert.equal(client.calls.storage, 0);
});

await test("public visibility accepts active circles only", async () => {
  const navigation = await vite.ssrLoadModule("/src/lib/site-navigation.ts");
  assert.equal(navigation.isPublicVisibleCircle({ status: "active", slug: "real-circle" }), true);
  assert.equal(navigation.isPublicVisibleCircle({ status: "hidden", slug: "real-circle" }), false);
  assert.equal(navigation.isPublicVisibleCircle({ status: "deleted", slug: "real-circle" }), false);
});

await vite.close();
