import { createHash } from "node:crypto";

export const SEALED_TOKEN_PREFIX = "R6SEALED1";
export const SEALED_PAYLOAD_MAX_BYTES = 4096;
export const SEALED_TOKEN_MAX_BYTES = 6144;
export const SEALED_TOKEN_PATTERN = /^R6SEALED1\.([0-9]+)\.([0-9a-f]{64})\.([A-Za-z0-9_-]+)$/;

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function createSealedRecoveryToken(payloadText) {
  const payloadBytes = Buffer.from(payloadText, "utf8");
  if (payloadBytes.byteLength < 1 || payloadBytes.byteLength > SEALED_PAYLOAD_MAX_BYTES) throw new Error("R6_SEALED_PAYLOAD_SIZE_INVALID");
  const token = `${SEALED_TOKEN_PREFIX}.${payloadBytes.byteLength}.${sha256(payloadBytes)}.${payloadBytes.toString("base64url")}`;
  if (Buffer.byteLength(token, "ascii") > SEALED_TOKEN_MAX_BYTES) throw new Error("R6_SEALED_TOKEN_SIZE_INVALID");
  return token;
}

export function decodeSealedRecoveryToken(token) {
  if (typeof token !== "string" || Buffer.byteLength(token, "ascii") > SEALED_TOKEN_MAX_BYTES) throw new Error("R6_SEALED_TOKEN_SIZE_INVALID");
  const match = SEALED_TOKEN_PATTERN.exec(token);
  if (!match) throw new Error("R6_SEALED_TOKEN_FORMAT_INVALID");
  const declaredLength = Number(match[1]);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > SEALED_PAYLOAD_MAX_BYTES || match[1] !== String(declaredLength)) throw new Error("R6_SEALED_TOKEN_LENGTH_INVALID");
  if (match[3].length % 4 === 1) throw new Error("R6_SEALED_TOKEN_BASE64URL_INVALID");
  const payloadBytes = Buffer.from(match[3], "base64url");
  if (payloadBytes.toString("base64url") !== match[3]) throw new Error("R6_SEALED_TOKEN_BASE64URL_INVALID");
  if (payloadBytes.byteLength !== declaredLength) throw new Error("R6_SEALED_TOKEN_LENGTH_MISMATCH");
  if (sha256(payloadBytes) !== match[2]) throw new Error("R6_SEALED_TOKEN_SHA_MISMATCH");
  let payloadText;
  try { payloadText = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes); } catch { throw new Error("R6_SEALED_TOKEN_UTF8_INVALID"); }
  if (!Buffer.from(payloadText, "utf8").equals(payloadBytes)) throw new Error("R6_SEALED_TOKEN_UTF8_INVALID");
  return { token, declaredLength, payloadSha256: match[2], payloadBytes, payloadText };
}
