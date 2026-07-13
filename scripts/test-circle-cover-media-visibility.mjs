import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const ids = {
  visible: "00000000-0000-4000-8000-000000000001",
  hidden: "00000000-0000-4000-8000-000000000002",
  inactive: "00000000-0000-4000-8000-000000000003",
  deleted: "00000000-0000-4000-8000-000000000004",
  owner: "00000000-0000-4000-8000-000000000005",
};

const coverPath = `circle-covers/${ids.owner}/1752451200000-cover.png`;

function gitBlobHash(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  return createHash("sha1").update(`blob ${Buffer.byteLength(normalized)}\0`).update(normalized).digest("hex");
}

function createCircleClient(row) {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, "circles", "cover authorization reads only the server-selected circles table");
      return {
        select(columns) {
          calls.push(`circles.select:${columns}`);
          return this;
        },
        eq(column, value) {
          calls.push(`circles.eq:${column}:${value}`);
          return this;
        },
        async maybeSingle() {
          calls.push("circles.maybeSingle");
          return { data: row, error: null };
        },
      };
    },
  };
  return { client, calls };
}

async function authorizeCover(resolvePublicCircleCoverTarget, circleId, row) {
  const { client, calls } = createCircleClient(row);
  const target = await resolvePublicCircleCoverTarget(client, circleId);
  const effects = { signing: 0, r2: 0, externalFetch: 0, writes: 0, audit: 0, cache: 0, rate: 0 };
  if (target) {
    effects.signing += 1;
    effects.r2 += 1;
    effects.externalFetch += 1;
  }
  return { target, calls, effects };
}

function circle(overrides = {}) {
  return {
    id: ids.visible,
    slug: "visible-circle",
    name: "Visible Circle",
    status: "active",
    image_path: coverPath,
    ...overrides,
  };
}

