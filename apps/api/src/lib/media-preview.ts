import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { resolveApiDataPath } from "./data-paths.js";

const MAX_INLINE_PREVIEW_DATA_URL_CHARS = 24_000;
const PREVIEW_BLOB_DIR_NAME = "previews";

export type PreviewMetadata = Record<string, string | number | boolean | null | undefined>;

function isDataImageUrl(value: string): boolean {
  return value.startsWith("data:image/");
}

function normalizePollinationsPreviewUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.hostname !== "image.pollinations.ai") return value;
    if (parsed.pathname.startsWith("/p/")) {
      parsed.pathname = `/prompt/${parsed.pathname.slice("/p/".length)}`;
      return parsed.toString();
    }
    if (parsed.pathname === "/p") {
      parsed.pathname = "/prompt";
      return parsed.toString();
    }
    return value;
  } catch {
    return value;
  }
}

function isPollinationsPreviewUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.hostname !== "image.pollinations.ai") return false;
    return parsed.pathname.startsWith("/p/") || parsed.pathname.startsWith("/prompt/") || parsed.pathname === "/p" || parsed.pathname === "/prompt";
  } catch {
    return false;
  }
}

function sanitizeLine(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const limited = compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}…` : compact;
  return limited.replace(/[<>&"]/g, "");
}

function normalizeAspectRatio(value: unknown): string {
  if (typeof value === "string" && /^\d+:\d+$/.test(value)) return value;
  return "1:1";
}

function dimensionsFor(aspectRatio: string, resolutionRaw: unknown): { width: number; height: number } {
  const resolution = typeof resolutionRaw === "string" ? resolutionRaw : "1K";
  const base = resolution === "4K" ? 3072 : resolution === "2K" ? 2048 : 1024;
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h) return { width: base, height: base };
  if (w >= h) {
    return { width: base, height: Math.max(256, Math.round((base * h) / w)) };
  }
  return { width: Math.max(256, Math.round((base * w) / h)), height: base };
}

function suppressedPreviewDataUrl(metadata: PreviewMetadata, detail: string): string {
  const aspectRatio = normalizeAspectRatio(metadata.aspectRatio);
  const { width, height } = dimensionsFor(aspectRatio, metadata.resolution);
  const prompt = typeof metadata.prompt === "string" ? sanitizeLine(metadata.prompt, 72) : "";
  const message = sanitizeLine(detail, 64);
  const titleSize = Math.max(24, Math.round(Math.min(width, height) * 0.05));
  const detailSize = Math.max(14, Math.round(Math.min(width, height) * 0.026));
  const subtitle = prompt.length > 0 ? prompt : "Stored preview unavailable";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#141f33"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.14)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.72)}" rx="${Math.max(18, Math.round(Math.min(width, height) * 0.04))}" fill="rgba(9, 13, 25, 0.58)" stroke="rgba(224, 234, 255, 0.24)" stroke-width="2"/><text x="50%" y="44%" text-anchor="middle" fill="#eef4ff" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700">Preview unavailable</text><text x="50%" y="56%" text-anchor="middle" fill="#ccdaef" font-family="Arial, sans-serif" font-size="${detailSize}">${subtitle}</text><text x="50%" y="67%" text-anchor="middle" fill="#9eb2d2" font-family="Arial, sans-serif" font-size="${detailSize}">${message}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function previewBlobDirectory(): string {
  return resolveApiDataPath(PREVIEW_BLOB_DIR_NAME);
}

function normalizePreviewBlobKey(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[a-f0-9]{40}\.[a-z0-9]+$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function previewBlobKeyFromStorageKey(storageKey: string | undefined): string | null {
  if (typeof storageKey !== "string" || storageKey.length === 0) return null;
  const match = storageKey.match(/^previews\/([a-f0-9]{40}\.[a-z0-9]+)$/i);
  if (!match) return null;
  return normalizePreviewBlobKey(match[1]);
}

function mimeTypeToExtension(mimeType: string): string | null {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/avif") return "avif";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  return null;
}

function extensionToMimeType(extension: string): string {
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "avif") return "image/avif";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const extension = mimeTypeToExtension(mimeType);
  if (!extension) return null;
  try {
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0) return null;
    return { mimeType, bytes };
  } catch {
    return null;
  }
}

function decodeSvgDataUrl(dataUrl: string): string | null {
  if (dataUrl.startsWith("data:image/svg+xml;utf8,")) {
    const encoded = dataUrl.slice("data:image/svg+xml;utf8,".length);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }

  const base64Match = dataUrl.match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/i);
  if (!base64Match) return null;
  try {
    return Buffer.from(base64Match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
}

function extractEmbeddedRasterDataUrl(svgDataUrl: string): string | null {
  const svg = decodeSvgDataUrl(svgDataUrl);
  if (!svg) return null;
  const imageHrefMatch = svg.match(/<image\b[^>]*\b(?:href|xlink:href)=["']([^"']+)["'][^>]*>/i);
  const embeddedHref = imageHrefMatch?.[1];
  if (!embeddedHref || !embeddedHref.startsWith("data:image/")) return null;
  if (embeddedHref.startsWith("data:image/svg+xml")) return null;
  return embeddedHref;
}

export function previewBlobUrl(blobKey: string): string {
  return `/v1/previews/${encodeURIComponent(blobKey)}`;
}

function persistPreviewBlob(dataUrl: string): string | null {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return null;
  const extension = mimeTypeToExtension(parsed.mimeType);
  if (!extension) return null;
  const hash = createHash("sha1").update(parsed.bytes).digest("hex");
  const blobKey = normalizePreviewBlobKey(`${hash}.${extension}`);
  if (!blobKey) return null;
  const directory = previewBlobDirectory();
  const filePath = path.join(directory, blobKey);
  try {
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, parsed.bytes);
    }
    return blobKey;
  } catch {
    return null;
  }
}

export function readPreviewBlob(blobKeyRaw: string): { contentType: string; bytes: Buffer } | null {
  const blobKey = normalizePreviewBlobKey(blobKeyRaw);
  if (!blobKey) return null;
  const directory = previewBlobDirectory();
  const filePath = path.join(directory, blobKey);
  const resolvedDirectory = path.resolve(directory);
  const resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(`${resolvedDirectory}${path.sep}`)) return null;
  try {
    if (!fs.existsSync(resolvedFilePath)) return null;
    const bytes = fs.readFileSync(resolvedFilePath);
    if (bytes.length === 0) return null;
    const extension = blobKey.split(".").pop() ?? "";
    return {
      contentType: extensionToMimeType(extension),
      bytes
    };
  } catch {
    return null;
  }
}

export function isPersistableInlinePreviewDataUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!isDataImageUrl(value)) return false;
  return value.length <= MAX_INLINE_PREVIEW_DATA_URL_CHARS;
}

function hasPersistableInlinePreview(metadata: PreviewMetadata): boolean {
  return typeof metadata.previewDataUrl === "string" && isPersistableInlinePreviewDataUrl(metadata.previewDataUrl);
}

function ensurePreviewUrlForBlob(metadata: PreviewMetadata): void {
  const blobRaw = metadata.previewBlob;
  if (typeof blobRaw !== "string") return;
  const blobKey = normalizePreviewBlobKey(blobRaw);
  if (!blobKey) return;
  if (typeof metadata.previewUrl !== "string" || metadata.previewUrl.length === 0) {
    metadata.previewUrl = previewBlobUrl(blobKey);
  }
}

export function sanitizeInlinePreviewMetadata<T extends PreviewMetadata>(metadata: T): T {
  const mutable = metadata as PreviewMetadata;
  if (typeof mutable.previewUrl === "string" && mutable.previewUrl.length > 0) {
    mutable.previewUrl = normalizePollinationsPreviewUrl(mutable.previewUrl);
  }
  if (typeof mutable.outputUrl === "string" && mutable.outputUrl.length > 0) {
    mutable.outputUrl = normalizePollinationsPreviewUrl(mutable.outputUrl);
  }
  ensurePreviewUrlForBlob(mutable);

  const previewDataUrl = mutable.previewDataUrl;
  if (typeof previewDataUrl === "string" && isDataImageUrl(previewDataUrl)) {
    const isSvg = previewDataUrl.startsWith("data:image/svg+xml;");
    // Raster previews are valuable generated output: persist to disk regardless of size.
    if (!isSvg) {
      const blobKey = persistPreviewBlob(previewDataUrl);
      if (blobKey) {
        delete mutable.previewDataUrl;
        mutable.previewBlob = blobKey;
        mutable.previewUrl = previewBlobUrl(blobKey);
        mutable.inlinePreviewExternalized = true;
      } else if (!isPersistableInlinePreviewDataUrl(previewDataUrl)) {
        mutable.inlinePreviewDropped = true;
        mutable.inlinePreviewLength = previewDataUrl.length;
        delete mutable.previewDataUrl;
        if (typeof mutable.previewUrl !== "string" || mutable.previewUrl.length === 0) {
          if (typeof mutable.outputUrl === "string" && mutable.outputUrl.length > 0) {
            mutable.previewUrl = mutable.outputUrl;
          }
        }
      }
    } else {
      const embeddedRasterDataUrl = extractEmbeddedRasterDataUrl(previewDataUrl);
      if (embeddedRasterDataUrl) {
        const blobKey = persistPreviewBlob(embeddedRasterDataUrl);
        if (blobKey) {
          delete mutable.previewDataUrl;
          mutable.previewBlob = blobKey;
          mutable.previewUrl = previewBlobUrl(blobKey);
          mutable.inlinePreviewExternalized = true;
          mutable.inlinePreviewEmbeddedImage = true;
        }
      }
      if (typeof mutable.previewDataUrl === "string" && !isPersistableInlinePreviewDataUrl(mutable.previewDataUrl)) {
        mutable.inlinePreviewDropped = true;
        mutable.inlinePreviewLength = mutable.previewDataUrl.length;
        delete mutable.previewDataUrl;
      }
    }
  }

  const previewUrl = typeof mutable.previewUrl === "string" ? mutable.previewUrl : "";
  const outputUrl = typeof mutable.outputUrl === "string" ? mutable.outputUrl : "";
  const usesPollinationsPreview = (previewUrl.length > 0 && isPollinationsPreviewUrl(previewUrl)) ||
    (outputUrl.length > 0 && isPollinationsPreviewUrl(outputUrl));
  if (!hasPersistableInlinePreview(mutable) && usesPollinationsPreview) {
    delete mutable.previewUrl;
    delete mutable.outputUrl;
    mutable.previewDataUrl = suppressedPreviewDataUrl(mutable, "Remote preview source disabled");
    mutable.remotePreviewSuppressed = true;
  }

  if (
    !hasPersistableInlinePreview(mutable) &&
    (typeof mutable.previewUrl !== "string" || mutable.previewUrl.length === 0) &&
    (typeof mutable.outputUrl !== "string" || mutable.outputUrl.length === 0) &&
    (typeof mutable.previewBlob !== "string" || !normalizePreviewBlobKey(mutable.previewBlob))
  ) {
    mutable.previewDataUrl = suppressedPreviewDataUrl(mutable, "Inline preview compacted");
  }

  return metadata;
}

export function resolvePreviewFromMetadata(metadata: PreviewMetadata | undefined): string | null {
  if (!metadata) return null;
  const previewDataUrl = metadata.previewDataUrl;
  if (typeof previewDataUrl === "string" && isPersistableInlinePreviewDataUrl(previewDataUrl)) return previewDataUrl;

  const previewBlobRaw = metadata.previewBlob;
  if (typeof previewBlobRaw === "string") {
    const previewBlob = normalizePreviewBlobKey(previewBlobRaw);
    if (previewBlob) return previewBlobUrl(previewBlob);
  }

  const previewUrlRaw = metadata.previewUrl;
  if (typeof previewUrlRaw === "string" && previewUrlRaw.length > 0) {
    const previewUrl = normalizePollinationsPreviewUrl(previewUrlRaw);
    if (isPollinationsPreviewUrl(previewUrl)) {
      return suppressedPreviewDataUrl(metadata, "Remote preview source disabled");
    }
    return previewUrl;
  }

  const outputUrlRaw = metadata.outputUrl;
  if (typeof outputUrlRaw === "string" && outputUrlRaw.length > 0) {
    const outputUrl = normalizePollinationsPreviewUrl(outputUrlRaw);
    if (isPollinationsPreviewUrl(outputUrl)) {
      return suppressedPreviewDataUrl(metadata, "Remote preview source disabled");
    }
    return outputUrl;
  }

  const recovered = recoverLegacyPreviewDataUrl(metadata);
  if (recovered) return recovered;
  return null;
}

function recoverLegacyPreviewDataUrl(metadata: PreviewMetadata): string | null {
  const wasDropped = metadata.inlinePreviewDropped === true;
  if (!wasDropped) return null;
  return suppressedPreviewDataUrl(metadata, "Legacy preview compacted");
}
