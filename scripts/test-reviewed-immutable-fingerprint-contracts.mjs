import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lf = "lf";
const preserve = "preserve";

const contracts = [
  { path: "docs/ops/reconciliation/operational-guardrails-authenticated-privilege-supplemental-preflight.sql", sha256: "d96e76f9dd3655c03a64dc5d535087fc63f99370b13b246f6529caaf121cd074", canonicalEol: lf },
  { path: "docs/ops/reconciliation/operational-guardrails-current-catalog-refresh.sql", sha256: "66f2a18efea1df249774bf5d6a65bc1b8d521ac59adb243c4ea10c6ae6680748", canonicalEol: lf },
  { path: "docs/ops/reconciliation/operational-guardrails-r6-production-postflight-recovery-sealed.sql", sha256: "7062795128ba2bdff6d06cb5ead8492120f9b1a226005ebfc57c1fa007f46c28", canonicalEol: lf },
  { path: "docs/ops/reconciliation/operational-guardrails-r6-production-postflight-recovery.sql", sha256: "a82c692a1d3569d4fe94134c613b2382d2cb11589bbc3135c4f883ca120bd3f8", canonicalEol: lf },
  { path: "docs/ops/reconciliation/operational-guardrails-r6-production-postflight.sql", sha256: "e7082fe8e25dd13a454c3b8a41aff5ded2aba4e8f499bd2afe5999222feb857e", canonicalEol: lf },
  { path: "docs/ops/reconciliation/operational-guardrails-r6-production-preflight.sql", sha256: "ee809d751a3fdd1f906116316e0b9deeb7c9321138ec69b9ec84ef9dfd877736", canonicalEol: lf },
  { path: "docs/ops/reconciliation/operational-guardrails-rate-limit-r2-unexecuted-proposal.sql", sha256: "10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb", canonicalEol: lf },
  { path: "supabase/migrations/20260525_forum_phase4_video_media.sql", sha256: "ee26a91b82d17302438d862638b92915b4d292cda1820c193500dc1eb254b90d", canonicalEol: preserve },
  { path: "supabase/migrations/20260525_forum_phase5_circle_creator_and_images.sql", sha256: "62c0af5ca0dff6548449720f274b1d267e3e83b76a99572d90e3af23193d6739", canonicalEol: preserve },
  { path: "supabase/migrations/20260525_forum_phase5_publish_posts_rls.sql", sha256: "37b615099e2e255666201e5f7ca65b4f75d22d625e32d6a0347862f4825d92c5", canonicalEol: preserve },
  { path: "supabase/migrations/20260603_forum_circle_owner_management.sql", sha256: "c3e7d38f03d3b4e3e49d58acc932b3bc392907b976e27571d388125988e0510f", canonicalEol: preserve },
  { path: "supabase/migrations/20260603_forum_comments_interactions.sql", sha256: "e7b7187ccb3f0f660d3f5e367bb1e791d14335e1365e7aded8fbe4c64fbc6300", canonicalEol: preserve },
  { path: "supabase/migrations/20260603_forum_hot_sort_and_circle_name_guard.sql", sha256: "562338885bd27b18ade1d7ad5bbf45726bd26f7286b1a3437da96415e121429c", canonicalEol: preserve },
  { path: "supabase/migrations/20260604_circle_cover_storage_policy.sql", sha256: "b6bd9197865429711f90634384f724acfbdd8084503f9708e11c16ad1ee490e0", canonicalEol: preserve },
  { path: "supabase/migrations/20260604_forum_circle_soft_delete_and_management.sql", sha256: "564874a3d66450492e5819a81ba54bf42ebcbcac4e99c5439327f9efa7d142d9", canonicalEol: preserve },
  { path: "supabase/migrations/20260605_circle_cover_public_select.sql", sha256: "3a18980810d10e237663562e2960136976bbc8250004099a745426cc8cbf842f", canonicalEol: preserve },
  { path: "supabase/migrations/20260605_forum_posts_body_short_content.sql", sha256: "21ce077f23c4aa14911b20cd00545190e3fba7410821f3b0be5aa449de260eaa", canonicalEol: preserve },
  { path: "supabase/migrations/20260605_forum_rate_limit_purposes.sql", sha256: "9e44b98b5c0ff8d9e0cfca61fd5cf87f2404c436d414153ad54bd59d91480ee3", canonicalEol: preserve },
  { path: "supabase/migrations/20260606_forum_notifications_mvp.sql", sha256: "dda6e1880623bf4b8ac25e3fb2d5f3e6a13f11c91a0a41963d1ff38e4c2a63dd", canonicalEol: preserve },
  { path: "supabase/migrations/20260606_profile_banner_and_storage.sql", sha256: "a35f93b2897b9baf80cb58f135ed81254f151579c4f074dcdb11eb0fccd0a29a", canonicalEol: preserve },
  { path: "supabase/migrations/20260607_auth_resend_confirmation_limit.sql", sha256: "f4ad22566547c9507c5d63aca7edec9643ce773fcad765f10a08df8fa32f9706", canonicalEol: preserve },
  { path: "supabase/migrations/20260607_enable_forum_realtime.sql", sha256: "0f967e7c373e6aa7b078a33e2bf2a79257f337cc08388714af9f8ea8e79c2b6c", canonicalEol: preserve },
  { path: "supabase/migrations/20260607_fix_notification_relike_update_guard.sql", sha256: "77803c5f67c5ab24597ec752d67b795255d442eacae9c983df447c21f907930a", canonicalEol: preserve },
  { path: "supabase/migrations/20260611_fix_forum_notification_realtime.sql", sha256: "4818c597e624219a559d4e5808413354674ac28ef5a5c0b4b826811ece51d836", canonicalEol: preserve },
  { path: "supabase/migrations/20260611_forum_permission_lockdown.sql", sha256: "6efd25f000f4562149c9b48c5498e9da0d2059425542d93f0e6eed6f13b88848", canonicalEol: preserve },
  { path: "supabase/migrations/20260611_stabilize_forum_notifications_realtime_permissions.sql", sha256: "aff3d78f91bad8f62a993bb541433ddc1ea0f086bad55439ff1cba42db45a170", canonicalEol: preserve },
  { path: "supabase/migrations/20260612_hot_news_mvp.sql", sha256: "e19091424cda9bba8ba2118032533e07f39b0922918261bff40cd73c499c93ce", canonicalEol: preserve },
  { path: "supabase/migrations/20260612_news_media_storage_policy.sql", sha256: "f4cf5ad75cd07f70d51ac267963c17348d972f73de1160b9a56c02d5b84a7f5b", canonicalEol: preserve },
  { path: "supabase/migrations/20260612_news_view_count_and_pagination.sql", sha256: "19fbd86b4157693ef485e7d9ac53c364f8576b1b0c383a79960c816c346464bf", canonicalEol: preserve },
  { path: "supabase/migrations/20260616_community_moderation_mvp.sql", sha256: "2a7029b8a38ed585cb2890f2aeda3f354dc99a2a38c6a2967f23bfa5d49237e8", canonicalEol: preserve },
  { path: "supabase/migrations/20260620_admin_qa_role_grant_path.sql", sha256: "3cfde2376d29d4e28dd6336167a09ce15161081980c9e2b732e9813215fc353e", canonicalEol: preserve },
  { path: "supabase/migrations/20260620_lock_profile_role_updates.sql", sha256: "ab48116782a8c7855ac2a43856b8164d7e0f73ebb6989289241d830e17fc9d30", canonicalEol: preserve },
  { path: "supabase/migrations/20260713_comment_creation_circle_authorization.sql", sha256: "84fdaa9b3519ff38ecf1b3ecf43e3601bc28d72f842418e986b351bb32618f26", canonicalEol: lf },
  { path: "supabase/migrations/20260713_comment_reaction_visibility_authorization.sql", sha256: "09cd413ff6d6271522f59066a4e698188c4ea41b914c795e377a96eccda07bb6", canonicalEol: lf },
  { path: "supabase/migrations/20260713_comment_read_circle_visibility_authorization.sql", sha256: "a09a1bbe73e3bc7729cb5d41d312e4a2487d3f1109317840ec6d6f802fa99845", canonicalEol: lf },
  { path: "supabase/migrations/20260713_forum_posts_circle_authorization.sql", sha256: "5486fe9dcbc4123f35d2f0640a0cbdf0d90790710af6a6f2bddb49b627f13a5a", canonicalEol: lf },
  { path: "supabase/migrations/20260713_forum_report_target_authorization.sql", sha256: "e1513ee78cd48dfaaa686f66a7b123a7270c88de06964ef015e94168a1128121", canonicalEol: lf },
  { path: "supabase/migrations/20260713_post_bound_media_provenance.sql", sha256: "b8c18247dba2f62f373d61bf8ed6ef3c7d556b01fa791cc51c35fef42c82d59e", canonicalEol: lf },
];

