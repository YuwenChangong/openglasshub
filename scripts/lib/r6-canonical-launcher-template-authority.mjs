import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const CANONICAL_LAUNCHER_TEMPLATE_RELATIVE_PATH = "scripts/qa/templates/r6-production-reconciliation-launcher-v3.ps1.template";
export async function loadCanonicalLauncherTemplateAuthority({ repositoryRoot }) {
  const canonicalLauncherTemplatePath = path.join(repositoryRoot, CANONICAL_LAUNCHER_TEMPLATE_RELATIVE_PATH);
  const bytes = await readFile(canonicalLauncherTemplatePath);
  return Object.freeze({ canonicalLauncherTemplatePath, canonicalLauncherTemplateSha256: createHash("sha256").update(bytes).digest("hex") });
}
