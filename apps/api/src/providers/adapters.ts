import { nanoid } from "nanoid";
import type { GenerationRequest, GenerationResult, ProviderAdapter } from "@aidrive/shared";
import type { Env } from "../config/env.js";

function normalizedAspectRatio(aspectRatio: string | undefined): string {
  return /^\d+:\d+$/.test(aspectRatio ?? "") ? String(aspectRatio) : "1:1";
}

function parseAspectRatio(aspectRatio: string | undefined): number {
  if (!/^\d+:\d+$/.test(aspectRatio ?? "")) return 1;
  const [w, h] = String(aspectRatio).split(":").map(Number);
  if (!w || !h) return 1;
  return w / h;
}

function isSvgDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:image/svg+xml;");
}

function wrapImageInAspectRatio(dataUrl: string, aspectRatio: string): string {
  const [w, h] = aspectRatio.split(":").map(Number);
  const width = Number.isFinite(w) && w > 0 ? w : 1;
  const height = Number.isFinite(h) && h > 0 ? h : 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-aidrive-keep-ratio="1" width="${width * 1000}" height="${height * 1000}" viewBox="0 0 ${width * 1000} ${height * 1000}"><image href="${dataUrl}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function fallbackPreviewDataUrl(aspectRatio: string, reason: string): string {
  const [w, h] = aspectRatio.split(":").map(Number);
  const width = Number.isFinite(w) && w > 0 ? w : 1;
  const height = Number.isFinite(h) && h > 0 ? h : 1;
  const detail = reason.trim().slice(0, 80).replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 1000}" height="${height * 1000}" viewBox="0 0 ${width * 1000} ${height * 1000}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#151f35"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><text x="50%" y="48%" text-anchor="middle" fill="#eff3ff" font-family="Arial, sans-serif" font-size="${Math.max(32, Math.round(Math.min(width, height) * 65))}" font-weight="700">Preview unavailable</text><text x="50%" y="58%" text-anchor="middle" fill="#b8c4dd" font-family="Arial, sans-serif" font-size="${Math.max(18, Math.round(Math.min(width, height) * 28))}">${detail || "generation fallback"}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function detectWebpRatio(bytes: Buffer): number | null {
  if (bytes.length < 30) return null;
  if (bytes.toString("ascii", 0, 4) !== "RIFF") return null;
  if (bytes.toString("ascii", 8, 12) !== "WEBP") return null;

  function readVp8X(offset: number): number | null {
    if (offset + 18 > bytes.length) return null;
    const width = 1 + bytes.readUIntLE(offset + 12, 3);
    const height = 1 + bytes.readUIntLE(offset + 15, 3);
    if (!width || !height) return null;
    return width / height;
  }

  function readVp8L(offset: number): number | null {
    if (offset + 13 > bytes.length) return null;
    if (bytes[offset + 8] !== 0x2f) return null;
    const b0 = bytes[offset + 9];
    const b1 = bytes[offset + 10];
    const b2 = bytes[offset + 11];
    const b3 = bytes[offset + 12];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (!width || !height) return null;
    return width / height;
  }

  function readVp8(offset: number): number | null {
    if (offset + 30 > bytes.length) return null;
    const width = bytes.readUInt16LE(offset + 26) & 0x3fff;
    const height = bytes.readUInt16LE(offset + 28) & 0x3fff;
    if (!width || !height) return null;
    return width / height;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (chunkType === "VP8X") return readVp8X(offset);
    if (chunkType === "VP8L") return readVp8L(offset);
    if (chunkType === "VP8 ") return readVp8(offset);
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return null;
}

function detectDataUrlRatio(dataUrl: string): number | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], "base64");

  if (mimeType.includes("png")) {
    if (bytes.length < 24) return null;
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!width || !height) return null;
    return width / height;
  }

  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      const isSof =
        marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
        marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 ||
        marker === 0xca || marker === 0xcb || marker === 0xcd || marker === 0xce || marker === 0xcf;
      if (isSof) {
        const height = bytes.readUInt16BE(offset + 5);
        const width = bytes.readUInt16BE(offset + 7);
        if (!width || !height) return null;
        return width / height;
      }
      offset += 2 + length;
    }
  }

  if (mimeType.includes("webp")) {
    return detectWebpRatio(bytes);
  }

  return null;
}

