import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--destination") throw new Error("R6_PRODUCTION_RECONCILIATION_SECURE_SESSION_RENDER_INPUT_INVALID");
const config = JSON.parse(await readFile(path.resolve(args[1]), "utf8"));
if (!path.isAbsolute(String(config.launcherPath ?? "")) || !/^[a-f0-9]{64}$/.test(String(config.launcherSha256 ?? ""))) throw new Error("R6_PRODUCTION_RECONCILIATION_SECURE_SESSION_RENDER_CONFIG_INVALID");
const template = await readFile(new URL("./templates/r6-production-reconciliation-secure-session.ps1.template", import.meta.url), "utf8");
if (!template.includes("__CONFIG_BASE64__")) throw new Error("R6_PRODUCTION_RECONCILIATION_SECURE_SESSION_TEMPLATE_INVALID");
const destination = path.resolve(args[3]);
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, template.replace("__CONFIG_BASE64__", Buffer.from(JSON.stringify(config)).toString("base64")), "utf8");
