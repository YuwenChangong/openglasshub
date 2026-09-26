import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const expected = new Map([
  ["docs/ops/p8-production-history-read-only.sql", "5ac18441dbd61a36db88300f333a40752173e224bfa9247af28aa55e3b97e0a7"],
  ["docs/ops/p9-migration-history-rows-read-only.sql", "6018ce149a1520c7c097e2577281ace773a2329cc8f36ca74350fd03be347002"],
  ["docs/ops/verified-session-v1-hosted-catalog-preflight.sql", "f110454fe7ba5da07af0633e4be88119eeb24f21177d4be6ef302fd24268c0b8"],
  ["supabase/migrations/20260923000000_ogh_verified_session_v1_foundation.sql", "575cfcea2ed0e4415e07370d97474518c957ba409248790b2f6309748c1597f9"],
  ["supabase/migrations/20260925012231_ogh_verified_session_v1_enforcement.sql", "89d74d4e96f1b6dcc1298ae443e21389ebc86c6ee0a6c46f7fef9dc15755d10e"],
  ["docs/ops/verified-session-v1-auth-a-authorization.md", "5dc9730dc5dcebc1a25b08abebea1f1cf0709cae79a593fcca7a81f9731c11b5"],
]);

test("byte-bound artifacts retain reviewed raw LF hashes in this checkout", () => {
  for (const [path, hash] of expected) {
    const bytes = readFileSync(path);
    assert.equal(bytes.includes(Buffer.from("\r\n")), false, `${path} must be LF in the worktree`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, path);
  }
});
