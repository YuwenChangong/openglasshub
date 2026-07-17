import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

export const PINNED_PSQL_IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.143@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
export const PINNED_PSQL_DIGEST = "sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
export const MOUNTED_REVIEWED_SQL_PATH = "/reviewed/operational-guardrails-authenticated-privilege-supplemental-preflight.sql";
export const CONNECTION_MODES = new Set(["DIRECT_SSL_REQUIRED", "SUPAVISOR_SESSION_SSL_REQUIRED"]);

const run = (args, options = {}) => {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `docker exited ${result.status}`);
  return result.stdout.trim();
};

export const resolveReviewedSourcePath = ({ root, packet }) => path.resolve(root, packet.sourceFile);

export const inspectPinnedPsqlImage = () => {
  const repoDigests = JSON.parse(execFileSync("docker", ["image", "inspect", PINNED_PSQL_IMAGE, "--format", "{{json .RepoDigests}}"], { encoding: "utf8" }).trim());
  assert(repoDigests.some((repoDigest) => repoDigest.endsWith(`@${PINNED_PSQL_DIGEST}`)), "pinned PostgreSQL image digest differs from reviewed transport image");
  const version = run(["run", "--rm", PINNED_PSQL_IMAGE, "psql", "--version"]);
  assert.match(version, /^psql \(PostgreSQL\) 17\.6/);
  return { image: PINNED_PSQL_IMAGE, digest: PINNED_PSQL_DIGEST, psqlVersion: version };
};

export const verifyReadOnlyMountedPacket = ({ root, packet }) => {
  const sourcePath = resolveReviewedSourcePath({ root, packet });
  const mount = `type=bind,src=${sourcePath},dst=${MOUNTED_REVIEWED_SQL_PATH},readonly`;
  const output = run([
    "run", "--rm", "--network", "none", "--mount", mount, "--entrypoint", "sh", PINNED_PSQL_IMAGE,
    "-ec", "test -f \"$1\" && test -r \"$1\" && mount_options=$(awk -v target=\"$1\" '$2 == target { print $4 }' /proc/mounts) && case \",$mount_options,\" in *,ro,*) ;; *) exit 1 ;; esac && sha256sum \"$1\" && wc -c < \"$1\"", "sh", MOUNTED_REVIEWED_SQL_PATH,
  ]);
  const [hashLine, byteLine] = output.split(/\r?\n/);
  const [containerSha256] = hashLine.split(/\s+/);
  const containerByteCount = Number.parseInt(byteLine, 10);
  assert.equal(containerSha256, packet.sourceSha256, "container file SHA-256 must match reviewed source");
  assert.equal(containerByteCount, packet.sourceByteCount, "container file byte count must match reviewed source");
  return { sourcePath, mountedPath: MOUNTED_REVIEWED_SQL_PATH, containerSha256, containerByteCount, mountedReadOnly: true };
};

export const buildDockerPsqlManifest = ({ packet, image, mount, repositoryCommit, targetIdentityFingerprint, expectedTargetIdentityFingerprint, connectionMode, timestamp = new Date().toISOString() }) => {
  assert.match(repositoryCommit, /^[0-9a-f]{40}$/i, "repository commit must be a full SHA");
  assert.match(targetIdentityFingerprint, /^[a-z0-9][a-z0-9._:-]{7,127}$/i, "target identity fingerprint must be a non-secret fingerprint token");
  assert.equal(targetIdentityFingerprint, expectedTargetIdentityFingerprint, "observed target identity fingerprint must match the reviewed target identity fingerprint");
  assert(CONNECTION_MODES.has(connectionMode), "connection mode must be direct SSL or Supavisor session SSL");
  assert.equal(packet.sourceSha256, packet.payloadSha256, "host payload SHA-256 must match source SHA-256");
  assert.equal(packet.sourceByteCount, packet.payloadByteCount, "host payload byte count must match source byte count");
  assert.equal(mount.containerSha256, packet.sourceSha256, "container SHA-256 must match source SHA-256");
  assert.equal(mount.containerByteCount, packet.sourceByteCount, "container byte count must match source byte count");
  assert.equal(image.digest, PINNED_PSQL_DIGEST, "Docker image digest must match reviewed digest");
  assert.equal(mount.mountedReadOnly, true, "reviewed SQL file must be read-only in container");
  return {
    manifestVersion: "docker-psql-reviewed-file-transport-v1",
    repositoryCommit,
    sourceFile: packet.sourceFile,
    hostSha256: packet.sourceSha256,
    containerSha256: mount.containerSha256,
    hostByteCount: packet.sourceByteCount,
    containerByteCount: mount.containerByteCount,
    pinnedDockerImage: image.image,
    pinnedDockerDigest: image.digest,
    psqlVersion: image.psqlVersion,
    mountedFilePath: mount.mountedPath,
    mountedReadOnly: true,
    transportCommandShape: "docker run --rm --mount type=bind,src=<reviewed-source>,dst=/reviewed/operational-guardrails-authenticated-privilege-supplemental-preflight.sql,readonly --env-file <credentials-env-file> <pinned-image> psql -X -v ON_ERROR_STOP=1 \"sslmode=require ...\" -f /reviewed/operational-guardrails-authenticated-privilege-supplemental-preflight.sql",
    targetIdentityFingerprint,
    expectedTargetIdentityFingerprint,
    connectionMode,
    dryRunValidation: "PASS",
    timestamp,
  };
};