const attributes = await readFile(".gitattributes", "utf8");
for (const contract of contracts) {
  const bytes = await readFile(contract.path);
  assert.equal(sha256(bytes), contract.sha256, `${contract.path}: reviewed fingerprint mismatch`);
  if (contract.canonicalEol === preserve) continue;

  assert.equal(bytes.includes(0x0d), false, `${contract.path}: canonical raw bytes must not contain CR`);
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, `${contract.path}: canonical raw bytes must not contain a BOM`);
  assert.equal(bytes.at(-1), 0x0a, `${contract.path}: canonical raw bytes must retain final LF`);
  assert.match(attributes, new RegExp(`^${contract.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} text eol=lf$`, "m"), `${contract.path}: exact LF checkout attribute is required`);

  const variants = [
    Buffer.concat([bytes, Buffer.from(" ")]),
    bytes.subarray(0, -1),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.from(bytes.toString("utf8").replace(/\n/g, "\r\n"), "utf8"),
    Buffer.concat([bytes.subarray(0, 1), Buffer.from([bytes[1] ^ 1]), bytes.subarray(2)]),
  ];
  for (const variant of variants) assert.notEqual(sha256(variant), contract.sha256, `${contract.path}: byte mutation must fail its reviewed fingerprint`);
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
const hashLiteral = /\b[a-f0-9]{64}\b/gi;
const referenced = new Set();
for (const file of trackedFiles) {
  if (!/\.(?:mjs|js|md|sql|json|ps1|toml)$/i.test(file)) continue;
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(hashLiteral)) referenced.add(match[0].toLowerCase());
}
const discovered = [];
for (const file of trackedFiles) {
  if (!/\.sql$/i.test(file)) continue;
  const hash = sha256(await readFile(file));
  if (referenced.has(hash)) discovered.push({ path: file, sha256: hash });
}
assert.deepEqual(discovered.sort((a, b) => a.path.localeCompare(b.path)), contracts.map(({ path, sha256: expected }) => ({ path, sha256: expected })).sort((a, b) => a.path.localeCompare(b.path)), "reviewed fingerprint inventory changed; add an explicit deterministic contract before release");

console.log(JSON.stringify({ status: "PASS", reviewedArtifacts: contracts.length, exactMatches: contracts.length, lfByteContracts: contracts.filter((contract) => contract.canonicalEol === lf).length, preservedHistoricalByteContracts: contracts.filter((contract) => contract.canonicalEol === preserve).length }));
