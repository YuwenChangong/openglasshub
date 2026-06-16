import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AwsClient } from "aws4fetch";

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

export type R2DeleteObjectResult = {
  ok: boolean;
  httpStatus?: number;
  body?: string;
  code?: string;
  error?: string;
};

function buildR2ObjectDeleteUrl(env: Record<string, string | undefined>, objectKey: string): string {
  const accountId = requireEnv(env, "R2_ACCOUNT_ID");
  const bucketName = getR2BucketName(env);
  const normalizedKey = objectKey.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${normalizedKey}`;
}

function extractXmlTagValue(xml: string, tagName: string): string {
  const match = xml.match(new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

export async function deleteR2Object(params: {
  env: Record<string, string | undefined>;
  objectKey: string;
}): Promise<R2DeleteObjectResult> {
  const { env, objectKey } = params;
  const missingEnv = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"].filter(
    (key) => !String(env[key] ?? "").trim(),
  );

  if (missingEnv.length > 0) {
    return {
      ok: false,
      error: `R2 delete skipped: missing R2 env ${missingEnv.join(", ")}`,
    };
  }

  try {
    const client = new AwsClient({
      accessKeyId: requireEnv(env, "R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    });
    const response = await client.fetch(buildR2ObjectDeleteUrl(env, objectKey), {
      method: "DELETE",
    });
    const body = (await response.text().catch(() => "")).trim();

    if (response.status === 200 || response.status === 204) {
      return { ok: true, httpStatus: response.status, body };
    }

    const code = extractXmlTagValue(body, "Code");
    if (response.status === 404 || code === "NoSuchKey") {
      return {
        ok: true,
        httpStatus: response.status,
        body,
        code: code || "NoSuchKey",
      };
    }

    return {
      ok: false,
      httpStatus: response.status,
      body,
      code,
      error: `R2 delete failed: HTTP ${response.status}${body ? ` ${body}` : ""}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown R2 delete error",
    };
  }
}
