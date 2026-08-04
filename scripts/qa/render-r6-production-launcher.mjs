import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2); if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--destination") throw new Error("R6_PRODUCTION_LAUNCHER_RENDER_INPUT_INVALID");
const config = JSON.parse(await readFile(path.resolve(args[1]), "utf8"));
const template = await readFile(new URL("./templates/r6-production-launcher.ps1.template", import.meta.url), "utf8");
if (!template.includes("__CONFIG_BASE64__")) throw new Error("R6_PRODUCTION_LAUNCHER_TEMPLATE_INVALID");
await mkdir(path.dirname(path.resolve(args[3])), { recursive: true });
await writeFile(path.resolve(args[3]), template.replace("__CONFIG_BASE64__", Buffer.from(JSON.stringify(config)).toString("base64")), "utf8");
