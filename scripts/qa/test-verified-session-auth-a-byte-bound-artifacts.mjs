import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const expected = new Map([
  ["docs/ops/p8-production-history-read-only.sql", "5ac18441dbd61a36db88300f333a40752173e224bfa9247af28aa55e3b97e0a7"],
  ["docs/ops/p9-migration-history-rows-read-only.sql", "6018ce149a1520c7c097e2577281ace773a2329cc8f36ca74350fd03be347002"],
  ["docs/ops/verified-session-v1-hosted-catalog-preflight.sql", "b033239a1b7bc689e9ad5be1409a19363eaba2c7a8c6eddb791bcabc9cf6bfc7"],
  ["supabase/migrations/20260923000000_ogh_verified_session_v1_foundation.sql", "575cfcea2ed0e4415e07370d97474518c957ba409248790b2f6309748c1597f9"],
  ["supabase/migrations/20260925012231_ogh_verified_session_v1_enforcement.sql", "89d74d4e96f1b6dcc1298ae443e21389ebc86c6ee0a6c46f7fef9dc15755d10e"],
  ["docs/ops/verified-session-v1-auth-a-transport-review.md", "bb201f45dd1cd9b397466c3de9236013294ac33dfd6e408be00c13ff0a9610be"],
  ["docs/ops/verified-session-v1-auth-a-authorization.md", "d5a2bffeb09911e79e37f64b68de5bc4f53605436e046a5db9e3183362410c2b"],
]);

test("byte-bound artifacts retain reviewed raw LF hashes in this checkout", () => {
  for (const [path, hash] of expected) {
    const bytes = readFileSync(path);
    assert.equal(bytes.includes(Buffer.from("\r\n")), false, `${path} must be LF in the worktree`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, path);
  }
});
