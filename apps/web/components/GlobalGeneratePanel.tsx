"use client";

import { type ChangeEvent, type CSSProperties, type DragEvent as ReactDragEvent, FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { createTraceId, postClientDiagnostic } from "../lib/diagnostics-client";
import {
  GENERATION_CLIENT_REQUEST_ID_KEY,
  toDisplayPreviewUrl,
  readActiveDraggedAssetIds,
  readDraggedAssetIds,
  resolveAssetPreview,
  type GeneratePanelState,
  type GenerationJob
} from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

type ModelKey = "gemini-2.0-flash" | "nano-banana-pro" | "nano-banana" | "a2e";
type ModelPanelConfig = {
  count: number;
  aspectRatio: string;
  resolution: string;
};
type ReferenceImage = { id: string; name: string; dataUrl: string; sourceUrl?: string };
type ProjectGeneratorSettings = {
  modelKey: ModelKey;
  selectedModelKeys: ModelKey[];
  modelConfigs: Record<ModelKey, ModelPanelConfig>;
};
type DropPayload = {
  files: File[];
  draggedAssetIds: string[];
  uriList: string;
  textPlain: string;
  textHtml: string;
};
type UiSurface = "mobile" | "desktop";
type UiProfile = {
  surface: UiSurface;
  viewportBreakpointPx: number;
  generatePanel: {
    toolsDefaultCollapsed: boolean;
  };
  referenceImages: {
    maxPerImageDataUrlBytes: number;
    maxTotalDataUrlBytes: number;
    safeGenerationBodyBytes: number;
  };
};

const PROMPT_BY_PROJECT_STORAGE_KEY = "aidrive:generatePromptByProject";
const REFS_BY_PROJECT_STORAGE_KEY = "aidrive:generateRefsByProject";
const SETTINGS_BY_PROJECT_STORAGE_KEY = "aidrive:generateSettingsByProject";
const TOOLS_COLLAPSED_STORAGE_KEY = "aidrive:generateToolsCollapsed";
const REFERENCE_IMAGE_DB_NAME = "aidrive-generate-panel";
const REFERENCE_IMAGE_DB_VERSION = 1;
const REFERENCE_IMAGE_STORE_NAME = "refs-by-project";
const MAX_REFERENCE_IMAGE_DATA_URL_BYTES = 1_900_000;
const MAX_REFERENCE_TOTAL_DATA_URL_BYTES = 5_200_000;
const SAFE_GENERATION_BODY_BYTES = 7 * 1024 * 1024;
const SUBMIT_REFERENCE_TARGET_BYTES = [1_600_000, 1_200_000, 900_000, 700_000, 500_000, 360_000];
const DEFAULT_UI_PROFILE: UiProfile = {
  surface: "desktop",
  viewportBreakpointPx: 980,
  generatePanel: {
    toolsDefaultCollapsed: false
  },
  referenceImages: {
    maxPerImageDataUrlBytes: MAX_REFERENCE_IMAGE_DATA_URL_BYTES,
    maxTotalDataUrlBytes: MAX_REFERENCE_TOTAL_DATA_URL_BYTES,
    safeGenerationBodyBytes: SAFE_GENERATION_BODY_BYTES
  }
};

const MODEL_OPTIONS: Array<{
  key: ModelKey;
  label: string;
  apiModel: string;
  resolutions: string[];
  maxReferenceImages: number;
}> = [
  { key: "gemini-2.0-flash", label: "Gemini 2.0 Flash", apiModel: "Gemini 2.0 flash", resolutions: ["1K"], maxReferenceImages: 3 },
  { key: "nano-banana-pro", label: "Nano Banana Pro", apiModel: "nano banana pro", resolutions: ["1K", "2K", "4K"], maxReferenceImages: 3 },
  { key: "nano-banana", label: "Nano Banana", apiModel: "nano banana", resolutions: ["1K"], maxReferenceImages: 3 },
  { key: "a2e", label: "A2E", apiModel: "A2E Image generator", resolutions: ["1K", "2K", "4K"], maxReferenceImages: 2 }
];

const ASPECT_RATIO_AUTO = "auto";
const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const A2E_SUPPORTED_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"];
const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];
const DEFAULT_MODEL_KEY: ModelKey = "gemini-2.0-flash";
const MODEL_KEYS: ModelKey[] = ["gemini-2.0-flash", "nano-banana-pro", "nano-banana", "a2e"];
const MODEL_MENU_ANIMATION_MS = 240;
const INLINE_MENU_ANIMATION_MS = 240;

function parseAspectRatioValue(value: string): { width: number; height: number } | null {
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function aspectRatioDisplayLabel(value: string): string {
  if (value === ASPECT_RATIO_AUTO) return "Auto";
  const ratio = parseAspectRatioValue(value);
  if (!ratio) return value;
  return value;
}

function aspectRatioShapeStyle(value: string): CSSProperties {
  if (value === ASPECT_RATIO_AUTO) {
    return { width: "16px", height: "16px" };
  }
  const ratio = parseAspectRatioValue(value);
  if (!ratio) return { width: "14px", height: "14px" };
  const rawRatio = ratio.width / ratio.height;
  const clampedRatio = Math.min(2.4, Math.max(0.38, rawRatio));
  const maxDimension = 18;
  const width = clampedRatio >= 1
    ? maxDimension
    : Math.round(maxDimension * clampedRatio);
  const height = clampedRatio >= 1
    ? Math.round(maxDimension / clampedRatio)
    : maxDimension;
  return {
    width: `${Math.max(7, Math.min(32, width))}px`,
    height: `${Math.max(10, Math.min(24, height))}px`
  };
}

function aspectRatioShapeClassName(value: string): string {
  return value === ASPECT_RATIO_AUTO ? "aspect-ratio-shape aspect-ratio-shape-auto" : "aspect-ratio-shape";
}

function defaultAspectRatioForModel(modelKey: ModelKey): string {
  return modelKey === "a2e" ? ASPECT_RATIO_AUTO : "1:1";
}

function aspectRatioOptionsForModel(modelKey: ModelKey): string[] {
  return [ASPECT_RATIO_AUTO, ...ASPECT_RATIOS];
}

function closestAspectRatioForValue(value: number, options: string[]): string {
  if (!Number.isFinite(value) || value <= 0) return options[0] ?? "1:1";
  let best = options[0] ?? "1:1";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const parsed = parseAspectRatioValue(option);
    if (!parsed) continue;
    const distance = Math.abs(parsed.width / parsed.height - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

function normalizeSelectedModelKeys(keys: ModelKey[]): ModelKey[] {
  const deduped = Array.from(new Set(keys.filter((key) => isModelKey(key))));
  return deduped.length > 0 ? deduped : [DEFAULT_MODEL_KEY];
}

function createClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

function normalizeUiProfile(value: unknown): UiProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Partial<UiProfile>;
  const surface = profile.surface === "mobile" || profile.surface === "desktop" ? profile.surface : DEFAULT_UI_PROFILE.surface;
  const viewportBreakpointPx = positiveInteger(profile.viewportBreakpointPx, DEFAULT_UI_PROFILE.viewportBreakpointPx);
  const toolsDefaultCollapsed = Boolean(profile.generatePanel?.toolsDefaultCollapsed);
  const maxPerImageDataUrlBytes = positiveInteger(
    profile.referenceImages?.maxPerImageDataUrlBytes,
    DEFAULT_UI_PROFILE.referenceImages.maxPerImageDataUrlBytes
  );
  const maxTotalDataUrlBytes = positiveInteger(
    profile.referenceImages?.maxTotalDataUrlBytes,
    DEFAULT_UI_PROFILE.referenceImages.maxTotalDataUrlBytes
  );
  const safeGenerationBodyBytes = positiveInteger(
    profile.referenceImages?.safeGenerationBodyBytes,
    DEFAULT_UI_PROFILE.referenceImages.safeGenerationBodyBytes
  );
  return {
    surface,
    viewportBreakpointPx,
    generatePanel: {
      toolsDefaultCollapsed
    },
    referenceImages: {
      maxPerImageDataUrlBytes,
      maxTotalDataUrlBytes,
      safeGenerationBodyBytes
    }
  };
}

async function fetchUiProfile(): Promise<UiProfile> {
  try {
    const response = await apiRequest<{ profile?: unknown }>("/v1/ui/profile");
    const profile = normalizeUiProfile(response.profile);
    if (profile) return profile;
  } catch {
    // Use safe fallback profile.
  }
  return DEFAULT_UI_PROFILE;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function referenceDataUrlBytes(dataUrl: string): number {
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/);
  if (!match) return 0;
  // Data URLs here are ASCII only, so .length is equivalent to byte length.
  return dataUrl.length;
}

function totalReferenceDataUrlBytes(images: ReferenceImage[]): number {
  return images.reduce((total, image) => total + referenceDataUrlBytes(image.dataUrl), 0);
}

function referenceSizeLimitMessage(maxPerImageBytes: number, maxTotalBytes: number): string {
  return `Reference images are too large. Keep each under ${formatMegabytes(maxPerImageBytes)} and total references under ${formatMegabytes(maxTotalBytes)}.`;
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement | null> {
  return await new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}

async function compressImageBlobToLimit(blob: Blob, maxBytes: number): Promise<string | null> {
  if (!blob.type.startsWith("image/")) return null;
  const image = await loadImageFromBlob(blob);
  if (!image) return null;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;

  const maxDimensions = [1920, 1600, 1400, 1200, 1024, 900, 768, 640, 512];
  const qualities = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38, 0.3];
  for (const maxDimension of maxDimensions) {
    const ratio = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio));
    const height = Math.max(1, Math.round(sourceHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    for (const quality of qualities) {
      const compressed = canvas.toDataURL("image/jpeg", quality);
      if (referenceDataUrlBytes(compressed) <= maxBytes) {
        return compressed;
      }
    }
  }
  return null;
}

async function compressImageDataUrlToLimit(dataUrl: string, maxBytes: number): Promise<string | null> {
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await compressImageBlobToLimit(blob, maxBytes);
  } catch {
    return null;
  }
}

async function fitReferenceImageToBudget(
  dataUrl: string,
  remainingTotalBytes: number,
  maxPerImageBytes: number
): Promise<string | null> {
  const initialBytes = referenceDataUrlBytes(dataUrl);
  if (initialBytes <= 0) return null;
  const maxBytesForImage = Math.min(maxPerImageBytes, Math.max(0, remainingTotalBytes));
  if (maxBytesForImage <= 0) return null;
  if (initialBytes <= maxBytesForImage) return dataUrl;
  return await compressImageDataUrlToLimit(dataUrl, maxBytesForImage);
}

async function selectSubmitReferenceImages(
  images: ReferenceImage[],
  limits: { maxPerImageDataUrlBytes: number; maxTotalDataUrlBytes: number }
): Promise<{
  accepted: ReferenceImage[];
  droppedInvalid: number;
  droppedOversize: number;
  totalBytes: number;
}> {
  const accepted: ReferenceImage[] = [];
  let droppedInvalid = 0;
  let droppedOversize = 0;
  let totalBytes = 0;
  for (const image of images) {
    const initialBytes = referenceDataUrlBytes(image.dataUrl);
    if (initialBytes <= 0) {
      droppedInvalid += 1;
      continue;
    }
    let submitDataUrl = image.dataUrl;
    if (initialBytes > limits.maxPerImageDataUrlBytes) {
      const compressed = await compressImageDataUrlToLimit(image.dataUrl, limits.maxPerImageDataUrlBytes);
      if (!compressed) {
        droppedOversize += 1;
        continue;
      }
      submitDataUrl = compressed;
    }
    const bytes = referenceDataUrlBytes(submitDataUrl);
    if (totalBytes + bytes > limits.maxTotalDataUrlBytes) {
      droppedOversize += 1;
      continue;
    }
    accepted.push({ ...image, dataUrl: submitDataUrl });
    totalBytes += bytes;
  }
  return { accepted, droppedInvalid, droppedOversize, totalBytes };
}

function parseApiErrorMessage(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; details?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return null;
    const error = typeof parsed.error === "string" ? parsed.error.trim() : "";
    const details = typeof parsed.details === "string" ? parsed.details.trim() : "";
    if (error && details) return `${error}: ${details}`;
    if (details) return details;
    if (error) return error;
  } catch {
    // Non-JSON error text.
  }
  return null;
}

