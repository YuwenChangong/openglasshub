const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src");
const migrationsDir = path.join(root, "supabase", "migrations");

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(fullPath));
    else results.push(fullPath);
  }
  return results;
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function fail(message) {
  failures.push(message);
}

const failures = [];
const passes = [];

const srcFiles = walk(srcDir).filter((file) => fs.statSync(file).isFile());
for (const file of srcFiles) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(text)) {
    fail(`${rel}: contains service role usage`);
  }
  if (/window\.confirm|window\.alert|window\.prompt/i.test(text)) {
    fail(`${rel}: contains native browser dialog usage`);
  }
}
passes.push("No service role usage in src");
passes.push("No native browser dialogs in src");

const criticalChecks = [
  {
    label: "Post delete API checks owner or staff",
    ok: /post\.author_id !== authData\.user\.id && !isStaff/.test(read("src/pages/api/forum/posts.ts")),
  },
  {
    label: "Post moderation UI gates delete button",
    ok: /const showDeleteButton = showManagementActions && \(isAuthor \|\| canModerate\)/.test(read("src/components/forum/PostModerationActions.tsx")),
  },
  {
    label: "Circle post API rejects non-owner non-staff actions",
    ok: /existingPost\.author_id !== auth\.user\.id/.test(read("src/pages/api/forum/circles/[slug]/posts.ts")),
  },
  {
    label: "Circle comment API rejects non-owner non-staff actions",
    ok: /existingComment\.author_id !== auth\.user\.id/.test(read("src/pages/api/forum/circles/[slug]/comments.ts")),
  },
  {
    label: "Notifications API only updates own notifications",
    ok: /\.update\(\{ read_at: new Date\(\)\.toISOString\(\) \}\)[\s\S]*?\.eq\("id", notificationId\)[\s\S]*?\.eq\("recipient_id", auth\.userId\)/.test(read("src/pages/api/users/me/notifications.ts")),
  },
  {
    label: "Notifications API only updates own notifications for mark all",
    ok: /\.update\(\{ read_at: new Date\(\)\.toISOString\(\) \}\)[\s\S]*?\.eq\("recipient_id", auth\.userId\)[\s\S]*?\.is\("read_at", null\)/.test(read("src/pages/api/users/me/notifications.ts")),
  },
  {
    label: "Post detail links author profile",
    ok: /post-detail__author-block/.test(read("src/pages/posts/[id].astro")) && /buildProfileHref/.test(read("src/pages/posts/[id].astro")),
  },
  {
    label: "Realtime auth helper exists",
    ok: /export async function syncBrowserRealtimeAuth/.test(read("src/lib/supabase-browser.ts")),
  },
  {
    label: "Forum permission lockdown migration exists",
    ok: fs.existsSync(path.join(migrationsDir, "20260611_forum_permission_lockdown.sql")),
  },
];

for (const check of criticalChecks) {
  if (check.ok) passes.push(check.label);
  else fail(check.label);
}

const migrationFiles = walk(migrationsDir).filter((file) => file.endsWith(".sql"));
for (const file of migrationFiles) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  const statements = text
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    if (!/^create policy\b/i.test(statement)) continue;
    if (/\bfor (update|delete)\b/i.test(statement) && /\busing\s*\(true\)/i.test(statement)) {
      fail(`${rel}: contains update/delete policy using (true)`);
    }
    if (/\bfor update\b/i.test(statement) && /\bwith check\s*\(true\)/i.test(statement)) {
      fail(`${rel}: contains update policy with check (true)`);
    }
  }
}
passes.push("No obvious broad update/delete RLS policies found");

if (failures.length > 0) {
  console.log("FORUM PERMISSION AUDIT FAILED");
  for (const item of failures) {
    console.log(`FAIL - ${item}`);
  }
  console.log("---");
  for (const item of passes) {
    console.log(`PASS - ${item}`);
  }
  process.exit(1);
}

console.log("FORUM PERMISSION AUDIT PASSED");
for (const item of passes) {
  console.log(`PASS - ${item}`);
}
