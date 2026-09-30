import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadChromium({ importModule = (specifier) => import(specifier), readDirectory = fs.readdir, access = fs.access,
  runtimeRoot = path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "runtimes", "cua_node") } = {}) {
  try { return (await importModule("playwright")).chromium; }
  catch (error) {
    if (!["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(error?.code)
      || !/Cannot find (?:package|module) ['"]playwright['"]/.test(error.message)) throw error;
  }
  let entries;
  try { entries = await readDirectory(runtimeRoot); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw new Error("Playwright runtime unavailable");
  }
  for (const entry of entries.sort().reverse()) {
    const candidate = path.join(runtimeRoot, entry, "bin", "node_modules", "playwright", "index.mjs");
    try { await access(candidate); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    return (await importModule(pathToFileURL(candidate).href)).chromium;
  }
  throw new Error("Playwright runtime unavailable");
}
