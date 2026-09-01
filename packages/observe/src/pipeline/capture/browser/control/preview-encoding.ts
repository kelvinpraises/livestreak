import type { BrowserCaptureImageEncoding } from "#pipeline/capture/browser/page/types.js";

export type BrowserCapturePreviewMime = "image/jpeg" | "image/png";

export const previewMimeForEncoding = (
  encoding: BrowserCaptureImageEncoding
): BrowserCapturePreviewMime => (encoding === "png" ? "image/png" : "image/jpeg");

export const base64FromBytes = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");

export const dataUriFromBytes = (bytes: Uint8Array, mime: BrowserCapturePreviewMime): string =>
  `data:${mime};base64,${base64FromBytes(bytes)}`;
