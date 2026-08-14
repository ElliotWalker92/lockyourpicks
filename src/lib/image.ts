/**
 * Downscale an image in the browser before upload.
 *
 * A photo straight off a phone is typically 3–5 MB and several thousand pixels
 * wide. Rejecting those means almost every real upload fails; and there is no
 * reason to store one, since the largest an avatar is ever rendered is 72px.
 *
 * Resizing client-side also means the big file never leaves the device, which
 * is faster on a phone connection than uploading 5 MB and shrinking it later.
 */

/** Generous next to a 72px render — allows for retina and any future crop UI. */
const MAX_EDGE = 512;

/** Comfortably inside the bucket's 2 MB ceiling. */
const TARGET_BYTES = 400 * 1024;

const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

export type ProcessedImage = {
  blob: Blob;
  /** Always image/jpeg or image/png — never the original SVG etc. */
  type: string;
  extension: string;
  originalBytes: number;
  finalBytes: number;
  width: number;
  height: number;
};

/**
 * @throws if the file isn't a decodable image
 */
export async function prepareAvatar(file: File): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file doesn't look like an image.");
  });

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Transparency only survives PNG, and a PNG of a photo is far larger than
  // its JPEG — so keep PNG only where it might actually matter.
  const keepAlpha = file.type === 'image/png';
  const type = keepAlpha ? 'image/png' : 'image/jpeg';

  const toBlob = (quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))),
        type,
        quality,
      ),
    );

  let blob = await toBlob(keepAlpha ? undefined : QUALITY_STEPS[0]);

  // Step the quality down until it fits. PNG ignores the quality argument, so
  // fall back to JPEG if a transparent image is still too big.
  if (!keepAlpha) {
    for (let i = 1; i < QUALITY_STEPS.length && blob.size > TARGET_BYTES; i++) {
      blob = await toBlob(QUALITY_STEPS[i]);
    }
  } else if (blob.size > TARGET_BYTES) {
    for (const q of QUALITY_STEPS) {
      const jpeg = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))),
          'image/jpeg',
          q,
        ),
      );
      blob = jpeg;
      if (jpeg.size <= TARGET_BYTES) break;
    }
    return {
      blob,
      type: 'image/jpeg',
      extension: 'jpg',
      originalBytes: file.size,
      finalBytes: blob.size,
      width,
      height,
    };
  }

  return {
    blob,
    type,
    extension: keepAlpha ? 'png' : 'jpg',
    originalBytes: file.size,
    finalBytes: blob.size,
    width,
    height,
  };
}

export function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
