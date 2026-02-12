import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { createServerTraceId, emitServerDiagnostic } from "../../../../lib/diagnostics-server";

export const runtime = "nodejs";

const DEFAULT_TARGETS = ["http://127.0.0.1:4100", "http://127.0.0.1:4000"];
const PROXY_FORWARD_TIMEOUT_MS = Math.max(1_000, Number(process.env.AIDRIVE_PROXY_TIMEOUT_MS ?? 12_000));
const PROXY_FAILOVER_WINDOW_MS = 5 * 60 * 1000;
const TRACE_HEADER_NAME = "x-aidrive-trace-id";

const proxyRouteWindow = new Map<string, { requestTimestamps: number[]; recoveredTimestamps: number[] }>();

function routeWindow(route: string): { requestTimestamps: number[]; recoveredTimestamps: number[] } {
  let current = proxyRouteWindow.get(route);
  if (current) return current;
  current = { requestTimestamps: [], recoveredTimestamps: [] };
  proxyRouteWindow.set(route, current);
  return current;
}

function pruneWindow(values: number[], nowMs: number): number[] {
  return values.filter((ts) => nowMs - ts <= PROXY_FAILOVER_WINDOW_MS);
}

function markProxyRouteObservation(route: string, recovered: boolean): {
  requestCountWindow: number;
  recoveredCountWindow: number;
  failoverRateWindow: number;
} {
  const nowMs = Date.now();
  const current = routeWindow(route);
  current.requestTimestamps = pruneWindow([...current.requestTimestamps, nowMs], nowMs);
  current.recoveredTimestamps = pruneWindow(
    recovered ? [...current.recoveredTimestamps, nowMs] : current.recoveredTimestamps,
    nowMs
  );
  const requestCountWindow = current.requestTimestamps.length;
  const recoveredCountWindow = current.recoveredTimestamps.length;
  const failoverRateWindow = requestCountWindow > 0 ? recoveredCountWindow / requestCountWindow : 0;
  return {
    requestCountWindow,
    recoveredCountWindow,
    failoverRateWindow: Number(failoverRateWindow.toFixed(4))
  };
}

function proxyFallbackEnabled(): boolean {
  const raw = process.env.AIDRIVE_ENABLE_PROXY_FALLBACK;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const normalized = raw.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return process.env.NODE_ENV !== "production";
}

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
  folderLayouts: Record<string, string[]>;
  workspaceFolderOrder: Record<string, string[]>;
  assets: LocalAsset[];
  jobs: LocalJob[];
  versions: LocalVersion[];
} = {
  seeded: false,
  folders: [],
  folderLayouts: {},
  workspaceFolderOrder: {},
  assets: [],
  jobs: [],
  versions: []
};

