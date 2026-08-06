import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readAndValidateFinalExecutionBinding } from "./r6-final-execution-binding.mjs";
import { validateParentSameCommitBinding } from "./r6-final-execution-binding-reissue.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
for (const key of ["--binding", "--binding-sha256", "--parent-authorization", "--parent-authorization-sha256", "--parent-receipt", "--execution-commit"]) if (!values.get(key)) fail("R6_FINAL_PARENT_DRYRUN_SAME_COMMIT_INPUT_INVALID");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const [binding, authorizationRaw, receiptRaw] = await Promise.all([
  readAndValidateFinalExecutionBinding(values.get("--binding"), values.get("--binding-sha256")),
  readFile(values.get("--parent-authorization")),
  readFile(values.get("--parent-receipt")),
]);
if (hash(authorizationRaw) !== values.get("--parent-authorization-sha256")) fail("R6_FINAL_PARENT_DRYRUN_SAME_COMMIT_BINDING_INVALID");
const result = validateParentSameCommitBinding({ binding, parentAuthorization: JSON.parse(authorizationRaw.toString("utf8")), parentReceipt: JSON.parse(receiptRaw.toString("utf8")), executionCommit: values.get("--execution-commit"), parentAuthorizationPath: values.get("--parent-authorization"), parentAuthorizationSha256: values.get("--parent-authorization-sha256"), parentReceiptPath: values.get("--parent-receipt"), parentReceiptSha256: hash(receiptRaw) });
process.stdout.write(`${result.classification}\n`);
