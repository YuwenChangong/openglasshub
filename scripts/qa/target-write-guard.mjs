const REF_PATTERN = /^[a-z0-9]{6,64}$/i;
const GENERIC_CONFIRMATIONS = new Set(["yes", "true", "confirm", "production", "test"]);

export class QaWriteGuardError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireRef(value, code) {
  const ref = String(value ?? "").trim().toLowerCase();
  if (!REF_PATTERN.test(ref)) throw new QaWriteGuardError(code);
  return ref;
}

export function refFromSupabaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new QaWriteGuardError("QA_TARGET_URL_INVALID");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    throw new QaWriteGuardError("QA_TARGET_URL_UNIDENTIFIABLE");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new QaWriteGuardError("QA_TARGET_URL_INVALID");
  }

  const suffix = ".supabase.co";
  if (!hostname.endsWith(suffix)) throw new QaWriteGuardError("QA_TARGET_URL_UNIDENTIFIABLE");

  const ref = hostname.slice(0, -suffix.length);
  if (!REF_PATTERN.test(ref) || ref.includes(".")) throw new QaWriteGuardError("QA_TARGET_URL_UNIDENTIFIABLE");
  return ref;
}

export function validateConfirmRun(value) {
  const runId = String(value ?? "").trim();
  if (GENERIC_CONFIRMATIONS.has(runId.toLowerCase())) throw new QaWriteGuardError("QA_CONFIRM_RUN_GENERIC");
  if (runId.length < 8 || runId.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runId)) {
    throw new QaWriteGuardError("QA_CONFIRM_RUN_INVALID");
  }
  return runId;
}

export function validateQaWriteTarget({ targetUrl, expectedTargetRef, productionRef, allowProductionWrites, confirmRun }) {
  const actualRef = refFromSupabaseUrl(targetUrl);
  const expectedRef = requireRef(expectedTargetRef, "QA_EXPECTED_TARGET_REF_REQUIRED");
  const knownProductionRef = requireRef(productionRef, "QA_PRODUCTION_REF_REQUIRED");

  if (actualRef !== expectedRef) throw new QaWriteGuardError("QA_TARGET_REF_MISMATCH");

  const productionTarget = actualRef === knownProductionRef;
  let safeRunLabel = null;
  if (productionTarget) {
    if (String(allowProductionWrites ?? "") !== "1") {
      throw new QaWriteGuardError("QA_PRODUCTION_WRITES_DISABLED");
    }
    safeRunLabel = validateConfirmRun(confirmRun);
  } else if (confirmRun) {
    // A confirmation is harmless for a non-production dry run, but keep its format strict.
    safeRunLabel = validateConfirmRun(confirmRun);
  }

  return {
    actualRef,
    expectedRef,
    productionTarget,
    safeRunLabel,
  };
}

export function readQaWriteGuardConfig(env = process.env, confirmRun = null) {
  return {
    targetUrl: env.QA_SUPABASE_URL,
    expectedTargetRef: env.QA_EXPECTED_SUPABASE_REF,
    productionRef: env.QA_PRODUCTION_SUPABASE_REF,
    allowProductionWrites: env.QA_ALLOW_PRODUCTION_WRITES,
    confirmRun,
  };
}

export function printQaWriteGuardError(error) {
  const code = error instanceof QaWriteGuardError ? error.code : "QA_TARGET_GUARD_FAILED";
  console.error(`QA_WRITE_GUARD_FAILED: ${code}`);
}