function nowIso(): string {
  return new Date().toISOString();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function folderNamePrefix(folderId: string): string {
  const folder = localStore.folders.find((item) => item.id === folderId);
  const raw = (folder?.name ?? "image")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw.length > 0 ? raw : "image";
}

function nextFolderAssetName(folderId: string, extension: string): string {
  const prefix = folderNamePrefix(folderId);
  const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)(?:\\.[A-Za-z0-9]+)?$`, "i");
  let max = 0;
  for (const asset of localStore.assets) {
    if (asset.folderId !== folderId) continue;
    const base = asset.name.replace(/\.[A-Za-z0-9]+$/, "");
    const match = base.match(pattern);
    if (!match) continue;
    const seq = Number.parseInt(match[1], 10);
    if (Number.isFinite(seq) && seq > max) {
      max = seq;
    }
  }
  const next = String(max + 1).padStart(4, "0");
  return `${prefix}-${next}.${extension}`;
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

function parseAspectRatio(aspectRatio: string): number {
  const match = aspectRatio.match(/^(\d+):(\d+)$/);
  if (!match) return 1;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return 1;
  return w / h;
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

function isAspectRatioSatisfied(aspectRatio: string, dataUrl: string): boolean {
  const requested = parseAspectRatio(aspectRatio);
  const actual = detectDataUrlRatio(dataUrl);
  if (!actual) return false;
  return Math.abs(actual - requested) <= 0.03;
}

function createFailurePreviewDataUrl(aspectRatio: string, message: string): string {
  const { width, height } = aspectToSize(aspectRatio, "1K");
  const detail = message.replace(/\s+/g, " ").trim().slice(0, 80).replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2b1d33"/><stop offset="100%" stop-color="#1b2234"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.14)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.72)}" rx="${Math.max(18, Math.round(Math.min(width, height) * 0.04))}" fill="rgba(9,11,20,0.6)" stroke="rgba(255,142,170,0.44)" stroke-width="2"/><text x="50%" y="47%" text-anchor="middle" fill="#ffe6ee" font-family="Arial, sans-serif" font-size="${Math.max(28, Math.round(Math.min(width, height) * 0.065))}" font-weight="700">Failed</text><text x="50%" y="60%" text-anchor="middle" fill="#e8d7e4" font-family="Arial, sans-serif" font-size="${Math.max(15, Math.round(Math.min(width, height) * 0.032))}">${detail || "Generation failed"}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function estimateLocalReservedCredits(job: LocalJob): number {
  const base = job.request.type === "VIDEO" ? 20 : 4;
  const qualityMultiplier = typeof job.request.settings.quality === "number" ? Number(job.request.settings.quality) : 1;
  return Math.max(1, Math.ceil(base * qualityMultiplier));
}

function localFinalizedJobSpend(job: LocalJob): number {
  if (job.status !== "SUCCEEDED") return 0;
  const reserved = estimateLocalReservedCredits(job);
  return Math.max(1, Math.floor(reserved * 0.9));
}

function localUsdCentsPerCredit(): number {
  const raw = Number(process.env.AIDRIVE_CREDIT_USD_CENTS ?? 1);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.trunc(raw);
}

function toUsdCents(credits: number, usdCentsPerCredit: number): number {
  if (!Number.isFinite(credits) || !Number.isFinite(usdCentsPerCredit)) return 0;
  return Math.max(0, Math.trunc(credits) * Math.trunc(usdCentsPerCredit));
}

function createLocalFailedAsset(params: {
  workspaceId: string;
  folderId: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  jobId: string;
  error: string;
}): void {
  const assetId = randomUUID();
  const previewUrl = createFailurePreviewDataUrl(params.aspectRatio, params.error);
  localStore.assets.unshift({
    id: assetId,
    workspaceId: params.workspaceId,
    folderId: params.folderId,
    name: nextFolderAssetName(params.folderId, "png"),
    mimeType: "image/png",
    tags: ["generated", "failed", params.model, `job:${params.jobId}`],
    deletedAt: null,
    createdBy: "user_demo",
    createdAt: nowIso(),
    previewUrl,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution
  });
  localStore.folderLayouts[params.folderId] = [
    assetId,
    ...(localStore.folderLayouts[params.folderId] ?? []).filter((id) => id !== assetId)
  ];
  localStore.versions.unshift({
    id: randomUUID(),
    assetId,
    version: 1,
    source: "GENERATE",
    storageKey: `failed/local/${assetId}.png`,
    checksum: randomUUID().replaceAll("-", ""),
    metadata: {
      prompt: params.prompt,
      model: params.model,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      quality: params.resolution,
      failed: true,
      generationJobId: params.jobId,
      failureMessage: params.error,
      previewDataUrl: previewUrl
    },
    createdBy: "user_demo",
    createdAt: nowIso()
  });
}

function imageModelForPrompt(model: string): string {
  const key = model.toLowerCase();
  if (key.includes("nano banana pro")) return "gemini-3-pro-image-preview";
  if (key.includes("nano banana")) return "gemini-2.5-flash-image";
  return "gemini-2.5-flash-image";
}

async function tryGeminiDataUrl(prompt: string, model: string, aspectRatio: string): Promise<string | null> {
  if (model.toLowerCase().includes("a2e")) return null;
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

function decodeInlineImageDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } | null {
  if (dataUrl.startsWith("data:image/svg+xml;utf8,")) {
    const encoded = dataUrl.slice("data:image/svg+xml;utf8,".length);
    try {
      return {
        contentType: "image/svg+xml",
        bytes: Buffer.from(decodeURIComponent(encoded), "utf8")
      };
    } catch {
      return null;
    }
  }

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0) return null;
    return {
      contentType: match[1].toLowerCase(),
      bytes
    };
  } catch {
    return null;
  }
}

function previewBlobFromStorageKey(storageKey: string): string | null {
  const match = storageKey.match(/^previews\/([a-f0-9]{40}\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function readLocalPreviewBlob(blobKey: string): { contentType: string; bytes: Buffer } | null {
  if (!/^[a-f0-9]{40}\.[a-z0-9]+$/i.test(blobKey)) return null;
  const extension = blobKey.split(".").pop()?.toLowerCase() ?? "";
  const contentType = extension === "png"
    ? "image/png"
    : extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "webp"
        ? "image/webp"
        : extension === "avif"
          ? "image/avif"
          : extension === "gif"
            ? "image/gif"
            : extension === "svg"
              ? "image/svg+xml"
              : "application/octet-stream";
  const candidates = [
    path.join(process.cwd(), "apps", "api", ".data", "previews", blobKey),
    path.join(process.cwd(), ".data", "previews", blobKey)
  ];
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const bytes = fs.readFileSync(filePath);
      if (bytes.length === 0) continue;
      return { contentType, bytes };
    } catch {
      // Continue to next candidate.
    }
  }
  return null;
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
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
    const activeFolders = localStore.folders.filter((folder) => folder.workspaceId === workspaceId && !folder.deletedAt);
    const folderById = new Map(activeFolders.map((folder) => [folder.id, folder] as const));
    const currentOrder = localStore.workspaceFolderOrder[workspaceId] ?? [];
    const normalizedOrder = [
      ...currentOrder.filter((folderId) => folderById.has(folderId)),
      ...activeFolders.map((folder) => folder.id).filter((folderId) => !currentOrder.includes(folderId))
    ];
    localStore.workspaceFolderOrder[workspaceId] = normalizedOrder;
    return NextResponse.json({
      folders: normalizedOrder
        .map((folderId) => folderById.get(folderId))
        .filter((folder): folder is NonNullable<typeof folder> => Boolean(folder))
        .map((folder) => ({
          ...folder,
          layout: {
            customOrderAssetIds: localStore.folderLayouts[folder.id] ?? []
          }
        })),
      folderOrderIds: normalizedOrder
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
    const currentOrder = localStore.workspaceFolderOrder[folder.workspaceId] ?? [];
    localStore.workspaceFolderOrder[folder.workspaceId] = [
      ...currentOrder.filter((id) => id !== folder.id),
      folder.id
    ];
    return NextResponse.json({ folder }, { status: 201 });
  }

  if (method === "PATCH" && path[0] === "v1" && path[1] === "drive" && path[2] === "folders" && path[3] && path[4] === "order") {
    const workspaceId = path[3];
    const bodyWithOrder = json && typeof json === "object"
      ? (json as { folderOrderIds?: unknown[] })
      : {};
    const requestedOrder = Array.isArray(bodyWithOrder.folderOrderIds)
      ? bodyWithOrder.folderOrderIds.filter((value): value is string => typeof value === "string")
      : [];
    const activeFolderIds = localStore.folders
      .filter((folder) => folder.workspaceId === workspaceId && !folder.deletedAt)
      .map((folder) => folder.id);
    const validSet = new Set(activeFolderIds);
    const deduped: string[] = Array.from(new Set(requestedOrder.filter((folderId) => validSet.has(folderId))));
    const normalizedOrder = [...deduped, ...activeFolderIds.filter((folderId) => !deduped.includes(folderId))];
    localStore.workspaceFolderOrder[workspaceId] = normalizedOrder;
    return NextResponse.json({ workspaceId, folderOrderIds: normalizedOrder });
  }

  if (method === "DELETE" && path[0] === "v1" && path[1] === "drive" && path[2] === "folders" && path[3]) {
    const folderId = path[3];
    const folder = localStore.folders.find((item) => item.id === folderId && !item.deletedAt);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const deletedAt = nowIso();
    folder.deletedAt = deletedAt;
    delete localStore.folderLayouts[folderId];
    const currentOrder = localStore.workspaceFolderOrder[folder.workspaceId] ?? [];
    localStore.workspaceFolderOrder[folder.workspaceId] = currentOrder.filter((id) => id !== folderId);

    let deletedAssetCount = 0;
    for (const asset of localStore.assets) {
      if (asset.folderId !== folderId || asset.deletedAt) continue;
      asset.deletedAt = deletedAt;
      deletedAssetCount += 1;
    }

    return NextResponse.json({ deleted: true, folderId, deletedAssetCount });
  }

  if (method === "GET" && path[0] === "v1" && path[1] === "drive" && path[2] === "assets" && path[3] && path[4] === "file") {
    const assetId = path[3];
    const asset = localStore.assets.find((item) => item.id === assetId && !item.deletedAt);
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    const versions = localStore.versions
      .filter((item) => item.assetId === assetId)
      .sort((a, b) => b.version - a.version);
    const latest = versions[0];
    if (!latest) {
      return NextResponse.json({ error: "Asset version not found" }, { status: 404 });
    }
    const previewBlob = typeof latest.metadata?.previewBlob === "string"
      ? latest.metadata.previewBlob
      : previewBlobFromStorageKey(latest.storageKey);
    if (previewBlob) {
      const blob = readLocalPreviewBlob(previewBlob);
      if (blob) {
        return new NextResponse(toArrayBuffer(blob.bytes), {
          status: 200,
          headers: {
            "content-type": blob.contentType,
            "cache-control": "public, max-age=600"
          }
        });
      }
    }
    const previewDataUrl = typeof latest.metadata?.previewDataUrl === "string" ? latest.metadata.previewDataUrl : "";
    const decoded = decodeInlineImageDataUrl(previewDataUrl);
    if (!decoded) {
      return NextResponse.json({ error: "Asset file not available" }, { status: 404 });
    }
    return new NextResponse(toArrayBuffer(decoded.bytes), {
      status: 200,
      headers: {
        "content-type": decoded.contentType,
        "cache-control": "public, max-age=600"
      }
    });
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

  if (method === "GET" && path[0] === "v1" && path[1] === "billing" && path[2] && path[3] === "media-spend") {
    const workspaceId = path[2];
    const usdCentsPerCredit = localUsdCentsPerCredit();
    let image = 0;
    let video = 0;
    let imageTransactions = 0;
    let videoTransactions = 0;

    for (const job of localStore.jobs) {
      if (job.workspaceId !== workspaceId) continue;
      const amount = localFinalizedJobSpend(job);
      if (amount <= 0) continue;
      if (job.request.type === "IMAGE") {
        image += amount;
        imageTransactions += 1;
        continue;
      }
      if (job.request.type === "VIDEO") {
        video += amount;
        videoTransactions += 1;
      }
    }

    return NextResponse.json({
      workspaceId,
      currency: "USD",
      estimated: true,
      pricing: {
        usdCentsPerCredit
      },
      totals: {
        imageCredits: image,
        videoCredits: video,
        totalCredits: image + video,
        imageUsdCents: toUsdCents(image, usdCentsPerCredit),
        videoUsdCents: toUsdCents(video, usdCentsPerCredit),
        totalUsdCents: toUsdCents(image + video, usdCentsPerCredit)
      },
      counts: {
        imageTransactions,
        videoTransactions
      },
      updatedAt: nowIso()
    });
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
            const needsStrictRatio = aspectRatio !== "1:1";
            let previewUrl: string | null = null;
            for (let attempt = 0; attempt < (needsStrictRatio ? 3 : 1); attempt += 1) {
              const geminiCandidate = await tryGeminiDataUrl(prompt, model, aspectRatio);
              if (!geminiCandidate) continue;
              if (!needsStrictRatio || isAspectRatioSatisfied(aspectRatio, geminiCandidate)) {
                previewUrl = geminiCandidate;
                break;
              }
              if (!previewUrl) {
                previewUrl = geminiCandidate;
              }
            }
            if (!previewUrl) {
              job.status = "FAILED";
              job.error = model.toLowerCase().includes("a2e")
                ? "A2E image generation failed"
                : "Gemini image generation failed";
              job.updatedAt = nowIso();
              createLocalFailedAsset({
                workspaceId,
                folderId,
                model,
                prompt,
                aspectRatio,
                resolution,
                jobId: job.id,
                error: job.error
              });
              return;
            }
            if (needsStrictRatio && !isAspectRatioSatisfied(aspectRatio, previewUrl)) {
              job.status = "FAILED";
              job.error = `Could not produce requested aspect ratio (${aspectRatio})`;
              job.updatedAt = nowIso();
              createLocalFailedAsset({
                workspaceId,
                folderId,
                model,
                prompt,
                aspectRatio,
                resolution,
                jobId: job.id,
                error: job.error
              });
              return;
            }
            localStore.assets.unshift({
              id: assetId,
              workspaceId,
              folderId,
              name: nextFolderAssetName(folderId, "png"),
              mimeType: "image/png",
              tags: ["generated", model, `job:${job.id}`],
              deletedAt: null,
              createdBy: "user_demo",
              createdAt: nowIso(),
              previewUrl,
              aspectRatio,
              resolution
            });
            localStore.folderLayouts[folderId] = [
              assetId,
              ...(localStore.folderLayouts[folderId] ?? []).filter((id) => id !== assetId)
            ];
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

function routeFromPath(pathSegments: string[]): string {
  return `/${pathSegments.join("/")}`;
}

function traceIdFromRequest(request: NextRequest): string {
  return createServerTraceId(request.headers.get(TRACE_HEADER_NAME));
}

async function forward(request: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const qs = request.nextUrl.search || "";
  const route = routeFromPath(pathSegments);
  const suffix = `${route}${qs}`;
  const traceId = traceIdFromRequest(request);
  const isInternalDiagnosticsRoute = route.startsWith("/v1/diagnostics/");

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set(TRACE_HEADER_NAME, traceId);
  if (!headers.has("x-user-id")) {
    headers.set("x-user-id", "user_demo");
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let lastError: unknown = null;
  let lastServerFailure: { status: number; headers: Headers; body: ArrayBuffer } | null = null;
  let primaryStatusCode: number | null = null;
  let primaryLatencyMs: number | null = null;
  let primaryFailureReason: string | null = null;
  const attemptFailureReasons: string[] = [];
  const targets = targetBaseUrls();
  const fallbackAllowed = proxyFallbackEnabled();

  for (let index = 0; index < targets.length; index += 1) {
    const base = targets[index];
    const attempt = index + 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_FORWARD_TIMEOUT_MS);
    try {
      const upstream = await fetch(`${base}${suffix}`, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal
      });
      const latencyMs = Math.max(0, Date.now() - startedAt);

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      responseHeaders.delete("transfer-encoding");
      responseHeaders.set(TRACE_HEADER_NAME, traceId);

      const responseBody = await upstream.arrayBuffer();
      if (upstream.status >= 500) {
        const failureReason = "upstream_5xx";
        attemptFailureReasons.push(failureReason);
        if (attempt === 1) {
          primaryStatusCode = upstream.status;
          primaryLatencyMs = latencyMs;
          primaryFailureReason = failureReason;
        }
        lastServerFailure = { status: upstream.status, headers: responseHeaders, body: responseBody };
        void emitServerDiagnostic({
          severity: "WARN",
          category: "PROXY",
          component: "web.api_proxy",
          eventName: "proxy.forward.upstream_5xx",
          message: "Proxy upstream returned server error",
          workspaceId: "ws_demo",
          traceId,
          context: {
            route,
            method,
            baseUrl: base,
            attempt,
            attemptsTotal: targets.length,
            primaryBase: targets[0] ?? null,
            failureReason,
            statusCode: upstream.status,
            latencyMs,
            timeoutMs: PROXY_FORWARD_TIMEOUT_MS
          }
        });
        continue;
      }

      const routeWindowStats = markProxyRouteObservation(route, attempt > 1);
      if (attempt > 1) {
        void emitServerDiagnostic({
          severity: isInternalDiagnosticsRoute ? "INFO" : "WARN",
          category: "PROXY",
          component: "web.api_proxy",
          eventName: "proxy.forward.recovered_after_failover",
          message: "Proxy request recovered after failover",
          workspaceId: "ws_demo",
          traceId,
          context: {
            route,
            method,
            baseUrl: base,
            primaryBase: targets[0] ?? null,
            fallbackBase: base,
            attemptCount: attempt,
            attemptsTotal: targets.length,
            statusCode: upstream.status,
            fallbackStatus: upstream.status,
            fallbackLatencyMs: latencyMs,
            primaryStatusCode,
            primaryLatencyMs,
            primaryFailureReason: primaryFailureReason ?? "unknown",
            failureReason: primaryFailureReason ?? "unknown",
            attemptFailureReasons: attemptFailureReasons.slice(0, 5).join(","),
            requestCountWindow: routeWindowStats.requestCountWindow,
            recoveredCountWindow: routeWindowStats.recoveredCountWindow,
            failoverRateWindow: routeWindowStats.failoverRateWindow,
            userImpact: !isInternalDiagnosticsRoute,
            timeoutMs: PROXY_FORWARD_TIMEOUT_MS
          }
        });
      }

      return new NextResponse(responseBody, {
        status: upstream.status,
        headers: responseHeaders
      });
    } catch (error) {
      lastError = error;
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const timedOut = error instanceof Error && error.name === "AbortError";
      const failureReason = timedOut ? "timeout" : "network_error";
      attemptFailureReasons.push(failureReason);
      if (attempt === 1) {
        primaryStatusCode = null;
        primaryLatencyMs = latencyMs;
        primaryFailureReason = failureReason;
      }
      void emitServerDiagnostic({
        severity: timedOut ? "WARN" : "HIGH",
        category: "PROXY",
        component: "web.api_proxy",
        eventName: timedOut ? "proxy.forward.timeout" : "proxy.forward.network_error",
        message: timedOut ? "Proxy upstream attempt timed out" : "Proxy upstream attempt failed",
        workspaceId: "ws_demo",
        traceId,
        context: {
          route,
          method,
          baseUrl: base,
          attempt,
          attemptsTotal: targets.length,
          primaryBase: targets[0] ?? null,
          failureReason,
          latencyMs,
          timeoutMs: PROXY_FORWARD_TIMEOUT_MS,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastServerFailure) {
    markProxyRouteObservation(route, false);
    lastServerFailure.headers.set(TRACE_HEADER_NAME, traceId);
    void emitServerDiagnostic({
      severity: "HIGH",
      category: "PROXY",
      component: "web.api_proxy",
      eventName: "proxy.forward.exhausted_with_5xx",
      message: "All proxy upstream attempts ended with server errors",
      workspaceId: "ws_demo",
      traceId,
      context: {
        route,
        method,
        primaryBase: targets[0] ?? null,
        statusCode: lastServerFailure.status,
        attemptsTotal: targets.length,
        primaryStatusCode,
        primaryLatencyMs,
        primaryFailureReason: primaryFailureReason ?? "upstream_5xx",
        timeoutMs: PROXY_FORWARD_TIMEOUT_MS
      }
    });
    return new NextResponse(lastServerFailure.body, {
      status: lastServerFailure.status,
      headers: lastServerFailure.headers
    });
  }

  if (fallbackAllowed) {
    const fallback = localFallback(method, pathSegments, body);
    if (fallback) {
      const routeWindowStats = markProxyRouteObservation(route, false);
      fallback.headers.set("x-aidrive-proxy-fallback", "1");
      fallback.headers.set(TRACE_HEADER_NAME, traceId);
      void emitServerDiagnostic({
        severity: "WARN",
        category: "PROXY",
        component: "web.api_proxy",
        eventName: "proxy.fallback.activated",
        message: "Proxy local fallback response activated",
        workspaceId: "ws_demo",
        traceId,
        context: {
          route,
          method,
          primaryBase: targets[0] ?? null,
          attemptsTotal: targets.length,
          requestCountWindow: routeWindowStats.requestCountWindow,
          recoveredCountWindow: routeWindowStats.recoveredCountWindow,
          failoverRateWindow: routeWindowStats.failoverRateWindow,
          timeoutMs: PROXY_FORWARD_TIMEOUT_MS,
          fallbackReason: lastError instanceof Error ? lastError.message : "upstream_unavailable"
        }
      });
      return fallback;
    }
  }

  void emitServerDiagnostic({
    severity: "HIGH",
    category: "PROXY",
    component: "web.api_proxy",
    eventName: "proxy.forward.unavailable",
    message: "Proxy could not reach upstream and no fallback response was available",
    workspaceId: "ws_demo",
    traceId,
    context: {
      route,
      method,
      primaryBase: targets[0] ?? null,
      attemptsTotal: targets.length,
      timeoutMs: PROXY_FORWARD_TIMEOUT_MS,
      fallbackEnabled: fallbackAllowed,
      error: lastError instanceof Error ? lastError.message : String(lastError ?? "unknown")
    }
  });

  const response = NextResponse.json(
    {
      error: "API upstream unavailable",
      details: lastError instanceof Error ? lastError.message : "Unknown error"
    },
    { status: 503 }
  );
  response.headers.set(TRACE_HEADER_NAME, traceId);
  return response;
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
