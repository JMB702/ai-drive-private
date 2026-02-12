import { nanoid } from "nanoid";
import type {
  DiagnosticSeverity,
  GenerationRequest,
  GenerationResult,
  ProviderAdapter
} from "@aidrive/shared";
import type { Env } from "../config/env.js";

const PROVIDER_REQUEST_TIMEOUT_MS = Math.max(2_000, Number(process.env.AIDRIVE_PROVIDER_TIMEOUT_MS ?? 45_000));
const PROVIDER_RETRY_ATTEMPTS = Math.max(1, Number(process.env.AIDRIVE_PROVIDER_RETRY_ATTEMPTS ?? 2));
const A2E_DEFAULT_BASE_URL = "https://video.a2e.ai";
const A2E_DEFAULT_REQ_KEY = "high_aes_general_v21_L";
const A2E_MAX_REFERENCE_IMAGES = 2;
const A2E_POLL_TIMEOUT_MS = Math.max(PROVIDER_REQUEST_TIMEOUT_MS, Number(process.env.AIDRIVE_A2E_POLL_TIMEOUT_MS ?? 180_000));
const A2E_SUPPORTED_ASPECT_RATIOS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"]);

type ProviderDiagnosticInput = {
  severity: DiagnosticSeverity;
  eventName: string;
  message: string;
  workspaceId: string;
  traceId?: string | null;
  context?: Record<string, unknown>;
};

type ProviderDiagnosticSink = ((input: ProviderDiagnosticInput) => void) | null;

let providerDiagnosticSink: ProviderDiagnosticSink = null;

export function configureProviderDiagnostics(sink: ProviderDiagnosticSink): void {
  providerDiagnosticSink = sink;
}

function emitProviderDiagnostic(input: ProviderDiagnosticInput): void {
  try {
    providerDiagnosticSink?.(input);
  } catch {
    // Provider requests should not fail due to telemetry.
  }
}

function traceIdForRequest(request: GenerationRequest): string | null {
  const candidate = request.settings?.__traceId;
  if (typeof candidate !== "string" || candidate.trim().length === 0) return null;
  return candidate.trim().slice(0, 120);
}

function truncateErrorDetail(value: string, max = 280): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

type FetchEnvelopeParams = {
  url: string;
  init: RequestInit;
  timeoutMs: number;
  maxAttempts: number;
  provider: string;
  model: string;
  workspaceId: string;
  traceId: string | null;
  route: string;
};

type FetchEnvelopeResult = {
  response: Response;
  attempt: number;
  latencyMs: number;
};

async function fetchWithEnvelope(params: FetchEnvelopeParams): Promise<FetchEnvelopeResult> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= params.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(params.url, {
        ...params.init,
        signal: controller.signal
      });
      const latencyMs = Date.now() - startedAt;
      const shouldRetry = response.status >= 500 && attempt < params.maxAttempts;
      if (shouldRetry) {
        emitProviderDiagnostic({
          severity: "WARN",
          eventName: "provider.retry.server_error",
          message: "Provider returned server error; retrying",
          workspaceId: params.workspaceId,
          traceId: params.traceId,
          context: {
            provider: params.provider,
            model: params.model,
            route: params.route,
            statusCode: response.status,
            latencyMs,
            attempt,
            maxAttempts: params.maxAttempts,
            retryOutcome: "retrying"
          }
        });
        continue;
      }
      return { response, attempt, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      lastError = error;
      const timedOut = error instanceof Error && error.name === "AbortError";
      const isFinalAttempt = attempt >= params.maxAttempts;
      emitProviderDiagnostic({
        severity: timedOut ? "WARN" : "HIGH",
        eventName: timedOut ? "provider.timeout" : "provider.network_error",
        message: timedOut ? "Provider request timed out" : "Provider request failed with network error",
        workspaceId: params.workspaceId,
        traceId: params.traceId,
        context: {
          provider: params.provider,
          model: params.model,
          route: params.route,
          latencyMs,
          attempt,
          maxAttempts: params.maxAttempts,
          retryOutcome: isFinalAttempt ? "exhausted" : "retrying",
          error: error instanceof Error ? truncateErrorDetail(error.message) : truncateErrorDetail(String(error))
        }
      });
      if (isFinalAttempt) {
        if (timedOut) {
          throw new Error(`Provider request timed out after ${params.timeoutMs}ms (attempt ${attempt}/${params.maxAttempts})`);
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("Provider request failed"));
}

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

function extractReferenceImageDataUrls(settings: Record<string, string | number | boolean>): string[] {
  const candidates = Object.entries(settings)
    .filter(([key, value]) => key.startsWith("referenceImageDataUrl") && typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_REFERENCE_IMAGES);

  const dataUrls: string[] = [];
  for (const [, raw] of candidates) {
    if (typeof raw !== "string") continue;
    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) continue;
    dataUrls.push(raw);
  }
  return dataUrls;
}