function isLikelyNetworkSubmitFailure(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("load failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("network request failed") ||
    normalized.includes("request timed out")
  );
}

function withReferenceSettings(
  settings: GenerationJob["request"]["settings"],
  references: ReferenceImage[],
  model: string
): GenerationJob["request"]["settings"] {
  const next: GenerationJob["request"]["settings"] = { ...settings };
  for (let i = 0; i < references.length; i += 1) {
    next[`referenceImageDataUrl${i + 1}`] = references[i].dataUrl;
    const sourceUrl = references[i].sourceUrl;
    if (
      model === "A2E Image generator" &&
      typeof sourceUrl === "string" &&
      sourceUrl.length > 0 &&
      isPublicHttpUrl(sourceUrl)
    ) {
      next[`referenceImageUrl${i + 1}`] = sourceUrl;
    }
  }
  return next;
}

function withoutReferenceSettings(
  settings: GenerationJob["request"]["settings"]
): GenerationJob["request"]["settings"] {
  const next: GenerationJob["request"]["settings"] = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("referenceImageDataUrl")) continue;
    if (key.startsWith("referenceImageUrl")) continue;
    next[key] = value;
  }
  return next;
}

function toAbsoluteHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/") && typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${trimmed}`;
  }
  return null;
}

function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) {
      return false;
    }
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function estimateGenerationBodyBytes(request: GenerationJob["request"]): number {
  return JSON.stringify({
    workspaceId: "ws_demo",
    ...request
  }).length;
}

async function shrinkReferencesForPayloadBudget(params: {
  images: ReferenceImage[];
  maxBodyBytes: number;
  estimateBodyBytes: (images: ReferenceImage[]) => number;
}): Promise<{
  references: ReferenceImage[];
  compressedCount: number;
  droppedCount: number;
  estimatedBodyBytes: number;
}> {
  let references = params.images.map((image) => ({ ...image }));
  let compressedCount = 0;
  let droppedCount = 0;
  let estimatedBodyBytes = params.estimateBodyBytes(references);
  if (estimatedBodyBytes <= params.maxBodyBytes) {
    return { references, compressedCount, droppedCount, estimatedBodyBytes };
  }

  for (const targetBytes of SUBMIT_REFERENCE_TARGET_BYTES) {
    if (references.length === 0) break;
    let changed = false;
    const next: ReferenceImage[] = [];

    for (const reference of references) {
      const bytes = referenceDataUrlBytes(reference.dataUrl);
      if (bytes <= 0) {
        droppedCount += 1;
        changed = true;
        continue;
      }
      if (bytes <= targetBytes) {
        next.push(reference);
        continue;
      }
      const compressed = await compressImageDataUrlToLimit(reference.dataUrl, targetBytes);
      if (!compressed) {
        droppedCount += 1;
        changed = true;
        continue;
      }
      if (compressed !== reference.dataUrl) {
        compressedCount += 1;
        changed = true;
      }
      next.push({ ...reference, dataUrl: compressed });
    }

    references = next;
    estimatedBodyBytes = params.estimateBodyBytes(references);
    if (estimatedBodyBytes <= params.maxBodyBytes) {
      return { references, compressedCount, droppedCount, estimatedBodyBytes };
    }
    if (!changed) continue;
  }

  while (references.length > 0 && estimatedBodyBytes > params.maxBodyBytes) {
    references = references.slice(0, -1);
    droppedCount += 1;
    estimatedBodyBytes = params.estimateBodyBytes(references);
  }

  return { references, compressedCount, droppedCount, estimatedBodyBytes };
}

function readPromptByProject(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROMPT_BY_PROJECT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === "string");
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    return {};
  }
}

function writePromptByProject(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROMPT_BY_PROJECT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage write failures.
  }
}

function sanitizeReferenceImages(value: unknown): ReferenceImage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ReferenceImage =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      typeof (item as { name?: unknown }).name === "string" &&
      typeof (item as { dataUrl?: unknown }).dataUrl === "string"
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      dataUrl: item.dataUrl,
      sourceUrl: typeof (item as { sourceUrl?: unknown }).sourceUrl === "string"
        ? (item as { sourceUrl: string }).sourceUrl
        : undefined
    }));
}

