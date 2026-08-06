import { readFile } from "node:fs/promises";
import { issueCurrentCanonicalProductionV3OAuthReadinessAttestation } from "./run-cloudflare-pages-current-canonical-production-v3-preparation.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const argv = process.argv.slice(2);
if (argv.length !== 3 || argv[0] !== "--config" || argv[2] !== "--handoff-nonce-stdin") fail("R6_OAUTH_READINESS_ATTESTATION_INPUT_INVALID");
const config = JSON.parse(await readFile(argv[1], "utf8"));
if (typeof config.attestationRoot !== "string" || config.attestationRoot.length === 0) fail("R6_OAUTH_READINESS_ATTESTATION_INPUT_INVALID");
let handoffNonce = ""; for await (const chunk of process.stdin) handoffNonce += chunk; handoffNonce = handoffNonce.trim();
try {
  const envelope = await issueCurrentCanonicalProductionV3OAuthReadinessAttestation({ ...config, handoffNonce });
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
} catch (error) {
  process.stderr.write(`${error?.code ?? "R6_OAUTH_READINESS_ATTESTATION_FAILED"}\n`);
  process.exitCode = 1;
}
