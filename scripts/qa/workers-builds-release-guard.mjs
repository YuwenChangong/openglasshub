const FULL_GIT_SHA = /^[0-9a-f]{40}$/;

const SOURCE_FIELDS = [
  "remoteMainSha",
  "candidateSha",
  "providerSourceSha",
  "activeSourceSha",
];

export function buildWorkersReleaseGuard(receipt = {}) {
  const invalidFields = SOURCE_FIELDS.filter((field) => !FULL_GIT_SHA.test(receipt[field] ?? ""));
  if (invalidFields.length > 0) {
    return {
      status: "BLOCKED",
      reason: "SOURCE_SHA_INVALID",
      invalidFields,
    };
  }

  const [expectedSourceSha] = SOURCE_FIELDS.map((field) => receipt[field]);
  const mismatchedFields = SOURCE_FIELDS.slice(1).filter((field) => receipt[field] !== expectedSourceSha);
  if (mismatchedFields.length > 0) {
    return {
      status: "BLOCKED",
      reason: "SOURCE_SHA_MISMATCH",
      mismatchedFields,
    };
  }

  return {
    status: "PASS",
    sourceSha: expectedSourceSha,
  };
}
