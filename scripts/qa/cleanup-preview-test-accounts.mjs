import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "QA_SUPABASE_URL",
  "QA_SUPABASE_SERVICE_ROLE_KEY",
  "QA_ORDINARY_EMAIL",
  "QA_ADMIN_EMAIL",
];

function requireEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`missing required env: ${missing.join(", ")}`);
    process.exitCode = 1;
    return null;
  }
  return Object.fromEntries(REQUIRED_ENV.map((key) => [key, process.env[key]]));
}

function redactEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

async function listUsersByEmail(client, email) {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const batch = data?.users ?? [];
    users.push(...batch.filter((user) => user.email?.toLowerCase() === email.toLowerCase()));
    if (batch.length < 200) break;
    page += 1;
  }
  return users;
}

async function softHideContent(client, userId) {
  await client.from("posts").update({
    status: "hidden_by_admin",
    moderation_status: "hidden_by_admin",
    moderation_reason: "qa_cleanup",
  }).eq("author_id", userId);

  await client.from("comments").update({
    status: "hidden_by_admin",
    moderation_status: "hidden_by_admin",
    moderation_reason: "qa_cleanup",
  }).eq("author_id", userId);

  await client.from("circles").update({
    status: "deleted",
  }).eq("owner_id", userId);
}

async function main() {
  const env = requireEnv();
  if (!env) return;

  const client = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const emails = [env.QA_ORDINARY_EMAIL, env.QA_ADMIN_EMAIL];
  for (const email of emails) {
    const users = await listUsersByEmail(client, email);
    for (const user of users) {
      await softHideContent(client, user.id);
      const { error } = await client.auth.admin.deleteUser(user.id);
      if (error) throw error;
      console.log(`cleaned QA user ${redactEmail(email)}`);
    }
  }
}

main().catch((error) => {
  console.error("cleanup-preview-test-accounts failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
