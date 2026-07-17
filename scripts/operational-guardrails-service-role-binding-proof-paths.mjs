import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

function comparisonPath(value, pathImpl) {
  const resolved = pathImpl.resolve(value);
  return pathImpl.sep === "\\" ? resolved.toLowerCase() : resolved;
}

export function isStrictlyOutsideRoot(rootPath, outputPath, pathImpl = path) {
  if (!pathImpl.isAbsolute(rootPath) || !pathImpl.isAbsolute(outputPath)) return false;
  const root = comparisonPath(rootPath, pathImpl);
  const output = comparisonPath(outputPath, pathImpl);
  const relativePath = pathImpl.relative(root, output);
  if (!relativePath) return false;
  return pathImpl.isAbsolute(relativePath)
    || relativePath === ".."
    || relativePath.startsWith(`..${pathImpl.sep}`);
}

export async function resolveSafeProofOutputPath({ repositoryRoot, outputPath }) {
  if (!path.isAbsolute(outputPath)) throw new Error("output must be an absolute path outside the repository");
  const root = path.resolve(repositoryRoot);
  const output = path.resolve(outputPath);
  const parent = path.dirname(output);
  let rootStats;
  let parentStats;
  try {
    [rootStats, parentStats] = await Promise.all([lstat(root), lstat(parent)]);
  } catch {
    throw new Error("repository root or output parent does not exist");
  }
  if (!rootStats.isDirectory() || !parentStats.isDirectory()) throw new Error("repository root and output parent must be directories");

  const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
  const resolvedOutput = path.join(realParent, path.basename(output));
  if (!isStrictlyOutsideRoot(realRoot, resolvedOutput)) throw new Error("output must be strictly outside the repository");

  try {
    await lstat(resolvedOutput);
    throw new Error("proof output already exists");
  } catch (error) {
    if (error instanceof Error && error.message === "proof output already exists") throw error;
    if ((error && typeof error === "object" && "code" in error && error.code === "ENOENT")) return resolvedOutput;
    throw error;
  }
}
