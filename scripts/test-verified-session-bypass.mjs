import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
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
];
const publicRpc = [
  "increment_post_view_count(uuid)",
  "increment_news_article_view(text)",
  "consume_verification_email_resend_limit(text,integer,integer)",
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

export async function verifyBypass({ pool, status }) {
  const base = localUrl(status.API_URL);
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
  try {
    const { rows: policies } = await db.query(`select tablename, cmd, permissive, qual, with_check
      from pg_policies where schemaname='public' and tablename=any($1::text[])`, [tables]);
    for (const table of tables) {
      const owned = policies.filter((p) => p.tablename === table);
      assert.ok(owned.length, `${table} has policies`);
      for (const cmd of ["INSERT", "UPDATE", "DELETE"]) {
        const relevant = owned.filter((p) => p.cmd === cmd || p.cmd === "ALL");
        const { rows: [{ allowed }] } = await db.query("select has_table_privilege('authenticated',$1,$2) as allowed", [`public.${table}`, cmd]);
        if (allowed && relevant.some((p) => p.permissive === "PERMISSIVE")) {
          assert.ok(relevant.some((p) => p.permissive === "RESTRICTIVE" &&
            `${p.qual ?? ""} ${p.with_check ?? ""}`.includes("ogh_is_verified_session")), `${table} ${cmd} verified RLS`);
        }
      }
      if (privateReads.has(table) || mixedReads.has(table)) {
        assert.ok(owned.some((p) => p.cmd === "SELECT" && p.permissive === "RESTRICTIVE" &&
          (p.qual ?? "").includes("ogh_is_verified_session")), `${table} private SELECT verified RLS`);
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
    const { rows: [{ view_count: beforePostView }] } = await db.query("select view_count from public.posts where id=$1", [postId]);
    const publicPostCounter = await rpc(base, status.ANON_KEY, null, "increment_post_view_count", { p_post_id: postId });
    assert.ok(publicPostCounter.status < 300, "public post counter remains callable");
    const { rows: [{ view_count: afterPostView }] } = await db.query("select view_count from public.posts where id=$1", [postId]);
    assert.equal(afterPostView, beforePostView + 1, "public post counter still increments");
    const resendBudget = await rpc(base, status.ANON_KEY, null, "consume_verification_email_resend_limit", {
      input_ip_hash: `local-${randomUUID()}`, max_attempts: 5, window_hours: 24,
    });
    assert.equal(resendBudget.status, 200, "public signup resend budget remains callable");
    assert.equal(resendBudget.data[0]?.allowed, true);

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
    await db.query("update public.profiles set role='moderator' where id=$1", [user.id]);
    const pendingStaffRead = await rest(base, status.ANON_KEY, token, "news_articles", "GET", undefined, `?select=id&id=eq.${draftId}`);
    assert.deepEqual(pendingStaffRead.data, [], "pending staff cannot read draft news");
    const pendingStaffWrite = await rest(base, status.ANON_KEY, token, "news_articles", "PATCH", { title: "Pending staff edit" }, `?id=eq.${draftId}`);
    assert.deepEqual(pendingStaffWrite.data, [], "pending staff cannot write draft news");
    const { rows: [{ view_count: beforeView }] } = await db.query("select view_count from public.news_articles where slug='community-discussion-shifts-to-real-usage'");
    const publicCounter = await rpc(base, status.ANON_KEY, null, "increment_news_article_view", { p_slug: "community-discussion-shifts-to-real-usage" });
    assert.ok(publicCounter.status < 300, "public news counter remains callable");
    const { rows: [{ view_count: afterView }] } = await db.query("select view_count from public.news_articles where slug='community-discussion-shifts-to-real-usage'");
    assert.equal(afterView, beforeView + 1, "public counter still increments");

    const { rows: publication } = await db.query("select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='forum_notifications'");
    assert.equal(publication.length, 1, "notification Realtime publication remains enabled");
    const pendingEvents = [];
    auth.realtime.setAuth(token);
    const channel = auth.channel(`verified-session-bypass-${randomUUID()}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "forum_notifications" }, (event) => pendingEvents.push(event));
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Local Realtime subscription timed out")), 15000);
        channel.subscribe((state) => {
          if (state === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") { clearTimeout(timer); reject(new Error(`Local Realtime ${state}`)); }
        });
      });
      const deletedId = randomUUID();
      await db.query("insert into public.forum_notifications(id,recipient_id,type) values($1,$2,'post_like')", [deletedId, user.id]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await db.query("delete from public.forum_notifications where id=$1", [deletedId]);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      assert.equal(pendingEvents.length, 0, "pending must not receive private notification DELETE events");
    } finally { await auth.removeChannel(channel); }
    await db.query("insert into private.ogh_verified_sessions(session_id,user_id,verification_kind) values($1,$2,'login_challenge')", [claims.session_id, user.id]);
    const verifiedEvents = [];
    const verifiedChannel = auth.channel(`verified-session-control-${randomUUID()}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "forum_notifications" }, (event) => verifiedEvents.push(event));
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Verified Realtime subscription timed out")), 15000);
        verifiedChannel.subscribe((state) => {
          if (state === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") { clearTimeout(timer); reject(new Error(`Verified Realtime ${state}`)); }
        });
      });
      const controlId = randomUUID();
      await db.query("insert into public.forum_notifications(id,recipient_id,type) values($1,$2,'post_like')", [controlId, user.id]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await db.query("delete from public.forum_notifications where id=$1", [controlId]);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      assert.ok(verifiedEvents.some((event) => event.old?.id === controlId), "verified Realtime DELETE control delivered");
    } finally { await auth.removeChannel(verifiedChannel); auth.realtime.disconnect(); }
    const verifiedNotifications = await rest(base, status.ANON_KEY, token, "forum_notifications", "GET", undefined, `?select=id&id=eq.${notificationId}`);
    assert.deepEqual(verifiedNotifications.data, [{ id: notificationId }], "verified recipient can read notifications");
    const verifiedUpdate = await rest(base, status.ANON_KEY, token, "profiles", "PATCH", { display_name: "Verified actor" }, `?id=eq.${user.id}`);
    assert.deepEqual(verifiedUpdate.data.map((row) => row.id), [user.id], "verified owner can write profile");
    const verifiedStaffRead = await rest(base, status.ANON_KEY, token, "news_articles", "GET", undefined, `?select=id&id=eq.${draftId}`);
    assert.deepEqual(verifiedStaffRead.data, [{ id: draftId }], "verified staff can read draft news");
    const verifiedStaffWrite = await rest(base, status.ANON_KEY, token, "news_articles", "PATCH", { title: "Verified staff edit" }, `?id=eq.${draftId}`);
    assert.deepEqual(verifiedStaffWrite.data.map((row) => row.id), [draftId], "verified staff can write draft news");
    const verifiedStorage = await auth.storage.from("post-media").upload(`profile-avatars/${user.id}/2-verified.png`, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    assert.ifError(verifiedStorage.error);
    const publicMediaPath = `news-covers/${user.id}/3-public.png`;
    const newsUpload = await auth.storage.from("post-media").upload(publicMediaPath, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    assert.ifError(newsUpload.error);
    const anonMedia = createClient(base, status.ANON_KEY, clientOptions);
    const publicMedia = await anonMedia.storage.from("post-media").download(publicMediaPath);
    assert.ifError(publicMedia.error);
    assert.deepEqual([...new Uint8Array(await publicMedia.data.arrayBuffer())], [1, 2, 3], "public news media remains readable");
  } finally {
    auth.realtime.disconnect();
    db.release();
    const { error } = await service.auth.admin.deleteUser(user.id);
    assert.ifError(error);
  }
  console.log(`PASS verified session bypass: ${tables.length} table surfaces; local REST, Storage, RPC and Realtime`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./test-verified-session-sql.mjs", import.meta.url)), "--bypass-only"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
