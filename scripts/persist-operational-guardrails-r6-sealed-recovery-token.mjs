import { mkdir, open, lstat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { decodeSealedRecoveryToken, sha256 } from "./lib/operational-guardrails-r6-sealed-token.mjs";

const safeError = (code) => new Error(code);

async function requireUnused(target) {
  try { await lstat(target); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
  throw safeError("R6_SEALED_TOKEN_OUTPUT_EXISTS");
}

async function atomicWrite(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(value, "utf8"); await handle.sync(); await handle.close(); await rename(temporary, target); }
  catch (error) { await handle.close().catch(() => undefined); await rm(temporary, { force: true }); throw error; }
}

export async function persistSealedRecoveryToken({ token, outputPath, shaOutputPath }) {
  if (!path.isAbsolute(outputPath) || !path.isAbsolute(shaOutputPath) || !outputPath.endsWith(".txt") || !shaOutputPath.endsWith(".sha256") || path.resolve(outputPath).toLowerCase() === path.resolve(shaOutputPath).toLowerCase()) throw safeError("R6_SEALED_TOKEN_OUTPUT_PATH_INVALID");
  const parsed = decodeSealedRecoveryToken(token);
  const contents = token;
  const digest = sha256(contents);
  await Promise.all([requireUnused(outputPath), requireUnused(shaOutputPath)]);
  let wroteToken = false;
  try {
    await atomicWrite(outputPath, contents); wroteToken = true;
    await atomicWrite(shaOutputPath, `${digest}  ${path.basename(outputPath)}\n`);
    return { declaredLength: parsed.declaredLength, tokenBytes: Buffer.byteLength(token, "ascii"), tokenSha256: digest };
  } catch (error) {
    await Promise.all([wroteToken ? rm(outputPath, { force: true }) : undefined, rm(shaOutputPath, { force: true })]);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [token, outputPath, shaOutputPath] = process.argv.slice(2);
  try {
    if (process.argv.length !== 5) throw safeError("R6_SEALED_TOKEN_CLI_ARGUMENTS_INVALID");
    const result = await persistSealedRecoveryToken({ token, outputPath, shaOutputPath });
    console.log(JSON.stringify({ status: "PASS", ...result }));
  } catch (error) { console.error(JSON.stringify({ status: "FAIL", classification: error.message })); process.exitCode = 1; }
}
