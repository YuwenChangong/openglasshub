import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const {
  CANONICAL_SUPABASE_PROJECT_REF,
  TRUSTED_ADMIN_CLIENT_AUTH_OPTIONS,
  TrustedAdminRuntimeError,
  assertCanonicalSupabaseUrl,
  createServerAdminSupabaseClient,
} = await import("../src/lib/server/supabase-admin-client.server.ts");

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

let viteServer;

async function loadCapabilityHandler() {
  viteServer ??= await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
  });
  return viteServer.ssrLoadModule(path.resolve("src/lib/server/supabase-admin.server.ts"));
}

const canonicalEnv = {
  SUPABASE_URL: `https://${CANONICAL_SUPABASE_PROJECT_REF}.supabase.co`,
  SUPABASE_SECRET_KEY: "sb_secret_test_only_not_a_real_key",
};

await test("canonical project URL is accepted", () => {
  assert.equal(assertCanonicalSupabaseUrl(canonicalEnv.SUPABASE_URL), canonicalEnv.SUPABASE_URL);
});

await test("wrong project configuration is rejected", () => {
  assert.throws(
    () => assertCanonicalSupabaseUrl("https://other-project.supabase.co"),
    (error) => error instanceof TrustedAdminRuntimeError && error.code === "TRUSTED_ADMIN_RUNTIME_PROJECT_MISMATCH",
  );
});

await test("missing trusted secret fails closed", () => {
  assert.throws(
    () => createServerAdminSupabaseClient({ SUPABASE_URL: canonicalEnv.SUPABASE_URL }),
    (error) => error instanceof TrustedAdminRuntimeError && error.code === "TRUSTED_ADMIN_RUNTIME_SECRET_MISSING",
  );
});

await test("admin client disables browser-oriented auth persistence", () => {
  assert.deepEqual(TRUSTED_ADMIN_CLIENT_AUTH_OPTIONS, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  assert.ok(createServerAdminSupabaseClient(canonicalEnv));
});

await test("server admin client never configures incoming auth or browser headers", async () => {
  const source = await fs.readFile(new URL("../src/lib/server/supabase-admin-client.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Authorization/);
  assert.doesNotMatch(source, /user-agent/i);
  assert.doesNotMatch(source, /headers\s*:/);
  assert.match(source, /createClient\(url, secretKey, clientOptions\)/);
});

function adminAuth() {
  return {
    user: { id: "admin-user" },
    profile: { role: "admin", username: null, display_name: null, avatar_url: null },
    client: {},
  };
}

function fakeElevatedClient(order, error = null) {
  return {
    from(table) {
      order.push(`probe:${table}`);
      return {
        select(columns) {
          assert.equal(columns, "id");
          return {
            async limit(limit) {
              assert.equal(limit, 1);
              return { error };
            },
          };
        },
      };
    },
  };
}

await test("anonymous capability request returns 401 before elevation", async () => {
  const { handleTrustedAdminRuntimeCapability } = await loadCapabilityHandler();
  let elevatedCalled = false;
  const response = await handleTrustedAdminRuntimeCapability(new Request("https://example.test"), canonicalEnv, {
    authorize: async () => {
      throw new Response("Unauthorized", { status: 401 });
    },
    createAdminClient: () => {
      elevatedCalled = true;
      return fakeElevatedClient([]);
    },
  });
  assert.equal(response.status, 401);
  assert.equal(elevatedCalled, false);
});

await test("ordinary user capability request returns 403 before elevation", async () => {
  const { handleTrustedAdminRuntimeCapability } = await loadCapabilityHandler();
  let elevatedCalled = false;
  const response = await handleTrustedAdminRuntimeCapability(new Request("https://example.test"), canonicalEnv, {
    authorize: async () => {
      throw new Response("Forbidden", { status: 403 });
    },
    createAdminClient: () => {
      elevatedCalled = true;
      return fakeElevatedClient([]);
    },
  });
  assert.equal(response.status, 403);
  assert.equal(elevatedCalled, false);
});

await test("admin + missing secret fails closed", async () => {
  const { handleTrustedAdminRuntimeCapability } = await loadCapabilityHandler();
  const response = await handleTrustedAdminRuntimeCapability(
    new Request("https://example.test"),
    { SUPABASE_URL: canonicalEnv.SUPABASE_URL },
    { authorize: async () => adminAuth() },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Trusted admin runtime unavailable",
    code: "TRUSTED_ADMIN_RUNTIME_SECRET_MISSING",
  });
});

await test("authenticated admin succeeds with a fake elevated adapter after authorization", async () => {
  const { handleTrustedAdminRuntimeCapability } = await loadCapabilityHandler();
  const order = [];
  const response = await handleTrustedAdminRuntimeCapability(new Request("https://example.test"), canonicalEnv, {
    authorize: async () => {
      order.push("authorize");
      return adminAuth();
    },
    createAdminClient: () => {
      order.push("elevate");
      return fakeElevatedClient(order);
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    trustedAdminRuntime: true,
    projectRefMatch: true,
  });
  assert.deepEqual(order, ["authorize", "elevate", "probe:circles"]);
});

await test("elevated API-key rejection is returned as safe Data API metadata", async () => {
  const { handleTrustedAdminRuntimeCapability } = await loadCapabilityHandler();
  const response = await handleTrustedAdminRuntimeCapability(new Request("https://example.test"), canonicalEnv, {
    authorize: async () => adminAuth(),
    createAdminClient: () => fakeElevatedClient([], { code: "401", message: "Invalid API key" }),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Trusted admin runtime capability probe failed",
    code: "TRUSTED_RUNTIME_PROBE_KEY_REJECTED",
    status: null,
    providerCode: "401",
  });
});

await test("server admin runtime stays outside client imports", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const endpoint = await fs.readFile(new URL("../src/pages/api/admin/trusted-runtime/capability.ts", import.meta.url), "utf8");
  assert.match(endpoint, /supabase-admin\.server/);

  const clientEntries = ["src/components", "src/layouts", "src/pages"];
  for (const entry of clientEntries) {
    const absolute = path.join(root, entry);
    const files = await fs.readdir(absolute, { recursive: true });
    for (const file of files) {
      if (!String(file).match(/\.(astro|tsx?|jsx?)$/)) continue;
      const fullPath = path.join(absolute, String(file));
      if (fullPath.endsWith(path.join("api", "admin", "trusted-runtime", "capability.ts"))) continue;
      const source = await fs.readFile(fullPath, "utf8");
      assert.doesNotMatch(source, /supabase-admin\.server/);
      assert.doesNotMatch(source, /SUPABASE_SECRET_KEY/);
    }
  }
});

await viteServer?.close();
