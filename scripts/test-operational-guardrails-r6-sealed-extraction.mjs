import assert from "node:assert/strict";
import { createCompactSealedRecoveryPayload, createSealedRecoveryToken } from "./lib/operational-guardrails-r6-sealed-token.mjs";
import { extractSealedRecoveryToken } from "./lib/operational-guardrails-r6-sealed-extraction.mjs";
import { createRecoveryPacket } from "../tests/fixtures/operational-guardrails-r6-compact-recovery.mjs";
import { wrapRowsInExactEnvelope } from "../tests/fixtures/operational-guardrails-r6-exact-envelope.mjs";

const token = createSealedRecoveryToken(createCompactSealedRecoveryPayload(createRecoveryPacket()));
const row = [{ sealed_token: token }];
const valid = [
  token,
  { sealed_token: token },
  { isError: false, content: [{ type: "text", text: JSON.stringify({ result: row }) }] },
  wrapRowsInExactEnvelope(row),
  JSON.stringify(token),
];
for (const response of valid) {
  const result = extractSealedRecoveryToken(response);
  assert.equal(result.classification, "SEALED_VALID_EXACT_TOKEN");
  assert.equal(result.token, token);
}
for (const [name, response, classification] of [
  ["zero", { result: [] }, "SEALED_ZERO_PREFIX"],
  ["two", { result: [{ sealed_token: token }, { sealed_token: token }] }, "SEALED_MULTIPLE_EXACT_TOKENS"],
  ["truncated", { sealed_token: token.slice(0, -1) }, "SEALED_TOKEN_INTEGRITY_INVALID"],
  ["line-break", { sealed_token: `${token.slice(0, 20)}\n${token.slice(20)}` }, "SEALED_TOKEN_APPEARS_TRUNCATED"],
  ["prefix-only", { sealed_token: "R6SEALED1." }, "SEALED_TOKEN_APPEARS_TRUNCATED"],
  ["error", { isError: true, content: [] }, "SEALED_CONNECTOR_ERROR"],
  ["attached", { sealed_token: `x${token}` }, "SEALED_TOKEN_GRAMMAR_INVALID"],
  ["oversized", { sealed_token: `R6SEALED1.${"x".repeat(4096)}` }, "SEALED_RESPONSE_OVERSIZED"],
]) assert.equal(extractSealedRecoveryToken(response).classification, classification, name);
console.log(JSON.stringify({ status: "PASS", validWrapperForms: valid.length, rejectedForms: 8, zeroMatchDiagnostics: true, rawConnectorPersisted: false }));
