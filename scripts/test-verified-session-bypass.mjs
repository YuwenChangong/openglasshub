import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const tables = [
  "profiles", "circles", "posts", "comments", "reports", "report_events",
  "moderation_actions", "post_votes", "bookmarks", "comment_reactions",
  "post_media", "forum_upload_attempts", "forum_notifications",
  "user_safety_states", "user_safety_events", "legal_policy_acceptances",
  "news_articles", "devices", "device_spec_definitions", "device_specs",
  "device_sources", "device_source_links", "device_spec_evidence",
  "catalog_audit_events",
];
const privateReads = new Set([
  "reports", "report_events", "moderation_actions", "bookmarks",
  "forum_upload_attempts", "forum_notifications", "user_safety_states",
  "user_safety_events", "device_spec_definitions", "device_specs",
  "device_sources", "device_source_links", "device_spec_evidence",
  "catalog_audit_events",
]);
const mixedReads = new Set(["circles", "posts", "comments", "post_media", "news_articles", "devices"]);
const mixedPublicPredicate = {
  circles: "can_access_public_circle", posts: "can_access_public_circle",
  comments: "can_access_public_comment_read_target", post_media: "can_access_public_post_media_object",
  news_articles: "status = 'published'", devices: "publication_status = 'published'",
};
const behavioralTables = new Set(["profiles", "circles", "posts", "comments", "post_votes", "bookmarks", "post_media", "forum_notifications", "news_articles", "devices"]);
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const serviceOnlyRpc = [
  "record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text)",
  "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)",
  "qa_grant_admin_role(uuid)", "qa_revoke_admin_role(uuid)",
  "admin_circle_purge_preview_v1(uuid)", "admin_purge_circle_v1(uuid)",
  "ogh_reserve_login_challenge(uuid,uuid,uuid,bytea,text,boolean)",
  "ogh_finalize_login_delivery(uuid,uuid,uuid,boolean)",
  "ogh_consume_login_challenge(uuid,uuid,uuid,bytea)",
  "ogh_activate_signup_session(uuid,uuid)",
  "ogh_revoke_verified_session(uuid,uuid)",
  "ogh_record_policy_acceptance(uuid,text,text,text,text,text)",
  "consume_verification_email_resend_limit(text,integer,integer)",
];
const publicRpc = [
  "increment_post_view_count(uuid)",
  "increment_news_article_view(text)",
];

function localUrl(value) {
  const url = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Disposable local Supabase only");
  return url.origin;
}

async function rest(base, key, token, table, method = "GET", body, query = "") {
  const response = await fetch(`${base}/rest/v1/${table}${query}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${token ?? key}`, "content-type": "application/json", prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bodyText = await response.text();
  return { status: response.status, data: bodyText ? JSON.parse(bodyText) : null };
}

async function rpc(base, key, token, name, body) {
  return rest(base, key, token, `rpc/${name}`, "POST", body);
}

async function subscribe(channel, label) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} Realtime subscription timed out`)), 15000);
    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") { clearTimeout(timer); reject(new Error(`${label} Realtime ${state}`)); }
    });
  });
}

async function waitForEvent(events, id, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!events.some((event) => event.new?.id === id || event.old?.id === id)) {
    if (Date.now() >= deadline) throw new Error(`${label} Realtime event not delivered`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function verifyAnonymousPages(status, fixtures) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const devVars = path.join(root, ".dev.vars");
  const apiUrl = localUrl(status.API_URL);
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const file = await open(devVars, "wx");
  let server;
  try {
    await file.writeFile(`SUPABASE_URL=${JSON.stringify(apiUrl)}\nSUPABASE_ANON_KEY=${JSON.stringify(status.ANON_KEY)}\n`);
    await file.close();
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(path|systemroot|windir|temp|tmp|comspec|pathext|appdata|localappdata|userprofile)$/i.test(key)));
    server = spawn(process.execPath, [path.join(root, "node_modules", "astro", "bin", "astro.mjs"),
      "dev", "--ignore-lock", "--host", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...cleanEnv, ASTRO_DEV_BACKGROUND: "1", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
      stdio: "ignore", windowsHide: true,
    });
    const deadline = Date.now() + 30000;
    for (const [route, marker] of [
      ["products", fixtures.device], ["feed", fixtures.post], ["circles", fixtures.circle],
    ]) {
      let response;
      while (Date.now() < deadline) {
        if (server.exitCode !== null) throw new Error(`local Astro exited ${server.exitCode}`);
        try { response = await fetch(`http://127.0.0.1:${port}/${route}/`); }
        catch { await new Promise((resolve) => setTimeout(resolve, 200)); continue; }
        break;
      }
      assert.ok(response, `${route} local Astro response`);
      assert.equal(response.status, 200, `anonymous /${route}/ with disposable local Supabase`);
      assert.ok((await response.text()).includes(marker), `anonymous /${route}/ renders disposable published fixture`);
    }
    console.log("PASS anonymous Astro /products/, /feed/, /circles/: local Supabase published fixtures");
  } finally {
    if (server && server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    await file.close().catch(() => {});
    await rm(devVars);
  }
}

