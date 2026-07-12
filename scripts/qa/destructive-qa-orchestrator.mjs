import crypto from "node:crypto";
import { validateConfirmRun } from "./target-write-guard.mjs";

export const ARTIFACT_GROUPS = [
  "users",
  "profiles",
  "roleAssignments",
  "posts",
  "comments",
  "circles",
  "reports",
  "mediaObjects",
  "relationshipRows",
];

const CLEANUP_ORDER = ["reports", "relationshipRows", "comments", "mediaObjects", "posts", "circles", "roleAssignments", "profiles", "users"];
const CLEANUP_METHODS = {
  users: "deleteUserByExactId",
  profiles: "deleteProfileByExactId",
  roleAssignments: "revokeRoleByExactUserId",
  posts: "deletePostById",
  comments: "deleteCommentById",
  circles: "deleteCircleById",
  reports: "deleteReportById",
  mediaObjects: "deleteMediaByExactKey",
  relationshipRows: "deleteRelationshipRowById",
};

export function generateRunId() {
  return `qa-${crypto.randomUUID()}`;
}

export function createRunManifest({ runId = generateRunId(), targetClassification }) {
  validateConfirmRun(runId);
  return {
    schemaVersion: 1,
    runId,
    targetClassification,
    startedAt: new Date().toISOString(),
    status: "RUNNING",
    artifacts: Object.fromEntries(ARTIFACT_GROUPS.map((group) => [group, []])),
    cleanupAttempts: [],
    cleanupFailures: [],
    residueResults: [],
    qaFailures: [],
    completedAt: null,
  };
}

export function registerArtifact(manifest, group, artifact) {
  if (!ARTIFACT_GROUPS.includes(group)) throw new Error("QA_MANIFEST_ARTIFACT_GROUP_INVALID");
  const id = String(artifact?.id ?? "").trim();
  if (!id) throw new Error("QA_MANIFEST_EXACT_ID_REQUIRED");
  if (manifest.artifacts[group].some((item) => item.id === id)) throw new Error("QA_MANIFEST_DUPLICATE_EXACT_ID");

  const entry = {
    id,
    artifactType: group,
    creationStep: String(artifact.creationStep ?? group),
    cleanupMethod: CLEANUP_METHODS[group],
    cleanupStatus: "PENDING",
    publicRoute: artifact.publicRoute ?? null,
    parentIds: Array.isArray(artifact.parentIds) ? artifact.parentIds.map(String) : [],
  };
  manifest.artifacts[group].push(entry);
  return entry;
}

function artifactsForCleanup(manifest) {
  return CLEANUP_ORDER.flatMap((group) => manifest.artifacts[group].slice().reverse());
}

function normalizeCleanupResult(result) {
  if (result?.alreadyAbsent === true) return { ok: true, alreadyAbsent: true };
  if (result?.ok === true) return { ok: true, alreadyAbsent: false };
  return { ok: false, error: String(result?.error ?? "QA_EXACT_CLEANUP_FAILED") };
}

async function cleanAndVerifyArtifact(adapter, manifest, artifact) {
  const method = adapter[artifact.cleanupMethod];
  let cleanupResult;
  if (typeof method !== "function") {
    cleanupResult = { ok: false, error: "QA_EXACT_CLEANUP_METHOD_MISSING" };
  } else {
    try {
      cleanupResult = normalizeCleanupResult(await method.call(adapter, artifact.id, artifact));
    } catch (error) {
      cleanupResult = { ok: false, error: String(error?.message ?? "QA_EXACT_CLEANUP_THROWN") };
    }
  }

  artifact.cleanupStatus = cleanupResult.ok ? (cleanupResult.alreadyAbsent ? "ALREADY_ABSENT" : "CLEANED") : "FAILED";
  manifest.cleanupAttempts.push({ artifactType: artifact.artifactType, id: artifact.id, status: artifact.cleanupStatus });
  if (!cleanupResult.ok) manifest.cleanupFailures.push({ artifactType: artifact.artifactType, id: artifact.id, error: cleanupResult.error });

  let absent = false;
  let verificationError = null;
  try {
    const verification = await adapter.verifyArtifactAbsent(artifact);
    absent = verification === true || verification?.absent === true;
  } catch (error) {
    verificationError = String(error?.message ?? "QA_RESIDUE_VERIFICATION_THROWN");
  }
  manifest.residueResults.push({ artifactType: artifact.artifactType, id: artifact.id, absent, error: verificationError });
  if (!absent) manifest.cleanupFailures.push({ artifactType: artifact.artifactType, id: artifact.id, error: verificationError ?? "QA_RESIDUE_REMAINS" });
}

