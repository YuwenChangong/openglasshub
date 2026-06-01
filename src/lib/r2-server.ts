import { S3Client, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export function normalizeFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createR2Client(env: Record<string, string | undefined>): S3Client {
  const accountId = requireEnv(env, "R2_ACCOUNT_ID");
  const accessKeyId = requireEnv(env, "R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv(env, "R2_SECRET_ACCESS_KEY");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function getR2BucketName(env: Record<string, string | undefined>): string {
  return requireEnv(env, "R2_BUCKET_NAME");
}

export function buildTmpVideoKey(userId: string, fileName: string): string {
  const safeName = normalizeFileName(fileName) || "video.mp4";
  return `tmp/${userId}/${crypto.randomUUID()}-${safeName}`;
}

export async function signR2PutUrl(params: {
  env: Record<string, string | undefined>;
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const { env, objectKey, contentType, expiresInSeconds = 15 * 60 } = params;
  const client = createR2Client(env);
  const bucketName = getR2BucketName(env);
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export function buildR2PublicUrl(env: Record<string, string | undefined>, objectKey: string): string {
  const base = requireEnv(env, "R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
  return `${base}/${objectKey}`;
}

export async function deleteR2Objects(params: {
  env: Record<string, string | undefined>;
  objectKeys: string[];
}): Promise<void> {
  const { env, objectKeys } = params;
  if (!objectKeys.length) return;
  const client = createR2Client(env);
  const bucketName = getR2BucketName(env);
  const chunks: string[][] = [];
  for (let i = 0; i < objectKeys.length; i += 1000) {
    chunks.push(objectKeys.slice(i, i + 1000));
  }
  for (const chunk of chunks) {
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );
    const errors = (result.Errors ?? [])
      .map((item) => ({
        key: item.Key ?? "",
        code: item.Code ?? "Unknown",
        message: item.Message ?? "Unknown R2 delete error",
      }))
      .filter((item) => item.code !== "NoSuchKey");
    if (errors.length > 0) {
      throw new Error(`R2_DELETE_FAILED:${JSON.stringify(errors)}`);
    }
  }
}
