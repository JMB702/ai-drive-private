"use client";

import { type ChangeEvent, type DragEvent as ReactDragEvent, FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
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
type ReferenceImage = { id: string; name: string; dataUrl: string };
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
  { key: "a2e", label: "A2E", apiModel: "A2E Image generator", resolutions: ["1K", "2K", "4K"], maxReferenceImages: 3 }
];

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];
const DEFAULT_MODEL_KEY: ModelKey = "gemini-2.0-flash";
const MODEL_KEYS: ModelKey[] = ["gemini-2.0-flash", "nano-banana-pro", "nano-banana", "a2e"];

function parseAspectRatioValue(value: string): { width: number; height: number } | null {
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function aspectRatioDisplayLabel(value: string): string {
  const ratio = parseAspectRatioValue(value);
  if (!ratio) return `▢ ${value}`;
  if (ratio.width === ratio.height) return `▢ ${value}`;
  if (ratio.width > ratio.height) {
    const shape = ratio.width / ratio.height >= 2 ? "▭▭" : "▭";
    return `${shape} ${value}`;
  }
  const shape = ratio.height / ratio.width >= 2 ? "▯▯" : "▯";
  return `${shape} ${value}`;
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

function referenceSizeLimitMessage(): string {
  return `Reference images are too large. Keep each under ${formatMegabytes(MAX_REFERENCE_IMAGE_DATA_URL_BYTES)} and total references under ${formatMegabytes(MAX_REFERENCE_TOTAL_DATA_URL_BYTES)}.`;
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

async function fitReferenceImageToBudget(dataUrl: string, remainingTotalBytes: number): Promise<string | null> {
  const initialBytes = referenceDataUrlBytes(dataUrl);
  if (initialBytes <= 0) return null;
  const maxBytesForImage = Math.min(MAX_REFERENCE_IMAGE_DATA_URL_BYTES, Math.max(0, remainingTotalBytes));
  if (maxBytesForImage <= 0) return null;
  if (initialBytes <= maxBytesForImage) return dataUrl;
  return await compressImageDataUrlToLimit(dataUrl, maxBytesForImage);
}

async function selectSubmitReferenceImages(images: ReferenceImage[]): Promise<{
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
    if (initialBytes > MAX_REFERENCE_IMAGE_DATA_URL_BYTES) {
      const compressed = await compressImageDataUrlToLimit(image.dataUrl, MAX_REFERENCE_IMAGE_DATA_URL_BYTES);
      if (!compressed) {
        droppedOversize += 1;
        continue;
      }
      submitDataUrl = compressed;
    }
    const bytes = referenceDataUrlBytes(submitDataUrl);
    if (totalBytes + bytes > MAX_REFERENCE_TOTAL_DATA_URL_BYTES) {
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

function withReferenceSettings(
  settings: GenerationJob["request"]["settings"],
  references: ReferenceImage[]
): GenerationJob["request"]["settings"] {
  const next: GenerationJob["request"]["settings"] = { ...settings };
  for (let i = 0; i < references.length; i += 1) {
    next[`referenceImageDataUrl${i + 1}`] = references[i].dataUrl;
  }
  return next;
}

function withoutReferenceSettings(
  settings: GenerationJob["request"]["settings"]
): GenerationJob["request"]["settings"] {
  const next: GenerationJob["request"]["settings"] = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("referenceImageDataUrl")) continue;
    next[key] = value;
  }
  return next;
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
    .map((item) => ({ id: item.id, name: item.name, dataUrl: item.dataUrl }));
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
    "gemini-2.0-flash": { count: 1, aspectRatio: "1:1", resolution: "1K" },
    "nano-banana-pro": { count: 1, aspectRatio: "1:1", resolution: "1K" },
    "nano-banana": { count: 1, aspectRatio: "1:1", resolution: "1K" },
    a2e: { count: 1, aspectRatio: "1:1", resolution: "1K" }
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
  const aspectRatio = typeof candidate.aspectRatio === "string" && ASPECT_RATIOS.includes(candidate.aspectRatio)
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
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const referencePickerRef = useRef<HTMLInputElement | null>(null);
  const projectMenuRef = useRef<HTMLDetailsElement | null>(null);
  const dropDepthRef = useRef(0);
  const keyboardPressTimeoutRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const promptByProjectRef = useRef<Record<string, string>>({});
  const refsByProjectRef = useRef<Record<string, ReferenceImage[]>>({});
  const referenceImagesRef = useRef<ReferenceImage[]>([]);
  const settingsByProjectRef = useRef<Record<string, ProjectGeneratorSettings>>({});
  const refsHydrationVersionRef = useRef(0);
  const suppressProjectScopedPersistRef = useRef(false);

  const model = useMemo(() => MODEL_OPTIONS.find((item) => item.key === modelKey) ?? MODEL_OPTIONS[0], [modelKey]);
  const selectedModels = useMemo(() => {
    const byKey = new Map(MODEL_OPTIONS.map((option) => [option.key, option]));
    return normalizeSelectedModelKeys(selectedModelKeys).map((key) => byKey.get(key)).filter(Boolean) as Array<(typeof MODEL_OPTIONS)[number]>;
  }, [selectedModelKeys]);
  const maxReferenceImages = useMemo(() => {
    if (selectedModels.length === 0) return 0;
    return Math.min(...selectedModels.map((item) => item.maxReferenceImages));
  }, [selectedModels]);
  const supportsReferenceImages = selectedModels.length > 0 && selectedModels.every((item) => item.maxReferenceImages > 0);
  const selectedProjectName = useMemo(
    () => folders.find((folder) => folder.id === selectedProjectId)?.name ?? null,
    [folders, selectedProjectId]
  );
  const collapsedToolsSummary = useMemo(() => {
    const modelsSummary = selectedModels.length > 0
      ? selectedModels
        .map((item) => {
          const config = modelConfigs[item.key] ?? {
            count: 1,
            aspectRatio: "1:1",
            resolution: item.resolutions[0] ?? "1K"
          };
          return `${item.label} · #${config.count} · ${config.aspectRatio} · ${config.resolution}`;
        })
        .join(" | ")
      : "No model selected";
    const folderSummary = selectedProjectName ?? "No destination folder";
    return `${modelsSummary} · Folder: ${folderSummary}`;
  }, [modelConfigs, selectedModels, selectedProjectName]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    promptByProjectRef.current = readPromptByProject();
    refsByProjectRef.current = readRefsByProjectFromLocalStorage();
    settingsByProjectRef.current = readSettingsByProject();
    try {
      const stored = window.localStorage.getItem(TOOLS_COLLAPSED_STORAGE_KEY);
      if (stored === "1") {
        setToolsCollapsed(true);
      } else if (stored === "0") {
        setToolsCollapsed(false);
      } else {
        setToolsCollapsed(window.matchMedia("(max-width: 980px)").matches);
      }
    } catch {
      setToolsCollapsed(window.matchMedia("(max-width: 980px)").matches);
    }
    setPromptLoaded(true);
  }, []);

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
    const nextSelectedModelKeys = [nextModelKey];
    const nextModelConfigs = storedSettings?.modelConfigs ?? defaultModelConfigs();
    const nextPrompt = selectedProjectId ? (promptByProjectRef.current[selectedProjectId] ?? "") : "";
    const nextRefs = selectedProjectId ? (refsByProjectRef.current[selectedProjectId] ?? []) : [];
    setModelKey(nextModelKey);
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
      const custom = event as CustomEvent<{ id: string; name: string; dataUrl: string }>;
      const payload = custom.detail;
      if (!payload || !payload.dataUrl) return;
      if (!supportsReferenceImages) {
        setPanelState((prev) => ({ ...prev, error: "Selected model does not support reference images." }));
        return;
      }
      void addReferenceEntries([{ id: payload.id, name: payload.name, dataUrl: payload.dataUrl }]);
    }
    window.addEventListener("aidrive:add-reference", onReferenceEvent as EventListener);
    return () => window.removeEventListener("aidrive:add-reference", onReferenceEvent as EventListener);
  }, [maxReferenceImages, supportsReferenceImages]);

  useEffect(() => {
    function handleOutsidePointerDown(event: MouseEvent): void {
      const menu = projectMenuRef.current;
      if (!menu?.open) return;
      const target = event.target as Node | null;
      if (target && menu.contains(target)) return;
      menu.open = false;
    }

    document.addEventListener("mousedown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointerDown);
    };
  }, []);

  const canSubmit = panelState.canSubmit && selectedModels.length > 0;

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
      const fitted = await fitReferenceImageToBudget(candidate.dataUrl, MAX_REFERENCE_TOTAL_DATA_URL_BYTES - totalBytes);
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
      if (fittedBytes <= 0 || totalBytes + fittedBytes > MAX_REFERENCE_TOTAL_DATA_URL_BYTES) {
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
        setPanelState((state) => ({ ...state, error: referenceSizeLimitMessage() }));
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
      if (skippedSize > 0) reasons.push(referenceSizeLimitMessage());
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
          dataUrl
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
        dataUrl
      });
    }

    return refs;
  }

  function onChooseModel(value: ModelKey): void {
    setModelKey(value);
    // Dropdown selection should switch active model; prior behavior appended and triggered duplicate submits.
    setSelectedModelKeys([value]);
    setModelConfigs((prev) => {
      if (prev[value]) return prev;
      const found = MODEL_OPTIONS.find((item) => item.key === value);
      return {
        ...prev,
        [value]: { count: 1, aspectRatio: "1:1", resolution: found?.resolutions[0] ?? "1K" }
      };
    });
  }

  function removeModel(value: ModelKey): void {
    setSelectedModelKeys((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((key) => key !== value);
      if (!next.includes(modelKey)) {
        setModelKey(next[0]);
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
          let dataUrl = await compressImageBlobToLimit(file, MAX_REFERENCE_IMAGE_DATA_URL_BYTES);
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
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;

    try {
      let failureCount = 0;
      let fallbackWithoutReferencesCount = 0;
      const requests: Array<{ optimisticId: string; payload: GenerationJob["request"] }> = [];
      const selected = MODEL_OPTIONS.find((item) => item.key === modelKey) ?? MODEL_OPTIONS[0];
      const config = modelConfigs[selected.key] ?? {
        count: 1,
        aspectRatio: "1:1",
        resolution: selected.resolutions[0]
      };
      const submitNotes: string[] = [];
      const submitReferences = await selectSubmitReferenceImages(referenceImages);
      let referencesForSubmit = submitReferences.accepted;
      if (submitReferences.accepted.length !== referenceImages.length) {
        const droppedCount = submitReferences.droppedInvalid + submitReferences.droppedOversize;
        const droppedReason = submitReferences.droppedOversize > 0
          ? referenceSizeLimitMessage()
          : "One or more references had an invalid image format.";
        submitNotes.push(`${droppedCount} reference image${droppedCount === 1 ? "" : "s"} were removed. ${droppedReason}`);
      }
      const payloadEstimateBase: GenerationJob["request"] = {
        folderId: panelState.targetProjectId,
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
      const referencesBeforeBudget = referencesForSubmit;
      const budgetedReferences = await shrinkReferencesForPayloadBudget({
        images: referencesForSubmit,
        maxBodyBytes: SAFE_GENERATION_BODY_BYTES,
        estimateBodyBytes: (images) =>
          estimateGenerationBodyBytes({
            ...payloadEstimateBase,
            settings: withReferenceSettings(payloadEstimateBase.settings, images)
          })
      });
      const referencesChangedByBudget =
        budgetedReferences.references.length !== referencesBeforeBudget.length ||
        budgetedReferences.references.some((item, index) => item.dataUrl !== referencesBeforeBudget[index]?.dataUrl);
      referencesForSubmit = budgetedReferences.references;
      if (budgetedReferences.compressedCount > 0) {
        submitNotes.push(`Compressed ${budgetedReferences.compressedCount} reference image${budgetedReferences.compressedCount === 1 ? "" : "s"} for mobile upload.`);
      }
      if (budgetedReferences.droppedCount > 0) {
        submitNotes.push(`Removed ${budgetedReferences.droppedCount} additional reference image${budgetedReferences.droppedCount === 1 ? "" : "s"} to fit request size.`);
      }
      if (submitReferences.accepted.length !== referenceImages.length || referencesChangedByBudget) {
        setReferenceImages(referencesForSubmit);
      }
      if (budgetedReferences.estimatedBodyBytes > SAFE_GENERATION_BODY_BYTES) {
        setPanelState((prev) => ({
          ...prev,
          error: `Request is still too large (${formatMegabytes(budgetedReferences.estimatedBodyBytes)}). Shorten the prompt or remove references.`
        }));
        return;
      }
      if (submitNotes.length > 0) {
        setPanelState((prev) => ({ ...prev, error: submitNotes.join(" ") }));
      }

      const count = config.count;
      for (let n = 0; n < count; n += 1) {
        const clientRequestId = createClientRequestId();
        const baseSettings: GenerationJob["request"]["settings"] = {
          quality: config.resolution,
          resolution: config.resolution,
          aspectRatio: config.aspectRatio,
          [GENERATION_CLIENT_REQUEST_ID_KEY]: clientRequestId
        };
        const payload: GenerationJob["request"] = {
          folderId: panelState.targetProjectId,
          prompt: panelState.prompt.trim(),
          model: selected.apiModel,
          type: panelState.type,
          settings: withReferenceSettings(baseSettings, referencesForSubmit)
        };
        const optimisticId = addOptimisticGenerationJob(payload);
        requests.push({ optimisticId, payload });
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
            if (referencesForSubmit.length > 0 && /payload too large/i.test(friendly)) {
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
        const targetFolder = folders.find((folder) => folder.id === panelState.targetProjectId);
        pushNotification({
          kind: "SUBMIT_FAILED",
          title: `${failureCount} request${failureCount > 1 ? "s" : ""} failed to submit`,
          message: friendlyReason
            ? `${friendlyReason}${targetFolder ? ` (${targetFolder.name})` : ""}`
            : `Submission failed${targetFolder ? ` in ${targetFolder.name}` : ""}.`,
          folderId: panelState.targetProjectId,
          jobId: null
        });
        setPanelState((prev) => ({
          ...prev,
          error: friendlyReason
            ? `Submit failed: ${friendlyReason}`
            : `${failureCount} generation request${failureCount > 1 ? "s" : ""} failed to submit.`
        }));
      } else if (fallbackWithoutReferencesCount > 0) {
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

        <div className={`dock-tools ${toolsCollapsed ? "collapsed" : "expanded"}`}>
          <div
            className={`dock-tools-panel ${toolsCollapsed ? "collapsed" : "expanded"}`}
            id="generation-tools"
            aria-hidden={toolsCollapsed}
          >
            <div className="dock-controls">
              <select className="dock-chip" value={modelKey} onChange={(e) => onChooseModel(e.target.value as ModelKey)}>
                {MODEL_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>

              <div className="dock-selected-models">
                {selectedModels.map((item) => (
                  <div className="dock-model-pill" key={item.key}>
                    <div className="dock-model-pill-head">
                      <span className="dock-model-pill-icon">✦</span>
                      <span>{item.label}</span>
                    </div>
                    <div className="dock-model-pill-controls">
                      <label className="dock-model-pill-control">
                        <span>#</span>
                        <select
                          className="dock-chip dock-model-pill-select"
                          value={modelConfigs[item.key]?.count ?? 1}
                          onChange={(e) =>
                            setModelConfigs((prev) => ({
                              ...prev,
                              [item.key]: { ...prev[item.key], count: Number(e.target.value) }
                            }))
                          }
                        >
                          {IMAGE_COUNT_OPTIONS.map((count) => (
                            <option key={count} value={count}>{count}</option>
                          ))}
                        </select>
                      </label>
                      <label className="dock-model-pill-control">
                        <span>AR</span>
                        <select
                          className="dock-chip dock-model-pill-select"
                          value={modelConfigs[item.key]?.aspectRatio ?? "1:1"}
                          onChange={(e) =>
                            setModelConfigs((prev) => ({
                              ...prev,
                              [item.key]: { ...prev[item.key], aspectRatio: e.target.value }
                            }))
                          }
                        >
                      {ASPECT_RATIOS.map((ratio) => (
                        <option key={ratio} value={ratio}>
                          {aspectRatioDisplayLabel(ratio)}
                        </option>
                      ))}
                        </select>
                      </label>
                      <label className="dock-model-pill-control">
                        <span>Res</span>
                        <select
                          className="dock-chip dock-model-pill-select"
                          value={modelConfigs[item.key]?.resolution ?? item.resolutions[0]}
                          onChange={(e) =>
                            setModelConfigs((prev) => ({
                              ...prev,
                              [item.key]: { ...prev[item.key], resolution: e.target.value }
                            }))
                          }
                        >
                          {item.resolutions.map((res) => <option key={res} value={res}>{res}</option>)}
                        </select>
                      </label>
                    </div>
                    {selectedModelKeys.length > 1 ? (
                      <button className="dock-model-pill-remove-btn" type="button" onClick={() => removeModel(item.key)}>
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <details className="project-picker" ref={projectMenuRef}>
                <summary className="project-picker-summary">
                  <span className="project-picker-label">Project</span>
                  <span className="project-picker-value">{selectedProjectName ?? "Select a project"}</span>
                </summary>
                <div className="project-picker-menu">
                  <button
                    className="project-picker-item add"
                    type="button"
                    onClick={() => {
                      setCreateModalOpen(true);
                      if (projectMenuRef.current) projectMenuRef.current.open = false;
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
                        if (projectMenuRef.current) projectMenuRef.current.open = false;
                      }}
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </div>

        <button
          className={`dock-tools-toggle ${toolsCollapsed ? "collapsed" : "expanded"}`}
          type="button"
          aria-label={toolsCollapsed ? "Expand generation tools" : "Collapse generation tools"}
          title={toolsCollapsed ? "Expand tools" : "Collapse tools"}
          aria-expanded={!toolsCollapsed}
          aria-controls="generation-tools"
          onClick={() => {
            if (!toolsCollapsed && projectMenuRef.current) {
              projectMenuRef.current.open = false;
            }
            setToolsCollapsed((value) => !value);
          }}
        >
          <span aria-hidden="true">⚙</span>
        </button>

        <div className="dock-submit">
          {folders.length === 0 ? (
            <p className="dock-note">Create your first project to unlock generation.</p>
          ) : toolsCollapsed ? (
            <p className="dock-note dock-note-collapsed">{collapsedToolsSummary}</p>
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
