import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = "C:\\Users\\1\\OpenGlassHub-R6-Proof\\production-canary";
function assertInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("QA_CANARY_JOURNAL_PATH_INVALID");
}
export function journalPath(root, runId) {
  const dir = path.resolve(root || ROOT, runId);
  assertInsideRoot(path.resolve(root || ROOT), dir);
  return { dir, file: path.join(dir, "journal.json") };
}
async function durableWrite(file, payload) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(tmp, "wx", 0o600);
  try { await handle.writeFile(payload, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(tmp, file);
  // Windows does not permit fsync on directory handles; the sealed file has already
  // been flushed and replace is atomic on the same volume.
  if (process.platform === "win32") return;
  const directory = await open(path.dirname(file), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
function integrityFor(journal) {
  const copy = { ...journal };
  delete copy.integrity;
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}
export function createFileJournalStore(root, runId) {
  const target = journalPath(root, runId);
  return {
    path: target.file,
    async exists() { try { await stat(target.file); return true; } catch { return false; } },
    async write(journal) { const sealed = { ...journal, integrity: integrityFor(journal) }; await mkdir(target.dir, { recursive: true }); await durableWrite(target.file, `${JSON.stringify(sealed, null, 2)}\n`); },
    async read() { const journal = JSON.parse(await readFile(target.file, "utf8")); if (journal.integrity !== integrityFor(journal)) throw new Error("QA_CANARY_JOURNAL_INTEGRITY_INVALID"); return journal; },
  };
}

export async function findUnfinishedJournals(root, qaUserId) {
  const resolvedRoot = path.resolve(root || ROOT);
  let entries;
  try { entries = await readdir(resolvedRoot, { withFileTypes: true }); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(resolvedRoot, entry.name, "journal.json");
    try {
      const journal = JSON.parse(await readFile(file, "utf8"));
      if (journal.integrity !== integrityFor(journal)) throw new Error("QA_CANARY_JOURNAL_INTEGRITY_INVALID");
      if (journal.prepared?.actorId === qaUserId && journal.state !== "COMPLETE") result.push({ runId: journal.runId, state: journal.state });
    } catch (error) { if (error?.code === "ENOENT") continue; throw error; }
  }
  return result;
}
