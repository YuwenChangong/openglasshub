import { createClient } from "@supabase/supabase-js";
import {
  printQaWriteGuardError,
  readConfirmRunArgument,
  readQaWriteGuardConfig,
  validateQaWriteTarget,
} from "./target-write-guard.mjs";

const REQUIRED_ENV = [
  "QA_SUPABASE_URL",
  "QA_SUPABASE_SERVICE_ROLE_KEY",
  "QA_ORDINARY_EMAIL",
  "QA_ORDINARY_PASSWORD",
  "QA_ADMIN_EMAIL",
  "QA_ADMIN_PASSWORD",
];

function parseArgs(argv) {
  const options = { dryRun: false, confirmRun: readConfirmRunArgument(argv) };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") options.dryRun = true;
    else if (value === "--confirm-run") {
      index += 1;
    }
  }
  return options;
}

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

function redactId(id) {
  if (!id) return "unknown";
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
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

async function ensureUser(client, { email, password }) {
  const existing = await listUsersByEmail(client, email);
  if (existing[0]) {
    const current = existing[0];
    const { data, error } = await client.auth.admin.updateUserById(current.id, {
      password,
      email_confirm: true,
      ban_duration: "none",
      user_metadata: {
        ...(current.user_metadata ?? {}),
        qa_managed: true,
        qa_account_type: email === process.env.QA_ADMIN_EMAIL ? "admin" : "ordinary",
        qa_disabled: false,
        qa_cleanup_at: null,
      },
    });
    if (error) throw error;
    return data.user ?? current;
  }

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      qa_managed: true,
      qa_account_type: email === process.env.QA_ADMIN_EMAIL ? "admin" : "ordinary",
      qa_disabled: false,
      qa_cleanup_at: null,
    },
  });
  if (error || !data.user) throw error ?? new Error(`failed to create user for ${email}`);
  return data.user;
}

async function ensureAdminRole(client, userId) {
  const { data, error } = await client.rpc("qa_grant_admin_role", { target_user_id: userId });
  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (message.includes("could not find the function") || message.includes("schema cache")) {
      throw new Error("QA_ADMIN_ROLE_RPC_MISSING");
    }
    if (error.code === "42501" || message.includes("permission denied")) {
      throw new Error("QA_ADMIN_ROLE_RPC_PERMISSION_DENIED");
    }
    throw new Error(`QA_ADMIN_ROLE_RPC_FAILED: ${error.message ?? "unknown error"}`);
  }
  if (data !== "admin") {
    throw new Error("QA_ADMIN_ROLE_GRANT_VERIFY_FAILED");
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    printQaWriteGuardError(error);
    process.exitCode = 1;
    return;
  }
  const env = requireEnv();
  if (!env) return;

  let target;
  try {
    target = validateQaWriteTarget(readQaWriteGuardConfig(process.env, options.confirmRun));
  } catch (error) {
    printQaWriteGuardError(error);
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      targetRef: target.actualRef,
      productionTarget: target.productionTarget,
      runLabel: target.safeRunLabel,
      plannedOperations: ["ensure ordinary QA account", "ensure admin QA account", "grant QA admin role"],
    }, null, 2));
    return;
  }

  const client = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ordinary = await ensureUser(client, {
    email: env.QA_ORDINARY_EMAIL,
    password: env.QA_ORDINARY_PASSWORD,
  });
  const admin = await ensureUser(client, {
    email: env.QA_ADMIN_EMAIL,
    password: env.QA_ADMIN_PASSWORD,
  });

  await ensureAdminRole(client, admin.id);

  console.log("preview QA accounts ready");
  console.log(`- ordinary: ${redactEmail(ordinary.email)} (${redactId(ordinary.id)})`);
  console.log(`- admin: ${redactEmail(admin.email)} (${redactId(admin.id)})`);
  console.log("- admin role granted via controlled local-only script");
}

main().catch((error) => {
  console.error("create-preview-test-accounts failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
