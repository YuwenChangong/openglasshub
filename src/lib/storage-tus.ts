import * as tus from "tus-js-client";

const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

export async function uploadToPostMediaWithTus(params: {
  file: File;
  objectPath: string;
  accessToken: string;
  upsert?: boolean;
}): Promise<void> {
  const { file, objectPath, accessToken, upsert = false } = params;
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("缺少 Supabase 前端环境变量。");
  }

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_SIZE,
      retryDelays: [0, 1000, 3000, 5000],
      metadata: {
        bucketName: "post-media",
        objectName: objectPath,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
        "x-upsert": upsert ? "true" : "false",
      },
      onError: (error) => reject(error),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

