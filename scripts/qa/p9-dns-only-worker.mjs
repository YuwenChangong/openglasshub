import dns from "node:dns";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyDnsOnlyResult, DNS_ONLY_HOST } from "./p9-dns-only-diagnostic.mjs";
import { createDnsOnlyGate, observeDnsOnlyRepository } from "../lib/p9-dns-only-gate.mjs";

async function main() {
  if (process.argv.length !== 3 || !["1", "2"].includes(process.argv[2]) || !process.send) process.exit(1);
  const expires = performance.now() + 5000;
  const deadline = setTimeout(() => process.exit(1), 5000);
  const authorization = await new Promise((resolve) => process.once("message", (message) => {
    if (!message || Object.keys(message).join(",") !== "authorization") process.exit(1);
    resolve(message.authorization);
  }));
  const method = Number(process.argv[2]);
  try {
    const snapshot = observeDnsOnlyRepository();
    createDnsOnlyGate({ authorization, snapshot }).claimMethod(method);
  } catch { process.exit(1); }
  if (performance.now() >= expires) process.exit(1);
  try {
    const raw = method === 1
      ? await new dns.promises.Resolver().resolve4(DNS_ONLY_HOST)
      : await dns.promises.lookup(DNS_ONLY_HOST, { family: 4, all: true });
    // Validate and bound before serialization. This private pipe is never forwarded to user output.
    const result = classifyDnsOnlyResult({ method, raw });
    if (result.classification.startsWith("SUCCESS_")) process.stdout.write(JSON.stringify({
      raw: method === 1 ? raw : raw.map((item) => ({ address: item.address, family: 4 })),
    }));
    else process.stdout.write(JSON.stringify({ classification: result.classification }));
  } catch (error) {
    const safeCodes = ["ENOTFOUND", "ENODATA", "ESERVFAIL", "EREFUSED", "ETIMEOUT",
      "ENOTINITIALIZED", "ELOADIPHLPAPI", "EADDRGETNETWORKPARAMS"];
    process.stdout.write(JSON.stringify({ errorCode: safeCodes.includes(error?.code) ? error.code : "OTHER" }));
  }
  clearTimeout(deadline);
  process.disconnect();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
