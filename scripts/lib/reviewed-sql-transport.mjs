import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const REVIEWED_SUPPLEMENTAL_SQL_PATH = "docs/ops/reconciliation/operational-guardrails-authenticated-privilege-supplemental-preflight.sql";
export const REVIEWED_SUPPLEMENTAL_SQL_SHA256 = "d96e76f9dd3655c03a64dc5d535087fc63f99370b13b246f6529caaf121cd074";
const forbiddenTransportMarkers = ["Exit code:", "```", "<tool", "tool_result", "assistant:", "user:", "system:"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lineEndingKind = (text) => {
  if (/\r(?!\n)/.test(text)) return "CR";
  if (/\r\n/.test(text)) return "CRLF";
  return "LF";
};
const firstMeaningfulSqlToken = (text) => {
  let remaining = text.replace(/^\uFEFF/, "");
  while (/^\s*--[^\r\n]*(?:\r?\n|$)/.test(remaining)) {
    remaining = remaining.replace(/^\s*--[^\r\n]*(?:\r?\n|$)/, "");
  }
  return remaining.trimStart().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
};

export const assertReviewedPayload = ({ sourceBytes, payloadBytes }) => {
  assert(Buffer.isBuffer(sourceBytes), "source must be a byte buffer");
  assert(Buffer.isBuffer(payloadBytes), "payload must be a byte buffer");
  assert.equal(payloadBytes.length, sourceBytes.length, "payload byte length must equal reviewed source byte length");
  const text = payloadBytes.toString("utf8");
  assert(!text.includes("\uFFFD"), "payload must be valid UTF-8 without replacement characters");
  for (const marker of forbiddenTransportMarkers) {
    assert(!text.includes(marker), `payload must not contain transport marker: ${marker}`);
  }
  assert(payloadBytes.equals(sourceBytes), "payload must be byte-for-byte identical to reviewed source");
  assert.equal(firstMeaningfulSqlToken(text), "BEGIN", "first meaningful SQL token must be BEGIN");
  assert.match(text, /^--[^\r\n]*\r?\n--[^\r\n]*\r?\nBEGIN TRANSACTION READ ONLY;/);
  assert.match(text, /\r?\nROLLBACK;\s*$/);
  return {
    firstMeaningfulSqlToken: "BEGIN",
    lineEnding: lineEndingKind(text),
    encoding: "UTF-8",
  };
};

export const loadReviewedSupplementalSql = async ({ root = process.cwd(), sourcePath = REVIEWED_SUPPLEMENTAL_SQL_PATH } = {}) => {
  const expectedPath = path.resolve(root, REVIEWED_SUPPLEMENTAL_SQL_PATH);
  const resolvedSourcePath = path.resolve(root, sourcePath);
  assert.equal(resolvedSourcePath, expectedPath, "source path must be the exact reviewed supplemental packet");
  const sourceBytes = await readFile(expectedPath);
  const sourceSha256 = sha256(sourceBytes);
  assert.equal(sourceSha256, REVIEWED_SUPPLEMENTAL_SQL_SHA256, "reviewed supplemental packet fingerprint mismatch");
  const payloadBytes = Buffer.from(sourceBytes);
  const payload = assertReviewedPayload({ sourceBytes, payloadBytes });
  return {
    sourceFile: REVIEWED_SUPPLEMENTAL_SQL_PATH,
    sourceBytes,
    payloadBytes,
    sourceSha256,
    payloadSha256: sha256(payloadBytes),
    sourceByteCount: sourceBytes.length,
    payloadByteCount: payloadBytes.length,
    ...payload,
  };
};

export const buildExecutionManifest = ({ packet, targetIdentityFingerprint, timestamp = new Date().toISOString() }) => {
  assert.match(targetIdentityFingerprint, /^[a-z0-9][a-z0-9._:-]{7,127}$/i, "target identity fingerprint must be a non-secret fingerprint token");
  return {
    manifestVersion: "reviewed-sql-transport-v1",
    sourceFile: packet.sourceFile,
    sourceSha256: packet.sourceSha256,
    payloadSha256: packet.payloadSha256,
    sourceByteCount: packet.sourceByteCount,
    payloadByteCount: packet.payloadByteCount,
    transportMethod: "raw-file-bytes-to-database-client-stdin",
    timestamp,
    targetIdentityFingerprint,
    dryRunValidation: "PASS",
    firstMeaningfulSqlToken: packet.firstMeaningfulSqlToken,
    payloadByteForByteMatch: packet.sourceBytes.equals(packet.payloadBytes),
    payloadEncoding: packet.encoding,
    lineEnding: packet.lineEnding,
  };
};
