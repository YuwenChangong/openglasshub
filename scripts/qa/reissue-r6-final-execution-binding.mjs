import { createFinalExecutionBindingPayload, writeCanonicalJsonAtomically } from "./r6-final-execution-binding-issuer.mjs";
import { REISSUE_TERMINAL_VERSION, inspectKnownInvalidPrimary, validateReissueTerminal } from "./r6-final-execution-binding-reissue.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
for (const key of ["--worktree", "--wrapper", "--operator-root", "--parent-authorization", "--parent-authorization-sha256", "--parent-receipt", "--primary-binding-sha256"]) if (!values.get(key)) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_INPUT_INVALID");
const initial = await inspectKnownInvalidPrimary({ operatorRoot: values.get("--operator-root"), expectedPrimarySha256: values.get("--primary-binding-sha256"), finalAuthorizationPath: values.get("--parent-authorization"), expectedFinalAuthorizationSha256: values.get("--parent-authorization-sha256"), executionCommit: (await import("node:child_process")).execFileSync("git", ["-C", values.get("--worktree"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() });
const result = await createFinalExecutionBindingPayload({ worktree: values.get("--worktree"), wrapper: values.get("--wrapper"), parentAuthorization: values.get("--parent-authorization"), parentReceipt: values.get("--parent-receipt") });
const replacementBindingSha256 = await writeCanonicalJsonAtomically(initial.paths.replacement, result.binding);
const terminal = validateReissueTerminal({ schemaVersion: REISSUE_TERMINAL_VERSION, issuedAt: new Date().toISOString(), primaryInvalidBindingPath: initial.paths.primary, primaryInvalidBindingSha256: initial.primarySha256, primaryFailureClassification: initial.known.failureClassification, primaryFailureReasonCode: initial.known.failureReasonCode, replacementBindingPath: initial.paths.replacement, replacementBindingSha256 });
await writeCanonicalJsonAtomically(initial.paths.terminal, terminal);
process.stdout.write(`${JSON.stringify({ classification: "R6_FINAL_EXECUTION_BINDING_CANONICAL_REISSUE_READY", replacementBindingPath: initial.paths.replacement, replacementBindingSha256, reissueTerminalPath: initial.paths.terminal, executionCommit: result.executionCommit })}\n`);