function isAspectRatioSatisfied(aspectRatio: string | undefined, dataUrl: string): boolean {
  const requested = parseAspectRatio(aspectRatio);
  const actual = detectDataUrlRatio(dataUrl);
  if (!actual) return false;
  return Math.abs(actual - requested) <= 0.03;
}

const MAX_REFERENCE_IMAGES = 3;

function extractReferenceImageParts(settings: Record<string, string | number | boolean>): Array<{
  inlineData: { mimeType: string; data: string };
}> {
  const candidates = Object.entries(settings)
    .filter(([key, value]) => key.startsWith("referenceImageDataUrl") && typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_REFERENCE_IMAGES);

  const parts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const [, raw] of candidates) {
    if (typeof raw !== "string") continue;
    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) continue;
    parts.push({
      inlineData: {
        mimeType: match[1],
        data: match[2]
      }
    });
  }

  return parts;
}

type GeminiImageModel = "gemini-2.5-flash-image" | "gemini-3-pro-image-preview";

const geminiImageModelCapabilities: Record<GeminiImageModel, { supportsImageSize: boolean }> = {
  "gemini-2.5-flash-image": { supportsImageSize: false },
  "gemini-3-pro-image-preview": { supportsImageSize: true }
};

function imageModelForRequest(request: GenerationRequest): GeminiImageModel {
  const model = request.model.toLowerCase();
  if (model.includes("nano banana pro")) return "gemini-3-pro-image-preview";
  if (model.includes("a2e")) return "gemini-3-pro-image-preview";
  if (model.includes("nano banana")) return "gemini-2.5-flash-image";
  // "Gemini 2.0 flash" in this app maps to the currently supported image model.
  return "gemini-2.5-flash-image";
}

