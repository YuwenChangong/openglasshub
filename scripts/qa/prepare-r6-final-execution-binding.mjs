import path from "node:path";
import { assertAbsent, createFinalExecutionBindingPayload, writeCanonicalJsonAtomically } from "./r6-final-execution-binding-issuer.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
for (const key of ["--worktree", "--wrapper", "--parent-authorization", "--parent-receipt", "--output"]) if (!values.get(key)) fail("R6_FINAL_EXECUTION_BINDING_INPUT_INVALID");
const output = path.resolve(values.get("--output"));
if (path.basename(output) !== "final-execution-binding.json") fail("R6_FINAL_EXECUTION_BINDING_OUTPUT_INVALID");
await assertAbsent(output, "R6_FINAL_EXECUTION_BINDING_OUTPUT_EXISTS");
const result = await createFinalExecutionBindingPayload({ worktree: values.get("--worktree"), wrapper: values.get("--wrapper"), parentAuthorization: values.get("--parent-authorization"), parentReceipt: values.get("--parent-receipt") });
const sha256 = await writeCanonicalJsonAtomically(output, result.binding);
process.stdout.write(`${JSON.stringify({ output, sha256, executionCommit: result.executionCommit })}\n`);