function extractReferenceImageHttpUrls(settings: Record<string, string | number | boolean>): string[] {
  const candidates = Object.entries(settings)
    .filter(([key, value]) => key.startsWith("referenceImageUrl") && typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_REFERENCE_IMAGES);

  const urls: string[] = [];
  for (const [, raw] of candidates) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (/^https?:\/\//i.test(value)) urls.push(value);
  }
  return urls;
}

function parseReferenceImageDataUrls(settings: Record<string, string | number | boolean>): Array<{ mimeType: string; bytes: Buffer }> {
  const candidates = Object.entries(settings)
    .filter(([key, value]) => key.startsWith("referenceImageDataUrl") && typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_REFERENCE_IMAGES);

  const parsed: Array<{ mimeType: string; bytes: Buffer }> = [];
  for (const [, raw] of candidates) {
    if (typeof raw !== "string") continue;
    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) continue;
    try {
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length === 0) continue;
      parsed.push({ mimeType: match[1].toLowerCase(), bytes });
    } catch {
      // Ignore malformed base64 blobs.
    }
  }
  return parsed;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/avif") return "avif";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/png") return "png";
  return "png";
}

function firstHttpUrl(value: unknown): string | null {
  if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = firstHttpUrl(item);
      if (match) return match;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const [key, nested] of Object.entries(record)) {
    if (
      key.toLowerCase().includes("url") ||
      key.toLowerCase().includes("link") ||
      key.toLowerCase().includes("location")
    ) {
      const match = firstHttpUrl(nested);
      if (match) return match;
    }
  }
  for (const nested of Object.values(record)) {
    const match = firstHttpUrl(nested);
    if (match) return match;
  }
  return null;
}

