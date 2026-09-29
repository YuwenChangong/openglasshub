import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

let networkAttempts = 0;
const deny = () => { networkAttempts += 1; throw new Error("network denied"); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = deny;
const { validateSliceAAcceptance } = await import("./lib/slice-a-acceptance.mjs");

const checkNames = [
  "AUTH_SIGNUP", "AUTH_EMAIL_VERIFICATION", "AUTH_LOGIN", "AUTH_SESSION_PERSISTENCE",
  "DEFAULT_IDENTITY", "CONSENT_FLOW", "AUTH_RESEND_VERIFICATION", "AUTH_LOGOUT",
  "AUTH_RELOGIN", "AUTH_PASSWORD_RECOVERY", "EMAIL_DELIVERY",
];
const utc = "2026-09-29T00:00:00Z";
function mail(flow, provider = "GMAIL") {
  return {
    flow, provider, ownedInbox: true, evidenceKind: "OBSERVED", evidenceRefs: ["EV-0001"],
    requestAtUtc: utc, responseAtUtc: utc, eventAtUtc: utc, receiptAtUtc: utc,
    appOutcome: "REQUEST_ACCEPTED", authOutcome: "REQUEST_ACCEPTED",
    smtpOutcome: "SMTP_ACCEPTED", brevoOutcome: "DELIVERED", mailboxReceived: true,
    callbackOutcome: flow === "PASSWORD_RESET" ? "RECOVERY_SESSION" : "VERIFIED_SESSION",
  };
}
function complete() {
  return {
    schemaVersion: 1, deployedCommit: "9184af7a0d216efe4dfcd5efffdc56cc3095583c",
    observedAtUtc: utc, authorizationRef: "AUTHZ-0001", legalExternalReviewStatus: "NOT_CONFIRMED",
    checks: Object.fromEntries(checkNames.map(name => [name, {
      status: "PASS", evidenceKind: "OBSERVED", evidenceRefs: ["EV-0001"],
    }])),
    mailCases: [mail("SIGNUP"), mail("RESEND"), mail("PASSWORD_RESET")],
    passwordOutcomes: {
      evidenceKind: "OBSERVED", evidenceRefs: ["EV-0001"], recoverySessionEstablished: true,
      passwordUpdated: true, loggedOut: true, oldPasswordRejected: true, newPasswordAccepted: true,
    },
  };
}

test("deliveryWithoutReceiptIsPartial", () => {
  const input = complete();
  input.mailCases[0].mailboxReceived = false;
  input.mailCases[0].receiptAtUtc = "UNKNOWN";
  input.mailCases[0].callbackOutcome = "NOT_RUN";
  assert.equal(validateSliceAAcceptance(input).status, "PARTIAL", "deliveredWithoutReceiptMustNotPass");
});

test("completeOwnedGmailFixture validates structure only", () => {
  assert.deepEqual(validateSliceAAcceptance(complete()), {
    status: "PASS", missing: [], providerLimitations: ["OUTLOOK_NOT_RUN", "QQ_NOT_RUN", "163_NOT_RUN"],
  });
});

for (const field of ["recoverySessionEstablished", "passwordUpdated", "loggedOut", "oldPasswordRejected", "newPasswordAccepted"]) {
  test(`missingRecoveryProofIsPartial: ${field}`, () => {
    const input = complete();
    input.passwordOutcomes[field] = false;
    const result = validateSliceAAcceptance(input);
    assert.equal(result.status, "PARTIAL");
    assert.ok(result.missing.includes(`AUTH_PASSWORD_RECOVERY_${field}`));
  });
}

test("sourceOnlyAndLocalFixturesCannotPass", () => {
  for (const evidenceKind of ["SOURCE_ONLY", "LOCAL_FIXTURE", "UNKNOWN"]) {
    for (const section of ["check", "mail", "password"]) {
      const input = complete();
      if (section === "check") input.checks.AUTH_LOGIN.evidenceKind = evidenceKind;
      if (section === "mail") input.mailCases[0].evidenceKind = evidenceKind;
      if (section === "password") input.passwordOutcomes.evidenceKind = evidenceKind;
      assert.equal(validateSliceAAcceptance(input).status, "PARTIAL");
    }
  }
});

test("primaryGmailMandatoryForEachFlow", () => {
  for (const flow of ["SIGNUP", "RESEND", "PASSWORD_RESET"]) {
    const input = complete();
    input.mailCases = input.mailCases.filter(item => item.flow !== flow);
    input.mailCases.push(mail(flow, "OUTLOOK"));
    const result = validateSliceAAcceptance(input);
    assert.equal(result.status, "PARTIAL");
    assert.ok(result.missing.includes(`GMAIL_${flow}`));
  }
});

test("callbackRequiredAndBoundToFlow", () => {
  for (const flow of ["SIGNUP", "RESEND", "PASSWORD_RESET"]) {
    for (const callbackOutcome of ["UNKNOWN", "NOT_RUN", "FAILED", flow === "PASSWORD_RESET" ? "VERIFIED_SESSION" : "RECOVERY_SESSION"]) {
      const input = complete();
      input.mailCases.find(item => item.flow === flow).callbackOutcome = callbackOutcome;
      assert.equal(validateSliceAAcceptance(input).status, callbackOutcome === "FAILED" ? "FAIL" : "PARTIAL");
    }
  }
});

test("allElevenObservedChecksRequired", () => {
  for (const name of checkNames) {
    for (const status of ["PARTIAL", "NOT_RUN", "FAIL"]) {
      const input = complete();
      input.checks[name].status = status;
      assert.equal(validateSliceAAcceptance(input).status, status === "FAIL" ? "FAIL" : "PARTIAL");
    }
    const input = complete();
    input.checks[name].evidenceRefs = [];
    assert.equal(validateSliceAAcceptance(input).status, "PARTIAL");
    delete input.checks[name];
    assert.equal(validateSliceAAcceptance(input).status, "FAIL");
  }
});

test("unknownTimesStayUnknown", () => {
  const input = complete();
  input.observedAtUtc = "UNKNOWN";
  for (const field of ["requestAtUtc", "responseAtUtc", "eventAtUtc", "receiptAtUtc"]) input.mailCases[0][field] = "UNKNOWN";
  const before = structuredClone(input);
  assert.equal(validateSliceAAcceptance(input).status, "PARTIAL");
  assert.deepEqual(input, before);
});

test("optionalOperatorEvidenceRemainsUnknownAndReported", () => {
  const input = complete();
  Object.assign(input.mailCases[0], { smtpOutcome: "UNKNOWN", brevoOutcome: "UNKNOWN", eventAtUtc: "UNKNOWN" });
  const result = validateSliceAAcceptance(input);
  assert.equal(result.status, "PASS");
  assert.ok(result.providerLimitations.includes("GMAIL_SIGNUP_SMTP_UNKNOWN"));
  assert.ok(result.providerLimitations.includes("GMAIL_SIGNUP_BREVO_UNKNOWN"));
  assert.equal(input.mailCases[0].eventAtUtc, "UNKNOWN");
});

test("legalNotConfirmedDoesNotBlockAndPolicyChangeStops", () => {
  for (const status of ["CONFIRMED", "NOT_CONFIRMED", "REQUIRED_FOR_POLICY_CHANGE"]) {
    const input = complete();
    input.legalExternalReviewStatus = status;
    assert.equal(validateSliceAAcceptance(input).status, status === "REQUIRED_FOR_POLICY_CHANGE" ? "FAIL" : "PASS");
  }
});

test("additionalProviderLimitationIsReported", () => {
  const input = complete();
  input.mailCases.push({ ...mail("SIGNUP", "OUTLOOK"), ownedInbox: false, mailboxReceived: false, callbackOutcome: "NOT_RUN", receiptAtUtc: "UNKNOWN", evidenceKind: "UNKNOWN", evidenceRefs: [] });
  const result = validateSliceAAcceptance(input);
  assert.equal(result.status, "PASS");
  assert.ok(result.providerLimitations.includes("OUTLOOK_SIGNUP_OWNED_ACCESS_UNAVAILABLE"));
  assert.ok(result.providerLimitations.includes("OUTLOOK_RESEND_NOT_RUN"));
});

test("suppliedProviderFailureCannotBeDowngraded", () => {
  for (const provider of ["OUTLOOK", "QQ", "163"]) {
    for (const field of ["appOutcome", "authOutcome", "smtpOutcome", "brevoOutcome", "callbackOutcome"]) {
      const input = complete();
      const item = mail("SIGNUP", provider);
      item[field] = field === "callbackOutcome" ? "FAILED" : field === "smtpOutcome" ? "REJECTED" : field === "brevoOutcome" ? "HARD_BOUNCED" : "AUTH_REJECTED";
      item.ownedInbox = false;
      input.mailCases.push(item);
      assert.equal(validateSliceAAcceptance(input).status, "FAIL");
    }
  }
  const input = complete();
  input.mailCases.push({ ...mail("SIGNUP", "OUTLOOK"), mailboxReceived: false, callbackOutcome: "NOT_RUN", receiptAtUtc: "UNKNOWN" });
  assert.equal(validateSliceAAcceptance(input).status, "PARTIAL");
});

test("secretFieldsRejectedAtEveryObjectBoundary", () => {
  for (const section of ["root", "checks", "check", "mail", "password"]) {
    for (const key of ["password", "accessToken", "url", "rawBody", "email", "error", "__proto__"]) {
      const input = complete();
      const target = section === "root" ? input : section === "checks" ? input.checks : section === "check" ? input.checks.AUTH_LOGIN : section === "mail" ? input.mailCases[0] : input.passwordOutcomes;
      Object.defineProperty(target, key, { value: "fixture-sensitive-payload", enumerable: true });
      const result = validateSliceAAcceptance(input);
      assert.equal(result.status, "FAIL");
      assert.doesNotMatch(JSON.stringify(result), /fixture-sensitive-payload|accessToken|rawBody|__proto__/);
    }
  }
});

test("exactTypesBoundsAndSafeReferences", () => {
  const mutations = [
    x => { x.schemaVersion = 2; }, x => { x.deployedCommit = "missing"; },
    x => { x.authorizationRef = "https://example.invalid/?token=fixture"; },
    x => { x.authorizationRef = "AUTHZ-0001\n"; },
    x => { x.checks.AUTH_LOGIN.evidenceRefs = ["EV-fixture-secret"]; },
    x => { x.checks.AUTH_LOGIN.evidenceRefs = ["EV-0001", "EV-0001"]; },
    x => { x.checks.AUTH_LOGIN.evidenceRefs = Array.from({ length: 9 }, (_, i) => `EV-000${i}`); },
    x => { x.passwordOutcomes.oldPasswordRejected = "true"; },
    x => { x.mailCases[0].mailboxReceived = 1; }, x => { x.mailCases[0].provider = "OTHER"; },
    x => { x.mailCases[0].requestAtUtc = "2026-02-30T00:00:00Z"; },
    x => { x.mailCases[0].requestAtUtc = "2026-09-29T00:00:00+00:00"; },
    x => { x.mailCases[0].requestAtUtc = `${utc}\n`; },
    x => { x.mailCases.push(structuredClone(x.mailCases[0])); },
    x => { x.mailCases = Array.from({ length: 13 }, () => mail("SIGNUP")); },
    x => { delete x.passwordOutcomes.oldPasswordRejected; },
    x => { delete x.mailCases[0].receiptAtUtc; },
    x => { x.mailCases[0].brevoOutcome = { raw: "fixture" }; },
  ];
  for (const mutate of mutations) {
    const input = complete();
    mutate(input);
    assert.equal(validateSliceAAcceptance(input).status, "FAIL");
  }
  for (const input of [null, undefined, true, [], {}, { schemaVersion: 1, checks: {} }]) assert.equal(validateSliceAAcceptance(input).status, "FAIL");
});

test("placeholderDeployedCommitCannotPass", () => {
  const input = complete();
  input.deployedCommit = "0".repeat(40);
  assert.equal(validateSliceAAcceptance(input).status, "FAIL");
});

test("emptyObservedReferencesCannotPass", () => {
  for (const section of ["mail", "password"]) {
    const input = complete();
    if (section === "mail") input.mailCases[0].evidenceRefs = [];
    else input.passwordOutcomes.evidenceRefs = [];
    assert.equal(validateSliceAAcceptance(input).status, "PARTIAL");
  }
});

test("eachRequiredUtcAndKnownEventTimeRequired", () => {
  for (const field of ["requestAtUtc", "responseAtUtc", "eventAtUtc", "receiptAtUtc"]) {
    const input = complete();
    input.mailCases[0][field] = "UNKNOWN";
    assert.equal(validateSliceAAcceptance(input).status, "PARTIAL");
  }
  const input = complete();
  input.observedAtUtc = "2026-09-29T00:00:00.123Z";
  assert.equal(validateSliceAAcceptance(input).status, "PASS");
});

test("normalizedOutcomesNeverImplyReceiptOrHideFailure", () => {
  const cases = [
    ["appOutcome", "UNKNOWN", "PARTIAL"], ["authOutcome", "UNKNOWN", "PARTIAL"],
    ["smtpOutcome", "UNKNOWN", "PASS"], ["brevoOutcome", "UNKNOWN", "PASS"],
    ...["appOutcome", "authOutcome"].flatMap(field => ["AUTH_REJECTED", "RATE_LIMITED", "UNAVAILABLE"].map(value => [field, value, "FAIL"])),
    ...["REJECTED", "RATE_LIMITED", "UNAVAILABLE"].map(value => ["smtpOutcome", value, "FAIL"]),
    ...["DEFERRED", "SOFT_BOUNCED", "HARD_BOUNCED", "BLOCKED", "SUPPRESSED", "REJECTED"].map(value => ["brevoOutcome", value, "FAIL"]),
    ["brevoOutcome", "ACCEPTED", "PARTIAL"], ["brevoOutcome", "SENT", "PARTIAL"],
  ];
  for (const [field, value, status] of cases) {
    const input = complete();
    input.mailCases[0][field] = value;
    assert.equal(validateSliceAAcceptance(input).status, status);
  }
});

test("denseArraysAndMaximumProviderCoverage", () => {
  const input = complete();
  input.mailCases = ["GMAIL", "OUTLOOK", "QQ", "163"].flatMap(provider => ["SIGNUP", "RESEND", "PASSWORD_RESET"].map(flow => mail(flow, provider)));
  input.checks.AUTH_LOGIN.evidenceRefs = Array.from({ length: 8 }, (_, i) => `EV-000${i}`);
  assert.deepEqual(validateSliceAAcceptance(input), { status: "PASS", missing: [], providerLimitations: [] });
  for (const mutate of [
    x => { delete x.mailCases[0]; },
    x => { x.mailCases.rawBody = "fixture"; },
    x => { x.checks.AUTH_LOGIN.evidenceRefs = new Array(1); },
    x => { x.checks.AUTH_LOGIN[Symbol("fixture")] = true; },
  ]) {
    const invalid = complete();
    mutate(invalid);
    assert.equal(validateSliceAAcceptance(invalid).status, "FAIL");
  }
});

test("validatorHandlesUntrustedObjectsWithoutReadingAccessors", () => {
  const input = complete();
  Object.defineProperty(input, "deployedCommit", { get() { throw new Error("fixture-sensitive-payload"); }, enumerable: true });
  assert.equal(validateSliceAAcceptance(input).status, "FAIL");
  assert.equal(validateSliceAAcceptance(new Proxy({}, { ownKeys() { throw new Error("fixture-sensitive-payload"); } })).status, "FAIL");
});

test("CLI rejects network and device paths before any open", () => {
  const cli = path.resolve("scripts/lib/slice-a-acceptance.mjs");
  const rejected = [
    "\\\\fixture-host\\share\\receipt.json", "//fixture-host/share/receipt.json",
    "\\/fixture-host/share/receipt.json", "/\\fixture-host/share/receipt.json",
    "\\\\?\\UNC\\fixture-host\\share\\receipt.json", "\\\\?\\C:\\receipt.json",
    "\\\\.\\pipe\\fixture", "\\??\\C:\\receipt.json", "\\Device\\fixture",
    "NUL", "CON.json", "C:\\fixtures\\AUX.txt", ".\\COM1", "LPT9:", "CONIN$", "CONOUT$",
    "https://example.invalid/receipt.json", "file:///C:/receipt.json", "/dev/null",
  ];
  for (const [candidate, expectedOpens] of [
    ...rejected.map(candidate => [candidate, 0]),
    [".tmp/receipt.json", 1], ["../receipt.json", 1], ["C:\\fixtures\\receipt.json", 1],
    ["C:/fixtures/receipt.json", 1], ["/tmp/receipt.json", 1], ["\\fixtures\\receipt.json", 1],
  ]) {
    // Replace the builtin before importing the CLI: none of these paths reaches the filesystem.
    const source = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import { pathToFileURL } from 'node:url';
      let opens = 0;
      fs.open = async () => { opens += 1; throw new Error('fake open'); };
      syncBuiltinESMExports();
      process.argv = [process.execPath, ${JSON.stringify(cli)}, '--receipt', ${JSON.stringify(candidate)}];
      await import(pathToFileURL(process.argv[1]).href);
      process.stdout.write(JSON.stringify({ opens }) + '\\n');
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      encoding: "utf8", env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const [summary, observation] = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(summary, { status: "FAIL", missing: ["SCHEMA_INVALID"], providerLimitations: [] });
    assert.equal(observation.opens, expectedOpens, "unsafe paths must be rejected before open; local paths must reach fake open");
  }
});

test("CLI exits nonzero for not-PASS and never echoes payloads or paths", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "slice-a-fixtures-"));
  const file = path.join(directory, "receipt.json");
  const cli = path.resolve("scripts/lib/slice-a-acceptance.mjs");
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } });
  try {
    await writeFile(file, JSON.stringify(complete()));
    const relative = run(["--receipt", path.relative(process.cwd(), file)]);
    assert.equal(relative.status, 0);
    assert.equal(JSON.parse(relative.stdout).status, "PASS");
    for (const [input, code, status] of [[complete(), 0, "PASS"], [{ ...complete(), password: "fixture-sensitive-payload" }, 1, "FAIL"], [{ ...complete(), mailCases: [] }, 1, "PARTIAL"]]) {
      await writeFile(file, JSON.stringify(input));
      const result = run(["--receipt", file]);
      assert.equal(result.status, code);
      assert.equal(JSON.parse(result.stdout).status, status);
      assert.doesNotMatch(result.stdout + result.stderr, /fixture-sensitive-payload|receipt\.json|9184af7a|AUTHZ-0001|EV-0001/);
    }
    const duplicateKey = JSON.stringify(complete()).replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1');
    for (const text of ["{bad fixture-sensitive-payload", " ".repeat(65537), duplicateKey, JSON.stringify(complete(), null, 2)]) {
      await writeFile(file, text);
      const result = run(["--receipt", file]);
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).status, "FAIL");
      assert.doesNotMatch(result.stdout + result.stderr, /fixture-sensitive-payload|receipt\.json/);
    }
    for (const args of [[], ["--receipt", file, "--extra"], ["--receipt", path.join(directory, "missing.json")], ["--receipt", "https://example.invalid/receipt.json"]]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).status, "FAIL");
      assert.equal(result.stderr, "");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("no external network attempted", () => assert.equal(networkAttempts, 0));
