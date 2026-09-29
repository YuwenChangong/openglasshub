import { open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHECKS = [
  "AUTH_SIGNUP", "AUTH_EMAIL_VERIFICATION", "AUTH_LOGIN", "AUTH_SESSION_PERSISTENCE",
  "DEFAULT_IDENTITY", "CONSENT_FLOW", "AUTH_RESEND_VERIFICATION", "AUTH_LOGOUT",
  "AUTH_RELOGIN", "AUTH_PASSWORD_RECOVERY", "EMAIL_DELIVERY",
];
const FLOWS = ["SIGNUP", "RESEND", "PASSWORD_RESET"];
const PROVIDERS = ["GMAIL", "OUTLOOK", "QQ", "163"];
const KINDS = ["OBSERVED", "SOURCE_ONLY", "LOCAL_FIXTURE", "UNKNOWN"];
const PASSWORD_FIELDS = ["recoverySessionEstablished", "passwordUpdated", "loggedOut", "oldPasswordRejected", "newPasswordAccepted"];
const MAIL_FIELDS = [
  "flow", "provider", "ownedInbox", "evidenceKind", "evidenceRefs", "requestAtUtc",
  "responseAtUtc", "eventAtUtc", "receiptAtUtc", "appOutcome", "authOutcome",
  "smtpOutcome", "brevoOutcome", "mailboxReceived", "callbackOutcome",
];
const APP_AUTH = ["REQUEST_ACCEPTED", "AUTH_REJECTED", "RATE_LIMITED", "UNAVAILABLE", "UNKNOWN"];
const SMTP = ["SMTP_ACCEPTED", "REJECTED", "RATE_LIMITED", "UNAVAILABLE", "UNKNOWN"];
const BREVO = ["ACCEPTED", "SENT", "DELIVERED", "DEFERRED", "SOFT_BOUNCED", "HARD_BOUNCED", "BLOCKED", "SUPPRESSED", "REJECTED", "UNKNOWN"];
const CALLBACK = ["VERIFIED_SESSION", "RECOVERY_SESSION", "FAILED", "NOT_RUN", "UNKNOWN"];
const failedSchema = () => ({ status: "FAIL", missing: ["SCHEMA_INVALID"], providerLimitations: [] });

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every(key =>
    typeof key === "string" && keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
}

function boundedArray(value, max, validate) {
  if (!Array.isArray(value) || value.length > max) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !validate(descriptor.value)) return false;
  }
  return true;
}

function evidenceRefs(value) {
  return boundedArray(value, 8, ref => typeof ref === "string" && ref.length === 7 && /^EV-[0-9]{4}$/.test(ref)) &&
    new Set(value).size === value.length;
}

