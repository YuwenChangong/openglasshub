import { evaluateLocalSensitiveLexicon } from "../../src/lib/moderation/local-sensitive-lexicon.server.ts";
import { moderateContent } from "../../src/lib/moderation/moderate-content.server.ts";

const terms = ["人口贩卖", "嫖娼", "卖淫"];
const targets = [
  { target_type: "post", contentType: "post_body", providerType: "post_text", textFor: (term) => `[MOD-CRITICAL-TERM] ${term}` },
  { target_type: "comment", contentType: "comment_body", providerType: "comment_text", textFor: (term) => `[MOD-CRITICAL-TERM] ${term}` },
  { target_type: "profile", contentType: "profile_text", providerType: "profile_text", textFor: (term) => `Bio: [MOD-CRITICAL-TERM] ${term}` },
  { target_type: "circle", contentType: "circle_description", providerType: "circle_text", textFor: (term) => `[MOD-CRITICAL-TERM] ${term}` },
  { target_type: "video_metadata", contentType: "post_body", providerType: "post_video_metadata", textFor: (term) => `Video metadata: [MOD-CRITICAL-TERM] ${term}` },
];

function boolEnv(name) {
  return String(process.env[name] ?? "").trim().toLowerCase() === "true";
}

async function run() {
  const canRunProvider = !!String(process.env.OPENAI_API_KEY || process.env.QA_OPENAI_API_KEY || "").trim();
  const env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    QA_OPENAI_API_KEY: process.env.QA_OPENAI_API_KEY,
    OPENAI_MODERATION_ENABLED: canRunProvider ? "true" : "false",
    OPENAI_FORUM_POLICY_ENABLED: canRunProvider && boolEnv("OPENAI_FORUM_POLICY_ENABLED") ? "true" : "false",
    OPENAI_FORUM_POLICY_MODEL: process.env.OPENAI_FORUM_POLICY_MODEL,
    OPENAI_MODERATION_MODEL: process.env.OPENAI_MODERATION_MODEL,
  };

  const failures = [];

  for (const term of terms) {
    for (const target of targets) {
      const text = target.textFor(term);
      const local = evaluateLocalSensitiveLexicon(text);
      const result = await moderateContent(env, {
        contentType: target.contentType,
        userId: "qa-critical-term",
        text,
        providerInput: {
          targetType: target.providerType,
          title: target.target_type === "post" || target.target_type === "video_metadata" ? text : undefined,
          body: text,
          description: target.target_type === "circle" ? text : undefined,
          localeHint: "zh-CN",
        },
      });

      const sourceLayer =
        result.providerDetails?.decisionSource === "forum_policy"
          ? "forum_policy_classifier"
          : result.providerDetails?.decisionSource === "openai"
            ? "openai_moderation"
            : result.providerDetails?.decisionSource === "provider_error"
              ? "provider_error_review"
              : local.decision !== "allow"
                ? "local_lexicon"
                : "unknown";

      const record = {
        term,
        target_type: target.target_type,
        decision: result.decision,
        source_layer: sourceLayer,
        reason_code: result.reason,
        provider_status: result.providerDetails?.providerStatus ?? null,
        classifier_status:
          result.providerDetails?.decisionSource === "forum_policy"
            ? result.providerDetails?.providerStatus ?? "success"
            : null,
        lexicon_match_source: local.decision !== "allow" ? local.reasonCode : null,
        is_pass:
          result.decision !== "allow" &&
          sourceLayer !== "provider_error_review",
      };

      console.log(JSON.stringify(record));
      if (!record.is_pass) failures.push(record);
    }
  }

  if (failures.length > 0) {
    console.error(`Critical moderation term check failed for ${failures.length} cases.`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("check-critical-moderation-terms failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
