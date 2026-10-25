export const RECEIPT_MAX_IMAGE_BYTES = 1_500_000;

const RECEIPT_MAX_INPUT_BYTES = 10_000_000;
const RECEIPT_MAX_PIXELS = 24_000_000;
const RECEIPT_MAX_EDGE = 10_000;
const RECEIPT_NORMALIZED_MAX_EDGE = 2_000;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function invalidReceiptImage(): never {
  throw new Error("RECEIPT_IMAGE_INVALID");
}

function validDimensions(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > RECEIPT_MAX_EDGE || height > RECEIPT_MAX_EDGE || width * height > RECEIPT_MAX_PIXELS) {
    return null;
  }

  return { width, height };
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 2 ** 24 + bytes[offset + 1] * 2 ** 16 + bytes[offset + 2] * 2 ** 8 + bytes[offset + 3];
}

function inspectPng(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  if (bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null;
  if (readUint32BigEndian(bytes, 8) !== 13) return null;

  return validDimensions(readUint32BigEndian(bytes, 16), readUint32BigEndian(bytes, 20));
}

function isJpegStartOfFrame(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

function inspectJpeg(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;

    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = bytes[offset] * 256 + bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;

    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 8) return null;
      return validDimensions(bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]);
    }

    offset += segmentLength;
  }

  return null;
}

/** Safely reads dimensions from a JPEG or PNG header without browser APIs. */
export function inspectReceiptImage(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return inspectPng(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  return null;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("RECEIPT_IMAGE_ENCODE_FAILED")), "image/jpeg", 0.8);
  });
}

function base64(bytes: Uint8Array): string {
  const encode = globalThis.btoa;
  if (typeof encode !== "function") invalidReceiptImage();

  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return encode(binary);
}

/**
 * Decodes a receipt photo in the browser, corrects its visual orientation, and
 * re-encodes it as a bounded JPEG. The returned string is raw base64 only.
 */
export async function normalizeReceiptImage(file: File): Promise<string> {
  if (file.type.toLowerCase() !== "image/jpeg" && file.type.toLowerCase() !== "image/png") invalidReceiptImage();
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > RECEIPT_MAX_INPUT_BYTES) invalidReceiptImage();

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  if (!inspectReceiptImage(sourceBytes)) invalidReceiptImage();

  if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.document === "undefined") invalidReceiptImage();

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await globalThis.createImageBitmap(file, { imageOrientation: "from-image" });
    if (!validDimensions(bitmap.width, bitmap.height)) invalidReceiptImage();

    const scale = Math.min(1, RECEIPT_NORMALIZED_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) invalidReceiptImage();
    context.drawImage(bitmap, 0, 0, width, height);

    const outputBytes = new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer());
    if (outputBytes.length === 0 || outputBytes.length > RECEIPT_MAX_IMAGE_BYTES || !inspectReceiptImage(outputBytes)) invalidReceiptImage();
    return base64(outputBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "RECEIPT_IMAGE_INVALID") throw error;
    throw new Error("RECEIPT_IMAGE_NORMALIZE_FAILED");
  } finally {
    bitmap?.close();
  }
}
