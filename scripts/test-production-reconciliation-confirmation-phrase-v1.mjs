import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueAttestedCandidateV3 } from "./lib/r6-production-reconciliation-candidate-issuer-v3.mjs";
import { issueFreshConfirmationPhraseV1, loadConfirmationPhraseIssuanceV1 } from "./lib/r6-production-reconciliation-confirmation-phrase-v1.mjs";
import { issueProductionReconciliationV4Package } from "./lib/r6-production-reconciliation-package-v4.mjs";

const root = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const hash = value => createHash("sha256").update(value).digest("hex");
const fixed = byte => size => Buffer.alloc(size, byte);
const temp = await mkdtemp(path.join(os.tmpdir(), "r6-confirmation-phrase-v1-"));
const authority = path.join(temp, "shared-authority");
const packageRoot = path.join(temp, "package");
const candidateInputs = { packageRoot, repositoryRoot: root, transportImplementationCommit: commit, transportLauncherSha256: hash("launcher"), transportSha256: hash("transport"), testOnly: true, testAuthorityRoot: authority };

try {
  await issueProductionReconciliationV4Package({ packageRoot, repositoryRoot: root, implementationCommit: commit, launcherSha256: candidateInputs.transportLauncherSha256, secureWrapperSha256: hash("wrapper"), baselineSha256: "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a" });
  const issued = await issueFreshConfirmationPhraseV1({ repositoryRoot: root, sourceCommit: commit, testOnly: true, testAuthorityRoot: authority, randomBytesProvider: fixed(0x41) });
  assert.match(issued.confirmationPhrase, new RegExp(`^CONFIRM_R6_PRODUCTION_RECONCILIATION_${commit.slice(0, 8).toUpperCase()}_[A-F0-9]{64}_SINGLE_USE_V5$`));
  const originalReceipt = await readFile(issued.receipt.path);
  await assert.rejects(() => issueFreshConfirmationPhraseV1({ repositoryRoot: root, sourceCommit: commit, testOnly: true, testAuthorityRoot: authority, randomBytesProvider: fixed(0x41) }), /CONFIRMATION_PHRASE_ALREADY_ISSUED/);
  assert.deepEqual(await readFile(issued.receipt.path), originalReceipt);
  const loaded = await loadConfirmationPhraseIssuanceV1({ repositoryRoot: root, issuancePath: issued.receipt.path, sourceCommit: commit, testOnly: true, testAuthorityRoot: authority });
  assert.equal(loaded.value.confirmationPhraseSha256, issued.confirmationPhraseSha256);
  const first = await issueAttestedCandidateV3({ ...candidateInputs, candidateRoot: path.join(temp, "candidate-a"), confirmationIssuancePath: issued.receipt.path });
  await assert.rejects(() => issueAttestedCandidateV3({ ...candidateInputs, candidateRoot: path.join(temp, "candidate-b"), confirmationIssuancePath: issued.receipt.path }), /CONFIRMATION_PHRASE_CROSS_CANDIDATE_REUSE_REJECTED/);
  await assert.rejects(access(path.join(temp, "candidate-b", "production-reconciliation-candidate.json")), /ENOENT/);
  const raced = await issueFreshConfirmationPhraseV1({ repositoryRoot: root, sourceCommit: commit, testOnly: true, testAuthorityRoot: authority, randomBytesProvider: fixed(0x42) });
  const race = await Promise.allSettled(["c", "d"].map(name => issueAttestedCandidateV3({ ...candidateInputs, candidateRoot: path.join(temp, `candidate-${name}`), confirmationIssuancePath: raced.receipt.path })));
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(race.filter(result => result.status === "rejected" && /CROSS_CANDIDATE_REUSE_REJECTED/.test(result.reason?.message)).length, 1);
  await assert.rejects(() => issueAttestedCandidateV3({ ...candidateInputs, testOnly: false, candidateRoot: path.join(temp, "historical"), requiredConfirmationPhrase: "CONFIRM_R6_PRODUCTION_RECONCILIATION_AA5E44C0_63E036B0997B44DBA8BAE5ED1F4E293E_SINGLE_USE_V4" }), /CONFIRMATION_ISSUANCE_REQUIRED/);
  const persisted = [first.candidateArtifact.path, issued.receipt.path, path.join(authority, "candidate-bindings", `${issued.confirmationPhraseSha256}.json`)];
  for (const file of persisted) assert.equal((await readFile(file, "utf8")).includes(issued.confirmationPhrase), false);
  console.log("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_PHRASE_ISSUANCE_V1_PASS");
  console.log("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_PHRASE_CROSS_CANDIDATE_REUSE_REJECTED");
} finally { await rm(temp, { recursive: true, force: true }); }
