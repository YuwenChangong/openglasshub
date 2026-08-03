import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

function fail(code) { throw Object.assign(new Error(code), { code }); }
function flags(argv) { if (argv.length !== 4 || argv[0] !== "--config" || argv[2] !== "--destination") fail("R6_OPERATOR_LAUNCH_RENDER_INPUT_INVALID"); return { config: path.resolve(argv[1]), destination: path.resolve(argv[3]) }; }
const { config: configPath, destination } = flags(process.argv.slice(2));
const config = JSON.parse(await readFile(configPath, "utf8"));
for (const key of ["runId", "operatorRoot", "manifestPath", "launcherPath", "evidenceRoot", "executionWorktree", "wrapperPath", "wrapperSha256"]) if (typeof config[key] !== "string" || !config[key]) fail("R6_OPERATOR_LAUNCH_RENDER_CONFIG_INVALID");
if (!/^qa-canary-[0-9a-f-]{36}$/.test(config.runId) || !/^[a-f0-9]{64}$/.test(config.wrapperSha256)) fail("R6_OPERATOR_LAUNCH_RENDER_CONFIG_INVALID");
const template = await readFile(new URL("./templates/r6-v3-operator-dryrun-launcher.ps1.template", import.meta.url), "utf8");
const encoded = Buffer.from(JSON.stringify(config)).toString("base64");
if (!template.includes("__CONFIG_BASE64__")) fail("R6_OPERATOR_LAUNCH_RENDER_TEMPLATE_INVALID");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, template.replace("__CONFIG_BASE64__", encoded), "utf8");
process.stdout.write(`${JSON.stringify({ destination })}\n`);