async function generateGeminiImageDataUrl(apiKey: string, request: GenerationRequest): Promise<string> {
  const modelName = imageModelForRequest(request);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const aspectRatio = typeof request.settings.aspectRatio === "string" ? request.settings.aspectRatio : "1:1";
  const requestedSize = typeof request.settings.resolution === "string" ? request.settings.resolution : "1K";
  const imageSize = requestedSize === "4K" ? "4K" : requestedSize === "2K" ? "2K" : "1K";
  const capabilities = geminiImageModelCapabilities[modelName];
  const prompt = `${request.prompt}\n\nGenerate a photorealistic image. Aspect ratio: ${aspectRatio}.`;
  const referenceParts = extractReferenceImageParts(request.settings);

  async function submit(body: unknown): Promise<string> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini image request failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
            inline_data?: { mime_type?: string; data?: string };
          }>;
        };
      }>;
    };

    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData?.data ?? part.inline_data?.data;
      const mimeType = part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? "image/png";
      if (data) {
        return `data:${mimeType};base64,${data}`;
      }
    }

    throw new Error("Gemini image response did not include inline image data");
  }

  try {
    const imageConfig: { aspectRatio: string; imageSize?: "1K" | "2K" | "4K" } = { aspectRatio };
    if (capabilities.supportsImageSize) {
      imageConfig.imageSize = imageSize;
    }
    return await submit({
      contents: [{ parts: [...referenceParts, { text: prompt }] }],
      generationConfig: {
        imageConfig
      }
    });
  } catch (primaryError) {
    try {
      // Compatibility fallback for models that reject imageConfig.
      return await submit({
        contents: [{ parts: [...referenceParts, { text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      });
    } catch (secondaryError) {
      const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const secondary = secondaryError instanceof Error ? secondaryError.message : String(secondaryError);
      throw new Error(`Gemini image attempts failed. Primary: ${primary}. Secondary: ${secondary}`);
    }
  }
}

class MockProviderAdapter implements ProviderAdapter {
  constructor(readonly key: string, readonly supports: string[]) {}

  async submit(request: GenerationRequest): Promise<GenerationResult> {
    await new Promise((resolve) => setTimeout(resolve, 1200));

    if (request.type === "IMAGE") {
      const aspectRatio = normalizedAspectRatio(
        typeof request.settings.aspectRatio === "string" ? request.settings.aspectRatio : "1:1"
      );
      const previewDataUrl = fallbackPreviewDataUrl(aspectRatio, `${this.key.toUpperCase()} mock image`);
      return {
        outputMimeType: "image/png",
        outputBytes: previewDataUrl.length,
        providerJobId: `${this.key}-${nanoid(12)}`,
        providerMetadata: {
          model: request.model,
          safety: true,
          promptLength: request.prompt.length,
          mode: "mock-inline-preview",
          previewDataUrl
        },
        storageKey: `generated/${request.workspaceId}/${nanoid()}.png`,
        checksum: nanoid(20)
      };
    }

    return {
      outputMimeType: "video/mp4",
      outputBytes: 5_000_000,
      providerJobId: `${this.key}-${nanoid(12)}`,
      providerMetadata: {
        model: request.model,
        safety: true,
        promptLength: request.prompt.length,
        mode: "mock-video"
      },
      storageKey: `generated/${request.workspaceId}/${nanoid()}.mp4`,
      checksum: nanoid(20)
    };
  }
}

class GeminiAdapter implements ProviderAdapter {
  readonly key = "gemini";
  readonly supports = ["Gemini 2.0 flash", "nano banana pro", "nano banana", "A2E Image generator"];

  constructor(private readonly apiKey?: string) {}

  async submit(request: GenerationRequest): Promise<GenerationResult> {
    if (request.type === "IMAGE") {
      if (!this.apiKey) {
        throw new Error("Missing GEMINI_API_KEY for image generation");
      }

      const requestedAspectRatio = normalizedAspectRatio(
        typeof request.settings.aspectRatio === "string" ? request.settings.aspectRatio : "1:1"
      );
      const needsStrictRatio = requestedAspectRatio !== "1:1";
      const attempts = needsStrictRatio ? 3 : 1;

      let previewDataUrl: string | null = null;
      let lastGeminiError: string | null = null;
      let ratioMismatch = false;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const candidate = await generateGeminiImageDataUrl(this.apiKey, request);
          if (!needsStrictRatio || isAspectRatioSatisfied(requestedAspectRatio, candidate)) {
            previewDataUrl = candidate;
            ratioMismatch = false;
            break;
          }
          if (!previewDataUrl) {
            previewDataUrl = candidate;
            ratioMismatch = true;
          }
        } catch (error) {
          lastGeminiError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!previewDataUrl) {
        const detail = lastGeminiError ? ` Gemini: ${lastGeminiError}` : "";
        throw new Error(`Could not produce requested aspect ratio (${requestedAspectRatio}).${detail}`);
      }
      if (needsStrictRatio && !isSvgDataUrl(previewDataUrl) && !isAspectRatioSatisfied(requestedAspectRatio, previewDataUrl)) {
        previewDataUrl = wrapImageInAspectRatio(previewDataUrl, requestedAspectRatio);
        ratioMismatch = true;
      }

      return {
        outputMimeType: "image/png",
        outputBytes: previewDataUrl.length,
        providerJobId: `gemini-${nanoid(12)}`,
        providerMetadata: {
          model: request.model,
          mode: "gemini-image-inline",
          referenceImageCount: extractReferenceImageParts(request.settings).length,
          previewDataUrl,
          ratioMismatch
        },
        storageKey: `generated/${request.workspaceId}/${nanoid()}.png`,
        checksum: nanoid(20)
      };
    }

    if (!this.apiKey) {
      return new MockProviderAdapter(this.key, this.supports).submit(request);
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: request.prompt }] }],
        generationConfig: {
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini request failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "Generated content";

    return {
      outputMimeType: "text/plain",
      outputBytes: text.length,
      providerJobId: `gemini-${nanoid(12)}`,
      providerMetadata: {
        model: request.model,
        mode: "api-text",
        contentPreview: text.slice(0, 120)
      },
      storageKey: `generated/${request.workspaceId}/${nanoid()}.txt`,
      checksum: nanoid(20)
    };
  }
}

export function createAdapters(env: Env): ProviderAdapter[] {
  return [
    new GeminiAdapter(env.GEMINI_API_KEY),
    new MockProviderAdapter("openai", ["ChatGPT image generator"]),
    new MockProviderAdapter("xai", ["Grock image generator"]),
    new MockProviderAdapter("kling", ["Kling 3.0", "Kling 2.6"])
  ];
}
