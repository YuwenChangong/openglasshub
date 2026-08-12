import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueProductionReconciliationV4Package } from "./lib/r6-production-reconciliation-package-v4.mjs";
import { issueAttestedCandidateV3 } from "./lib/r6-production-reconciliation-candidate-issuer-v3.mjs";
import { loadCandidateAuthority } from "./lib/r6-production-reconciliation-candidate-authority.mjs";
const root=process.cwd(), commit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(), hash=v=>createHash("sha256").update(v).digest("hex"), temp=await mkdtemp(path.join(os.tmpdir(),"r6-candidate-authority-"));
try { const packageRoot=path.join(temp,"package"), candidateRoot=path.join(temp,"candidate"); await issueProductionReconciliationV4Package({packageRoot,repositoryRoot:root,implementationCommit:commit,launcherSha256:hash("l"),secureWrapperSha256:hash("w"),baselineSha256:"adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a"}); await issueAttestedCandidateV3({candidateRoot,packageRoot,repositoryRoot:root,transportImplementationCommit:commit,transportLauncherSha256:hash("l"),transportSha256:hash("t"),requiredConfirmationPhrase:"phrase",testOnly:true,testAuthorityRoot:path.join(temp,"authority")}); const authority=await loadCandidateAuthority({candidateRoot}); assert.equal(authority.candidate.authorizationState,"AWAITING_FINAL_HUMAN_CONFIRMATION"); console.log("R6_PRODUCTION_RECONCILIATION_CANDIDATE_AUTHORITY_UNIT_PASS"); } finally { await rm(temp,{recursive:true,force:true}); }