async function cleanupManifest(adapter, manifest) {
  for (const artifact of artifactsForCleanup(manifest)) {
    await cleanAndVerifyArtifact(adapter, manifest, artifact);
  }
}

function finishManifest(manifest) {
  const success = manifest.qaFailures.length === 0 && manifest.cleanupFailures.length === 0 && manifest.residueResults.every((item) => item.absent);
  manifest.status = success ? "SUCCESS" : manifest.residueResults.some((item) => !item.absent) ? "NO-GO" : "PARTIAL";
  manifest.completedAt = new Date().toISOString();
  return { manifest, exitCode: success ? 0 : 1 };
}

function artifactFromResult(group, result, creationStep, extra = {}) {
  return {
    id: result?.id,
    creationStep,
    publicRoute: result?.publicRoute ?? null,
    parentIds: extra.parentIds ?? result?.parentIds ?? [],
  };
}

export async function orchestrateDestructiveQa(adapter, { runId, targetClassification = "staging" }) {
  const manifest = createRunManifest({ runId, targetClassification });
  const created = {};

  try {
    created.user = await adapter.createQaUser({ runId });
    registerArtifact(manifest, "users", artifactFromResult("users", created.user, "createQaUser"));
    if (created.user.profileId) registerArtifact(manifest, "profiles", { id: created.user.profileId, creationStep: "createQaUser", parentIds: [created.user.id] });

    created.role = await adapter.assignQaRole({ userId: created.user.id, runId });
    registerArtifact(manifest, "roleAssignments", artifactFromResult("roleAssignments", created.role, "assignQaRole", { parentIds: [created.user.id] }));

    created.circle = await adapter.createCircle({ userId: created.user.id, runId });
    registerArtifact(manifest, "circles", artifactFromResult("circles", created.circle, "createCircle", { parentIds: [created.user.id] }));

    created.post = await adapter.createPost({ userId: created.user.id, circleId: created.circle.id, runId });
    registerArtifact(manifest, "posts", artifactFromResult("posts", created.post, "createPost", { parentIds: [created.user.id, created.circle.id] }));

    created.comment = await adapter.createComment({ userId: created.user.id, postId: created.post.id, runId });
    registerArtifact(manifest, "comments", artifactFromResult("comments", created.comment, "createComment", { parentIds: [created.user.id, created.post.id] }));

    created.report = await adapter.createReport({ userId: created.user.id, postId: created.post.id, runId });
    registerArtifact(manifest, "reports", artifactFromResult("reports", created.report, "createReport", { parentIds: [created.user.id, created.post.id] }));

    created.media = await adapter.uploadMedia({ userId: created.user.id, postId: created.post.id, runId });
    registerArtifact(manifest, "mediaObjects", artifactFromResult("mediaObjects", created.media, "uploadMedia", { parentIds: [created.user.id, created.post.id] }));

    if (typeof adapter.assertQaScenario === "function") await adapter.assertQaScenario({ runId, manifest, created });
  } catch (error) {
    manifest.qaFailures.push(String(error?.message ?? "QA_ORCHESTRATION_FAILED"));
  } finally {
    await cleanupManifest(adapter, manifest);
  }

  return finishManifest(manifest);
}

function redactId(value) {
  const id = String(value ?? "");
  return id.length <= 8 ? id : `${id.slice(0, 4)}...${id.slice(-4)}`;
}

export function serializeManifest(manifest) {
  return {
    ...manifest,
    artifacts: Object.fromEntries(
      ARTIFACT_GROUPS.map((group) => [group, manifest.artifacts[group].map((item) => ({ ...item, id: redactId(item.id), parentIds: item.parentIds.map(redactId), publicRoute: item.publicRoute ? "[route-recorded]" : null }))]),
    ),
    cleanupAttempts: manifest.cleanupAttempts.map((item) => ({ ...item, id: redactId(item.id) })),
    cleanupFailures: manifest.cleanupFailures.map((item) => ({ ...item, id: redactId(item.id) })),
    residueResults: manifest.residueResults.map((item) => ({ ...item, id: redactId(item.id) })),
  };
}
