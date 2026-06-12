type ImageVariantOptions = {
  maxWidth: number;
  quality: number;
  fileName?: string;
};

export type OptimizedImageVariant = {
  file: File;
  width: number;
  height: number;
  mimeType: string;
};

function supportsImageOptimization(file: File) {
  return /^image\/(jpeg|png|webp)$/i.test(file.type);
}

function normalizeOutputMimeType(file: File) {
  return /^image\/png$/i.test(file.type) ? "image/webp" : "image/webp";
}

function buildVariantName(file: File, overrideName?: string) {
  const baseName = overrideName || file.name || "image";
  return baseName.replace(/\.[a-z0-9]+$/i, "") || "image";
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`无法处理图片：${file.name}`));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export async function createOptimizedImageVariant(
  file: File,
  options: ImageVariantOptions,
): Promise<OptimizedImageVariant> {
  if (!supportsImageOptimization(file) || typeof document === "undefined") {
    return {
      file,
      width: 0,
      height: 0,
      mimeType: file.type || "image/jpeg",
    };
  }

  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    return {
      file,
      width: 0,
      height: 0,
      mimeType: file.type || "image/jpeg",
    };
  }

  const scale = Math.min(1, options.maxWidth / sourceWidth);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const outputMimeType = normalizeOutputMimeType(file);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return {
      file,
      width: sourceWidth,
      height: sourceHeight,
      mimeType: file.type || "image/jpeg",
    };
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const blob = await canvasToBlob(canvas, outputMimeType, options.quality);
  if (!blob) {
    return {
      file,
      width: sourceWidth,
      height: sourceHeight,
      mimeType: file.type || "image/jpeg",
    };
  }

  const nextFile = new File(
    [blob],
    `${buildVariantName(file, options.fileName)}.webp`,
    { type: outputMimeType, lastModified: Date.now() },
  );

  if (nextFile.size >= file.size && sourceWidth <= options.maxWidth) {
    return {
      file,
      width: sourceWidth,
      height: sourceHeight,
      mimeType: file.type || "image/jpeg",
    };
  }

  return {
    file: nextFile,
    width: targetWidth,
    height: targetHeight,
    mimeType: outputMimeType,
  };
}
