import { createCanonicalCanaryTargetBinding } from "../qa/canonical-canary-target-binding.mjs";

const commit = "c49712bfa5afc7290f72ad1e39462d8b03fd6077";
const runId = "qa-canary-11111111-1111-4111-8111-111111111111";
const hash = (value) => value.repeat(64);

function targetBinding() {
  return createCanonicalCanaryTargetBinding({
    resolvedAtUtc: "2099-01-01T00:03:00.000Z",
    canonicalCircleId: "11111111-1111-4111-8111-111111111111",
    canonicalCircleSlug: "replay-target",
    baseMutationPlanSchema: "qa-minimal-canary-mutation-plan-v1",
    baseMutationPlanHash: hash("a"),
    executionCommit: commit,
    toolingCommit: commit,
  });
}

export function createLiveDryRunReplayFixture() {
  const binding = targetBinding();
  return Object.freeze({
    provenance: Object.freeze({
      source: "sanitized-live-artifact-replay",
      originalRunIdRetired: true,
      realProviderValuesRetained: false,
      targetIdentityRetained: false,
    }),
    expected: Object.freeze({
      outerClassification: "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED",
      innerClassification: "R6_PREEXISTING_SECRET_ENV_DENIED",
      failureStage: "RUN_ID_RESERVATION",
      firstDivergenceStage: "DRY_RUN_CHILD_INVOCATION",
      firstDivergenceField: "resolverScopedProcessEnvironment",
    }),
    dryRunTerminal: Object.freeze({
      schemaVersion: "r6-v4-dry-run-terminal-result-v4",
      startedAt: "2099-01-01T00:03:08.000Z",
      completedAt: "2099-01-01T00:03:55.000Z",
      runId,
      outerClassification: "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED",
      innerClassification: "R6_PREEXISTING_SECRET_ENV_DENIED",
      success: false,
      failureStage: "RUN_ID_RESERVATION",
      captureProvenancePassed: true,
      authProvenancePassed: true,
      attestationFreshnessPassed: true,
      minimumRequiredValidityMs: 720000,
      remainingValidityMs: 780000,
      runIdValidationPassed: true,
      reservationAttempted: true,
      reservationCompleted: true,
      receiptCreated: true,
      receiptState: "PENDING",
      executionCommit: commit,
      receiptRunnerCommit: commit,
      expectedToolingCommit: commit,
      targetBinding: binding,
      targetBindingPath: "C:\\replay\\dry-run\\canonical-canary-target-binding.json",
      targetBindingSha256: hash("b"),
      childStarted: false,
      canaryChildStarted: false,
      childCompleted: false,
      childTimedOut: false,
      stdoutClassification: null,
      stderrClassification: null,
      childTerminalPath: null,
      childTerminalSha256: null,
      childTerminalLocated: false,
      childTerminalValidated: false,
      adapterReached: false,
      journalCreated: false,
      childExitCode: 1,
      plannedMutationCount: 2,
      actualMutationCount: 0,
      unexpectedMutationCount: 0,
      supabaseWriteCount: 0,
      productionMutationCount: 0,
      retryCount: 0,
      finalAuthorizationCreated: false,
      authenticationCompleted: true,
      targetResolutionStarted: true,
      targetResolutionCompleted: true,
      targetResolutionSucceeded: true,
      targetResolutionFailureCategory: null,
      targetResultCountClass: "ONE",
      targetEligibleState: "ELIGIBLE",
      canonicalTargetResolved: true,
      canonicalCircleIdResolved: true,
      canonicalCircleSlugResolved: true,
      targetBindingArtifactPresent: true,
      targetBindingValidationPassed: true,
      targetBindingCreated: true,
      targetBindingHashCreated: true,
      targetBoundExecutionPlanHashCreated: true,
    }),
  });
}
