import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256, stableJson, writeCanonicalEvidence } from "./lib/legal-local-replay-evidence.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "r6-local-evidence-test-"));
try {
  assert.equal(stableJson({ z: 1, a: [true, { b: "x", a: null }] }), '{"a":[true,{"a":null,"b":"x"}],"z":1}');
  const first = await writeCanonicalEvidence({ evidenceRoot: root, name: "terminal.json", payload: { z: 1, a: true } });
  assert.equal((await readFile(first.path, "utf8")), '{"a":true,"z":1}\n');
  assert.equal(first.sha256, sha256('{"a":true,"z":1}\n'));
  await assert.rejects(() => writeCanonicalEvidence({ evidenceRoot: root, name: "terminal.json", payload: {} }), (error) => error.code === "R6_LOCAL_REPLAY_EVIDENCE_ALREADY_EXISTS");
  await assert.rejects(() => writeCanonicalEvidence({ evidenceRoot: root, name: "../escape.json", payload: {} }), (error) => error.code === "R6_LOCAL_REPLAY_EVIDENCE_NAME_INVALID");
  console.log(JSON.stringify({ classification: "R6_LOCAL_REPLAY_EVIDENCE_WRITER_CONTRACT_TESTS_READY", fixtures: 4, realOperations: 0 }));
} finally {
  await rm(root, { recursive: true, force: true });
}