function trimUrlQuery(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function preferredHttpUrl(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return firstHttpUrl(value);
  const preferredKeys = [
    "public_url",
    "publicUrl",
    "file_url",
    "fileUrl",
    "url",
    "view_url",
    "viewUrl",
    "resource_url",
    "resourceUrl",
    "object_url",
    "objectUrl",
    "cdn_url",
    "cdnUrl",
    "download_url",
    "downloadUrl"
  ];
  for (const key of preferredKeys) {
    const candidate = firstHttpUrl(record[key]);
    if (candidate) return candidate;
  }
  return firstHttpUrl(value);
}

type GeminiImageModel = "gemini-2.5-flash-image" | "gemini-3-pro-image-preview";

const geminiImageModelCapabilities: Record<GeminiImageModel, { supportsImageSize: boolean }> = {
  "gemini-2.5-flash-image": { supportsImageSize: false },
  "gemini-3-pro-image-preview": { supportsImageSize: true }
};

function imageModelForRequest(request: GenerationRequest): GeminiImageModel {
  const model = request.model.toLowerCase();
  if (model.includes("nano banana pro")) return "gemini-3-pro-image-preview";
  if (model.includes("nano banana")) return "gemini-2.5-flash-image";
  // "Gemini 2.0 flash" in this app maps to the currently supported image model.
  return "gemini-2.5-flash-image";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

type A2EImageState = {
  taskId: string | null;
  status: string | null;
  imageUrls: string[];
  detail: string | null;
  failedCode: string | null;
  failedMessage: string | null;
};

function parseA2EImageState(payload: unknown): A2EImageState {
  const root = asRecord(payload);
  const result = asRecord(root?.result);
  const candidates: Record<string, unknown>[] = [];
  if (root) candidates.push(root);
  if (result) candidates.push(result);
  const dataValue = root?.data;
  if (Array.isArray(dataValue)) {
    for (const entry of dataValue) {
      const record = asRecord(entry);
      if (record) candidates.push(record);
    }
  } else {
    const data = asRecord(dataValue);
    if (data) candidates.push(data);
  }

  let taskId: string | null = null;
  let status: string | null = null;
  let imageUrls: string[] = [];
  let detail: string | null = null;
  let failedCode: string | null = null;
  let failedMessage: string | null = null;

  for (const candidate of candidates) {
    taskId ??= pickString(candidate.task_id, candidate.taskId, candidate.id, candidate._id, candidate.job_id, candidate.jobId);
    status ??= pickString(candidate.current_status, candidate.currentStatus, candidate.status, candidate.state);
    failedCode ??= pickString(candidate.failed_code, candidate.failedCode);
    failedMessage ??= pickString(candidate.failed_message, candidate.failedMessage);
    const nestedError = asRecord(candidate.error);
    detail ??= pickString(
      candidate.error_message,
      candidate.errorMessage,
      candidate.message,
      candidate.reason,
      candidate.status_message,
      candidate.statusMessage,
      nestedError?.message,
      nestedError?.detail,
      nestedError?.error
    );
    if (imageUrls.length === 0) {
      imageUrls = pickStringArray(candidate.image_urls);
      if (imageUrls.length === 0) imageUrls = pickStringArray(candidate.imageUrls);
      if (imageUrls.length === 0) imageUrls = pickStringArray(candidate.urls);
    }
  }

  const failureDetail = failedCode && failedMessage
    ? `${failedCode}:${failedMessage}`
    : failedCode ?? failedMessage ?? null;

  return { taskId, status, imageUrls, detail: detail ?? failureDetail, failedCode, failedMessage };
}

function isA2EJobComplete(status: string | null): boolean {
  const normalized = (status ?? "").toLowerCase();
  return normalized === "completed" || normalized === "succeeded" || normalized === "success" || normalized === "done";
}

function isA2EJobPending(status: string | null): boolean {
  const normalized = (status ?? "").toLowerCase();
  return normalized === "queued" || normalized === "pending" || normalized === "processing" || normalized === "running" || normalized === "initialized";
}

function normalizeBaseUrl(value: string | undefined): string {
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : A2E_DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function normalizeA2EAspectRatio(value: string): { aspectRatio: string; adjustedFrom: string | null } {
  const requested = normalizedAspectRatio(value);
  if (A2E_SUPPORTED_ASPECT_RATIOS.has(requested)) {
    return { aspectRatio: requested, adjustedFrom: null };
  }
  if (requested === "4:5") {
    return { aspectRatio: "3:4", adjustedFrom: requested };
  }
  if (requested === "5:4") {
    return { aspectRatio: "4:3", adjustedFrom: requested };
  }
  return { aspectRatio: "1:1", adjustedFrom: requested };
}

function closestA2EAspectRatioForValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "1:1";
  let best = "1:1";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ratio of A2E_SUPPORTED_ASPECT_RATIOS) {
    const parsed = parseAspectRatio(ratio);
    const distance = Math.abs(parsed - value);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

function a2eAspectRatioFromFirstReferenceDataUrl(request: GenerationRequest): { aspectRatio: string; sourceRatio: number } | null {
  const firstDataUrl = extractReferenceImageDataUrls(request.settings)[0];
  if (!firstDataUrl) return null;
  const sourceRatio = detectDataUrlRatio(firstDataUrl);
  if (!sourceRatio || !Number.isFinite(sourceRatio) || sourceRatio <= 0) return null;
  const aspectRatio = closestA2EAspectRatioForValue(sourceRatio);
  return { aspectRatio, sourceRatio };
}

async function fetchImageAsDataUrl(url: string, request: GenerationRequest): Promise<string> {
  const traceId = traceIdForRequest(request);
  const { response, attempt, latencyMs } = await fetchWithEnvelope({
    url,
    init: {
      method: "GET",
      headers: { accept: "image/*,*/*;q=0.8" }
    },
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    maxAttempts: PROVIDER_RETRY_ATTEMPTS,
    provider: "a2e",
    model: request.model,
    workspaceId: request.workspaceId,
    traceId,
    route: "external_image_url"
  });

  if (!response.ok) {
    const text = await response.text();
    emitProviderDiagnostic({
      severity: response.status >= 500 ? "HIGH" : "WARN",
      eventName: "provider.http_error",
      message: "A2E image URL fetch failed",
      workspaceId: request.workspaceId,
      traceId,
      context: {
        provider: "a2e",
        model: request.model,
        route: "external_image_url",
        attempt,
        maxAttempts: PROVIDER_RETRY_ATTEMPTS,
        latencyMs,
        statusCode: response.status,
        errorCode: `http_${response.status}`,
        upstreamMessage: truncateErrorDetail(text)
      }
    });
    throw new Error(`A2E image URL fetch failed: ${response.status} ${truncateErrorDetail(text)}`);
  }

  const mimeType = (response.headers.get("content-type") ?? "image/png").split(";")[0].trim().toLowerCase() || "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function a2eReqKeyForRequest(request: GenerationRequest): string {
  const value = request.settings.a2eReqKey;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return A2E_DEFAULT_REQ_KEY;
}

function normalizePromptForA2ESaferRetry(prompt: string): string {
  const normalized = prompt
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Generate a high-quality image based on the provided reference.";
  if (normalized.length > 320) return normalized.slice(0, 320).trim();
  return `${normalized} high quality detailed render`;
}

async function prepareA2EReferenceImageUrl(params: {
  apiKey: string;
  baseUrl: string;
  request: GenerationRequest;
  source: { mimeType: string; bytes: Buffer };
  index: number;
  reqKey: string;
}): Promise<string> {
  const traceId = traceIdForRequest(params.request);
  const base = normalizeBaseUrl(params.baseUrl);
  const extension = extensionForMimeType(params.source.mimeType);
  const uploadKey = `aidrive_ref_${Date.now()}_${params.index}_${nanoid(8)}`;
  const uploadInit = await fetchWithEnvelope({
    url: `${base}/api/v1/r2/get_upload_presigned_url`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify({
        key: uploadKey,
        type: "images",
        file_extension: extension
      })
    },
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    maxAttempts: PROVIDER_RETRY_ATTEMPTS,
    provider: "a2e",
    model: params.request.model,
    workspaceId: params.request.workspaceId,
    traceId,
    route: "/api/v1/r2/get_upload_presigned_url"
  });
  if (!uploadInit.response.ok) {
    const text = await uploadInit.response.text();
    throw new Error(`A2E reference upload init failed: ${uploadInit.response.status} ${truncateErrorDetail(text)}`);
  }

  const uploadPayload = await uploadInit.response.json();
  const uploadRoot = asRecord(uploadPayload);
  const uploadResult = asRecord(uploadRoot?.result) ?? asRecord(uploadRoot?.data);
  const uploadUrl = preferredHttpUrl(uploadResult) ?? firstHttpUrl(uploadPayload);
  const uploadBucket = pickString(uploadResult?.bucket, uploadRoot?.bucket);
  const uploadedObjectKey = pickString(uploadResult?.key, uploadRoot?.key);
  if (!uploadUrl) {
    throw new Error("A2E reference upload init did not return an upload URL");
  }

  const uploadPut = await fetchWithEnvelope({
    url: uploadUrl,
    init: {
      method: "PUT",
      headers: {
        "content-type": params.source.mimeType
      },
      body: params.source.bytes as unknown as NonNullable<RequestInit["body"]>
    },
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    maxAttempts: PROVIDER_RETRY_ATTEMPTS,
    provider: "a2e",
    model: params.request.model,
    workspaceId: params.request.workspaceId,
    traceId,
    route: "r2_presigned_put"
  });
  if (!uploadPut.response.ok) {
    const text = await uploadPut.response.text();
    throw new Error(`A2E reference upload failed: ${uploadPut.response.status} ${truncateErrorDetail(text)}`);
  }

  // A2E generation accepts the bucket CDN URL shape; raw R2 object URLs fail generation.
  if (uploadBucket && uploadedObjectKey) {
    return `https://${uploadBucket}.ai2everyone.com/${uploadedObjectKey.replace(/^\/+/, "")}`;
  }

  const uploadLocation =
    firstHttpUrl(uploadPut.response.headers.get("location")) ??
    preferredHttpUrl(uploadResult) ??
    firstHttpUrl(uploadPayload);

  const fetchableUploadLocation = uploadLocation ? trimUrlQuery(uploadLocation) : null;

  if (!fetchableUploadLocation) {
    throw new Error("A2E reference upload completed but did not expose a retrievable URL");
  }

  const transfer = await fetchWithEnvelope({
    url: `${base}/api/v1/tos/transferToStorage`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify({ url: fetchableUploadLocation })
    },
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    maxAttempts: PROVIDER_RETRY_ATTEMPTS,
    provider: "a2e",
    model: params.request.model,
    workspaceId: params.request.workspaceId,
    traceId,
    route: "/api/v1/tos/transferToStorage"
  });

  if (transfer.response.ok) {
    const transferred = await transfer.response.json();
    const transferredUrl = preferredHttpUrl(asRecord(transferred)?.result) ?? firstHttpUrl(transferred);
    if (transferredUrl) return transferredUrl;
  } else {
    const text = await transfer.response.text();
    emitProviderDiagnostic({
      severity: "WARN",
      eventName: "provider.reference_transfer_failed",
      message: "A2E transferToStorage failed for reference image",
      workspaceId: params.request.workspaceId,
      traceId,
      context: {
        provider: "a2e",
        model: params.request.model,
        route: "/api/v1/tos/transferToStorage",
        statusCode: transfer.response.status,
        referenceIndex: params.index,
        upstreamMessage: truncateErrorDetail(text)
      }
    });
  }

  return fetchableUploadLocation;
}

async function resolveA2EReferenceImageUrls(apiKey: string, baseUrl: string, request: GenerationRequest): Promise<string[]> {
  const explicitUrls = extractReferenceImageHttpUrls(request.settings).slice(0, A2E_MAX_REFERENCE_IMAGES);
  const parsedDataUrls = parseReferenceImageDataUrls(request.settings);

  if (parsedDataUrls.length === 0) return explicitUrls;
  if (explicitUrls.length >= A2E_MAX_REFERENCE_IMAGES) return explicitUrls.slice(0, A2E_MAX_REFERENCE_IMAGES);

  const remaining = Math.max(0, A2E_MAX_REFERENCE_IMAGES - explicitUrls.length);
  const converted = await Promise.all(
    parsedDataUrls.slice(0, remaining).map((source, index) =>
      prepareA2EReferenceImageUrl({
        apiKey,
        baseUrl,
        request,
        source,
        index: index + 1,
        reqKey: a2eReqKeyForRequest(request)
      })
    )
  );
  return [...explicitUrls, ...converted].slice(0, A2E_MAX_REFERENCE_IMAGES);
}

async function generateA2EImageDataUrl(apiKey: string, baseUrl: string, request: GenerationRequest): Promise<{
  previewDataUrl: string;
  taskId: string | null;
  referenceImageCount: number;
}> {
  const traceId = traceIdForRequest(request);
  const endpoint = `${normalizeBaseUrl(baseUrl)}/api/v1/userText2image/start`;
  const rawRequestedAspectRatio = typeof request.settings.aspectRatio === "string"
    ? request.settings.aspectRatio.trim().toLowerCase()
    : "1:1";
  const requestedAspectRatio = rawRequestedAspectRatio === "auto"
    ? "auto"
    : normalizedAspectRatio(rawRequestedAspectRatio);
  const fromReference = requestedAspectRatio === "auto" ? a2eAspectRatioFromFirstReferenceDataUrl(request) : null;
  const normalized = normalizeA2EAspectRatio(requestedAspectRatio === "auto" ? "1:1" : requestedAspectRatio);
  const aspectRatio = fromReference?.aspectRatio ?? normalized.aspectRatio;
  if (fromReference) {
    emitProviderDiagnostic({
      severity: "WARN",
      eventName: "provider.aspect_ratio_derived_from_reference",
      message: "A2E aspect ratio was derived from first reference image",
      workspaceId: request.workspaceId,
      traceId,
      context: {
        provider: "a2e",
        model: request.model,
        requestedAspectRatio,
        sourceReferenceRatio: Number(fromReference.sourceRatio.toFixed(4)),
        appliedAspectRatio: fromReference.aspectRatio
      }
    });
  } else if (requestedAspectRatio !== "auto" && normalized.adjustedFrom) {
    emitProviderDiagnostic({
      severity: "WARN",
      eventName: "provider.aspect_ratio_adjusted",
      message: "A2E aspect ratio was adjusted to a supported value",
      workspaceId: request.workspaceId,
      traceId,
      context: {
        provider: "a2e",
        model: request.model,
        requestedAspectRatio: normalized.adjustedFrom,
        appliedAspectRatio: aspectRatio
      }
    });
  }
  const referenceHttpUrls = await resolveA2EReferenceImageUrls(apiKey, baseUrl, request);
  const basePayload = {
    prompt: request.prompt,
    req_key: a2eReqKeyForRequest(request),
    aspect_ratio: aspectRatio,
    input_images: referenceHttpUrls
  };

  async function submitAndPollOnce(payload: typeof basePayload): Promise<A2EImageState> {
    const submit = await fetchWithEnvelope({
      url: endpoint,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      },
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      maxAttempts: PROVIDER_RETRY_ATTEMPTS,
      provider: "a2e",
      model: request.model,
      workspaceId: request.workspaceId,
      traceId,
      route: "/api/v1/userText2image/start"
    });

    if (!submit.response.ok) {
      const text = await submit.response.text();
      emitProviderDiagnostic({
        severity: submit.response.status >= 500 ? "HIGH" : "WARN",
        eventName: "provider.http_error",
        message: "A2E start request failed",
        workspaceId: request.workspaceId,
        traceId,
        context: {
          provider: "a2e",
          model: request.model,
          route: "/api/v1/userText2image/start",
          attempt: submit.attempt,
          maxAttempts: PROVIDER_RETRY_ATTEMPTS,
          latencyMs: submit.latencyMs,
          statusCode: submit.response.status,
          errorCode: `http_${submit.response.status}`,
          upstreamMessage: truncateErrorDetail(text)
        }
      });
      throw new Error(`A2E start request failed: ${submit.response.status} ${truncateErrorDetail(text)}`);
    }

    const initialPayload = await submit.response.json();
    let state = parseA2EImageState(initialPayload);
    const startedAt = Date.now();
    const pollTimeoutMs = Math.max(6_000, A2E_POLL_TIMEOUT_MS);
    const pollIntervalMs = 1_500;

    while (state.imageUrls.length === 0 && state.taskId && isA2EJobPending(state.status) && (Date.now() - startedAt) < pollTimeoutMs) {
      await sleep(pollIntervalMs);
      const poll = await fetchWithEnvelope({
        url: `${normalizeBaseUrl(baseUrl)}/api/v1/userText2image/${encodeURIComponent(state.taskId)}`,
        init: {
          method: "GET",
          headers: {
            authorization: `Bearer ${apiKey}`
          }
        },
        timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
        maxAttempts: PROVIDER_RETRY_ATTEMPTS,
        provider: "a2e",
        model: request.model,
        workspaceId: request.workspaceId,
        traceId,
        route: "/api/v1/userText2image/:id"
      });

      if (!poll.response.ok) {
        const text = await poll.response.text();
        throw new Error(`A2E status request failed: ${poll.response.status} ${truncateErrorDetail(text)}`);
      }

      state = parseA2EImageState(await poll.response.json());
    }

    if (state.imageUrls.length === 0 && state.taskId && isA2EJobPending(state.status)) {
      throw new Error(`A2E task still processing after ${pollTimeoutMs}ms. status=${state.status} taskId=${state.taskId}`);
    }

    return state;
  }

  let state = await submitAndPollOnce(basePayload);

  const canRetryFailedJob =
    state.imageUrls.length === 0 &&
    (state.status ?? "").toLowerCase() === "failed" &&
    typeof state.detail === "string" &&
    /generation_error|failure/i.test(state.detail);

  if (canRetryFailedJob) {
    emitProviderDiagnostic({
      severity: "WARN",
      eventName: "provider.retry.failed_generation",
      message: "A2E returned failed generation result; retrying once",
      workspaceId: request.workspaceId,
      traceId,
      context: {
        provider: "a2e",
        model: request.model,
        route: "/api/v1/userText2image/start",
        priorTaskId: state.taskId,
        priorStatus: state.status,
        priorDetail: truncateErrorDetail(state.detail ?? "")
      }
    });
    await sleep(1_500);
    state = await submitAndPollOnce(basePayload);
  }

  const saferPrompt = normalizePromptForA2ESaferRetry(request.prompt);
  const canRetryWithSaferPrompt =
    state.imageUrls.length === 0 &&
    (state.status ?? "").toLowerCase() === "failed" &&
    typeof state.detail === "string" &&
    /generation_error|failure/i.test(state.detail) &&
    saferPrompt !== request.prompt;

  if (canRetryWithSaferPrompt) {
    emitProviderDiagnostic({
      severity: "WARN",
      eventName: "provider.retry.safer_prompt",
      message: "A2E generation failed again; retrying once with normalized prompt variant",
      workspaceId: request.workspaceId,
      traceId,
      context: {
        provider: "a2e",
        model: request.model,
        route: "/api/v1/userText2image/start",
        priorTaskId: state.taskId,
        priorStatus: state.status,
        priorDetail: truncateErrorDetail(state.detail ?? ""),
        originalPromptLength: request.prompt.length,
        saferPromptLength: saferPrompt.length
      }
    });
    await sleep(1_500);
    state = await submitAndPollOnce({
      ...basePayload,
      prompt: saferPrompt
    });
  }

  const imageUrl = state.imageUrls[0];
  if (!imageUrl) {
    const suffix = state.taskId ? ` taskId=${state.taskId}` : "";
    const status = state.status ? ` status=${state.status}` : "";
    const detail = state.detail ? ` detail=${truncateErrorDetail(state.detail)}` : "";
    throw new Error(`A2E did not return image URL.${status}${suffix}${detail}`);
  }

  const previewDataUrl = await fetchImageAsDataUrl(imageUrl, request);
  if (isA2EJobComplete(state.status) || isA2EJobPending(state.status) || !state.status) {
    return { previewDataUrl, taskId: state.taskId, referenceImageCount: referenceHttpUrls.length };
  }
  throw new Error(`A2E image generation failed with status ${state.status}`);
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
  const traceId = traceIdForRequest(request);

  async function submit(body: unknown): Promise<string> {
    const { response, attempt, latencyMs } = await fetchWithEnvelope({
      url: endpoint,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      maxAttempts: PROVIDER_RETRY_ATTEMPTS,
      provider: "gemini",
      model: modelName,
      workspaceId: request.workspaceId,
      traceId,
      route: "/v1beta/models/:model:generateContent"
    });

    if (!response.ok) {
      const text = await response.text();
      emitProviderDiagnostic({
        severity: response.status >= 500 ? "HIGH" : "WARN",
        eventName: "provider.http_error",
        message: "Gemini image request failed",
        workspaceId: request.workspaceId,
        traceId,
        context: {
          provider: "gemini",
          model: modelName,
          route: "/v1beta/models/:model:generateContent",
          attempt,
          maxAttempts: PROVIDER_RETRY_ATTEMPTS,
          latencyMs,
          statusCode: response.status,
          errorCode: `http_${response.status}`,
          upstreamMessage: truncateErrorDetail(text)
        }
      });
      throw new Error(`Gemini image request failed: ${response.status} ${truncateErrorDetail(text)}`);
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
  readonly supports = ["Gemini 2.0 flash", "nano banana pro", "nano banana"];

  constructor(private readonly apiKey?: string) {}

  async submit(request: GenerationRequest): Promise<GenerationResult> {
    if (request.type === "IMAGE") {
      if (!this.apiKey) {
        throw new Error("Missing GEMINI_API_KEY for image generation");
      }

      const requestedAspectRatio = normalizedAspectRatio(
        typeof request.settings.aspectRatio === "string" ? request.settings.aspectRatio : "1:1"
      );
      const imageModelName = imageModelForRequest(request);
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
        emitProviderDiagnostic({
          severity: "HIGH",
          eventName: "provider.generation_failed",
          message: "Gemini could not produce an image preview",
          workspaceId: request.workspaceId,
          traceId: traceIdForRequest(request),
          context: {
            provider: "gemini",
            model: imageModelName,
            route: "/v1beta/models/:model:generateContent",
            errorCode: "generation_failed",
            attempts,
            ratioRequested: requestedAspectRatio,
            lastError: lastGeminiError ? truncateErrorDetail(lastGeminiError) : null
          }
        });
        throw new Error(`Could not produce requested aspect ratio (${requestedAspectRatio}).${detail}`);
      }
      if (needsStrictRatio && !isSvgDataUrl(previewDataUrl) && !isAspectRatioSatisfied(requestedAspectRatio, previewDataUrl)) {
        previewDataUrl = wrapImageInAspectRatio(previewDataUrl, requestedAspectRatio);
        ratioMismatch = true;
        emitProviderDiagnostic({
          severity: "WARN",
          eventName: "provider.aspect_ratio_fallback",
          message: "Gemini image ratio mismatch was corrected by SVG wrapper",
          workspaceId: request.workspaceId,
          traceId: traceIdForRequest(request),
          context: {
            provider: "gemini",
            model: imageModelName,
            route: "/v1beta/models/:model:generateContent",
            requestedAspectRatio,
            fallback: "svg_wrapper"
          }
        });
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
    const traceId = traceIdForRequest(request);
    const { response, attempt, latencyMs } = await fetchWithEnvelope({
      url: endpoint,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: request.prompt }] }],
          generationConfig: {
            temperature: 0.7
          }
        })
      },
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      maxAttempts: PROVIDER_RETRY_ATTEMPTS,
      provider: "gemini",
      model: "gemini-2.0-flash",
      workspaceId: request.workspaceId,
      traceId,
      route: "/v1beta/models/gemini-2.0-flash:generateContent"
    });

    if (!response.ok) {
      const text = await response.text();
      emitProviderDiagnostic({
        severity: response.status >= 500 ? "HIGH" : "WARN",
        eventName: "provider.http_error",
        message: "Gemini text request failed",
        workspaceId: request.workspaceId,
        traceId,
        context: {
          provider: "gemini",
          model: "gemini-2.0-flash",
          route: "/v1beta/models/gemini-2.0-flash:generateContent",
          attempt,
          maxAttempts: PROVIDER_RETRY_ATTEMPTS,
          latencyMs,
          statusCode: response.status,
          errorCode: `http_${response.status}`,
          upstreamMessage: truncateErrorDetail(text)
        }
      });
      throw new Error(`Gemini request failed: ${response.status} ${truncateErrorDetail(text)}`);
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

class A2EAdapter implements ProviderAdapter {
  readonly key = "a2e";
  readonly supports = ["A2E Image generator"];

  constructor(private readonly apiKey?: string, private readonly baseUrl: string = A2E_DEFAULT_BASE_URL) {}

  async submit(request: GenerationRequest): Promise<GenerationResult> {
    if (request.type !== "IMAGE") {
      throw new Error("A2E only supports image generation");
    }
    if (!this.apiKey) {
      throw new Error("Missing A2E_API_KEY for image generation");
    }

    const { previewDataUrl, taskId, referenceImageCount } = await generateA2EImageDataUrl(this.apiKey, this.baseUrl, request);
    return {
      outputMimeType: "image/png",
      outputBytes: previewDataUrl.length,
      providerJobId: taskId ?? `a2e-${nanoid(12)}`,
      providerMetadata: {
        model: request.model,
        mode: "a2e-image-inline",
        referenceImageCount,
        previewDataUrl
      },
      storageKey: `generated/${request.workspaceId}/${nanoid()}.png`,
      checksum: nanoid(20)
    };
  }
}

export function createAdapters(env: Env): ProviderAdapter[] {
  return [
    new GeminiAdapter(env.GEMINI_API_KEY),
    new A2EAdapter(env.A2E_API_KEY, normalizeBaseUrl(env.A2E_API_BASE_URL)),
    new MockProviderAdapter("openai", ["ChatGPT image generator"]),
    new MockProviderAdapter("xai", ["Grock image generator"]),
    new MockProviderAdapter("kling", ["Kling 3.0", "Kling 2.6"])
  ];
}
