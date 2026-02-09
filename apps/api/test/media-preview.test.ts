import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  readPreviewBlob,
  resolvePreviewFromMetadata,
  sanitizeInlinePreviewMetadata
} from "../src/lib/media-preview.js";
import { resolveApiDataPath } from "../src/lib/data-paths.js";

const PREVIEW_DIR = resolveApiDataPath("previews");

function removePreviewBlobIfPresent(blobKey: string | undefined): void {
  if (!blobKey) return;
  const filePath = path.join(PREVIEW_DIR, blobKey);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup for test artifacts.
  }
}

describe("media preview safeguards", () => {
  it("suppresses pollinations preview URLs when no inline preview exists", () => {
    const metadata: Record<string, string | number | boolean | null | undefined> = {
      prompt: "Silly dogs",
      aspectRatio: "1:1",
      resolution: "1K",
      previewUrl: "https://image.pollinations.ai/prompt/silly%20dogs?seed=1&width=1024&height=1024"
    };

    sanitizeInlinePreviewMetadata(metadata);

    expect(metadata.remotePreviewSuppressed).toBe(true);
    expect(typeof metadata.previewUrl === "string" && metadata.previewUrl.includes("pollinations.ai")).toBe(false);
    const resolved = resolvePreviewFromMetadata(metadata);
    expect(typeof resolved).toBe("string");
    expect(String(resolved).startsWith("data:image/svg+xml;")).toBe(true);
    expect(decodeURIComponent(String(resolved))).toContain("Preview unavailable");
  });

  it("externalizes oversized inline preview data into preview blobs", () => {
    const hugePreviewDataUrl = `data:image/png;base64,${Buffer.alloc(40_000, 9).toString("base64")}`;
    const metadata: Record<string, string | number | boolean | null | undefined> = {
      prompt: "Externalize preview",
      aspectRatio: "1:1",
      resolution: "1K",
      previewDataUrl: hugePreviewDataUrl
    };

    sanitizeInlinePreviewMetadata(metadata);

    const previewBlob = typeof metadata.previewBlob === "string" ? metadata.previewBlob : undefined;
    expect(previewBlob).toBeTruthy();
    expect(metadata.inlinePreviewExternalized).toBe(true);
    expect(metadata.previewDataUrl).toBeUndefined();
    expect(String(metadata.previewUrl ?? "")).toMatch(/^\/v1\/previews\/[a-f0-9]{40}\.[a-z0-9]+$/i);

    const blob = readPreviewBlob(String(previewBlob));
    expect(blob).not.toBeNull();
    expect(String(blob?.contentType ?? "")).toContain("image/");
    expect((blob?.bytes.length ?? 0) > 0).toBe(true);

    removePreviewBlobIfPresent(previewBlob);
  });

  it("externalizes raster inline previews even when small", () => {
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
    const metadata: Record<string, string | number | boolean | null | undefined> = {
      prompt: "tiny png",
      previewDataUrl: tinyPng
    };

    sanitizeInlinePreviewMetadata(metadata);
    const previewBlob = typeof metadata.previewBlob === "string" ? metadata.previewBlob : undefined;
    expect(previewBlob).toBeTruthy();
    expect(metadata.previewDataUrl).toBeUndefined();
    expect(String(metadata.previewUrl ?? "")).toMatch(/^\/v1\/previews\/[a-f0-9]{40}\.[a-z0-9]+$/i);

    removePreviewBlobIfPresent(previewBlob);
  });

  it("extracts and externalizes raster images embedded in oversized SVG wrappers", () => {
    const hugeRasterDataUrl = `data:image/png;base64,${Buffer.alloc(40_000, 6).toString("base64")}`;
    const wrappedSvg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1024\" height=\"1024\"><image href=\"${hugeRasterDataUrl}\" width=\"100%\" height=\"100%\"/></svg>`;
    const wrappedDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(wrappedSvg)}`;
    const metadata: Record<string, string | number | boolean | null | undefined> = {
      prompt: "wrapped raster",
      aspectRatio: "1:1",
      resolution: "1K",
      previewDataUrl: wrappedDataUrl
    };

    sanitizeInlinePreviewMetadata(metadata);
    const previewBlob = typeof metadata.previewBlob === "string" ? metadata.previewBlob : undefined;
    expect(previewBlob).toBeTruthy();
    expect(metadata.inlinePreviewExternalized).toBe(true);
    expect(metadata.inlinePreviewEmbeddedImage).toBe(true);
    expect(metadata.previewDataUrl).toBeUndefined();
    expect(String(metadata.previewUrl ?? "")).toMatch(/^\/v1\/previews\/[a-f0-9]{40}\.[a-z0-9]+$/i);

    const blob = readPreviewBlob(String(previewBlob));
    expect(blob).not.toBeNull();
    expect(String(blob?.contentType ?? "")).toContain("image/");
    expect((blob?.bytes.length ?? 0) > 0).toBe(true);

    removePreviewBlobIfPresent(previewBlob);
  });

  it("resolves local preview blob routes ahead of other URLs", () => {
    const metadata: Record<string, string | number | boolean | null | undefined> = {
      prompt: "Blob priority",
      previewBlob: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      previewUrl: "https://example.com/preview.png"
    };

    const resolved = resolvePreviewFromMetadata(metadata);
    expect(resolved).toBe("/v1/previews/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");
  });
});