function utcOrUnknown(value) {
  if (value === "UNKNOWN") return true;
  if (typeof value !== "string" || ![20, 24].includes(value.length) ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === (value.length === 20 ? value.replace("Z", ".000Z") : value);
}

function validSchema(input) {
  if (!exactObject(input, ["schemaVersion", "deployedCommit", "observedAtUtc", "authorizationRef", "legalExternalReviewStatus", "checks", "mailCases", "passwordOutcomes"])) return false;
  if (input.schemaVersion !== 1 || typeof input.deployedCommit !== "string" || input.deployedCommit.length !== 40 ||
    !/^[a-f0-9]{40}$/.test(input.deployedCommit) || /^0{40}$/.test(input.deployedCommit) || !utcOrUnknown(input.observedAtUtc) ||
    typeof input.authorizationRef !== "string" || input.authorizationRef.length !== 10 || !/^AUTHZ-[0-9]{4}$/.test(input.authorizationRef) ||
    !["CONFIRMED", "NOT_CONFIRMED", "REQUIRED_FOR_POLICY_CHANGE"].includes(input.legalExternalReviewStatus)) return false;
  if (!exactObject(input.checks, CHECKS) || !CHECKS.every(name => {
    const check = input.checks[name];
    return exactObject(check, ["status", "evidenceKind", "evidenceRefs"]) &&
      ["PASS", "PARTIAL", "FAIL", "NOT_RUN"].includes(check.status) && KINDS.includes(check.evidenceKind) && evidenceRefs(check.evidenceRefs);
  })) return false;
  if (!boundedArray(input.mailCases, 12, item => exactObject(item, MAIL_FIELDS) &&
    FLOWS.includes(item.flow) && PROVIDERS.includes(item.provider) && typeof item.ownedInbox === "boolean" &&
    KINDS.includes(item.evidenceKind) && evidenceRefs(item.evidenceRefs) &&
    [item.requestAtUtc, item.responseAtUtc, item.eventAtUtc, item.receiptAtUtc].every(utcOrUnknown) &&
    APP_AUTH.includes(item.appOutcome) && APP_AUTH.includes(item.authOutcome) && SMTP.includes(item.smtpOutcome) &&
    BREVO.includes(item.brevoOutcome) && typeof item.mailboxReceived === "boolean" && CALLBACK.includes(item.callbackOutcome))) return false;
  if (new Set(input.mailCases.map(item => `${item.provider}_${item.flow}`)).size !== input.mailCases.length) return false;
  const password = input.passwordOutcomes;
  return exactObject(password, ["evidenceKind", "evidenceRefs", ...PASSWORD_FIELDS]) &&
    KINDS.includes(password.evidenceKind) && evidenceRefs(password.evidenceRefs) && PASSWORD_FIELDS.every(field => typeof password[field] === "boolean");
}

function evaluate(input) {
  const missing = new Set();
  const limitations = new Set();
  let failed = false;
  if (input.observedAtUtc === "UNKNOWN") missing.add("OBSERVED_AT_UTC_UNKNOWN");
  if (input.legalExternalReviewStatus === "REQUIRED_FOR_POLICY_CHANGE") {
    failed = true;
    missing.add("LEGAL_POLICY_CHANGE_STOPPED");
  }
  for (const name of CHECKS) {
    const check = input.checks[name];
    if (check.status === "FAIL") failed = true;
    if (check.status !== "PASS" || check.evidenceKind !== "OBSERVED" || check.evidenceRefs.length === 0) missing.add(name);
  }
  for (const flow of FLOWS) {
    if (!input.mailCases.some(item => item.provider === "GMAIL" && item.flow === flow)) missing.add(`GMAIL_${flow}`);
  }
  for (const provider of PROVIDERS.slice(1)) {
    const cases = input.mailCases.filter(item => item.provider === provider);
    if (!cases.length) limitations.add(`${provider}_NOT_RUN`);
    else for (const flow of FLOWS) if (!cases.some(item => item.flow === flow)) limitations.add(`${provider}_${flow}_NOT_RUN`);
  }
  for (const item of input.mailCases) {
    const name = `${item.provider}_${item.flow}`;
    // Evaluate explicit failures before any optional-inbox limitation.
    const rejected = [item.appOutcome, item.authOutcome, item.smtpOutcome].some(outcome => ["AUTH_REJECTED", "REJECTED", "RATE_LIMITED", "UNAVAILABLE"].includes(outcome)) ||
      ["DEFERRED", "SOFT_BOUNCED", "HARD_BOUNCED", "BLOCKED", "SUPPRESSED", "REJECTED"].includes(item.brevoOutcome) || item.callbackOutcome === "FAILED";
    if (rejected) { failed = true; missing.add(`${name}_FAILED`); }
    if (!item.ownedInbox) {
      if (item.provider === "GMAIL") missing.add(`${name}_OWNED_INBOX`);
      else limitations.add(`${name}_OWNED_ACCESS_UNAVAILABLE`);
      continue;
    }
    if (item.evidenceKind !== "OBSERVED" || item.evidenceRefs.length === 0) missing.add(`${name}_OBSERVED_EVIDENCE`);
    if (!item.mailboxReceived) missing.add(`${name}_MAILBOX_RECEIPT`);
    if (item.callbackOutcome !== (item.flow === "PASSWORD_RESET" ? "RECOVERY_SESSION" : "VERIFIED_SESSION")) missing.add(`${name}_CALLBACK`);
    for (const field of ["requestAtUtc", "responseAtUtc", "receiptAtUtc"]) if (item[field] === "UNKNOWN") missing.add(`${name}_${field}_UNKNOWN`);
    if (item.appOutcome !== "REQUEST_ACCEPTED" || item.authOutcome !== "REQUEST_ACCEPTED") missing.add(`${name}_REQUEST_OUTCOME`);
    if (item.smtpOutcome === "UNKNOWN") limitations.add(`${name}_SMTP_UNKNOWN`);
    if (item.brevoOutcome === "UNKNOWN") limitations.add(`${name}_BREVO_UNKNOWN`);
    else {
      if (item.brevoOutcome !== "DELIVERED") missing.add(`${name}_TRANSPORT_INCOMPLETE`);
      if (item.eventAtUtc === "UNKNOWN") missing.add(`${name}_eventAtUtc_UNKNOWN`);
    }
  }
  const password = input.passwordOutcomes;
  if (password.evidenceKind !== "OBSERVED" || password.evidenceRefs.length === 0) missing.add("AUTH_PASSWORD_RECOVERY_OBSERVED_EVIDENCE");
  for (const field of PASSWORD_FIELDS) if (!password[field]) missing.add(`AUTH_PASSWORD_RECOVERY_${field}`);
  return { status: failed ? "FAIL" : missing.size ? "PARTIAL" : "PASS", missing: [...missing], providerLimitations: [...limitations] };
}

// Outputs are fixed contract names, never copied from untrusted input.
export function validateSliceAAcceptance(input) {
  try {
    return validSchema(input) ? evaluate(input) : failedSchema();
  } catch {
    return failedSchema();
  }
}

async function main(args) {
  let result = failedSchema();
  let file;
  try {
    if (args.length !== 2 || args[0] !== "--receipt" || /^[a-z][a-z0-9+.-]*:\/\//i.test(args[1])) throw new Error();
    file = await open(args[1], "r");
    if (!(await file.stat()).isFile()) throw new Error();
    const bytes = Buffer.alloc(65537);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 65536) throw new Error();
    const text = bytes.subarray(0, size).toString("utf8").trim();
    const input = JSON.parse(text);
    // Canonical JSON prevents duplicate keys or alternate escaped field names hiding evidence.
    if (JSON.stringify(input) !== text) throw new Error();
    result = validateSliceAAcceptance(input);
  } catch {
    result = failedSchema();
  } finally {
    await file?.close();
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2));