export async function verifyBypass({ pool, status }) {
  const base = localUrl(status.API_URL);
  const { rows: finalPolicies } = await pool.query(`select schemaname, tablename, policyname, permissive, roles
    from pg_policies where policyname like 'ogh_verified_%'`);
  const expectedPolicies = [
    ...tables.flatMap((table) => ["insert", "update", "delete"].map((command) => `public.${table}.ogh_verified_${command}`)),
    ...[...privateReads, ...mixedReads].map((table) => `public.${table}.ogh_verified_select`),
    ...["insert", "update", "delete", "select"].map((command) => `storage.objects.ogh_verified_storage_${command}`),
  ].sort();
  assert.deepEqual(finalPolicies.map((entry) => {
    assert.equal(entry.permissive, "RESTRICTIVE", "D policies remain restrictive");
    assert.equal(entry.roles, "{authenticated}", "D policies apply to authenticated actors");
    return `${entry.schemaname}.${entry.tablename}.${entry.policyname}`;
  }).sort(), expectedPolicies, "bypass controls require the complete final D policy inventory");
  const service = createClient(base, status.SERVICE_ROLE_KEY, clientOptions);
  const email = `verified-bypass-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(createError);
  const user = created.user;
  const auth = createClient(base, status.ANON_KEY, clientOptions);
  const { data: login, error: loginError } = await auth.auth.signInWithPassword({ email, password });
  assert.ifError(loginError);
  const token = login.session?.access_token;
  const session = login.session?.user?.id && login.session.access_token.split(".")[1];
  assert.ok(token && session, "real local password session");
  const claims = JSON.parse(Buffer.from(session, "base64url").toString("utf8"));
  assert.equal(claims.sub, user.id);
  assert.ok(claims.session_id);

  const db = await pool.connect();
  let otherUserId;
  let realtimeControlUserId;
  try {
    const { rows: policies } = await db.query(`select tablename, cmd, permissive, qual, with_check,
      'authenticated'::name = any(roles) as applies_authenticated
      from pg_policies where schemaname='public' and tablename=any($1::text[])`, [tables]);
    const { rows: tableSecurity } = await db.query(`select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1::text[])`, [tables]);
    assert.equal(tableSecurity.length, tables.length, "complete ledger table catalog");
    assert.ok(tableSecurity.every((row) => row.relrowsecurity), "all ledger tables enforce RLS");
    for (const table of tables) {
      const owned = policies.filter((p) => p.tablename === table);
      assert.ok(owned.length, `${table} has policies`);
      for (const cmd of ["INSERT", "UPDATE", "DELETE"]) {
        const relevant = owned.filter((p) => p.cmd === cmd || p.cmd === "ALL");
        const { rows: [{ allowed }] } = await db.query("select has_table_privilege('authenticated',$1,$2) as allowed", [`public.${table}`, cmd]);
        if (allowed && relevant.some((p) => p.permissive === "PERMISSIVE")) {
          assert.ok(relevant.some((p) => p.permissive === "RESTRICTIVE" && p.applies_authenticated &&
            (cmd === "INSERT" ? p.with_check?.includes("ogh_is_verified_session")
              : cmd === "UPDATE" ? p.qual?.includes("ogh_is_verified_session") && p.with_check?.includes("ogh_is_verified_session")
                : p.qual?.includes("ogh_is_verified_session"))), `${table} ${cmd} verified RLS`);
        }
      }
      if (privateReads.has(table) || mixedReads.has(table)) {
        assert.ok(owned.some((p) => p.cmd === "SELECT" && p.permissive === "RESTRICTIVE" && p.applies_authenticated &&
          (p.qual ?? "").includes("ogh_is_verified_session")), `${table} private SELECT verified RLS`);
      }
      if (mixedReads.has(table)) {
        assert.ok(owned.some((p) => p.cmd === "SELECT" && p.permissive === "RESTRICTIVE" && p.applies_authenticated &&
          (p.qual ?? "").includes(mixedPublicPredicate[table]) && /\bor\b/i.test(p.qual ?? "")),
        `${table} mixed SELECT keeps explicit public OR verified branch`);
      }
    }
    const { rows: privateFunctions } = await db.query(`select p.oid::regprocedure::text as signature,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.oid=any($1::regprocedure[])`,
      [serviceOnlyRpc.map((name) => `public.${name}`)]);
    assert.equal(privateFunctions.length, serviceOnlyRpc.length, "service-only RPC inventory");
    for (const entry of privateFunctions) {
      assert.ok(!entry.anon && !entry.authenticated && entry.service, `${entry.signature} effective ACL`);
    }
    const { rows: publicFunctions } = await db.query(`select p.oid::regprocedure::text as signature,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.oid=any($1::regprocedure[])`,
      [publicRpc.map((name) => `public.${name}`)]);
    assert.equal(publicFunctions.length, publicRpc.length, "public bootstrap/counter RPC inventory");
    for (const entry of publicFunctions) {
      assert.ok(entry.anon && entry.authenticated, `${entry.signature} public exception ACL`);
    }

    const publicNews = await rest(base, status.ANON_KEY, null, "news_articles", "GET", undefined, "?select=id&status=eq.published&limit=1");
    assert.equal(publicNews.status, 200);
    assert.ok(publicNews.data.length > 0, "public news remains visible");
    const publicDevices = await rest(base, status.ANON_KEY, null, "devices", "GET", undefined, "?select=id&publication_status=eq.published&limit=1");
    assert.equal(publicDevices.status, 200);
    const circleId = randomUUID(), postId = randomUUID();
    await db.query("insert into public.circles(id,slug,name,type,owner_id,status) values($1,$2,'Local feed fixture','topic',$3,'active')", [circleId, `verified-bypass-${randomUUID().slice(0, 8)}`, user.id]);
    await db.query("insert into public.posts(id,author_id,circle_id,type,title,body,status,moderation_status) values($1,$2,$3,'experience','Local public post','A published local feed fixture.','published','published')", [postId, user.id, circleId]);
    for (const actorToken of [null, token]) {
      const feed = await rest(base, status.ANON_KEY, actorToken, "posts", "GET", undefined, `?select=id&id=eq.${postId}`);
      assert.deepEqual(feed.data, [{ id: postId }], "published feed visible anonymously and while pending");
    }
    const ownProfile = await rest(base, status.ANON_KEY, token, "profiles", "GET", undefined, `?select=id&id=eq.${user.id}`);
    assert.deepEqual(ownProfile.data, [{ id: user.id }], "public profile remains visible while pending");
    await db.query(`insert into public.legal_policy_acceptances
      (user_id,bundle_version,terms_version,privacy_version,guidelines_version,minimum_age,first_acceptance_source,last_confirmation_source)
      values($1,'local-bundle','local-terms','local-privacy','local-guidelines',16,'registration','registration')`, [user.id]);
    const pendingConsent = await rest(base, status.ANON_KEY, token, "legal_policy_acceptances", "GET", undefined, `?select=user_id&user_id=eq.${user.id}`);
    assert.deepEqual(pendingConsent.data, [{ user_id: user.id }], "own historical consent bootstrap read remains available while pending");
    const privateCircleId = randomUUID(), privatePostId = randomUUID();
    const privateCommentId = randomUUID(), privateMediaId = randomUUID(), publicCommentId = randomUUID(), publicMediaId = randomUUID();
    await db.query("insert into public.circles(id,slug,name,type,owner_id,status) values($1,$2,'Local private circle','topic',$3,'deleted')", [privateCircleId, `verified-private-${randomUUID().slice(0, 8)}`, user.id]);
    await db.query("insert into public.posts(id,author_id,circle_id,type,title,body,status,moderation_status) values($1,$2,$3,'experience','Local private post','A pending local post fixture.','pending','pending_review')", [privatePostId, user.id, circleId]);
    await db.query("insert into public.comments(id,post_id,author_id,body,status,moderation_status) values($1,$2,$3,'Hidden local comment','hidden','hidden_by_admin')", [privateCommentId, postId, user.id]);
    await db.query("insert into public.comments(id,post_id,author_id,body,status,moderation_status) values($1,$2,$3,'Visible local comment','published','published')", [publicCommentId, postId, user.id]);
    await db.query("insert into public.post_media(id,post_id,user_id,kind,storage_path) values($1,$2,$3,'image',$4)", [privateMediaId, privatePostId, user.id, `${user.id}/${privatePostId}/1-private.png`]);
    await db.query("insert into public.post_media(id,post_id,user_id,kind,storage_path) values($1,$2,$3,'image',$4)", [publicMediaId, postId, user.id, `${user.id}/${postId}/1-public.png`]);
    const bookmarkId = randomUUID();
    await db.query("insert into public.bookmarks(id,user_id,post_id) values($1,$2,$3)", [bookmarkId, user.id, postId]);
    const { rows: [{ uploadSelectGrant }] } = await db.query("select has_table_privilege('authenticated','public.forum_upload_attempts','SELECT') as \"uploadSelectGrant\"");
    assert.equal(uploadSelectGrant, false, "upload attempts private read is protected by effective grant");
    const mixedRows = [
      ["circles", circleId, privateCircleId], ["posts", postId, privatePostId],
      ["comments", publicCommentId, privateCommentId], ["post_media", publicMediaId, privateMediaId],
    ];
    for (const [table, publicId, privateId] of mixedRows) {
      for (const actorToken of [null, token]) {
        const publicRow = publicId && await rest(base, status.ANON_KEY, actorToken, table, "GET", undefined, `?select=id&id=eq.${publicId}`);
        if (publicId) assert.deepEqual(publicRow.data, [{ id: publicId }], `${table} public branch`);
        const privateRow = await rest(base, status.ANON_KEY, actorToken, table, "GET", undefined, `?select=id&id=eq.${privateId}`);
        assert.deepEqual(privateRow.data, [], `${table} private branch denied to anonymous/pending`);
      }
    }
    for (const [table, id] of [["bookmarks", bookmarkId]]) {
      const privateRow = await rest(base, status.ANON_KEY, token, table, "GET", undefined, `?select=id&id=eq.${id}`);
      assert.deepEqual(privateRow.data, [], `${table} private SELECT denied while pending`);
    }
    const { rows: [{ view_count: beforePostView }] } = await db.query("select view_count from public.posts where id=$1", [postId]);
    const publicPostCounter = await rpc(base, status.ANON_KEY, null, "increment_post_view_count", { p_post_id: postId });
    assert.ok(publicPostCounter.status < 300, "public post counter remains callable");
    const { rows: [{ view_count: afterPostView }] } = await db.query("select view_count from public.posts where id=$1", [postId]);
    assert.equal(afterPostView, beforePostView + 1, "public post counter still increments");
    const { rows: [{ anon_execute, authenticated_execute, service_execute }] } = await db.query(`select
      has_function_privilege('anon', 'public.consume_verification_email_resend_limit(text, integer, integer)', 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', 'public.consume_verification_email_resend_limit(text, integer, integer)', 'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role', 'public.consume_verification_email_resend_limit(text, integer, integer)', 'EXECUTE') as service_execute`);
    assert.equal(anon_execute, false, "anon cannot execute the resend limiter directly");
    assert.equal(authenticated_execute, false, "authenticated cannot execute the resend limiter directly");
    assert.equal(service_execute, true, "only the service role can execute the resend limiter");
    const budgetHash = randomBytes(32).toString("hex");
    for (const actorToken of [null, token]) {
      const denied = await rpc(base, status.ANON_KEY, actorToken, "consume_verification_email_resend_limit", {
        input_ip_hash: randomBytes(32).toString("hex"), max_attempts: 1000000, window_hours: 1,
      });
      assert.ok([401, 403].includes(denied.status), "direct browser resend limiter RPC is denied");
      assert.equal(denied.data?.code, "42501", "direct browser denial is an EXECUTE privilege failure");
    }
    for (let n = 1; n <= 5; n++) {
      const resendBudget = await rpc(base, status.SERVICE_ROLE_KEY, null, "consume_verification_email_resend_limit", {
        input_ip_hash: budgetHash, max_attempts: 5, window_hours: 24,
      });
      assert.equal(resendBudget.status, 200, "service-owned signup resend budget remains callable");
      assert.deepEqual(resendBudget.data, [{ allowed: true, attempts: n }]);
    }
    const bypassBudget = await rpc(base, status.SERVICE_ROLE_KEY, null, "consume_verification_email_resend_limit", {
      input_ip_hash: budgetHash, max_attempts: 1000000, window_hours: 1,
    });
    assert.deepEqual(bypassBudget.data, [{ allowed: false, attempts: 5 }], "excessive max attempts cannot override fixed five-attempt budget");
    await db.query("update public.forum_upload_attempts set created_at=now()-interval '2 hours' where purpose='verification_email_resend' and ip_hash=$1", [budgetHash]);
    const shortenedWindow = await rpc(base, status.SERVICE_ROLE_KEY, null, "consume_verification_email_resend_limit", {
      input_ip_hash: budgetHash, max_attempts: 5, window_hours: 1,
    });
    assert.deepEqual(shortenedWindow.data, [{ allowed: false, attempts: 5 }], "one-hour argument cannot shorten fixed 24-hour window");
    const rotatedBudget = await rpc(base, status.SERVICE_ROLE_KEY, null, "consume_verification_email_resend_limit", {
      input_ip_hash: randomBytes(32).toString("hex"), max_attempts: 5, window_hours: 24,
    });
    assert.deepEqual(rotatedBudget.data, [{ allowed: true, attempts: 1 }], "different server-derived IP hash gets its own bucket");
    const raceHash = randomBytes(32).toString("hex");
    const race = await Promise.all(Array.from({ length: 8 }, () => rpc(base, status.SERVICE_ROLE_KEY, null,
      "consume_verification_email_resend_limit", { input_ip_hash: raceHash, max_attempts: 5, window_hours: 24 })));
    assert.equal(race.filter((result) => result.data?.[0]?.allowed).length, 5, "same-hash concurrent budget capped at five");

    const notificationId = randomUUID();
    await db.query("insert into public.forum_notifications(id,recipient_id,type) values($1,$2,'post_like')", [notificationId, user.id]);
    const pendingNotifications = await rest(base, status.ANON_KEY, token, "forum_notifications", "GET", undefined, `?select=id&id=eq.${notificationId}`);
    assert.equal(pendingNotifications.status, 200);
    assert.deepEqual(pendingNotifications.data, [], "pending cannot read private notifications or Realtime rows");
    const pendingUpdate = await rest(base, status.ANON_KEY, token, "profiles", "PATCH", { display_name: "Pending bypass" }, `?id=eq.${user.id}`);
    assert.ok(pendingUpdate.status === 200 || pendingUpdate.status === 204);
    assert.deepEqual(pendingUpdate.data, [], "pending cannot write own profile");
    const pendingStorage = await auth.storage.from("post-media").upload(`profile-avatars/${user.id}/1-pending.png`, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    assert.ok(pendingStorage.error, "pending cannot upload profile media");
    const deniedRpc = await rpc(base, status.ANON_KEY, token, "qa_grant_admin_role", { target_user_id: user.id });
    assert.ok(deniedRpc.status >= 400, "pending cannot call service-only QA role RPC");
    const draftId = randomUUID();
    await db.query("insert into public.news_articles(id,slug,title,status) values($1,$2,'Local draft','draft')", [draftId, `verified-bypass-${randomUUID().slice(0, 8)}`]);
    const draftDeviceId = randomUUID();
    await db.query(`insert into public.devices(id,slug,brand_key,brand_name,name,short_description,long_description,
      image_alt,category,route_label,route_description,publication_status)
      values($1,$2,'local','Local','Local draft device','Local description','Local long description',
      'Local device','ar_glasses','Local route','Local route description','draft')`,
      [draftDeviceId, `verified-device-${randomUUID().slice(0, 8)}`]);
    const publicDeviceId = randomUUID();
    await db.query(`insert into public.devices(id,slug,brand_key,brand_name,name,short_description,long_description,
      image_alt,category,route_label,route_description,publication_status)
      values($1,$2,'local','Local','Local public device','Local description','Local long description',
      'Local device','ar_glasses','Local route','Local route description','published')`,
      [publicDeviceId, `verified-public-device-${randomUUID().slice(0, 8)}`]);
    for (const actorToken of [null, token]) {
      const publicDevice = await rest(base, status.ANON_KEY, actorToken, "devices", "GET", undefined, `?select=id&id=eq.${publicDeviceId}`);
      assert.deepEqual(publicDevice.data, [{ id: publicDeviceId }], "devices published branch remains public");
    }
    await verifyAnonymousPages(status, { device: "Local public device", post: "Local public post", circle: "Local feed fixture" });
    await db.query("update public.profiles set role='moderator' where id=$1", [user.id]);
    const pendingStaffRead = await rest(base, status.ANON_KEY, token, "news_articles", "GET", undefined, `?select=id&id=eq.${draftId}`);
    assert.deepEqual(pendingStaffRead.data, [], "pending staff cannot read draft news");
    const pendingDeviceRead = await rest(base, status.ANON_KEY, token, "devices", "GET", undefined, `?select=id&id=eq.${draftDeviceId}`);
    assert.deepEqual(pendingDeviceRead.data, [], "pending staff cannot read draft device");
    const pendingStaffWrite = await rest(base, status.ANON_KEY, token, "news_articles", "PATCH", { title: "Pending staff edit" }, `?id=eq.${draftId}`);
    assert.deepEqual(pendingStaffWrite.data, [], "pending staff cannot write draft news");
    const mediaCases = [
      { family: "post", path: `${user.id}/${postId}/1-owner.png`, privateRead: true },
      { family: "circle", path: `circle-covers/${user.id}/1-owner.png`, privateRead: true },
      { family: "profile", path: `profile-avatars/${user.id}/1-owner.png`, privateRead: false },
      { family: "news", path: `news-covers/${user.id}/1-owner.png`, privateRead: false },
    ];
    for (const entry of mediaCases) {
      const pendingUpload = await auth.storage.from("post-media").upload(entry.path, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
      assert.ok(pendingUpload.error, `${entry.family} pending Storage INSERT denied`);
    }
    const insertCases = [
      { table: "circles", id: randomUUID(), body: { slug: `verified-insert-${randomUUID().slice(0, 8)}`, name: "Local insert circle", type: "topic", owner_id: user.id }, update: { name: "Verified circle update" }, deleteControl: false },
      { table: "posts", id: randomUUID(), body: { author_id: user.id, circle_id: circleId, type: "experience", title: "Inserted local post", body: "A valid published local post.", status: "published" }, update: { title: "Verified post update" } },
      { table: "comments", id: randomUUID(), body: { post_id: postId, author_id: user.id, body: "Inserted local comment", status: "published" }, update: { body: "Verified comment update" } },
      { table: "post_votes", id: randomUUID(), body: { post_id: postId, user_id: user.id, vote: 1 }, update: { vote: -1 } },
      { table: "bookmarks", id: randomUUID(), body: { post_id: privatePostId, user_id: user.id }, update: { user_id: user.id } },
      { table: "news_articles", id: randomUUID(), body: { slug: `verified-news-${randomUUID().slice(0, 8)}`, title: "Inserted local news", status: "draft" }, update: { title: "Verified news update" } },
    ];
    for (const entry of insertCases) {
      const pendingInsert = await rest(base, status.ANON_KEY, token, entry.table, "POST", { id: entry.id, ...entry.body });
      assert.equal(pendingInsert.data?.code, "42501", `${entry.table} pending INSERT denied by RLS`);
    }
    const { rows: [{ view_count: beforeView }] } = await db.query("select view_count from public.news_articles where slug='community-discussion-shifts-to-real-usage'");
    const publicCounter = await rpc(base, status.ANON_KEY, null, "increment_news_article_view", { p_slug: "community-discussion-shifts-to-real-usage" });
    assert.ok(publicCounter.status < 300, "public news counter remains callable");
    const { rows: [{ view_count: afterView }] } = await db.query("select view_count from public.news_articles where slug='community-discussion-shifts-to-real-usage'");
    assert.equal(afterView, beforeView + 1, "public counter still increments");

    const { rows: publication } = await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=any($1::text[]) order by tablename", [["comments", "post_votes", "comment_reactions", "forum_notifications"]]);
    assert.deepEqual(publication.map((row) => row.tablename), ["comment_reactions", "comments", "forum_notifications", "post_votes"], "all reviewed Realtime tables remain published");
    const controlEmail = `verified-realtime-${randomUUID()}@example.test`;
    const { data: controlCreated, error: controlCreateError } = await service.auth.admin.createUser({ email: controlEmail, password, email_confirm: true });
    assert.ifError(controlCreateError);
    realtimeControlUserId = controlCreated.user.id;
    const controlAuth = createClient(base, status.ANON_KEY, clientOptions);
    const { data: controlLogin, error: controlLoginError } = await controlAuth.auth.signInWithPassword({ email: controlEmail, password });
    assert.ifError(controlLoginError);
    const controlToken = controlLogin.session.access_token;
    const controlClaims = JSON.parse(Buffer.from(controlToken.split(".")[1], "base64url").toString("utf8"));
    await db.query("insert into private.ogh_verified_sessions(session_id,user_id,verification_kind) values($1,$2,'login_challenge')", [controlClaims.session_id, realtimeControlUserId]);
    const controlPredicate = await rpc(base, status.ANON_KEY, controlToken, "ogh_is_verified_session", {});
    assert.equal(controlPredicate.status, 200, "verified Realtime control predicate is callable");
    assert.equal(controlPredicate.data, true, "verified Realtime control has a live verified session");
    const pendingEvents = [];
    const controlEvents = [];
    auth.realtime.setAuth(token);
    controlAuth.realtime.setAuth(controlToken);
    const channel = auth.channel(`verified-session-bypass-${randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_notifications" }, (event) => pendingEvents.push(event));
    const controlChannel = controlAuth.channel(`verified-session-positive-${randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_notifications" }, (event) => controlEvents.push(event));
    try {
      await subscribe(channel, "pending private");
      await subscribe(controlChannel, "verified private positive control");
      const readinessDeadline = Date.now() + 30_000;
      const readinessIds = new Set();
      const hasReadinessEvent = () => controlEvents.some((event) => readinessIds.has(event.new?.id));
      let ready = false;
      while (!ready && Date.now() < readinessDeadline) {
        const readinessId = randomUUID();
        readinessIds.add(readinessId);
        await db.query("insert into public.forum_notifications(id,recipient_id,type) values($1,$2,'post_like')", [readinessId, realtimeControlUserId]);
        const controlRead = await rest(base, status.ANON_KEY, controlToken, "forum_notifications", "GET", undefined, `?select=id&id=eq.${readinessId}`);
        assert.deepEqual(controlRead.data, [{ id: readinessId }], "verified Realtime control row is visible through REST");
        const attemptDeadline = Math.min(Date.now() + 2500, readinessDeadline);
        while (!hasReadinessEvent() && Date.now() < attemptDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        ready = hasReadinessEvent();
      }
      assert.ok(ready, `verified notification readiness Realtime event not delivered; received=${controlEvents.length}`);
      assert.equal(pendingEvents.length, 0, "pending receives no verified readiness event");
      const observationStart = Date.now();
      const controlIds = [];
      let sentinelEventCount = 0;
      for (let index = 0; index < 4; index++) {
        const pendingId = randomUUID();
        const controlId = randomUUID();
        controlIds.push(controlId);
        await db.query("insert into public.forum_notifications(id,recipient_id,type) values($1,$2,'post_like'),($3,$4,'post_like')", [pendingId, user.id, controlId, realtimeControlUserId]);
        sentinelEventCount += 2;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const deliveryDeadline = observationStart + 14_500;
      let receivedControlIds = new Set(controlEvents.map((event) => event.new?.id).filter((id) => controlIds.includes(id)));
      while (receivedControlIds.size < controlIds.length && Date.now() < deliveryDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        receivedControlIds = new Set(controlEvents.map((event) => event.new?.id).filter((id) => controlIds.includes(id)));
      }
      const observationWindowMs = Date.now() - observationStart;
      console.log(`OBSERVATION_WINDOW_MS=${observationWindowMs}`);
      console.log(`SENTINEL_EVENT_COUNT=${sentinelEventCount}`);
      console.log(`PENDING_EVENTS_RECEIVED=${pendingEvents.length}`);
      console.log(`VERIFIED_EVENTS_RECEIVED=${receivedControlIds.size}`);
      console.log(`VERIFIED_SENTINEL_INDICES=${controlIds.map((id, index) => receivedControlIds.has(id) ? index + 1 : "MISSING").join(",")}`);
      assert.ok(observationWindowMs >= 10000 && observationWindowMs <= 15000, "bounded 10-15 second local observation");
      assert.equal(pendingEvents.length, 0, "pending receives zero private notification events");
      assert.equal(receivedControlIds.size, 4, "verified recipient receives every positive-control sentinel");
      const realtimePublicCommentId = randomUUID();
      await db.query("insert into public.comments(id,post_id,author_id,body,status,moderation_status) values($1,$2,$3,'Realtime public control','published','published')", [realtimePublicCommentId, postId, user.id]);
      const realtimePublicRead = await rest(base, status.ANON_KEY, token, "comments", "GET", undefined, `?select=id&id=eq.${realtimePublicCommentId}`);
      assert.deepEqual(realtimePublicRead.data, [{ id: realtimePublicCommentId }], "pending REST sees public comment event row");
    } finally {
      await auth.removeChannel(channel);
      await controlAuth.removeChannel(controlChannel);
      controlAuth.realtime.disconnect();
    }
    await db.query("insert into private.ogh_verified_sessions(session_id,user_id,verification_kind) values($1,$2,'login_challenge')", [claims.session_id, user.id]);
    for (const [table, , privateId] of mixedRows) {
      const privateRow = await rest(base, status.ANON_KEY, token, table, "GET", undefined, `?select=id&id=eq.${privateId}`);
      assert.deepEqual(privateRow.data, [{ id: privateId }], `${table} verified owner private SELECT`);
    }
    for (const [table, id] of [["bookmarks", bookmarkId]]) {
      const privateRow = await rest(base, status.ANON_KEY, token, table, "GET", undefined, `?select=id&id=eq.${id}`);
      assert.deepEqual(privateRow.data, [{ id }], `${table} verified private SELECT`);
    }
    const verifiedEvents = [];
    const verifiedChannel = auth.channel(`verified-session-control-${randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_notifications" }, (event) => verifiedEvents.push(event));
    try {
      await subscribe(verifiedChannel, "verified private");
      const controlId = randomUUID();
      await db.query("insert into public.forum_notifications(id,recipient_id,type) values($1,$2,'post_like')", [controlId, user.id]);
      await waitForEvent(verifiedEvents, controlId, "verified notification INSERT");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await db.query("delete from public.forum_notifications where id=$1", [controlId]);
      const deadline = Date.now() + 5000;
      while (!verifiedEvents.some((event) => event.old?.id === controlId)) {
        if (Date.now() >= deadline) throw new Error("verified notification DELETE event not delivered");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally { await auth.removeChannel(verifiedChannel); auth.realtime.disconnect(); }
    const verifiedNotifications = await rest(base, status.ANON_KEY, token, "forum_notifications", "GET", undefined, `?select=id&id=eq.${notificationId}`);
    assert.deepEqual(verifiedNotifications.data, [{ id: notificationId }], "verified recipient can read notifications");
    const verifiedUpdate = await rest(base, status.ANON_KEY, token, "profiles", "PATCH", { display_name: "Verified actor" }, `?id=eq.${user.id}`);
    assert.deepEqual(verifiedUpdate.data.map((row) => row.id), [user.id], "verified owner can write profile");
    const verifiedStaffRead = await rest(base, status.ANON_KEY, token, "news_articles", "GET", undefined, `?select=id&id=eq.${draftId}`);
    assert.deepEqual(verifiedStaffRead.data, [{ id: draftId }], "verified staff can read draft news");
    const verifiedDeviceRead = await rest(base, status.ANON_KEY, token, "devices", "GET", undefined, `?select=id&id=eq.${draftDeviceId}`);
    assert.deepEqual(verifiedDeviceRead.data, [{ id: draftDeviceId }], "verified staff can read draft device");
    const verifiedStaffWrite = await rest(base, status.ANON_KEY, token, "news_articles", "PATCH", { title: "Verified staff edit" }, `?id=eq.${draftId}`);
    assert.deepEqual(verifiedStaffWrite.data.map((row) => row.id), [draftId], "verified staff can write draft news");
    for (const entry of insertCases) {
      const verifiedInsert = await rest(base, status.ANON_KEY, token, entry.table, "POST", { id: entry.id, ...entry.body });
      assert.equal(verifiedInsert.status, 201, `${entry.table} verified INSERT: ${JSON.stringify(verifiedInsert.data)}`);
      assert.deepEqual(verifiedInsert.data.map((row) => row.id), [entry.id]);
    }
    const pendingAgain = createClient(base, status.ANON_KEY, clientOptions);
    const { data: secondLogin, error: secondError } = await pendingAgain.auth.signInWithPassword({ email, password });
    assert.ifError(secondError);
    assert.ok(secondLogin.session?.access_token, "second real password session");
    const secondToken = secondLogin.session.access_token;
    for (const entry of insertCases) {
      const pendingUpdate = await rest(base, status.ANON_KEY, secondToken, entry.table, "PATCH", entry.update, `?id=eq.${entry.id}`);
      assert.deepEqual(pendingUpdate.data, [], `${entry.table} pending UPDATE denied`);
      const verifiedUpdate = await rest(base, status.ANON_KEY, token, entry.table, "PATCH", entry.update, `?id=eq.${entry.id}`);
      assert.deepEqual(verifiedUpdate.data.map((row) => row.id), [entry.id], `${entry.table} verified UPDATE`);
    }
    for (const entry of [...insertCases].reverse()) {
      if (entry.deleteControl === false) continue;
      const pendingDelete = await rest(base, status.ANON_KEY, secondToken, entry.table, "DELETE", undefined, `?id=eq.${entry.id}`);
      assert.deepEqual(pendingDelete.data, [], `${entry.table} pending DELETE denied`);
      const verifiedDelete = await rest(base, status.ANON_KEY, token, entry.table, "DELETE", undefined, `?id=eq.${entry.id}`);
      assert.deepEqual(verifiedDelete.data.map((row) => row.id), [entry.id], `${entry.table} verified DELETE`);
    }
    const anonMedia = createClient(base, status.ANON_KEY, clientOptions);
    for (const entry of mediaCases) {
      const verifiedUpload = await auth.storage.from("post-media").upload(entry.path, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
      assert.ifError(verifiedUpload.error);
      if (entry.family === "profile") await db.query("update public.profiles set avatar_url=$1 where id=$2", [entry.path, user.id]);
      const readClient = entry.privateRead ? auth : anonMedia;
      const readable = await readClient.storage.from("post-media").download(entry.path);
      assert.ifError(readable.error);
      assert.deepEqual([...new Uint8Array(await readable.data.arrayBuffer())], [1, 2, 3], `${entry.family} owner/public Storage SELECT`);
      const pendingRead = await pendingAgain.storage.from("post-media").download(entry.path);
      if (entry.privateRead) assert.ok(pendingRead.error, `${entry.family} private Storage SELECT denied`);
      else assert.ifError(pendingRead.error);
      const pendingUpdate = await pendingAgain.storage.from("post-media").update(entry.path, new Uint8Array([4, 5, 6]), { contentType: "image/png" });
      assert.ok(pendingUpdate.error, `${entry.family} pending Storage UPDATE denied`);
      const verifiedUpdate = await auth.storage.from("post-media").update(entry.path, new Uint8Array([4, 5, 6]), { contentType: "image/png" });
      assert.ifError(verifiedUpdate.error);
      const pendingDelete = await pendingAgain.storage.from("post-media").remove([entry.path]);
      assert.ok(pendingDelete.error || !pendingDelete.data?.length, `${entry.family} pending Storage DELETE denied`);
      const stillReadable = await readClient.storage.from("post-media").download(entry.path);
      assert.ifError(stillReadable.error);
      const verifiedDelete = await auth.storage.from("post-media").remove([entry.path]);
      assert.ifError(verifiedDelete.error);
      assert.ok(verifiedDelete.data?.length, `${entry.family} verified Storage DELETE`);
    }
    const otherEmail = `verified-other-${randomUUID()}@example.test`;
    const { data: otherCreated, error: otherCreateError } = await service.auth.admin.createUser({
      email: otherEmail, password, email_confirm: true, user_metadata: { role: "admin", is_admin: true },
    });
    assert.ifError(otherCreateError);
    otherUserId = otherCreated.user.id;
    const otherAuth = createClient(base, status.ANON_KEY, clientOptions);
    const { data: otherLogin, error: otherLoginError } = await otherAuth.auth.signInWithPassword({ email: otherEmail, password });
    assert.ifError(otherLoginError);
    const otherToken = otherLogin.session.access_token;
    const otherClaims = JSON.parse(Buffer.from(otherToken.split(".")[1], "base64url").toString("utf8"));
    assert.equal(otherClaims.user_metadata.role, "admin", "adversarial metadata reached the token");
    await db.query("insert into private.ogh_verified_sessions(session_id,user_id,verification_kind) values($1,$2,'login_challenge')", [otherClaims.session_id, otherUserId]);
    const otherProfile = await rest(base, status.ANON_KEY, otherToken, "profiles", "GET", undefined, `?select=id,role&id=eq.${otherUserId}`);
    assert.deepEqual(otherProfile.data, [{ id: otherUserId, role: "user" }], "metadata does not grant staff role");
    const crossOwnerWrite = await rest(base, status.ANON_KEY, otherToken, "profiles", "PATCH", { display_name: "Cross-owner bypass" }, `?id=eq.${user.id}`);
    assert.deepEqual(crossOwnerWrite.data, [], "verified B cannot write A's profile");
    const { rows: [ownerProfile] } = await db.query("select display_name, role from public.profiles where id=$1", [user.id]);
    assert.equal(ownerProfile.display_name, "Verified actor", "cross-owner denial preserves A's profile");
    assert.equal(ownerProfile.role, "moderator", "cross-owner denial preserves A's staff role");
    const crossRecipientRead = await rest(base, status.ANON_KEY, otherToken, "forum_notifications", "GET", undefined, `?select=id&id=eq.${notificationId}`);
    assert.deepEqual(crossRecipientRead.data, [], "verified B cannot read A's notification");
    const metadataStaffRead = await rest(base, status.ANON_KEY, otherToken, "news_articles", "GET", undefined, `?select=id&id=eq.${draftId}`);
    assert.deepEqual(metadataStaffRead.data, [], "metadata admin hint cannot read staff draft");
    const signedOldToken = token;
    const { error: signOutError } = await auth.auth.signOut({ scope: "local" });
    assert.ifError(signOutError);
    const { error: oldUserError } = await service.auth.getUser(signedOldToken);
    assert.ok(oldUserError, "provider rejects old signed token after logout");
    const oldPrivate = await rest(base, status.ANON_KEY, signedOldToken, "forum_notifications", "GET", undefined, `?select=id&id=eq.${notificationId}`);
    assert.deepEqual(oldPrivate.data, [], "old signed JWT cannot read private notifications");
    const oldWrite = await rest(base, status.ANON_KEY, signedOldToken, "profiles", "PATCH", { display_name: "Old JWT bypass" }, `?id=eq.${user.id}`);
    assert.deepEqual(oldWrite.data, [], "old signed JWT cannot write own profile");
    const oldPublic = await rest(base, status.ANON_KEY, signedOldToken, "posts", "GET", undefined, `?select=id&id=eq.${postId}`);
    assert.deepEqual(oldPublic.data, [{ id: postId }], "public post remains readable with old signed JWT");
  } finally {
    auth.realtime.disconnect();
    db.release();
    const { error } = await service.auth.admin.deleteUser(user.id);
    assert.ifError(error);
    if (otherUserId) {
      const { error: otherDeleteError } = await service.auth.admin.deleteUser(otherUserId);
      assert.ifError(otherDeleteError);
    }
    if (realtimeControlUserId) {
      const { error: controlDeleteError } = await service.auth.admin.deleteUser(realtimeControlUserId);
      assert.ifError(controlDeleteError);
    }
  }
  console.log(`PASS verified session bypass: catalog/RLS=${tables.length}, REST behavior=${behavioralTables.size}, Storage families=4, live Realtime=forum_notifications, resend RPC service-role only`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const routes = spawnSync(process.execPath, ["--experimental-transform-types", fileURLToPath(new URL("./test-verified-session-routes.mjs", import.meta.url))], { stdio: "inherit" });
  if (routes.error) throw routes.error;
  if (routes.status !== 0) throw new Error("Verified Session Worker route matrix failed");
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./test-verified-session-sql.mjs", import.meta.url)), "--bypass-only"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
