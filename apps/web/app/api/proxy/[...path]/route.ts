import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const DEFAULT_TARGETS = ["http://127.0.0.1:4100", "http://127.0.0.1:4000"];

type LocalFolder = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
};

type LocalAsset = {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  tags: string[];
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
  previewUrl?: string;
  aspectRatio?: string;
  resolution?: string;
};

type LocalJob = {
  id: string;
  workspaceId: string;
  createdBy: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  request: {
    workspaceId: string;
    folderId?: string;
    prompt: string;
    model: string;
    type: "IMAGE" | "VIDEO";
    settings: Record<string, string | number | boolean>;
  };
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type LocalVersion = {
  id: string;
  assetId: string;
  version: number;
  source: "GENERATE";
  storageKey: string;
  checksum: string;
  metadata: Record<string, string | number | boolean | null>;
  createdBy: string;
  createdAt: string;
};

const localStore: {
  seeded: boolean;
  folders: LocalFolder[];
  assets: LocalAsset[];
  jobs: LocalJob[];
  versions: LocalVersion[];
} = {
  seeded: false,
  folders: [],
  assets: [],
  jobs: [],
  versions: []
};

function nowIso(): string {
  return new Date().toISOString();
}

function ensureSeeded(): void {
  if (localStore.seeded) return;
  localStore.seeded = true;
  for (let i = 1; i <= 8; i += 1) {
    localStore.folders.push({
      id: randomUUID(),
      workspaceId: "ws_demo",
      parentId: null,
      name: `Sample Project ${String(i).padStart(2, "0")}`,
      deletedAt: null,
      createdBy: "user_demo",
      createdAt: nowIso()
    });
  }
}

function aspectToSize(aspectRatio: string, resolution: string): { width: number; height: number } {
  const base = resolution === "4K" ? 3072 : resolution === "2K" ? 2048 : 1024;
  const match = aspectRatio.match(/^(\d+):(\d+)$/);
  if (!match) return { width: base, height: base };
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return { width: base, height: base };
  if (w >= h) return { width: base, height: Math.max(256, Math.round((base * h) / w)) };
  return { width: Math.max(256, Math.round((base * w) / h)), height: base };
}

function imageModelForPrompt(model: string): string {
  const key = model.toLowerCase();
  if (key.includes("nano banana")) return "gemini-2.5-flash-image";
  return "gemini-2.0-flash-preview-image-generation";
}

function requiresGemini(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("gemini") || m.includes("nano banana") || m.includes("a2e");
}

async function tryGeminiDataUrl(prompt: string, model: string, aspectRatio: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${imageModelForPrompt(model)}:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}\n\nGenerate a photorealistic image. Aspect ratio: ${aspectRatio}.` }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    })
  });

  if (!response.ok) return null;

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

  return null;
}

function parseJsonBody(body: ArrayBuffer | undefined): any {
  if (!body) return {};
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return {};
  }
}

function localFallback(
  method: string,
  path: string[],
  body: ArrayBuffer | undefined
): NextResponse | null {
  ensureSeeded();

  const json = parseJsonBody(body);

  if (method === "GET" && path[0] === "v1" && path[1] === "drive" && path[2] === "folders" && path[3]) {
    const workspaceId = path[3];
    return NextResponse.json({
      folders: localStore.folders.filter((f) => f.workspaceId === workspaceId && !f.deletedAt)
    });
  }

  if (method === "POST" && path[0] === "v1" && path[1] === "drive" && path[2] === "folders") {
    const folder: LocalFolder = {
      id: randomUUID(),
      workspaceId: String(json.workspaceId ?? "ws_demo"),
      parentId: json.parentId ?? null,
      name: String(json.name ?? "Untitled Project"),
      deletedAt: null,
      createdBy: "user_demo",
      createdAt: nowIso()
    };
    localStore.folders.push(folder);
    return NextResponse.json({ folder }, { status: 201 });
  }

  if (method === "GET" && path[0] === "v1" && path[1] === "drive" && path[2] === "assets" && path[3]) {
    const workspaceId = path[3];
    const assets = localStore.assets.filter((a) => a.workspaceId === workspaceId && !a.deletedAt);
    const previews: Record<string, string> = {};
    const aspectRatios: Record<string, string> = {};
    const resolutions: Record<string, string> = {};
    for (const asset of assets) {
      if (asset.previewUrl) previews[asset.id] = asset.previewUrl;
      if (asset.aspectRatio) aspectRatios[asset.id] = asset.aspectRatio;
      if (asset.resolution) resolutions[asset.id] = asset.resolution;
    }
    return NextResponse.json({ assets, previews, aspectRatios, resolutions });
  }

  if (method === "GET" && path[0] === "v1" && path[1] === "generation" && path[2] === "jobs" && path[3]) {
    const workspaceId = path[3];
    return NextResponse.json({ jobs: localStore.jobs.filter((j) => j.workspaceId === workspaceId) });
  }

  if (method === "POST" && path[0] === "v1" && path[1] === "generation" && path[2] === "jobs") {
    const workspaceId = String(json.workspaceId ?? "ws_demo");
    const folderId = typeof json.folderId === "string" ? json.folderId : undefined;
    const prompt = String(json.prompt ?? "");
    const model = String(json.model ?? "Gemini 2.0 flash");
    const type = (json.type === "VIDEO" ? "VIDEO" : "IMAGE") as "IMAGE" | "VIDEO";
    const settings = (json.settings ?? {}) as Record<string, string | number | boolean>;
    const aspectRatio = typeof settings.aspectRatio === "string" ? settings.aspectRatio : "1:1";
    const resolution = typeof settings.resolution === "string" ? settings.resolution : "1K";
    if (type === "IMAGE" && requiresGemini(model) && !process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY for image generation in fallback mode" },
        { status: 400 }
      );
    }

    const job: LocalJob = {
      id: randomUUID(),
      workspaceId,
      createdBy: "user_demo",
      status: "QUEUED",
      request: { workspaceId, folderId, prompt, model, type, settings },
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    localStore.jobs.unshift(job);

    setTimeout(() => {
      void (async () => {
        try {
          job.status = "SUCCEEDED";
          job.updatedAt = nowIso();
          if (folderId && type === "IMAGE") {
            const assetId = randomUUID();
            const previewUrl = await tryGeminiDataUrl(prompt, model, aspectRatio);
            if (!previewUrl) {
              job.status = "FAILED";
              job.error = "Gemini image generation failed";
              job.updatedAt = nowIso();
              return;
            }
            localStore.assets.unshift({
              id: assetId,
              workspaceId,
              folderId,
              name: `generated-${Date.now()}.png`,
              mimeType: "image/png",
              tags: ["generated", model],
              deletedAt: null,
              createdBy: "user_demo",
              createdAt: nowIso(),
              previewUrl,
              aspectRatio,
              resolution
            });
            localStore.versions.unshift({
              id: randomUUID(),
              assetId,
              version: 1,
              source: "GENERATE",
              storageKey: `generated/local/${assetId}.png`,
              checksum: randomUUID().replaceAll("-", ""),
              metadata: {
                prompt,
                model,
                aspectRatio,
                resolution,
                quality: resolution,
                previewUrl
              },
              createdBy: "user_demo",
              createdAt: nowIso()
            });
          }
        } catch (error) {
          job.status = "FAILED";
          job.error = error instanceof Error ? error.message : "Generation failed";
          job.updatedAt = nowIso();
        }
      })();
    }, 1200);

    return NextResponse.json({ job }, { status: 202 });
  }

  if (method === "GET" && path[0] === "v1" && path[1] === "versions" && path[2]) {
    const assetId = path[2];
    const versions = localStore.versions
      .filter((v) => v.assetId === assetId)
      .sort((a, b) => b.version - a.version);
    return NextResponse.json({ versions });
  }

  return null;
}

function targetBaseUrls(): string[] {
  const fromEnv = process.env.API_PROXY_TARGETS;
  if (!fromEnv) return DEFAULT_TARGETS;
  return fromEnv
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function forward(request: NextRequest, path: string[]): Promise<NextResponse> {
  const qs = request.nextUrl.search || "";
  const suffix = `/${path.join("/")}${qs}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  if (!headers.has("x-user-id")) {
    headers.set("x-user-id", "user_demo");
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let lastError: unknown = null;

  for (const base of targetBaseUrls()) {
    try {
      const upstream = await fetch(`${base}${suffix}`, {
        method,
        headers,
        body,
        redirect: "manual"
      });

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      responseHeaders.delete("transfer-encoding");

      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: responseHeaders
      });
    } catch (error) {
      lastError = error;
    }
  }

  const fallback = localFallback(method, path, body);
  if (fallback) {
    return fallback;
  }

  return NextResponse.json(
    {
      error: "API upstream unavailable",
      details: lastError instanceof Error ? lastError.message : "Unknown error"
    },
    { status: 503 }
  );
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}
