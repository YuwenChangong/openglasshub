import { execFileSync } from "node:child_process";
import { runLegalLocalPredeploymentReplay } from "../lib/legal-local-predeployment-orchestrator.mjs";
import { createLegalLocalDockerAdapter } from "../lib/legal-local-docker-adapter.mjs";

const argument = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1] ?? null; };
const mode = argument("--mode") ?? "PREFLIGHT";
const root = process.cwd();
const implementationCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
try {
  const result = await runLegalLocalPredeploymentReplay({ mode, taskId: argument("--task-id"), taskRoot: argument("--task-root"), confirmation: argument("--confirmation"), confirmationSha256: argument("--confirmation-sha256"), consumptionRegistryRoot: argument("--consumption-registry-root"), implementationCommit, repositoryRoot: root, adapter: mode === "EXECUTE" ? createLegalLocalDockerAdapter({ repositoryRoot: root }) : undefined });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ classification: error.code ?? "R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED", innerClassification: error.innerClassification ?? null })}\n`);
  process.exitCode = 1;
}
