import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = () => { throw new Error("AUTH_A_WORKER_ARTIFACT_INVALID"); };
const object = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const MODULE_NAME = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9_./-]{1,256}$/;
const CONTENT_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;

export function canonicalWorkerArtifact({ mainModule, modules, compatibilityDate,
  compatibilityFlags, bindings, assets } = {}) {
  if (typeof mainModule !== "string" || !MODULE_NAME.test(mainModule)
    || !Array.isArray(modules) || !modules.length || modules.length > 1024
    || !/^\d{4}-\d{2}-\d{2}$/.test(compatibilityDate ?? "")
    || !Array.isArray(compatibilityFlags) || compatibilityFlags.some((flag) =>
      typeof flag !== "string" || !/^[a-z0-9_]+$/.test(flag))
    || new Set(compatibilityFlags).size !== compatibilityFlags.length
    || !Array.isArray(bindings) || !object(assets)) fail();
  const seenModules = new Set();
  const canonicalModules = modules.map((module) => {
    if (!object(module) || typeof module.name !== "string" || !MODULE_NAME.test(module.name)
      || typeof module.content_type !== "string" || !CONTENT_TYPE.test(module.content_type)
      || typeof module.content_base64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(module.content_base64)
      || seenModules.has(module.name)) fail();
    seenModules.add(module.name);
    const bytes = Buffer.from(module.content_base64, "base64");
    if (bytes.toString("base64") !== module.content_base64) fail();
    return { name: module.name, contentType: module.content_type, sha256: sha256(bytes) };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (!seenModules.has(mainModule)) fail();
  const seenBindings = new Set();
  const canonicalBindings = bindings.map((binding) => {
    if (!object(binding) || typeof binding.name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(binding.name)
      || typeof binding.type !== "string" || !/^[a-z0-9_]+$/.test(binding.type)
      || seenBindings.has(binding.name)) fail();
    seenBindings.add(binding.name);
    return { name: binding.name, type: binding.type };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (Object.keys(assets).sort().join(",") !== "binding,router_config,run_worker_first"
    || typeof assets.binding !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(assets.binding)
    || typeof assets.run_worker_first !== "boolean" || !object(assets.router_config)
    || Object.keys(assets.router_config).join(",") !== "has_user_worker"
    || typeof assets.router_config.has_user_worker !== "boolean") fail();
  const artifact = { mainModule, modules: canonicalModules };
  const config = { compatibilityDate, compatibilityFlags: [...compatibilityFlags].sort(),
    bindings: canonicalBindings, assets: { binding: assets.binding, runWorkerFirst: assets.run_worker_first,
      hasUserWorker: assets.router_config.has_user_worker } };
  return Object.freeze({ artifactSha256: sha256(JSON.stringify(artifact)),
    configSha256: sha256(JSON.stringify(config)), moduleCount: canonicalModules.length });
}
