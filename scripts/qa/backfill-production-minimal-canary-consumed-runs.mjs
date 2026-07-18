import path from "node:path";
import { backfillHistoricalConsumedRuns } from "./production-minimal-canary-consumed-run-registry.mjs";

const historical = [
  ["qa-canary-cf466ba5-5eb1-48ba-b18c-f20b60193a07", "r6-deployment-attestation-676995f7-edb9-4f8d-92c2-9b8bdb2ec672", "human-dry-run-qa-canary-cf466ba5-5eb1-48ba-b18c-f20b60193a07", "dry-run-confirmation-token-ledger.json"],
  ["qa-canary-e61e9405-8fab-4570-8a6b-a23a0841ac37", "r6-deployment-attestation-676995f7-edb9-4f8d-92c2-9b8bdb2ec672", "human-live-run-qa-canary-e61e9405-8fab-4570-8a6b-a23a0841ac37", "live-confirmation-token-ledger.json"],
  ["qa-canary-76c5e82b-e601-4ccc-b571-b949f35c28d2", "r6-deployment-attestation-727f88c9-3cd7-4a65-a4a9-d654d2055e68", "human-dry-run-qa-canary-76c5e82b-e601-4ccc-b571-b949f35c28d2", "dry-run-confirmation-token-ledger.json"],
  ["qa-canary-60622b81-6c5f-40fd-a73b-bfb0cf559f9d", "r6-deployment-attestation-727f88c9-3cd7-4a65-a4a9-d654d2055e68", "human-live-run-qa-canary-60622b81-6c5f-40fd-a73b-bfb0cf559f9d", "live-confirmation-token-ledger.json"],
];

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1] ?? null; }
const root = option("--registry-root"); const attestations = option("--attestations-root");
if (!root || !attestations) throw new Error("QA_CANARY_HISTORICAL_BACKFILL_ARGUMENTS_INVALID");
const records = historical.map(([runId, attestation, directory, ledger]) => ({ runId, sourceLedgerPath: path.join(attestations, attestation, directory, ledger) }));
records.push({ runId: "qa-canary-d5d9eed0-a599-4cf6-be98-39e2060d2340", legacyBlock: true });
const result = await backfillHistoricalConsumedRuns({ root, records });
console.log(JSON.stringify({ added: result.added, registrySha256: result.registrySha256, ledgerSha256: result.ledgerSha256 }, null, 2));