function readRefsByProjectFromLocalStorage(): Record<string, ReferenceImage[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REFS_BY_PROJECT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const entries = Object.entries(parsed as Record<string, unknown>).map(([projectId, value]) => [projectId, sanitizeReferenceImages(value)] as const);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function writeRefsByProjectToLocalStorage(map: Record<string, ReferenceImage[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REFS_BY_PROJECT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage write failures.
  }
}

async function openReferenceImageDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") return null;
  return await new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = window.indexedDB.open(REFERENCE_IMAGE_DB_NAME, REFERENCE_IMAGE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(REFERENCE_IMAGE_STORE_NAME)) {
          db.createObjectStore(REFERENCE_IMAGE_STORE_NAME, { keyPath: "projectId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readRefsForProject(projectId: string): Promise<ReferenceImage[] | null> {
  const db = await openReferenceImageDb();
  if (!db) return null;
  return await new Promise<ReferenceImage[]>((resolve) => {
    try {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE_NAME, "readonly");
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE_NAME);
      const request = store.get(projectId);
      request.onsuccess = () => {
        const result = request.result as { refs?: unknown } | undefined;
        resolve(sanitizeReferenceImages(result?.refs ?? []));
      };
      request.onerror = () => resolve([]);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
      transaction.onabort = () => db.close();
    } catch {
      db.close();
      resolve([]);
    }
  });
}

async function writeRefsForProject(projectId: string, refs: ReferenceImage[]): Promise<boolean> {
  const db = await openReferenceImageDb();
  if (!db) return false;
  return await new Promise<boolean>((resolve) => {
    try {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE_NAME);
      store.put({ projectId, refs: sanitizeReferenceImages(refs) });
      transaction.oncomplete = () => {
        db.close();
        resolve(true);
      };
      transaction.onerror = () => {
        db.close();
        resolve(false);
      };
      transaction.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

function isModelKey(value: string): value is ModelKey {
  return MODEL_KEYS.includes(value as ModelKey);
}

function defaultModelConfigs(): Record<ModelKey, ModelPanelConfig> {
  return {
    "gemini-2.0-flash": { count: 1, aspectRatio: defaultAspectRatioForModel("gemini-2.0-flash"), resolution: "1K" },
    "nano-banana-pro": { count: 1, aspectRatio: defaultAspectRatioForModel("nano-banana-pro"), resolution: "1K" },
    "nano-banana": { count: 1, aspectRatio: defaultAspectRatioForModel("nano-banana"), resolution: "1K" },
    a2e: { count: 1, aspectRatio: defaultAspectRatioForModel("a2e"), resolution: "1K" }
  };
}

function normalizeModelConfig(key: ModelKey, value: unknown): ModelPanelConfig {
  const fallback = defaultModelConfigs()[key];
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<ModelPanelConfig>;
  const model = MODEL_OPTIONS.find((item) => item.key === key);
  const resolution = typeof candidate.resolution === "string" && model?.resolutions.includes(candidate.resolution)
    ? candidate.resolution
    : fallback.resolution;
  const aspectRatioOptions = aspectRatioOptionsForModel(key);
  const aspectRatio = typeof candidate.aspectRatio === "string" && aspectRatioOptions.includes(candidate.aspectRatio)
    ? candidate.aspectRatio
    : fallback.aspectRatio;
  const count = typeof candidate.count === "number"
    ? Math.max(1, Math.min(6, Math.floor(candidate.count)))
    : fallback.count;
  return { count, aspectRatio, resolution };
}

function readSettingsByProject(): Record<string, ProjectGeneratorSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SETTINGS_BY_PROJECT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const output: Record<string, ProjectGeneratorSettings> = {};
    for (const [projectId, item] of Object.entries(parsed as Record<string, unknown>)) {
      if (!item || typeof item !== "object") continue;
      const typed = item as {
        modelKey?: unknown;
        selectedModelKeys?: unknown;
        modelConfigs?: unknown;
      };
      const selectedModelKeys = Array.isArray(typed.selectedModelKeys)
        ? typed.selectedModelKeys.filter((value): value is ModelKey => typeof value === "string" && isModelKey(value))
        : [];
      const safeSelected = normalizeSelectedModelKeys(selectedModelKeys);
      const modelKey = typeof typed.modelKey === "string" && isModelKey(typed.modelKey) ? typed.modelKey : safeSelected[0];
      const configsRaw = typed.modelConfigs && typeof typed.modelConfigs === "object"
        ? (typed.modelConfigs as Record<string, unknown>)
        : {};
      const configs = defaultModelConfigs();
      for (const key of MODEL_KEYS) {
        configs[key] = normalizeModelConfig(key, configsRaw[key]);
      }
      output[projectId] = {
        modelKey,
        selectedModelKeys: safeSelected,
        modelConfigs: configs
      };
    }
    return output;
  } catch {
    return {};
  }
}

function writeSettingsByProject(map: Record<string, ProjectGeneratorSettings>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_BY_PROJECT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage write failures.
  }
}

export function GlobalGeneratePanel() {
  const {
    folders,
    assets,
    draggedItemIds,
    selectedProjectId,
    selectProject,
    setCreateModalOpen,
    refreshMedia,
    addOptimisticGenerationJob,
    reconcileOptimisticGenerationJob,
    removeGenerationJob,
    pushNotification
  } = useProjects();
  const [promptLoaded, setPromptLoaded] = useState(false);
  const [modelKey, setModelKey] = useState<ModelKey>(DEFAULT_MODEL_KEY);
  const [selectedModelKeys, setSelectedModelKeys] = useState<ModelKey[]>([DEFAULT_MODEL_KEY]);
  const [modelConfigs, setModelConfigs] = useState<Record<ModelKey, ModelPanelConfig>>(defaultModelConfigs);
  const [panelState, setPanelState] = useState<GeneratePanelState>({
    prompt: "",
    model: "Gemini 2.0 Flash",
    type: "IMAGE",
    aspectRatio: "1:1",
    resolution: "1K",
    targetProjectId: null,
    canSubmit: false,
    error: null
  });
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [isDropActive, setIsDropActive] = useState(false);
  const [keyboardPressingGenerate, setKeyboardPressingGenerate] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [uiProfile, setUiProfile] = useState<UiProfile>(DEFAULT_UI_PROFILE);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuClosing, setModelMenuClosing] = useState(false);
  const [openInlineMenuId, setOpenInlineMenuId] = useState<string | null>(null);
  const [closingInlineMenuIds, setClosingInlineMenuIds] = useState<Record<string, true>>({});
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const referencePickerRef = useRef<HTMLInputElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuCloseTimeoutRef = useRef<number | null>(null);
  const inlineMenuCloseTimeoutsRef = useRef<Record<string, number>>({});
  const dropDepthRef = useRef(0);
  const keyboardPressTimeoutRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const promptByProjectRef = useRef<Record<string, string>>({});
  const refsByProjectRef = useRef<Record<string, ReferenceImage[]>>({});
  const referenceImagesRef = useRef<ReferenceImage[]>([]);
  const settingsByProjectRef = useRef<Record<string, ProjectGeneratorSettings>>({});
  const activeModelKeyRef = useRef<ModelKey>(DEFAULT_MODEL_KEY);
  const refsHydrationVersionRef = useRef(0);
  const suppressProjectScopedPersistRef = useRef(false);

  function setActiveModelKey(next: ModelKey): void {
    activeModelKeyRef.current = next;
    setModelKey(next);
  }

  const model = useMemo(() => MODEL_OPTIONS.find((item) => item.key === modelKey) ?? MODEL_OPTIONS[0], [modelKey]);
  const selectedModels = useMemo(() => {
    const byKey = new Map(MODEL_OPTIONS.map((option) => [option.key, option]));
    return normalizeSelectedModelKeys(selectedModelKeys).map((key) => byKey.get(key)).filter(Boolean) as Array<(typeof MODEL_OPTIONS)[number]>;
  }, [selectedModelKeys]);
  const maxReferenceImages = useMemo(() => {
    if (selectedModels.length === 0) return 0;
    return Math.max(...selectedModels.map((item) => item.maxReferenceImages));
  }, [selectedModels]);
  const supportsReferenceImages = selectedModels.length > 0 && selectedModels.every((item) => item.maxReferenceImages > 0);
  const selectedProjectName = useMemo(
    () => folders.find((folder) => folder.id === selectedProjectId)?.name ?? null,
    [folders, selectedProjectId]
  );
  const referenceBudget = useMemo(() => ({
    maxPerImageDataUrlBytes: positiveInteger(
      uiProfile.referenceImages.maxPerImageDataUrlBytes,
      MAX_REFERENCE_IMAGE_DATA_URL_BYTES
    ),
    maxTotalDataUrlBytes: positiveInteger(
      uiProfile.referenceImages.maxTotalDataUrlBytes,
      MAX_REFERENCE_TOTAL_DATA_URL_BYTES
    ),
    safeGenerationBodyBytes: positiveInteger(
      uiProfile.referenceImages.safeGenerationBodyBytes,
      SAFE_GENERATION_BODY_BYTES
    )
  }), [uiProfile.referenceImages.maxPerImageDataUrlBytes, uiProfile.referenceImages.maxTotalDataUrlBytes, uiProfile.referenceImages.safeGenerationBodyBytes]);
  const collapsedToolsSummary = useMemo(() => {
    const modelsSummary = selectedModels.length > 0
      ? selectedModels
        .map((item) => {
          const config = modelConfigs[item.key] ?? {
            count: 1,
            aspectRatio: defaultAspectRatioForModel(item.key),
            resolution: item.resolutions[0] ?? "1K"
          };
          return `${item.label} · #${config.count} · ${aspectRatioDisplayLabel(config.aspectRatio)} · ${config.resolution}`;
        })
        .join(" | ")
      : "No model selected";
    const folderSummary = selectedProjectName ?? "No destination folder";
    return `${modelsSummary} · Folder: ${folderSummary}`;
  }, [modelConfigs, selectedModels, selectedProjectName]);
  const toolsCanCollapse = isMobileViewport;
  const toolsPanelCollapsed = toolsCanCollapse ? toolsCollapsed : false;

  const clearModelMenuCloseTimeout = () => {
    if (modelMenuCloseTimeoutRef.current === null) return;
    window.clearTimeout(modelMenuCloseTimeoutRef.current);
    modelMenuCloseTimeoutRef.current = null;
  };

  const openModelMenu = () => {
    clearModelMenuCloseTimeout();
    setModelMenuClosing(false);
    setModelMenuOpen(true);
  };

  const closeModelMenu = () => {
    if (!modelMenuOpen && !modelMenuClosing) return;
    clearModelMenuCloseTimeout();
    setModelMenuOpen(false);
    setModelMenuClosing(true);
    modelMenuCloseTimeoutRef.current = window.setTimeout(() => {
      setModelMenuClosing(false);
      modelMenuCloseTimeoutRef.current = null;
    }, MODEL_MENU_ANIMATION_MS);
  };

  const clearInlineMenuCloseTimeout = (menuId: string) => {
    const timeoutId = inlineMenuCloseTimeoutsRef.current[menuId];
    if (typeof timeoutId !== "number") return;
    window.clearTimeout(timeoutId);
    delete inlineMenuCloseTimeoutsRef.current[menuId];
  };

  const closeInlineMenu = (menuId: string) => {
    if (openInlineMenuId !== menuId && !closingInlineMenuIds[menuId]) return;
    clearInlineMenuCloseTimeout(menuId);
    setOpenInlineMenuId((prev) => (prev === menuId ? null : prev));
    setClosingInlineMenuIds((prev) => ({ ...prev, [menuId]: true }));
    inlineMenuCloseTimeoutsRef.current[menuId] = window.setTimeout(() => {
      setClosingInlineMenuIds((prev) => {
        const next = { ...prev };
        delete next[menuId];
        return next;
      });
      delete inlineMenuCloseTimeoutsRef.current[menuId];
    }, INLINE_MENU_ANIMATION_MS);
  };

  const openInlineMenu = (menuId: string) => {
    if (openInlineMenuId && openInlineMenuId !== menuId) {
      closeInlineMenu(openInlineMenuId);
    }
    clearInlineMenuCloseTimeout(menuId);
    setClosingInlineMenuIds((prev) => {
      if (!prev[menuId]) return prev;
      const next = { ...prev };
      delete next[menuId];
      return next;
    });
    setOpenInlineMenuId(menuId);
    closeModelMenu();
  };

  const toggleInlineMenu = (menuId: string) => {
    if (openInlineMenuId === menuId) {
      closeInlineMenu(menuId);
      return;
    }
    openInlineMenu(menuId);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    promptByProjectRef.current = readPromptByProject();
    refsByProjectRef.current = readRefsByProjectFromLocalStorage();
    settingsByProjectRef.current = readSettingsByProject();
    const mobileViewport = window.matchMedia(`(max-width: ${DEFAULT_UI_PROFILE.viewportBreakpointPx}px)`).matches;
    setIsMobileViewport(mobileViewport);
    let storedToolsCollapsed: "1" | "0" | null = null;
    try {
      const stored = window.localStorage.getItem(TOOLS_COLLAPSED_STORAGE_KEY);
      if (stored === "1") {
        storedToolsCollapsed = "1";
        setToolsCollapsed(true);
      } else if (stored === "0") {
        storedToolsCollapsed = "0";
        setToolsCollapsed(false);
      } else {
        setToolsCollapsed(mobileViewport);
      }
    } catch {
      setToolsCollapsed(mobileViewport);
    }
    void (async () => {
      const profile = await fetchUiProfile();
      if (cancelled) return;
      setUiProfile(profile);
      const profileViewport = window.matchMedia(`(max-width: ${profile.viewportBreakpointPx}px)`).matches;
      setIsMobileViewport(profileViewport);
      if (!storedToolsCollapsed) {
        setToolsCollapsed(profile.generatePanel.toolsDefaultCollapsed);
      }
    })();
    setPromptLoaded(true);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(`(max-width: ${uiProfile.viewportBreakpointPx}px)`);
    const syncViewport = (event?: MediaQueryListEvent) => {
      setIsMobileViewport(event ? event.matches : mediaQuery.matches);
    };
    syncViewport();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }
    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, [uiProfile.viewportBreakpointPx]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(TOOLS_COLLAPSED_STORAGE_KEY, toolsCollapsed ? "1" : "0");
    } catch {
      // Ignore storage write failures.
    }
  }, [toolsCollapsed]);

  useEffect(() => {
    if (!promptLoaded) return;
    const hydrationVersion = refsHydrationVersionRef.current + 1;
    refsHydrationVersionRef.current = hydrationVersion;
    suppressProjectScopedPersistRef.current = true;
    const storedSettings = selectedProjectId ? settingsByProjectRef.current[selectedProjectId] : undefined;
    const nextModelKey = storedSettings?.modelKey ?? DEFAULT_MODEL_KEY;
    const nextSelectedModelKeys = normalizeSelectedModelKeys(storedSettings?.selectedModelKeys ?? [nextModelKey]);
    const nextModelConfigs = storedSettings?.modelConfigs ?? defaultModelConfigs();
    const nextPrompt = selectedProjectId ? (promptByProjectRef.current[selectedProjectId] ?? "") : "";
    const nextRefs = selectedProjectId ? (refsByProjectRef.current[selectedProjectId] ?? []) : [];
    setActiveModelKey(nextModelKey);
    setSelectedModelKeys(nextSelectedModelKeys);
    setModelConfigs(nextModelConfigs);
    setPanelState((prev) => ({
      ...prev,
      prompt: nextPrompt,
      canSubmit: Boolean(nextPrompt.trim() && (selectedProjectId ?? prev.targetProjectId) && nextSelectedModelKeys.length > 0)
    }));
    setReferenceImages(nextRefs);
    const clearSuppression = () => {
      if (refsHydrationVersionRef.current !== hydrationVersion) return;
      suppressProjectScopedPersistRef.current = false;
    };
    if (selectedProjectId) {
      void (async () => {
        const persistedRefs = await readRefsForProject(selectedProjectId);
        if (refsHydrationVersionRef.current !== hydrationVersion) return;
        if (persistedRefs) {
          const hydratedRefs = persistedRefs.length > 0 || nextRefs.length === 0 ? persistedRefs : nextRefs;
          refsByProjectRef.current = { ...refsByProjectRef.current, [selectedProjectId]: hydratedRefs };
          setReferenceImages(hydratedRefs);
        }
        clearSuppression();
      })();
      return;
    }
    clearSuppression();
  }, [promptLoaded, selectedProjectId]);

  useEffect(() => {
    if (!promptLoaded || !selectedProjectId || suppressProjectScopedPersistRef.current) return;
    const next = { ...promptByProjectRef.current, [selectedProjectId]: panelState.prompt };
    promptByProjectRef.current = next;
    writePromptByProject(next);
  }, [panelState.prompt, promptLoaded, selectedProjectId]);

  useEffect(() => {
    referenceImagesRef.current = referenceImages;
  }, [referenceImages]);

  useEffect(() => {
    if (!promptLoaded || !selectedProjectId || suppressProjectScopedPersistRef.current) return;
    const next = { ...refsByProjectRef.current, [selectedProjectId]: referenceImages };
    refsByProjectRef.current = next;
    void (async () => {
      const wroteToIndexedDb = await writeRefsForProject(selectedProjectId, referenceImages);
      if (!wroteToIndexedDb) {
        writeRefsByProjectToLocalStorage(next);
      }
    })();
  }, [promptLoaded, referenceImages, selectedProjectId]);

  useEffect(() => {
    if (!promptLoaded || !selectedProjectId || suppressProjectScopedPersistRef.current) return;
    const next = {
      ...settingsByProjectRef.current,
      [selectedProjectId]: {
        modelKey,
        selectedModelKeys,
        modelConfigs
      }
    };
    settingsByProjectRef.current = next;
    writeSettingsByProject(next);
  }, [modelConfigs, modelKey, promptLoaded, selectedModelKeys, selectedProjectId]);

  useEffect(() => {
    setPanelState((prev) => {
      const nextTarget = selectedProjectId ?? prev.targetProjectId;
      const canSubmit = Boolean(nextTarget && prev.prompt.trim() && selectedModels.length > 0);
      return {
        ...prev,
        model: model.apiModel,
        targetProjectId: nextTarget,
        canSubmit,
        error: null
      };
    });
  }, [model, modelKey, selectedModels.length, selectedProjectId]);

  useEffect(() => {
    if (!supportsReferenceImages) {
      setReferenceImages([]);
      return;
    }
    setReferenceImages((prev) => prev.slice(0, maxReferenceImages));
  }, [maxReferenceImages, supportsReferenceImages]);

  useEffect(() => {
    function onReferenceEvent(event: Event): void {
      const custom = event as CustomEvent<{ id: string; name: string; dataUrl: string; sourceUrl?: string }>;
      const payload = custom.detail;
      if (!payload || !payload.dataUrl) return;
      if (!supportsReferenceImages) {
        setPanelState((prev) => ({ ...prev, error: "Selected model does not support reference images." }));
        return;
      }
      void addReferenceEntries([{ id: payload.id, name: payload.name, dataUrl: payload.dataUrl, sourceUrl: payload.sourceUrl }]);
    }
    window.addEventListener("aidrive:add-reference", onReferenceEvent as EventListener);
    return () => window.removeEventListener("aidrive:add-reference", onReferenceEvent as EventListener);
  }, [maxReferenceImages, supportsReferenceImages]);

  useEffect(() => {
    function handleOutsidePointerDown(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".model-picker, .project-picker, .inline-picker")) return;
      closeModelMenu();
      if (openInlineMenuId) {
        closeInlineMenu(openInlineMenuId);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      closeModelMenu();
      if (openInlineMenuId) {
        closeInlineMenu(openInlineMenuId);
      }
    }

    document.addEventListener("mousedown", handleOutsidePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeInlineMenu, closeModelMenu, openInlineMenuId]);

  const canSubmit = panelState.canSubmit && selectedModels.length > 0;

  function toggleToolsPanel(): void {
    if (!toolsCanCollapse) return;
    setToolsCollapsed((value) => {
      const next = !value;
      if (next) {
        closeModelMenu();
        if (openInlineMenuId) {
          closeInlineMenu(openInlineMenuId);
        }
      }
      return next;
    });
  }

  function resizePromptInput(): void {
    const input = promptInputRef.current;
    if (!input) return;
    const minHeight = 58;
    const maxHeight = 210;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, contentHeight));
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }

  function onPromptKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;
    if (event.altKey) return;
    event.preventDefault();
    const form = event.currentTarget.form;
    if (!form || !canSubmit) return;
    if (keyboardPressTimeoutRef.current !== null) {
      window.clearTimeout(keyboardPressTimeoutRef.current);
    }
    setKeyboardPressingGenerate(true);
    keyboardPressTimeoutRef.current = window.setTimeout(() => {
      setKeyboardPressingGenerate(false);
      keyboardPressTimeoutRef.current = null;
    }, 130);
    form.requestSubmit();
  }

  useEffect(() => {
    return () => {
      if (keyboardPressTimeoutRef.current !== null) {
        window.clearTimeout(keyboardPressTimeoutRef.current);
      }
      if (modelMenuCloseTimeoutRef.current !== null) {
        window.clearTimeout(modelMenuCloseTimeoutRef.current);
      }
      const timeoutIds = Object.values(inlineMenuCloseTimeoutsRef.current);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      inlineMenuCloseTimeoutsRef.current = {};
    };
  }, []);

  useEffect(() => {
    resizePromptInput();
  }, [panelState.prompt]);

  async function blobToDataUrl(blob: Blob): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read image blob"));
      reader.readAsDataURL(blob);
    });
  }

  async function toDataUrlFromUrl(url: string): Promise<string | null> {
    if (url.startsWith("data:image/")) return url;
    let fetchUrl = url;
    if (fetchUrl.startsWith("http://") || fetchUrl.startsWith("https://")) {
      fetchUrl = `/api/image?url=${encodeURIComponent(fetchUrl)}`;
    } else if (fetchUrl.startsWith("/")) {
      fetchUrl = `${window.location.origin}${fetchUrl}`;
    }
    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) return null;
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.startsWith("image/")) return null;
      const blob = await response.blob();
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  async function addReferenceEntries(entries: ReferenceImage[]): Promise<void> {
    if (!supportsReferenceImages) {
      setPanelState((prev) => ({ ...prev, error: "Selected model does not support reference images." }));
      return;
    }
    if (entries.length === 0) return;
    const baseline = referenceImagesRef.current;
    const next = [...baseline];
    let totalBytes = totalReferenceDataUrlBytes(next);
    let skippedInvalid = 0;
    let skippedSize = 0;
    let skippedCapacity = 0;

    for (const candidate of entries) {
      if (next.some((item) => item.id === candidate.id || item.dataUrl === candidate.dataUrl)) continue;
      if (next.length >= maxReferenceImages) {
        skippedCapacity += 1;
        continue;
      }
      const fitted = await fitReferenceImageToBudget(
        candidate.dataUrl,
        referenceBudget.maxTotalDataUrlBytes - totalBytes,
        referenceBudget.maxPerImageDataUrlBytes
      );
      if (!fitted) {
        const candidateBytes = referenceDataUrlBytes(candidate.dataUrl);
        if (candidateBytes <= 0) {
          skippedInvalid += 1;
        } else {
          skippedSize += 1;
        }
        continue;
      }
      const fittedBytes = referenceDataUrlBytes(fitted);
      if (fittedBytes <= 0 || totalBytes + fittedBytes > referenceBudget.maxTotalDataUrlBytes) {
        skippedSize += 1;
        continue;
      }
      next.push({ ...candidate, dataUrl: fitted });
      totalBytes += fittedBytes;
    }

    setReferenceImages(next);
    referenceImagesRef.current = next;
    const addedCount = next.length - baseline.length;
    if (addedCount <= 0) {
      if (skippedCapacity > 0) {
        setPanelState((state) => ({
          ...state,
          error: `This model supports up to ${maxReferenceImages} reference image${maxReferenceImages > 1 ? "s" : ""}.`
        }));
        return;
      }
      if (skippedSize > 0) {
        setPanelState((state) => ({
          ...state,
          error: referenceSizeLimitMessage(referenceBudget.maxPerImageDataUrlBytes, referenceBudget.maxTotalDataUrlBytes)
        }));
        return;
      }
      if (skippedInvalid > 0) {
        setPanelState((state) => ({ ...state, error: "One or more references had an invalid image format." }));
        return;
      }
      setPanelState((state) => ({ ...state, error: null }));
      return;
    }

    const skippedTotal = skippedInvalid + skippedSize + skippedCapacity;
    if (skippedTotal > 0) {
      const reasons: string[] = [];
      if (skippedSize > 0) {
        reasons.push(referenceSizeLimitMessage(referenceBudget.maxPerImageDataUrlBytes, referenceBudget.maxTotalDataUrlBytes));
      }
      if (skippedInvalid > 0) reasons.push("Invalid image format.");
      if (skippedCapacity > 0) reasons.push(`Max ${maxReferenceImages} references.`);
      setPanelState((state) => ({
        ...state,
        error: `${addedCount} reference image${addedCount === 1 ? "" : "s"} added. ${skippedTotal} skipped. ${reasons.join(" ")}`
      }));
      return;
    }
    setPanelState((state) => ({ ...state, error: null }));
  }

  function snapshotDropPayload(dataTransfer: DataTransfer): DropPayload {
    const fromMime = readDraggedAssetIds({ dataTransfer });
    const fromGlobalDragState = readActiveDraggedAssetIds();
    const mergedDraggedIds = [...new Set([...fromMime, ...draggedItemIds, ...fromGlobalDragState])];
    return {
      files: Array.from(dataTransfer.files ?? []),
      draggedAssetIds: mergedDraggedIds,
      uriList: dataTransfer.getData("text/uri-list"),
      textPlain: dataTransfer.getData("text/plain"),
      textHtml: dataTransfer.getData("text/html")
    };
  }

  async function buildReferencesFromDrop(payload: DropPayload): Promise<ReferenceImage[]> {
    const refs: ReferenceImage[] = [];
    const files = payload.files.filter((file) => file.type.startsWith("image/"));
    if (files.length > 0) {
      const fromFiles = await Promise.all(
        files.map(async (file) => ({
          id: createClientRequestId(),
          name: file.name,
          dataUrl: await blobToDataUrl(file)
        }))
      );
      refs.push(...fromFiles);
    }

    if (payload.draggedAssetIds.length > 0) {
      for (const assetId of payload.draggedAssetIds) {
        if (assetId.startsWith("pending:")) continue;
        const asset = assets.find((item) => item.id === assetId);
        if (!asset) continue;
        const previewRaw = asset.previewUrl ? toDisplayPreviewUrl(asset.previewUrl) : "";
        const url = previewRaw || resolveAssetPreview(asset);
        const dataUrl = await toDataUrlFromUrl(url);
        if (!dataUrl) continue;
        refs.push({
          id: createClientRequestId(),
          name: asset.name || `asset-${asset.id}`,
          dataUrl,
          sourceUrl: toAbsoluteHttpUrl(url) ?? undefined
        });
      }
    }

    const htmlUrls = Array.from(payload.textHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).map((match) => match[1]);
    const urlCandidates = [...payload.uriList.split("\n"), ...payload.textPlain.split("\n")]
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .filter((line) => line.startsWith("http://") || line.startsWith("https://") || line.startsWith("data:image/") || line.startsWith("blob:"));
    const uniqueUrls = [...new Set([...urlCandidates, ...htmlUrls])];
    for (const url of uniqueUrls) {
      const dataUrl = await toDataUrlFromUrl(url);
      if (!dataUrl) continue;
      refs.push({
        id: createClientRequestId(),
        name: "dropped-image",
        dataUrl,
        sourceUrl: toAbsoluteHttpUrl(url) ?? undefined
      });
    }

    return refs;
  }

  function onChooseModel(value: ModelKey): void {
    setActiveModelKey(value);
    setSelectedModelKeys((prev) => {
      if (prev.includes(value)) return prev;
      return [...prev, value];
    });
    setModelConfigs((prev) => {
      if (prev[value]) return prev;
      const found = MODEL_OPTIONS.find((item) => item.key === value);
      return {
        ...prev,
        [value]: { count: 1, aspectRatio: defaultAspectRatioForModel(value), resolution: found?.resolutions[0] ?? "1K" }
      };
    });
  }

  function removeModel(value: ModelKey): void {
    setSelectedModelKeys((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((key) => key !== value);
      if (!next.includes(modelKey)) {
        setActiveModelKey(next[0]);
      }
      return next;
    });
  }

  function toggleModelSelection(value: ModelKey): void {
    setSelectedModelKeys((prev) => {
      if (!prev.includes(value)) {
        setActiveModelKey(value);
        return [...prev, value];
      }
      if (prev.length <= 1) return prev;
      const next = prev.filter((key) => key !== value);
      if (activeModelKeyRef.current === value) {
        setActiveModelKey(next[0]);
      }
      return next;
    });
  }

  async function onPickReferenceImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const allowed = Math.max(0, maxReferenceImages - referenceImages.length);
    const chosen = files.filter((file) => file.type.startsWith("image/")).slice(0, allowed);
    if (chosen.length === 0) {
      setPanelState((prev) => ({ ...prev, error: `This model supports up to ${maxReferenceImages} reference image${maxReferenceImages > 1 ? "s" : ""}.` }));
      return;
    }

    try {
      const loaded = await Promise.all(
        chosen.map(async (file) => {
          let dataUrl = await compressImageBlobToLimit(file, referenceBudget.maxPerImageDataUrlBytes);
          if (!dataUrl) {
            dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result ?? ""));
              reader.onerror = () => reject(new Error("Failed to read reference image"));
              reader.readAsDataURL(file);
            });
          }
          return { id: createClientRequestId(), name: file.name, dataUrl };
        })
      );
      await addReferenceEntries(loaded);
    } catch {
      setPanelState((prev) => ({ ...prev, error: "Failed to load one or more reference images." }));
    } finally {
      if (referencePickerRef.current) {
        referencePickerRef.current.value = "";
      }
    }
  }

  function onPanelDragEnter(event: ReactDragEvent<HTMLFormElement>): void {
    event.preventDefault();
    dropDepthRef.current += 1;
    setIsDropActive(true);
  }

  function onPanelDragOver(event: ReactDragEvent<HTMLFormElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDropActive) setIsDropActive(true);
  }

  function onPanelDragLeave(event: ReactDragEvent<HTMLFormElement>): void {
    event.preventDefault();
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) {
      setIsDropActive(false);
    }
  }

  async function onPanelDrop(event: ReactDragEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const { dataTransfer } = event;
    const payload = snapshotDropPayload(dataTransfer);
    dropDepthRef.current = 0;
    setIsDropActive(false);
    const refs = await buildReferencesFromDrop(payload);
    if (refs.length === 0) {
      setPanelState((prev) => ({ ...prev, error: "Drop one or more images to add references." }));
      return;
    }
    await addReferenceEntries(refs);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || !panelState.targetProjectId) return;
    if (suppressProjectScopedPersistRef.current) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const activeProjectId = panelState.targetProjectId;
    const activeProjectRefs = refsByProjectRef.current[activeProjectId] ?? [];
    const submitSourceReferences = suppressProjectScopedPersistRef.current
      ? activeProjectRefs
      : referenceImagesRef.current;
    const submitTraceId = createTraceId();
    const emitSubmitDiagnostic = (
      eventName: string,
      severity: "WARN" | "HIGH",
      message: string,
      context: Record<string, unknown>,
      modelOverride?: ModelKey
    ): void => {
      const diagnosticModelKey = modelOverride ?? activeModelKeyRef.current;
      void postClientDiagnostic({
        severity,
        category: "GENERATION",
        component: "web.generate_panel",
        eventName,
        message,
        workspaceId: "ws_demo",
        traceId: submitTraceId,
        context: {
          projectId: activeProjectId,
          model: diagnosticModelKey,
          requestedCount: modelConfigs[diagnosticModelKey]?.count ?? 1,
          ...context
        }
      });
    };

    try {
      let failureCount = 0;
      let fallbackWithoutReferencesCount = 0;
      const fallbackWithoutReferencesByModel: Record<string, number> = {};
      const requests: Array<{ optimisticId: string; payload: GenerationJob["request"] }> = [];
      const selectedKeysForSubmit = normalizeSelectedModelKeys(selectedModelKeys);
      const modelsToSubmit = selectedKeysForSubmit
        .map((key) => MODEL_OPTIONS.find((item) => item.key === key))
        .filter((item): item is (typeof MODEL_OPTIONS)[number] => Boolean(item));
      if (modelsToSubmit.length === 0) {
        setPanelState((prev) => ({ ...prev, error: "Choose at least one model." }));
        return;
      }
      const perModelRequestedCounts = Object.fromEntries(
        modelsToSubmit.map((selected) => {
          const config = modelConfigs[selected.key] ?? {
            count: 1,
            aspectRatio: defaultAspectRatioForModel(selected.key),
            resolution: selected.resolutions[0]
          };
          return [selected.key, config.count];
        })
      );
      emitSubmitDiagnostic(
        "generation.submit.multi_model_selection",
        "WARN",
        "Submitting with selected models",
        {
          selectedModelKeys: modelsToSubmit.map((item) => item.key),
          perModelRequestedCounts
        }
      );
      const submitNotes: string[] = [];
      const submitReferences = await selectSubmitReferenceImages(submitSourceReferences, referenceBudget);
      let referencesForSubmit = submitReferences.accepted;
      if (submitReferences.accepted.length !== submitSourceReferences.length) {
        const droppedCount = submitReferences.droppedInvalid + submitReferences.droppedOversize;
        const droppedReason = submitReferences.droppedOversize > 0
          ? referenceSizeLimitMessage(referenceBudget.maxPerImageDataUrlBytes, referenceBudget.maxTotalDataUrlBytes)
          : "One or more references had an invalid image format.";
        submitNotes.push(`${droppedCount} reference image${droppedCount === 1 ? "" : "s"} were removed. ${droppedReason}`);
        emitSubmitDiagnostic(
          "generation.submit.references_filtered",
          "WARN",
          "Reference images were removed before submit",
          {
            droppedCount,
            droppedInvalid: submitReferences.droppedInvalid,
            droppedOversize: submitReferences.droppedOversize,
            acceptedCount: submitReferences.accepted.length,
            requestedCount: submitSourceReferences.length
          }
        );
      }
      const referencesBeforeBudget = referencesForSubmit;
      const budgetedReferences = await shrinkReferencesForPayloadBudget({
        images: referencesForSubmit,
        maxBodyBytes: referenceBudget.safeGenerationBodyBytes,
        estimateBodyBytes: (images) => {
          const estimates = modelsToSubmit.map((selected) => {
          const config = modelConfigs[selected.key] ?? {
            count: 1,
            aspectRatio: defaultAspectRatioForModel(selected.key),
            resolution: selected.resolutions[0]
          };
            const payloadEstimateBase: GenerationJob["request"] = {
              folderId: panelState.targetProjectId ?? activeProjectId,
              prompt: panelState.prompt.trim(),
              model: selected.apiModel,
              type: panelState.type,
              settings: {
                quality: config.resolution,
                resolution: config.resolution,
                aspectRatio: config.aspectRatio,
                [GENERATION_CLIENT_REQUEST_ID_KEY]: "estimate-only"
              }
            };
            return estimateGenerationBodyBytes({
              ...payloadEstimateBase,
              settings: withReferenceSettings(payloadEstimateBase.settings, images, selected.apiModel)
            });
          });
          return Math.max(...estimates);
        }
      });
      const referencesChangedByBudget =
        budgetedReferences.references.length !== referencesBeforeBudget.length ||
        budgetedReferences.references.some((item, index) => item.dataUrl !== referencesBeforeBudget[index]?.dataUrl);
      referencesForSubmit = budgetedReferences.references;
      if (budgetedReferences.compressedCount > 0) {
        submitNotes.push(`Compressed ${budgetedReferences.compressedCount} reference image${budgetedReferences.compressedCount === 1 ? "" : "s"} to fit request limits.`);
        emitSubmitDiagnostic(
          "generation.submit.references_compressed",
          "WARN",
          "Reference images were compressed for request size budget",
          {
            compressedCount: budgetedReferences.compressedCount,
            remainingReferences: budgetedReferences.references.length
          }
        );
      }
      if (budgetedReferences.droppedCount > 0) {
        submitNotes.push(`Removed ${budgetedReferences.droppedCount} additional reference image${budgetedReferences.droppedCount === 1 ? "" : "s"} to fit request size.`);
        emitSubmitDiagnostic(
          "generation.submit.references_dropped_for_budget",
          "WARN",
          "Reference images were dropped to satisfy request size budget",
          {
            droppedCount: budgetedReferences.droppedCount,
            remainingReferences: budgetedReferences.references.length
          }
        );
      }
      if (submitReferences.accepted.length !== submitSourceReferences.length || referencesChangedByBudget) {
        setReferenceImages(referencesForSubmit);
        referenceImagesRef.current = referencesForSubmit;
      }
      if (budgetedReferences.estimatedBodyBytes > referenceBudget.safeGenerationBodyBytes) {
        emitSubmitDiagnostic(
          "generation.submit.payload_too_large",
          "HIGH",
          "Generation submit blocked because payload remained too large",
          {
            estimatedBodyBytes: budgetedReferences.estimatedBodyBytes,
            maxBodyBytes: referenceBudget.safeGenerationBodyBytes,
            referencesRemaining: referencesForSubmit.length
          }
        );
        setPanelState((prev) => ({
          ...prev,
          error: `Request is still too large (${formatMegabytes(budgetedReferences.estimatedBodyBytes)}). Shorten the prompt or remove references.`
        }));
        return;
      }
      if (submitNotes.length > 0) {
        setPanelState((prev) => ({ ...prev, error: submitNotes.join(" ") }));
      }
      const perModelTrimmedReferences: Record<string, { used: number; available: number; limit: number }> = {};
      let inferredSourceAspectRatio: number | null = null;
      if (referencesForSubmit.length > 0) {
        const firstReference = referencesForSubmit[0];
        const ratioImage = await new Promise<HTMLImageElement | null>((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = firstReference.dataUrl;
        });
        if (ratioImage) {
          const width = ratioImage.naturalWidth || ratioImage.width;
          const height = ratioImage.naturalHeight || ratioImage.height;
          if (width > 0 && height > 0) {
            inferredSourceAspectRatio = width / height;
          }
        }
      }
      for (const selected of modelsToSubmit) {
        const config = modelConfigs[selected.key] ?? {
          count: 1,
          aspectRatio: defaultAspectRatioForModel(selected.key),
          resolution: selected.resolutions[0]
        };
        const resolvedAspectRatio = config.aspectRatio === ASPECT_RATIO_AUTO
          ? closestAspectRatioForValue(
            inferredSourceAspectRatio ?? 1,
            selected.key === "a2e" ? A2E_SUPPORTED_ASPECT_RATIOS : ASPECT_RATIOS
          )
          : config.aspectRatio;
        const modelReferences = referencesForSubmit.slice(0, selected.maxReferenceImages);
        if (modelReferences.length < referencesForSubmit.length) {
          perModelTrimmedReferences[selected.key] = {
            used: modelReferences.length,
            available: referencesForSubmit.length,
            limit: selected.maxReferenceImages
          };
        }
        for (let n = 0; n < config.count; n += 1) {
          const clientRequestId = createClientRequestId();
          const baseSettings: GenerationJob["request"]["settings"] = {
            quality: config.resolution,
            resolution: config.resolution,
            aspectRatio: resolvedAspectRatio,
            [GENERATION_CLIENT_REQUEST_ID_KEY]: clientRequestId
          };
          const payload: GenerationJob["request"] = {
            folderId: activeProjectId,
            prompt: panelState.prompt.trim(),
            model: selected.apiModel,
            type: panelState.type,
            settings: withReferenceSettings(baseSettings, modelReferences, selected.apiModel)
          };
          const optimisticId = addOptimisticGenerationJob(payload);
          requests.push({ optimisticId, payload });
        }
      }
      if (Object.keys(perModelTrimmedReferences).length > 0) {
        const trimmedNotes = Object.entries(perModelTrimmedReferences).map(([key, info]) => {
          const selected = MODEL_OPTIONS.find((item) => item.key === key);
          const label = selected?.label ?? key;
          return `${label} submitted with first ${info.used} reference${info.used === 1 ? "" : "s"} (model limit).`;
        });
        setPanelState((prev) => ({
          ...prev,
          error: [prev.error, ...trimmedNotes].filter(Boolean).join(" ").trim() || null
        }));
        emitSubmitDiagnostic(
          "generation.submit.references_trimmed_per_model",
          "WARN",
          "Reference images trimmed per model capability limits",
          {
            trimmedByModel: perModelTrimmedReferences
          }
        );
      }

      const results = await Promise.allSettled(
        requests.map(async ({ optimisticId, payload }) => {
          try {
            const result = await apiRequest<{ job: GenerationJob }>("/v1/generation/jobs", {
              method: "POST",
              body: JSON.stringify({
                workspaceId: "ws_demo",
                ...payload
              })
            });
            reconcileOptimisticGenerationJob(optimisticId, result.job);
          } catch (error) {
            const errorText = error instanceof Error ? error.message : String(error);
            const friendly = parseApiErrorMessage(errorText) ?? errorText;
            const hasReferencesInPayload = Object.keys(payload.settings).some((key) => key.startsWith("referenceImageDataUrl"));
            const shouldRetryWithoutReferences = hasReferencesInPayload
              && (/payload too large/i.test(friendly) || isLikelyNetworkSubmitFailure(friendly));
            if (shouldRetryWithoutReferences) {
              const retryPayload: GenerationJob["request"] = {
                ...payload,
                settings: withoutReferenceSettings(payload.settings)
              };
              const retryResult = await apiRequest<{ job: GenerationJob }>("/v1/generation/jobs", {
                method: "POST",
                body: JSON.stringify({
                  workspaceId: "ws_demo",
                  ...retryPayload
                })
              });
              fallbackWithoutReferencesCount += 1;
              fallbackWithoutReferencesByModel[payload.model] = (fallbackWithoutReferencesByModel[payload.model] ?? 0) + 1;
              reconcileOptimisticGenerationJob(optimisticId, retryResult.job);
              return;
            }
            throw error;
          }
        })
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        failureCount += 1;
        removeGenerationJob(requests[index].optimisticId);
      });
      if (failureCount > 0) {
        const failedReasons = results
          .map((result) => (result.status === "rejected" ? result.reason : null))
          .filter(Boolean)
          .map((reason) => (reason instanceof Error ? reason.message : String(reason)));
        const firstReason = failedReasons[0]?.trim();
        const friendlyReason = parseApiErrorMessage(firstReason) ?? firstReason;
        const networkHint = isLikelyNetworkSubmitFailure(friendlyReason)
          ? " Mobile upload failed before the API received the request. Try fewer/smaller references or submit without references."
          : "";
        emitSubmitDiagnostic(
          "generation.submit.failed",
          "HIGH",
          "One or more generation submit requests failed",
          {
            failureCount,
            requestCount: requests.length,
            fallbackWithoutReferencesCount,
            fallbackWithoutReferencesByModel,
            selectedModelKeys: modelsToSubmit.map((item) => item.key),
            firstError: friendlyReason ?? null
          }
        );
        const targetFolder = folders.find((folder) => folder.id === activeProjectId);
        pushNotification({
          kind: "SUBMIT_FAILED",
          title: `${failureCount} request${failureCount > 1 ? "s" : ""} failed to submit`,
          message: friendlyReason
            ? `${friendlyReason}${networkHint}${targetFolder ? ` (${targetFolder.name})` : ""}`
            : `Submission failed${targetFolder ? ` in ${targetFolder.name}` : ""}.`,
          folderId: activeProjectId,
          jobId: null
        });
        setPanelState((prev) => ({
          ...prev,
          error: friendlyReason
            ? `Submit failed: ${friendlyReason}${networkHint}`
            : `${failureCount} generation request${failureCount > 1 ? "s" : ""} failed to submit.`
        }));
      } else if (fallbackWithoutReferencesCount > 0) {
        emitSubmitDiagnostic(
          "generation.submit.fallback_without_references",
          "WARN",
          "Generation submit retried without references due payload limits",
          {
            fallbackWithoutReferencesCount,
            requestCount: requests.length,
            fallbackWithoutReferencesByModel,
            selectedModelKeys: modelsToSubmit.map((item) => item.key)
          }
        );
        setPanelState((prev) => ({
          ...prev,
          error: `${fallbackWithoutReferencesCount} request${fallbackWithoutReferencesCount > 1 ? "s were" : " was"} submitted without references to fit upload limits.`
        }));
      }

      setTimeout(() => {
        void refreshMedia({ silent: true });
      }, 250);
    } finally {
      submitInFlightRef.current = false;
    }
  }

  return (
    <footer className="generate-dock-wrap">
      <form
        className={`generate-dock ${isDropActive ? "drop-active" : ""}`}
        onSubmit={onSubmit}
        onDragEnter={onPanelDragEnter}
        onDragOver={onPanelDragOver}
        onDragLeave={onPanelDragLeave}
        onDrop={(event) => {
          void onPanelDrop(event);
        }}
      >
        <div className="dock-top">
          {supportsReferenceImages ? (
            <div className="dock-references">
              <button
                className="dock-reference-add"
                type="button"
                onClick={() => referencePickerRef.current?.click()}
                disabled={referenceImages.length >= maxReferenceImages}
                aria-label="Add reference images"
                title={`Add up to ${maxReferenceImages} reference images`}
              >
                +
              </button>
              <input
                ref={referencePickerRef}
                className="dock-reference-input"
                type="file"
                accept="image/*"
                multiple
                onChange={onPickReferenceImages}
              />
              {referenceImages.map((image) => (
                <div className="dock-reference-chip" key={image.id}>
                  <img src={image.dataUrl} alt={image.name} />
                  <button
                    className="dock-reference-remove"
                    type="button"
                    onClick={() => setReferenceImages((prev) => prev.filter((item) => item.id !== image.id))}
                    aria-label={`Remove ${image.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            ref={promptInputRef}
            className="dock-prompt"
            placeholder="Describe the scene you imagine"
            value={panelState.prompt}
            rows={2}
            onKeyDown={onPromptKeyDown}
            onChange={(e) => {
              const prompt = e.target.value;
              setPanelState((prev) => ({
                ...prev,
                prompt,
                canSubmit: Boolean(prompt.trim() && (selectedProjectId ?? prev.targetProjectId))
              }));
            }}
          />
        </div>

        <div
          className={`dock-tools ${toolsPanelCollapsed ? "collapsed" : "expanded"} ${toolsCanCollapse ? "mobile-collapsible dock-tools-mobile" : "desktop-static dock-tools-desktop"}`}
        >
          {toolsCanCollapse ? (
            <button
              className={`dock-tools-surface ${toolsPanelCollapsed ? "collapsed" : "expanded"}`}
              type="button"
              aria-label={toolsPanelCollapsed ? "Expand generation tools" : "Collapse generation tools"}
              title={toolsPanelCollapsed ? "Expand tools" : "Collapse tools"}
              aria-expanded={!toolsPanelCollapsed}
              aria-controls="generation-tools"
              onClick={toggleToolsPanel}
            >
              <span className="dock-tools-surface-title">Generation tools</span>
              <span className="dock-tools-surface-summary">{collapsedToolsSummary}</span>
              <span className="dock-tools-surface-hint">{toolsPanelCollapsed ? "Tap to expand" : "Tap to collapse"}</span>
            </button>
          ) : null}
          <div
            className={`dock-tools-panel ${toolsPanelCollapsed ? "collapsed" : "expanded"}`}
            id="generation-tools"
            aria-hidden={toolsPanelCollapsed}
          >
            <div className="dock-controls">
              <div className={`model-picker ${modelMenuOpen ? "open" : ""} ${modelMenuClosing ? "closing" : ""}`} ref={modelMenuRef}>
                <button
                  className="model-picker-summary"
                  type="button"
                  aria-expanded={modelMenuOpen}
                  aria-controls="generate-model-picker-menu"
                  onClick={() => {
                    if (modelMenuOpen) {
                      closeModelMenu();
                      return;
                    }
                    if (openInlineMenuId) {
                      closeInlineMenu(openInlineMenuId);
                    }
                    openModelMenu();
                  }}
                >
                  <span className="model-picker-label">Choose</span>
                  <span className="model-picker-value">Model</span>
                </button>
                <div className="model-picker-menu" id="generate-model-picker-menu" aria-hidden={!modelMenuOpen}>
                  {MODEL_OPTIONS.map((item) => (
                    <button
                      className={`model-picker-item ${selectedModelKeys.includes(item.key) ? "active" : ""}`}
                      key={item.key}
                      type="button"
                      onClick={() => {
                        toggleModelSelection(item.key);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dock-selected-models">
                {selectedModels.map((item) => {
                  const countMenuId = `${item.key}-count-menu`;
                  const ratioMenuId = `${item.key}-ratio-menu`;
                  const resolutionMenuId = `${item.key}-resolution-menu`;
                  return <div className="dock-model-pill" key={item.key}>
                    <div className="dock-model-pill-head">
                      <span className="dock-model-pill-icon">✦</span>
                      <span>{item.label}</span>
                    </div>
                    <div className="dock-model-pill-controls">
                      <div className="dock-model-pill-control">
                        <span>#</span>
                        <div className={`inline-picker inline-picker-compact ${openInlineMenuId === countMenuId ? "open" : ""} ${closingInlineMenuIds[countMenuId] ? "closing" : ""}`}>
                          <button
                            className="inline-picker-summary"
                            type="button"
                            aria-expanded={openInlineMenuId === countMenuId}
                            aria-controls={countMenuId}
                            onClick={() => toggleInlineMenu(countMenuId)}
                          >
                            <span className="inline-picker-value">{modelConfigs[item.key]?.count ?? 1}</span>
                          </button>
                          <div className="inline-picker-menu" id={countMenuId} aria-hidden={openInlineMenuId !== countMenuId}>
                            {IMAGE_COUNT_OPTIONS.map((count) => (
                              <button
                                className={`inline-picker-item ${(modelConfigs[item.key]?.count ?? 1) === count ? "active" : ""}`}
                                key={count}
                                type="button"
                                onClick={() => {
                                  setModelConfigs((prev) => ({
                                    ...prev,
                                    [item.key]: { ...prev[item.key], count }
                                  }));
                                  closeInlineMenu(countMenuId);
                                }}
                              >
                                {count}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="dock-model-pill-control">
                        <span>AR</span>
                        <div className={`inline-picker ${openInlineMenuId === ratioMenuId ? "open" : ""} ${closingInlineMenuIds[ratioMenuId] ? "closing" : ""}`}>
                          <button
                            className="inline-picker-summary"
                            type="button"
                            aria-expanded={openInlineMenuId === ratioMenuId}
                            aria-controls={ratioMenuId}
                            onClick={() => toggleInlineMenu(ratioMenuId)}
                          >
                            <span className="inline-picker-value inline-picker-value-ratio">
                              <span className={aspectRatioShapeClassName(modelConfigs[item.key]?.aspectRatio ?? defaultAspectRatioForModel(item.key))} style={aspectRatioShapeStyle(modelConfigs[item.key]?.aspectRatio ?? defaultAspectRatioForModel(item.key))} />
                              <span>{aspectRatioDisplayLabel(modelConfigs[item.key]?.aspectRatio ?? defaultAspectRatioForModel(item.key))}</span>
                            </span>
                          </button>
                          <div className="inline-picker-menu" id={ratioMenuId} aria-hidden={openInlineMenuId !== ratioMenuId}>
                            {aspectRatioOptionsForModel(item.key).map((ratio) => (
                              <button
                                className={`inline-picker-item ${(modelConfigs[item.key]?.aspectRatio ?? defaultAspectRatioForModel(item.key)) === ratio ? "active" : ""}`}
                                key={ratio}
                                type="button"
                                onClick={() => {
                                  setModelConfigs((prev) => ({
                                    ...prev,
                                    [item.key]: { ...prev[item.key], aspectRatio: ratio }
                                  }));
                                  closeInlineMenu(ratioMenuId);
                                }}
                              >
                                <span className="aspect-ratio-option">
                                  <span className={aspectRatioShapeClassName(ratio)} style={aspectRatioShapeStyle(ratio)} />
                                  <span>{aspectRatioDisplayLabel(ratio)}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="dock-model-pill-control">
                        <span>Res</span>
                        <div className={`inline-picker inline-picker-compact ${openInlineMenuId === resolutionMenuId ? "open" : ""} ${closingInlineMenuIds[resolutionMenuId] ? "closing" : ""}`}>
                          <button
                            className="inline-picker-summary"
                            type="button"
                            aria-expanded={openInlineMenuId === resolutionMenuId}
                            aria-controls={resolutionMenuId}
                            onClick={() => toggleInlineMenu(resolutionMenuId)}
                          >
                            <span className="inline-picker-value">{modelConfigs[item.key]?.resolution ?? item.resolutions[0]}</span>
                          </button>
                          <div className="inline-picker-menu" id={resolutionMenuId} aria-hidden={openInlineMenuId !== resolutionMenuId}>
                            {item.resolutions.map((res) => (
                              <button
                                className={`inline-picker-item ${(modelConfigs[item.key]?.resolution ?? item.resolutions[0]) === res ? "active" : ""}`}
                                key={res}
                                type="button"
                                onClick={() => {
                                  setModelConfigs((prev) => ({
                                    ...prev,
                                    [item.key]: { ...prev[item.key], resolution: res }
                                  }));
                                  closeInlineMenu(resolutionMenuId);
                                }}
                              >
                                {res}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    {selectedModelKeys.length > 1 ? (
                      <button className="dock-model-pill-remove-btn" type="button" onClick={() => removeModel(item.key)}>
                        ×
                      </button>
                    ) : null}
                  </div>;
                })}
              </div>

              <div className={`project-picker ${openInlineMenuId === "project-menu" ? "open" : ""} ${closingInlineMenuIds["project-menu"] ? "closing" : ""}`}>
                <button
                  className="project-picker-summary"
                  type="button"
                  aria-expanded={openInlineMenuId === "project-menu"}
                  aria-controls="project-menu"
                  onClick={() => toggleInlineMenu("project-menu")}
                >
                  <span className="project-picker-label">Project</span>
                  <span className="project-picker-value">{selectedProjectName ?? "Select a project"}</span>
                </button>
                <div className="project-picker-menu" id="project-menu" aria-hidden={openInlineMenuId !== "project-menu"}>
                  <button
                    className="project-picker-item add"
                    type="button"
                    onClick={() => {
                      setCreateModalOpen(true);
                      closeInlineMenu("project-menu");
                    }}
                  >
                    + Add Project
                  </button>
                  {folders.map((folder) => (
                    <button
                      className={`project-picker-item ${folder.id === selectedProjectId ? "active" : ""}`}
                      key={folder.id}
                      type="button"
                      onClick={() => {
                        selectProject(folder.id);
                        setPanelState((prev) => ({ ...prev, targetProjectId: folder.id, canSubmit: Boolean(prev.prompt.trim()) }));
                        closeInlineMenu("project-menu");
                      }}
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="dock-submit">
          {folders.length === 0 ? (
            <p className="dock-note">Create your first project to unlock generation.</p>
          ) : null}

          <button className={`generate-btn ${keyboardPressingGenerate ? "keyboard-press" : ""}`} type="submit" disabled={!canSubmit}>
            <>
              Generate
              <span className="generate-btn-sparkles" aria-hidden="true">
                <span className="sparkle sparkle-main">✧</span>
                <span className="sparkle sparkle-small sparkle-top">✦</span>
                <span className="sparkle sparkle-small sparkle-bottom">✦</span>
              </span>
            </>
          </button>
        </div>

        {panelState.error ? <p className="dock-note error" role="status">{panelState.error}</p> : null}
      </form>
    </footer>
  );
}