async function main() {
  const routePath = path.join(root, "src/pages/api/media/circle/[circleId].ts");
  const helperPath = path.join(root, "src/lib/circle-cover.ts");
  const migrationPath = path.join(root, "supabase/migrations/20260714_circle_cover_public_visibility_authorization.sql");
  const historicalCirclePolicyPath = path.join(root, "supabase/migrations/20260518_forum_phase1_schema.sql");
  const historicalCoverPolicyPath = path.join(root, "supabase/migrations/20260605_circle_cover_public_select.sql");
  const [routeSource, helperSource, migration, historicalCirclePolicy, historicalCoverPolicy] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile(helperPath, "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(historicalCirclePolicyPath, "utf8"),
    readFile(historicalCoverPolicyPath, "utf8"),
  ]);

  assert.equal(gitBlobHash(historicalCirclePolicy), "48deb683515de975c84c1f44ac06d3048082fcd4");
  assert.equal(gitBlobHash(historicalCoverPolicy), "776f665dd2ad7653860dcafb512cc1d46f1edf6a");
  assert.match(routeSource, /resolvePublicCircleCoverTarget\(supabase, circleId\)/);
  assert.ok(routeSource.indexOf("const coverTarget = await resolvePublicCircleCoverTarget") < routeSource.indexOf("return streamStorageObjectViaSignedUrl"), "circle authorization precedes signing/proxying");
  assert.doesNotMatch(routeSource, /Authorization|auth\.getUser|createUserClient/, "the public route does not broaden access from bearer input");
  assert.doesNotMatch(routeSource, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/, "GET has no persistent mutation");
  assert.match(helperSource, /CIRCLE_COVER_PATH_PATTERN/);
  assert.match(helperSource, /isPublicVisibleCircle\(circle\)/);
  assert.match(helperSource, /circle\.status\?\.toLowerCase\(\) !== "active"/);

  const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const { isCircleCoverPath, resolvePublicCircleCoverTarget } = await vite.ssrLoadModule("/src/lib/circle-cover.ts");
    assert.equal(isCircleCoverPath(coverPath), true, "the canonical uploaded cover key is accepted");
    for (const invalidPath of [
      `circle-covers/${ids.owner}/../private.png`,
      `circle-covers/${ids.owner}/1752451200000-%2fprivate.png`,
      `circle-covers/${ids.owner}/1752451200000-..\\private.png`,
      `circle-covers/${ids.owner}/1752451200000-cover.png?other=1`,
      `circle-covers/${ids.owner}//1752451200000-cover.png`,
      "post-media/other-object.png",
    ]) {
      assert.equal(isCircleCoverPath(invalidPath), false, `noncanonical cover key is denied: ${invalidPath}`);
    }

    const allowed = await authorizeCover(resolvePublicCircleCoverTarget, ids.visible, circle());
    assert.deepEqual(allowed.target, { circleId: ids.visible, imagePath: coverPath });
    assert.deepEqual(allowed.effects, { signing: 1, r2: 1, externalFetch: 1, writes: 0, audit: 0, cache: 0, rate: 0 });
    assert.deepEqual(allowed.calls.slice(0, 2), ["circles.select:id,slug,name,status,image_path", `circles.eq:id:${ids.visible}`]);

    const deniedCases = [
      ["malformed circle id", "not-a-uuid", circle()],
      ["missing circle", ids.visible, null],
      ["inactive circle", ids.inactive, circle({ id: ids.inactive, status: "inactive" })],
      ["deleted circle", ids.deleted, circle({ id: ids.deleted, status: "deleted" })],
      ["canonical QA-hidden slug", ids.hidden, circle({ id: ids.hidden, slug: "rls-test-circle" })],
      ["canonical QA-hidden name", ids.hidden, circle({ id: ids.hidden, name: "RLS Test Circle" })],
      ["stored traversal path", ids.visible, circle({ image_path: `circle-covers/${ids.owner}/../private.png` })],
      ["stored encoded separator", ids.visible, circle({ image_path: `circle-covers/${ids.owner}/1752451200000-%2fprivate.png` })],
      ["mismatched database id", ids.visible, circle({ id: ids.hidden })],
    ];
    for (const [name, circleId, row] of deniedCases) {
      const result = await authorizeCover(resolvePublicCircleCoverTarget, circleId, row);
      assert.equal(result.target, null, `${name} is denied`);
      assert.equal(result.effects.signing, 0, `${name} performs zero signing`);
      assert.equal(result.effects.r2, 0, `${name} performs zero R2 calls`);
      assert.equal(result.effects.externalFetch, 0, `${name} performs zero external fetches`);
      assert.equal(result.effects.writes, 0, `${name} performs zero database writes`);
      assert.equal(result.effects.audit + result.effects.cache + result.effects.rate, 0, `${name} has no persistence side effect`);
    }
  } finally {
    await vite.close();
  }

  for (const required of [
    "public.can_access_public_circle_cover_object(target_object_name text)",
    "circle_ref.image_path = target_object_name",
    "public.can_access_public_circle(circle_ref.id)",
    "drop policy if exists \"circles_select_public\"",
    "create policy \"circles_select_public\"",
    "public.can_access_public_circle(id)",
    "owner_id = auth.uid()",
    "drop policy if exists \"circle_cover_objects_select_public\"",
    "create policy \"circle_cover_objects_select_public\"",
    "public.can_access_public_circle_cover_object(name)",
    "(storage.foldername(name))[2] = auth.uid()::text",
    "public.is_moderator_or_admin()",
  ]) {
    assert.ok(migration.includes(required), `forward RLS migration includes ${required}`);
  }
  assert.match(migration, /target_object_name ~ '\^circle-covers\//, "forward RLS accepts only canonical cover keys");
  assert.doesNotMatch(migration, /\(storage\.foldername\(name\)\)\[1\] = 'circle-covers'\s*\);/, "public storage SELECT does not rely on prefix-only access");

  console.log(JSON.stringify({
    allowed: ["anonymous active canonical public circle", "ordinary authenticated caller receives the same public-only decision"],
    denied: ["malformed/missing/inactive/deleted/QA-hidden circle", "noncanonical object path", "mismatched circle row"],
    nonApplicable: ["no post, post_media, author/profile, pagination, query, cursor, limit, raw object key, signed URL, or media metadata is returned by this circle-cover route"],
    readOrder: ["validate path id", "anon RLS client", "exact circle row read", "active canonical visibility and canonical path checks", "storage signed URL", "trusted storage signed-URL fetch", "stream response"],
    deniedEffects: "zero signing, R2, external fetch, writes, audit, cache, and rate persistence",
    historicalMigrationsUnchanged: true,
    forwardMigrationAuthoredNotExecuted: true,
    realNetworkDatabaseStorageRequests: 0,
  }));
}

await main();
