import { nanoid } from "nanoid";
import type { GenerationRequest, GenerationResult, ProviderAdapter } from "@aidrive/shared";
import type { Env } from "../config/env.js";

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash || Date.now();
}

function aspectToDimensions(aspectRatio: string | undefined, resolution: string | undefined): { width: number; height: number } {
  const base = resolution === "4K" ? 3072 : resolution === "2K" ? 2048 : 1024;
  const ratio = /^\d+:\d+$/.test(aspectRatio ?? "") ? (aspectRatio as string) : "1:1";
  const [w, h] = ratio.split(":").map(Number);

  if (!w || !h) {
    return { width: base, height: base };
  }

  if (w >= h) {
    return { width: base, height: Math.max(256, Math.round((base * h) / w)) };
  }

  return { width: Math.max(256, Math.round((base * w) / h)), height: base };
}

function generatedImageUrl(request: GenerationRequest): string {
  const resolution = typeof request.settings.resolution === "string" ? request.settings.resolution : "1K";
  const aspectRatio = typeof request.settings.aspectRatio === "string" ? request.settings.aspectRatio : "1:1";
  const { width, height } = aspectToDimensions(aspectRatio, resolution);
  const seed = hashSeed(`${request.prompt}:${request.model}:${Date.now()}`);
  const prompt = encodeURIComponent(request.prompt);
  return `https://image.pollinations.ai/p/${prompt}?seed=${seed}&width=${width}&height=${height}&nologo=true`;
}

function imageModelForRequest(request: GenerationRequest): string {
  const model = request.model.toLowerCase();
  if (model.includes("nano banana pro")) return "gemini-2.5-flash-image";
  if (model.includes("nano banana")) return "gemini-2.5-flash-image";
  if (model.includes("a2e")) return "gemini-2.5-flash-image";
  return "gemini-2.5-flash-image";
}

async function generateGeminiImageDataUrl(apiKey: string, request: GenerationRequest): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${imageModelForRequest(request)}:generateContent?key=${apiKey}`;
  const aspectRatio = typeof request.settings.aspectRatio === "string" ? request.settings.aspectRatio : "1:1";
  const prompt = `${request.prompt}\n\nGenerate a photorealistic image. Aspect ratio: ${aspectRatio}.`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    })
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

class MockProviderAdapter implements ProviderAdapter {
  constructor(readonly key: string, readonly supports: string[]) {}

  async submit(request: GenerationRequest): Promise<GenerationResult> {
    await new Promise((resolve) => setTimeout(resolve, 1200));

    if (request.type === "IMAGE") {
      const previewUrl = generatedImageUrl(request);
      return {
        outputMimeType: "image/png",
        outputBytes: 1_200_000,
        providerJobId: `${this.key}-${nanoid(12)}`,
        providerMetadata: {
          model: request.model,
          safety: true,
          promptLength: request.prompt.length,
          mode: "generated-preview-url",
          previewUrl
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

      const previewDataUrl = await generateGeminiImageDataUrl(this.apiKey, request);
      return {
        outputMimeType: "image/png",
        outputBytes: previewDataUrl.length,
        providerJobId: `gemini-${nanoid(12)}`,
        providerMetadata: {
          model: request.model,
          mode: "gemini-image-inline",
          previewDataUrl
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
