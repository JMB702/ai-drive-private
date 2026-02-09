"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import {
  AUTO_SEED_SAMPLE_PROJECTS,
  SAMPLE_PROJECT_NAMES,
  WORKSPACE_ID,
  type Asset,
  type AssetVersion,
  type Folder,
  type GenerationJob,
  type GridMode,
  type ProjectViewModel,
  buildProjectCards,
  DASHBOARD_PROJECT_ORDER_STORAGE_KEY,
  normalizeCustomOrder,
  normalizeProjectOrderIds,
  orderAssetsByCustom,
  orderFoldersByIds,
  pickDefaultProjectId,
  readGridModes,
  readStoredProjectOrder,
  readStoredFolderOrder,
  readStoredTargetProjectId,
  SIDEBAR_PROJECT_ORDER_STORAGE_KEY,
  sortAssetsNewestFirst,
  downloadAssetFile,
  generationClientRequestId,
  isLocalGenerationJobId,
  writeGridModes,
  writeStoredProjectOrder,
  writeStoredFolderOrder,
  writeStoredTargetProjectId
} from "../lib/projects";
import { generationFailureCategoryLabel, generationFailureForJob } from "../lib/generation-failure";

type ReorderInput = {
  draggedIds: string[];
  targetIndex: number;
};

export type AppNotification = {
  id: string;
  kind: "SUBMIT_FAILED" | "GENERATION_SUCCEEDED" | "GENERATION_FAILED";
  title: string;
  message: string;
  typeLabel?: string | null;
  imageName?: string | null;
  imageAssetId?: string | null;
  imagePreviewUrl?: string | null;
  createdAt: string;
  read: boolean;
  folderId: string | null;
  jobId: string | null;
};

type ProjectsContextValue = {
  workspaceId: string;
  folders: Folder[];
  sidebarFolders: Folder[];
  projectCards: ProjectViewModel[];
  dashboardProjectCards: ProjectViewModel[];
  assets: Asset[];
  jobs: GenerationJob[];
  selectedProjectAssets: Asset[];
  selectedProjectVisibleAssets: Asset[];
  selectedProjectPendingJobs: GenerationJob[];
  selectedProjectFailedJobs: GenerationJob[];
  selectedProjectHasCustomOrder: boolean;
  notifications: AppNotification[];
  unreadNotificationCount: number;
  loading: boolean;
  loadingAssets: boolean;
  error: string | null;
  selectedProjectId: string | null;
  selectedProject: Folder | null;
  sidebarFocus: "dashboard" | "folder";
  projectSelectionToken: number;
  createModalOpen: boolean;
  selectedAsset: Asset | null;
  selectedAssetVersions: AssetVersion[];
  versionsLoading: boolean;
  selectedGridMode: GridMode;
  selectedAssetIds: string[];
  selectionActive: boolean;
  draggedItemIds: string[];
  setCreateModalOpen: (open: boolean) => void;
  reorderSidebarFolders: (draggedFolderId: string, targetIndex: number) => void;
  reorderDashboardFolders: (draggedFolderIds: string[], targetIndex: number) => void;
  selectProject: (projectId: string) => void;
  setSidebarFocusDashboard: () => void;
  setSidebarFocusFolder: () => void;
  setSelectedGridMode: (mode: GridMode) => void;
  setDraggedItemIds: (itemIds: string[]) => void;
  toggleAssetSelection: (assetId: string) => void;
  clearAssetSelection: () => void;
  pushNotification: (input: Omit<AppNotification, "id" | "createdAt" | "read">) => void;
  markNotificationRead: (id: string) => void;
  markNotificationUnread: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearAllNotifications: () => void;
  dismissNotification: (id: string) => void;
  refreshProjects: (preferredProjectId?: string | null, options?: { newProjectId?: string | null }) => Promise<void>;
  refreshAssets: (opts?: { silent?: boolean }) => Promise<void>;
  refreshJobs: (opts?: { silent?: boolean }) => Promise<void>;
  refreshMedia: (opts?: { silent?: boolean }) => Promise<void>;
  addOptimisticGenerationJob: (request: GenerationJob["request"]) => string;
  reconcileOptimisticGenerationJob: (optimisticId: string, job: GenerationJob) => void;
  removeGenerationJob: (jobId: string) => void;
  createProject: (name: string) => Promise<string | null>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  downloadProject: (projectId: string) => Promise<void>;
  openAsset: (asset: Asset) => Promise<void>;
  closeAsset: () => void;
  reorderSelectedProjectAssets: (input: ReorderInput) => Promise<void>;
  setSelectedProjectCustomOrder: (assetIds: string[]) => Promise<void>;
  moveItemsToFolder: (itemIds: string[], folderId: string) => Promise<void>;
  deleteAssets: (assetIds: string[]) => Promise<Asset[]>;
  deleteGenerationJobs: (jobIds: string[]) => Promise<void>;
  restoreAssets: (assetIds: string[], snapshot?: Asset[]) => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);
const NOTIFIED_TERMINAL_JOB_IDS_STORAGE_KEY = "aidrive:notifiedTerminalJobIds";
const NOTIFICATIONS_STORAGE_KEY = "aidrive:notifications";
const NOTIFICATION_MAX_COUNT = 100;
const NOTIFICATION_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const PERSISTED_NOTIFICATION_PREVIEW_MAX_CHARS = 2048;

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function parseIsoTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("timed out");
}

function toIsoOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

const STALE_PENDING_JOB_MS = 2 * 60 * 1000;
const FIRST_SEEN_TERMINAL_NOTIFY_GRACE_MS = 60 * 1000;
const REALTIME_SSE_PATH = "/v1/realtime/jobs/stream";
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 30000;

function joinUrl(base: string, path: string): string {
  if (base.endsWith("/") && path.startsWith("/")) return `${base.slice(0, -1)}${path}`;
  if (!base.endsWith("/") && !path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function isStalePendingJob(job: GenerationJob, now: number): boolean {
  if (job.status !== "QUEUED" && job.status !== "RUNNING") return false;
  const createdAt = parseIsoTime(job.createdAt);
  if (createdAt <= 0) return true;
  return now - createdAt > STALE_PENDING_JOB_MS;
}

function createNotificationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `notif:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function pickPreferredPendingJob(group: GenerationJob[]): GenerationJob {
  return [...group].sort((a, b) => {
    const statusPriority = (job: GenerationJob) => (job.status === "RUNNING" ? 2 : 1);
    const sourcePriority = (job: GenerationJob) => (isLocalGenerationJobId(job.id) ? 0 : 1);
    const statusDelta = statusPriority(b) - statusPriority(a);
    if (statusDelta !== 0) return statusDelta;
    const sourceDelta = sourcePriority(b) - sourcePriority(a);
    if (sourceDelta !== 0) return sourceDelta;
    return parseIsoTime(b.createdAt) - parseIsoTime(a.createdAt);
  })[0];
}

function jobGroupKey(job: GenerationJob): string {
  return generationClientRequestId(job) ?? job.id;
}

function requestFingerprint(job: GenerationJob): string {
  const folderId = job.request.folderId ?? "";
  const prompt = job.request.prompt ?? "";
  const model = job.request.model ?? "";
  const type = job.request.type ?? "";
  const aspectRatio = typeof job.request.settings.aspectRatio === "string" ? job.request.settings.aspectRatio : "";
  const resolution = typeof job.request.settings.resolution === "string" ? job.request.settings.resolution : "";
  return [folderId, prompt, model, type, aspectRatio, resolution].join("||");
}

const OPTIMISTIC_MATCH_WINDOW_MS = 60_000;

function pendingDedupKey(job: GenerationJob): string {
  return generationClientRequestId(job) ?? requestFingerprint(job);
}

function jobTagFromAsset(asset: Asset): string | null {
  const tag = asset.tags.find((item) => item.startsWith("job:"));
  if (!tag) return null;
  return tag.slice(4) || null;
}

type RawGenerationJob = Partial<GenerationJob> & {
  workspaceId?: string;
  request?: GenerationJob["request"] & { workspaceId?: string };
};

function normalizeGenerationJob(item: unknown): GenerationJob | null {
  const allowedStatuses = new Set<GenerationJob["status"]>(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]);
  if (!item || typeof item !== "object") return null;
  const job = item as RawGenerationJob;
  if (typeof job.id !== "string" || job.id.length === 0) return null;
  const workspaceId = typeof job.workspaceId === "string"
    ? job.workspaceId
    : (typeof job.request?.workspaceId === "string" ? job.request.workspaceId : WORKSPACE_ID);
  if (workspaceId !== WORKSPACE_ID) return null;
  return {
    // Treat malformed timestamps as very old so stale pending jobs do not linger forever in UI.
    createdAt: toIsoOrFallback(job.createdAt, "1970-01-01T00:00:00.000Z"),
    updatedAt: typeof job.updatedAt === "string" ? toIsoOrFallback(job.updatedAt, "1970-01-01T00:00:00.000Z") : undefined,
    id: job.id,
    status: allowedStatuses.has(job.status as GenerationJob["status"]) ? (job.status as GenerationJob["status"]) : "FAILED",
    error: typeof job.error === "string" ? job.error : null,
    failure: job.failure ?? null,
    request: {
      folderId: typeof job.request?.folderId === "string" ? job.request.folderId : undefined,
      model: typeof job.request?.model === "string" && job.request.model.length > 0 ? job.request.model : "unknown",
      type: job.request?.type === "VIDEO" ? "VIDEO" : "IMAGE",
      prompt: typeof job.request?.prompt === "string" ? job.request.prompt : "",
      negativePrompt: typeof job.request?.negativePrompt === "string" ? job.request.negativePrompt : undefined,
      settings: job.request?.settings && typeof job.request.settings === "object" ? job.request.settings : {}
    }
  };
}

function mergeRealtimeJobs(current: GenerationJob[], updates: GenerationJob[]): GenerationJob[] {
  if (updates.length === 0) return current;
  const byId = new Map<string, GenerationJob>();
  for (const job of current) byId.set(job.id, job);
  for (const job of updates) byId.set(job.id, job);

  const updateClientIds = new Set(
    updates
      .map((job) => generationClientRequestId(job))
      .filter((value): value is string => Boolean(value))
  );
  const updatePendingKeys = new Set(
    updates
      .filter((job) => job.status === "QUEUED" || job.status === "RUNNING")
      .map((job) => pendingDedupKey(job))
  );
  const updateByFingerprint = new Map<string, GenerationJob[]>();
  for (const job of updates) {
    const key = requestFingerprint(job);
    updateByFingerprint.set(key, [...(updateByFingerprint.get(key) ?? []), job]);
  }

  const merged = [...byId.values()].filter((job) => {
    if (!isLocalGenerationJobId(job.id)) return true;
    if (job.status !== "QUEUED" && job.status !== "RUNNING") return true;
    const clientId = generationClientRequestId(job);
    if (clientId && updateClientIds.has(clientId)) return false;
    if (updatePendingKeys.has(pendingDedupKey(job))) return false;
    const localTime = parseIsoTime(job.createdAt);
    const nearbyUpdates = updateByFingerprint.get(requestFingerprint(job)) ?? [];
    if (
      nearbyUpdates.some((candidate) =>
        Math.abs(parseIsoTime(candidate.createdAt) - localTime) <= OPTIMISTIC_MATCH_WINDOW_MS
      )
    ) {
      return false;
    }
    return true;
  });

  return merged.sort(
    (a, b) => parseIsoTime(b.updatedAt ?? b.createdAt) - parseIsoTime(a.updatedAt ?? a.createdAt)
  );
}

function realtimeSseUrls(): string[] {
  if (typeof window === "undefined") return [];
  const envBase = process.env.NEXT_PUBLIC_API_URL?.trim();
  const candidates = [
    envBase ? joinUrl(envBase, REALTIME_SSE_PATH) : null,
    `${window.location.origin}${REALTIME_SSE_PATH}`,
    `http://127.0.0.1:4100${REALTIME_SSE_PATH}`,
    `http://127.0.0.1:4000${REALTIME_SSE_PATH}`
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}

function normalizeNotification(value: unknown): AppNotification | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AppNotification>;
  const kind = item.kind;
  if (kind !== "SUBMIT_FAILED" && kind !== "GENERATION_SUCCEEDED" && kind !== "GENERATION_FAILED") return null;
  if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.message !== "string") return null;
  return {
    id: item.id,
    kind,
    title: item.title,
    message: item.message,
    typeLabel: typeof item.typeLabel === "string" ? item.typeLabel : null,
    imageName: typeof item.imageName === "string" ? item.imageName : null,
    imageAssetId: typeof item.imageAssetId === "string" ? item.imageAssetId : null,
    imagePreviewUrl: typeof item.imagePreviewUrl === "string" ? item.imagePreviewUrl : null,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    read: Boolean(item.read),
    folderId: typeof item.folderId === "string" ? item.folderId : null,
    jobId: typeof item.jobId === "string" ? item.jobId : null
  };
}

function pruneNotifications(items: AppNotification[], now = Date.now()): AppNotification[] {
  const fresh = items.filter((item) => {
    const timestamp = Date.parse(item.createdAt);
    if (!Number.isFinite(timestamp)) return true;
    return now - timestamp <= NOTIFICATION_TTL_MS;
  });
  const sorted = [...fresh].sort((a, b) => {
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    const safeA = Number.isFinite(at) ? at : 0;
    const safeB = Number.isFinite(bt) ? bt : 0;
    return safeB - safeA;
  });
  return sorted.slice(0, NOTIFICATION_MAX_COUNT);
}

function mergeNotifications(current: AppNotification[], incoming: AppNotification[]): AppNotification[] {
  const byId = new Map<string, AppNotification>();
  for (const item of [...current, ...incoming]) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const existingTime = Date.parse(existing.createdAt);
    const itemTime = Date.parse(item.createdAt);
    const useIncoming =
      (Number.isFinite(itemTime) && Number.isFinite(existingTime) && itemTime >= existingTime) ||
      (!Number.isFinite(existingTime) && Number.isFinite(itemTime));
    byId.set(item.id, useIncoming ? item : existing);
  }
  return [...byId.values()].sort((a, b) => {
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    const safeA = Number.isFinite(at) ? at : 0;
    const safeB = Number.isFinite(bt) ? bt : 0;
    return safeB - safeA;
  });
}

function compactNotificationForStorage(item: AppNotification): AppNotification {
  const preview = item.imagePreviewUrl;
  const shouldDropPreview =
    typeof preview === "string" &&
    (preview.startsWith("data:") || preview.length > PERSISTED_NOTIFICATION_PREVIEW_MAX_CHARS);
  if (!shouldDropPreview) return item;
  return {
    ...item,
    imagePreviewUrl: null
  };
}

function persistNotificationsToStorage(items: AppNotification[]): void {
  if (typeof window === "undefined") return;
  const compact = pruneNotifications(items).map((item) => compactNotificationForStorage(item));
  try {
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(compact));
    return;
  } catch {
    // If quota is still exceeded, keep newest notifications and drop oldest until it fits.
  }

  let candidate = compact;
  while (candidate.length > 0) {
    candidate = candidate.slice(0, Math.max(1, candidate.length - 10));
    try {
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(candidate));
      return;
    } catch {
      // Continue shrinking.
    }
  }

  try {
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, "[]");
  } catch {
    // Ignore storage write failures.
  }
}

function mergeFetchedJobsWithLocalOptimistic(current: GenerationJob[], fetched: GenerationJob[]): GenerationJob[] {
  const fetchedIds = new Set(fetched.map((job) => job.id));
  const fetchedClientIds = new Set(
    fetched
      .map((job) => generationClientRequestId(job))
      .filter((value): value is string => Boolean(value))
  );
  const fetchedPendingKeys = new Set(
    fetched
      .filter((job) => job.status === "QUEUED" || job.status === "RUNNING")
      .map((job) => pendingDedupKey(job))
  );
  const fetchedByFingerprint = new Map<string, GenerationJob[]>();
  for (const job of fetched) {
    const key = requestFingerprint(job);
    fetchedByFingerprint.set(key, [...(fetchedByFingerprint.get(key) ?? []), job]);
  }
  const retainedLocalOptimistic = current.filter((job) => {
    if (!isLocalGenerationJobId(job.id)) return false;
    if (job.status !== "QUEUED" && job.status !== "RUNNING") return false;
    if (fetchedIds.has(job.id)) return false;
    const clientId = generationClientRequestId(job);
    if (clientId && fetchedClientIds.has(clientId)) return false;
    if (fetchedPendingKeys.has(pendingDedupKey(job))) return false;
    const localTime = parseIsoTime(job.createdAt);
    const nearbyFetched = fetchedByFingerprint.get(requestFingerprint(job)) ?? [];
    if (
      nearbyFetched.some((candidate) =>
        Math.abs(parseIsoTime(candidate.createdAt) - localTime) <= OPTIMISTIC_MATCH_WINDOW_MS
      )
    ) {
      return false;
    }
    return true;
  });
  return [...fetched, ...retainedLocalOptimistic].sort((a, b) => parseIsoTime(b.createdAt) - parseIsoTime(a.createdAt));
}

async function fetchFolders(): Promise<Folder[]> {
  const result = await apiRequest<{ folders: Folder[] }>(`/v1/drive/folders/${WORKSPACE_ID}`);
  return (result.folders ?? [])
    .filter((folder): folder is Folder => Boolean(folder && typeof folder.id === "string"))
    .map((folder) => ({
      id: folder.id,
      name: typeof folder.name === "string" && folder.name.trim().length > 0 ? folder.name : "Untitled Project",
      parentId: typeof folder.parentId === "string" ? folder.parentId : null,
      createdAt: typeof folder.createdAt === "string" ? folder.createdAt : undefined,
      layout: folder.layout && Array.isArray(folder.layout.customOrderAssetIds)
        ? { customOrderAssetIds: folder.layout.customOrderAssetIds.filter((id): id is string => typeof id === "string") }
        : undefined
    }));
}

async function fetchAssets(): Promise<Asset[]> {
  const result = await apiRequest<{
    assets: Asset[];
    previews?: Record<string, string>;
    aspectRatios?: Record<string, string>;
    resolutions?: Record<string, string>;
  }>(`/v1/drive/assets/${WORKSPACE_ID}`);
  const previews = result.previews ?? {};
  const aspectRatios = result.aspectRatios ?? {};
  const resolutions = result.resolutions ?? {};
  return (result.assets ?? [])
    .filter((asset): asset is Asset => Boolean(asset && typeof asset.id === "string"))
    .map((asset) => ({
      id: asset.id,
      name: typeof asset.name === "string" && asset.name.trim().length > 0 ? asset.name : `asset-${asset.id}`,
      mimeType: typeof asset.mimeType === "string" && asset.mimeType.length > 0 ? asset.mimeType : "image/png",
      folderId: typeof asset.folderId === "string" ? asset.folderId : null,
      tags: Array.isArray(asset.tags) ? asset.tags.filter((tag): tag is string => typeof tag === "string") : [],
      createdAt: typeof asset.createdAt === "string" ? asset.createdAt : undefined,
      previewUrl: previews[asset.id],
      aspectRatio: aspectRatios[asset.id],
      resolution: resolutions[asset.id]
    }));
}

async function fetchJobs(): Promise<GenerationJob[]> {
  const result = await apiRequest<{ jobs: GenerationJob[] }>(`/v1/generation/jobs/${WORKSPACE_ID}`);
  return (result.jobs ?? [])
    .map((item) => normalizeGenerationJob(item))
    .filter((item): item is GenerationJob => Boolean(item));
}

async function ensureSampleProjects(existing: Folder[]): Promise<Folder[]> {
  if (!AUTO_SEED_SAMPLE_PROJECTS) return existing;
  // Seed demo projects only for a brand-new empty workspace.
  // Do not recreate "missing" sample folders after user deletes them.
  if (existing.length > 0) return existing;

  const names = new Set(existing.map((f) => f.name.toLowerCase()));
  const missing = SAMPLE_PROJECT_NAMES.filter((name) => !names.has(name.toLowerCase()));
  if (missing.length === 0) return existing;

  for (const name of missing) {
    await apiRequest<{ folder: Folder }>("/v1/drive/folders", {
      method: "POST",
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, parentId: null, name })
    });
  }

  return fetchFolders();
}

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sidebarFocus, setSidebarFocus] = useState<"dashboard" | "folder">("dashboard");
  const [projectSelectionToken, setProjectSelectionToken] = useState(0);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [selectedAssetVersions, setSelectedAssetVersions] = useState<AssetVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modeByFolderId, setModeByFolderId] = useState<Record<string, GridMode>>({});
  const [customOrderByFolderId, setCustomOrderByFolderId] = useState<Record<string, string[]>>({});
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [draggedItemIds, setDraggedItemIds] = useState<string[]>([]);
  const [folderOrderIds, setFolderOrderIds] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const refreshMediaInFlightRef = useRef<Promise<void> | null>(null);
  const refreshRetryTimerRef = useRef<number | null>(null);
  const notificationsHydratedRef = useRef(false);

  function pushNotification(input: Omit<AppNotification, "id" | "createdAt" | "read">): void {
    const notification: AppNotification = {
      id: createNotificationId(),
      createdAt: new Date().toISOString(),
      read: false,
      ...input
    };
    setNotifications((prev) => pruneNotifications([notification, ...prev]));
  }

  function markNotificationRead(id: string): void {
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)));
  }

  function markNotificationUnread(id: string): void {
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: false } : item)));
  }

  function markAllNotificationsRead(): void {
    setNotifications((prev) => prev.map((item) => (item.read ? item : { ...item, read: true })));
  }

  function dismissNotification(id: string): void {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }

  function clearAllNotifications(): void {
    setNotifications([]);
  }

  const unreadNotificationCount = useMemo(
    () => notifications.reduce((count, item) => (item.read ? count : count + 1), 0),
    [notifications]
  );

  useEffect(() => {
    setModeByFolderId(readGridModes());
    const storedUnified =
      readStoredProjectOrder(SIDEBAR_PROJECT_ORDER_STORAGE_KEY) ??
      readStoredProjectOrder(DASHBOARD_PROJECT_ORDER_STORAGE_KEY) ??
      [];
    setFolderOrderIds(storedUnified);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const next = parsed
        .map((item) => normalizeNotification(item))
        .filter((item): item is AppNotification => Boolean(item));
      setNotifications((prev) => pruneNotifications(mergeNotifications(prev, next)));
    } catch {
      // Ignore storage parse failures.
    } finally {
      notificationsHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!notificationsHydratedRef.current) return;
    persistNotificationsToStorage(notifications);
  }, [notifications]);

  async function refreshAssets(opts?: { silent?: boolean }): Promise<void> {
    if (!opts?.silent) setLoadingAssets(true);
    let keepLoading = false;
    try {
      const items = await fetchAssets();
      setAssets(items);
      if (!opts?.silent) setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assets");
      if (!opts?.silent && isTimeoutError(e)) {
        keepLoading = true;
        if (refreshRetryTimerRef.current) window.clearTimeout(refreshRetryTimerRef.current);
        refreshRetryTimerRef.current = window.setTimeout(() => {
          refreshRetryTimerRef.current = null;
          void refreshAssets();
        }, 900);
      }
    } finally {
      if (!opts?.silent && !keepLoading) setLoadingAssets(false);
    }
  }

  async function refreshJobs(opts?: { silent?: boolean }): Promise<void> {
    try {
      const items = await fetchJobs();
      setJobs((prev) => mergeFetchedJobsWithLocalOptimistic(prev, items));
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : "Failed to load jobs");
      }
    }
  }

  async function refreshMedia(opts?: { silent?: boolean }): Promise<void> {
    const inFlight = refreshMediaInFlightRef.current;
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      if (!opts?.silent) setLoadingAssets(true);
      let keepLoading = false;
      const assetsPromise = fetchAssets();
      const jobsPromise = fetchJobs();
      try {
        const items = await assetsPromise;
        setAssets(items);
        if (!opts?.silent) setError(null);
      } catch (e) {
        if (!opts?.silent) {
          setError(e instanceof Error ? e.message : "Failed to load assets");
          if (isTimeoutError(e)) {
            keepLoading = true;
            if (refreshRetryTimerRef.current) window.clearTimeout(refreshRetryTimerRef.current);
            refreshRetryTimerRef.current = window.setTimeout(() => {
              refreshRetryTimerRef.current = null;
              void refreshAssets();
            }, 900);
          }
        }
      } finally {
        if (!opts?.silent && !keepLoading) setLoadingAssets(false);
      }

      try {
        const jobItems = await jobsPromise;
        setJobs((prev) => mergeFetchedJobsWithLocalOptimistic(prev, jobItems));
      } catch (e) {
        if (!opts?.silent) {
          console.warn("Failed to refresh jobs during media refresh", e);
        }
      }
    })();

    refreshMediaInFlightRef.current = task;
    try {
      await task;
    } finally {
      if (refreshMediaInFlightRef.current === task) {
        refreshMediaInFlightRef.current = null;
      }
    }
  }

  function addOptimisticGenerationJob(request: GenerationJob["request"]): string {
    const optimisticId = `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const optimisticJob: GenerationJob = {
      id: optimisticId,
      status: "QUEUED",
      createdAt: new Date().toISOString(),
      error: null,
      request
    };
    setJobs((prev) => [optimisticJob, ...prev]);
    return optimisticId;
  }

  function reconcileOptimisticGenerationJob(optimisticId: string, job: GenerationJob): void {
    setJobs((prev) => {
      const optimisticIndex = prev.findIndex((item) => item.id === optimisticId);
      const jobClientId = generationClientRequestId(job);
      const withoutDuplicates = prev.filter((item, index) => {
        if (index === optimisticIndex) return false;
        if (item.id === job.id) return false;
        if (jobClientId && generationClientRequestId(item) === jobClientId) return false;
        return true;
      });
      if (optimisticIndex >= 0) {
        const next = [...withoutDuplicates];
        next.splice(Math.min(optimisticIndex, next.length), 0, job);
        return next;
      }
      return [job, ...withoutDuplicates];
    });
  }

  function removeGenerationJob(jobId: string): void {
    setJobs((prev) => prev.filter((item) => item.id !== jobId));
  }

  async function refreshProjects(
    preferredProjectId?: string | null,
    options?: { newProjectId?: string | null }
  ): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      let items = await fetchFolders();
      items = await ensureSampleProjects(items);
      setFolders(items);

      setCustomOrderByFolderId((prev) => {
        const next = { ...prev };
        for (const folder of items) {
          const remoteOrder = folder.layout?.customOrderAssetIds;
          const storedOrder = readStoredFolderOrder(folder.id);
          if (remoteOrder && remoteOrder.length > 0) {
            next[folder.id] = remoteOrder;
            writeStoredFolderOrder(folder.id, remoteOrder);
          } else if ((!next[folder.id] || next[folder.id].length === 0) && storedOrder && storedOrder.length > 0) {
            next[folder.id] = storedOrder;
          }
        }
        return next;
      });
      setFolderOrderIds((prev) => {
        const remoteBase = items.map((folder) => folder.id);
        const base = remoteBase.length > 0
          ? remoteBase
          : (
            prev.length > 0
              ? prev
              : readStoredProjectOrder(SIDEBAR_PROJECT_ORDER_STORAGE_KEY) ??
                readStoredProjectOrder(DASHBOARD_PROJECT_ORDER_STORAGE_KEY)
          );
        let normalized = normalizeProjectOrderIds(items, base);
        const newProjectId = options?.newProjectId ?? null;
        if (newProjectId && normalized.includes(newProjectId)) {
          normalized = [newProjectId, ...normalized.filter((id) => id !== newProjectId)];
        }
        writeStoredProjectOrder(SIDEBAR_PROJECT_ORDER_STORAGE_KEY, normalized);
        writeStoredProjectOrder(DASHBOARD_PROJECT_ORDER_STORAGE_KEY, normalized);
        return normalized;
      });

      const stored = readStoredTargetProjectId();
      const fallback = pickDefaultProjectId(items, preferredProjectId ?? selectedProjectId ?? stored);
      setSelectedProjectId(fallback);
      setSidebarFocus(fallback ? "folder" : "dashboard");

      if (fallback) {
        writeStoredTargetProjectId(fallback);
        setCreateModalOpen(false);
      } else {
        setCreateModalOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }

    await refreshMedia();
  }

  async function createProject(name: string): Promise<string | null> {
    if (!name.trim()) {
      setError("Project name is required");
      return null;
    }

    try {
      setError(null);
      const response = await apiRequest<{ folder: Folder }>("/v1/drive/folders", {
        method: "POST",
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, parentId: null, name: name.trim() })
      });
      const projectId = response.folder.id;
      await refreshProjects(projectId, { newProjectId: projectId });
      return projectId;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
      return null;
    }
  }

  async function openAsset(asset: Asset): Promise<void> {
    setSelectedAsset(asset);
    setVersionsLoading(true);
    setSelectedAssetVersions([]);

    try {
      const response = await apiRequest<{ versions: AssetVersion[] }>(`/v1/versions/${asset.id}`);
      setSelectedAssetVersions(response.versions);
    } catch {
      setSelectedAssetVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }

  function closeAsset(): void {
    setSelectedAsset(null);
    setSelectedAssetVersions([]);
  }

  const selectProject = useCallback((projectId: string): void => {
    setSelectedProjectId(projectId);
    writeStoredTargetProjectId(projectId);
    setSelectedAssetIds([]);
    setSidebarFocus("folder");
    setProjectSelectionToken((value) => value + 1);
  }, []);

  const setSidebarFocusDashboard = useCallback((): void => {
    setSidebarFocus("dashboard");
  }, []);

  const setSidebarFocusFolder = useCallback((): void => {
    setSidebarFocus("folder");
  }, []);

  async function renameProject(projectId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Project name is required");
      return;
    }
    try {
      setError(null);
      await apiRequest<{ folder: Folder }>(`/v1/drive/folders/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed })
      });
      setFolders((prev) => prev.map((folder) => (folder.id === projectId ? { ...folder, name: trimmed } : folder)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename project");
      throw e;
    }
  }

  async function deleteProject(projectId: string): Promise<void> {
    const fallbackId =
      selectedProjectId === projectId
        ? folders.find((folder) => folder.id !== projectId)?.id ?? null
        : selectedProjectId;

    try {
      setError(null);
      await apiRequest<{ deleted: boolean }>(`/v1/drive/folders/${projectId}`, { method: "DELETE" });
      await refreshProjects(fallbackId);
    } catch (e) {
      try {
        const proxyResponse = await fetch(`/api/proxy/v1/drive/folders/${projectId}`, {
          method: "DELETE",
          headers: {
            "x-user-id": "user_demo"
          }
        });
        if (proxyResponse.ok) {
          await refreshProjects(fallbackId);
          return;
        }
      } catch {
        // Continue to verification fallback.
      }

      try {
        const verifyResponse = await fetch(`/api/proxy/v1/drive/folders/${WORKSPACE_ID}`, {
          method: "GET",
          headers: {
            "x-user-id": "user_demo"
          }
        });
        if (verifyResponse.ok) {
          const payload = (await verifyResponse.json()) as { folders?: Folder[] };
          const latest = payload.folders ?? [];
          const exists = latest.some((folder) => folder.id === projectId);
          if (!exists) {
            await refreshProjects(fallbackId);
            return;
          }
        }
      } catch {
        // Fall through to throw original error.
      }

      setError(e instanceof Error ? e.message : "Failed to delete project");
      throw e;
    }
  }

  async function downloadProject(projectId: string): Promise<void> {
    const projectAssets = sortAssetsNewestFirst(assets.filter((asset) => asset.folderId === projectId));
    for (const asset of projectAssets) {
      await downloadAssetFile(asset);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const selectedProject = useMemo(() => folders.find((f) => f.id === selectedProjectId) ?? null, [folders, selectedProjectId]);
  const selectedProjectAssets = useMemo(
    () => (selectedProjectId ? assets.filter((asset) => asset.folderId === selectedProjectId) : []),
    [assets, selectedProjectId]
  );
  const selectedProjectAssetsTimeOrdered = useMemo(
    () => sortAssetsNewestFirst(selectedProjectAssets),
    [selectedProjectAssets]
  );
  const selectedGridMode: GridMode = selectedProjectId ? modeByFolderId[selectedProjectId] ?? "TIME" : "TIME";
  const selectedProjectCustomOrder = useMemo(() => {
    if (!selectedProjectId) return [];
    return normalizeCustomOrder(selectedProjectAssets, customOrderByFolderId[selectedProjectId]);
  }, [customOrderByFolderId, selectedProjectAssets, selectedProjectId]);
  const selectedProjectHasCustomOrder = useMemo(() => {
    if (!selectedProjectId) return false;
    return (customOrderByFolderId[selectedProjectId]?.length ?? 0) > 0;
  }, [customOrderByFolderId, selectedProjectId]);
  const selectedProjectAssetsCustomOrdered = useMemo(
    () => orderAssetsByCustom(selectedProjectAssets, selectedProjectCustomOrder),
    [selectedProjectAssets, selectedProjectCustomOrder]
  );
  const selectedProjectVisibleAssets = selectedGridMode === "CUSTOM" ? selectedProjectAssetsCustomOrdered : selectedProjectAssetsTimeOrdered;

  useEffect(() => {
    if (!selectedProjectId) return;
    if (selectedGridMode !== "CUSTOM") return;
    if (arraysEqual(selectedProjectCustomOrder, customOrderByFolderId[selectedProjectId] ?? [])) return;
    setCustomOrderByFolderId((prev) => ({ ...prev, [selectedProjectId]: selectedProjectCustomOrder }));
    writeStoredFolderOrder(selectedProjectId, selectedProjectCustomOrder);
  }, [customOrderByFolderId, selectedGridMode, selectedProjectCustomOrder, selectedProjectId]);

  const selectedProjectPendingJobs = useMemo(
    () => {
      const now = Date.now();
      const projectJobs = jobs.filter((job) => job.request.folderId === selectedProjectId);
      const terminalKeys = new Set(
        projectJobs
          .filter((job) => job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELED")
          .map((job) => pendingDedupKey(job))
      );
      const filtered = projectJobs.filter((job) => {
        if (job.status !== "QUEUED" && job.status !== "RUNNING") return false;
        if (isStalePendingJob(job, now)) return false;
        return !terminalKeys.has(pendingDedupKey(job));
      });
      const grouped = new Map<string, GenerationJob[]>();
      for (const job of filtered) {
        const key = pendingDedupKey(job);
        grouped.set(key, [...(grouped.get(key) ?? []), job]);
      }
      const deduped = [...grouped.values()].map((group) => pickPreferredPendingJob(group));
      deduped.sort((a, b) => parseIsoTime(b.createdAt) - parseIsoTime(a.createdAt));
      return deduped;
    },
    [jobs, selectedProjectId]
  );
  const selectedProjectFailedJobs = useMemo(
    () => {
      const jobBackedFailureIds = new Set(
        selectedProjectAssets
          .flatMap((asset) => asset.tags)
          .filter((tag) => tag.startsWith("job:"))
          .map((tag) => tag.slice("job:".length))
      );
      const filtered = jobs.filter(
        (job) =>
          job.request.folderId === selectedProjectId &&
          !jobBackedFailureIds.has(job.id) &&
          (job.status === "FAILED" || job.status === "CANCELED")
      );
      const grouped = new Map<string, GenerationJob[]>();
      for (const job of filtered) {
        const key = jobGroupKey(job);
        grouped.set(key, [...(grouped.get(key) ?? []), job]);
      }
      const deduped = [...grouped.values()].map((group) => {
        const sorted = [...group].sort((a, b) => parseIsoTime(b.createdAt) - parseIsoTime(a.createdAt));
        return sorted[0];
      });
      deduped.sort((a, b) => parseIsoTime(b.createdAt) - parseIsoTime(a.createdAt));
      return deduped;
    },
    [jobs, selectedProjectAssets, selectedProjectId]
  );
  const sidebarFolders = useMemo(
    () => orderFoldersByIds(folders, folderOrderIds),
    [folderOrderIds, folders]
  );
  const dashboardFolders = useMemo(
    () => orderFoldersByIds(folders, folderOrderIds),
    [folderOrderIds, folders]
  );
  const projectCards = useMemo(() => buildProjectCards(dashboardFolders, selectedProjectId), [dashboardFolders, selectedProjectId]);
  const dashboardProjectCards = projectCards;
  const selectionActive = selectedAssetIds.length > 0;

  const persistWorkspaceFolderOrder = useCallback(async (order: string[]): Promise<void> => {
    try {
      await apiRequest<{ workspaceId: string; folderOrderIds: string[] }>(`/v1/drive/folders/${WORKSPACE_ID}/order`, {
        method: "PATCH",
        body: JSON.stringify({ folderOrderIds: order })
      });
    } catch {
      // Keep local order as a fallback if remote persistence fails.
    }
  }, []);

  const reorderSidebarFolders = useCallback((draggedFolderId: string, targetIndex: number) => {
    if (!draggedFolderId) return;
    let nextOrder: string[] | null = null;
    setFolderOrderIds((prev) => {
      const current = normalizeProjectOrderIds(folders, prev);
      const fromIndex = current.indexOf(draggedFolderId);
      const withoutDragged = current.filter((id) => id !== draggedFolderId);
      let insertAt = Math.max(0, Math.min(targetIndex, current.length));
      if (fromIndex >= 0 && fromIndex < insertAt) insertAt -= 1;
      insertAt = Math.max(0, Math.min(insertAt, withoutDragged.length));
      const next = [...withoutDragged.slice(0, insertAt), draggedFolderId, ...withoutDragged.slice(insertAt)];
      writeStoredProjectOrder(SIDEBAR_PROJECT_ORDER_STORAGE_KEY, next);
      writeStoredProjectOrder(DASHBOARD_PROJECT_ORDER_STORAGE_KEY, next);
      nextOrder = next;
      return next;
    });
    if (nextOrder) {
      void persistWorkspaceFolderOrder(nextOrder);
    }
  }, [folders, persistWorkspaceFolderOrder]);

  const reorderDashboardFolders = useCallback((draggedFolderIds: string[], targetIndex: number) => {
    if (draggedFolderIds.length === 0) return;
    let nextOrder: string[] | null = null;
    setFolderOrderIds((prev) => {
      const current = normalizeProjectOrderIds(folders, prev);
      const draggedSet = new Set(draggedFolderIds.filter((id) => current.includes(id)));
      if (draggedSet.size === 0) return current;
      const withoutDragged = current.filter((id) => !draggedSet.has(id));
      let insertAt = Math.max(0, Math.min(targetIndex, current.length));
      const removedBefore = current.filter((id, index) => draggedSet.has(id) && index < targetIndex).length;
      insertAt -= removedBefore;
      insertAt = Math.max(0, Math.min(insertAt, withoutDragged.length));
      const draggedOrdered = current.filter((id) => draggedSet.has(id));
      const next = [...withoutDragged.slice(0, insertAt), ...draggedOrdered, ...withoutDragged.slice(insertAt)];
      writeStoredProjectOrder(DASHBOARD_PROJECT_ORDER_STORAGE_KEY, next);
      writeStoredProjectOrder(SIDEBAR_PROJECT_ORDER_STORAGE_KEY, next);
      nextOrder = next;
      return next;
    });
    if (nextOrder) {
      void persistWorkspaceFolderOrder(nextOrder);
    }
  }, [folders, persistWorkspaceFolderOrder]);

  function clearAssetSelection(): void {
    setSelectedAssetIds([]);
  }

  function toggleAssetSelection(assetId: string): void {
    setSelectedAssetIds((prev) => {
      if (prev.includes(assetId)) return prev.filter((id) => id !== assetId);
      return [...prev, assetId];
    });
  }

  function setSelectedGridMode(mode: GridMode): void {
    if (!selectedProjectId) return;
    setModeByFolderId((prev) => {
      const next = { ...prev, [selectedProjectId]: mode };
      writeGridModes(next);
      return next;
    });
  }

  async function persistCustomOrder(folderId: string, order: string[]): Promise<void> {
    setCustomOrderByFolderId((prev) => ({ ...prev, [folderId]: order }));
    writeStoredFolderOrder(folderId, order);
    try {
      await apiRequest<{ folderId: string; customOrderAssetIds: string[] }>(`/v1/drive/folders/${folderId}/layout`, {
        method: "PATCH",
        body: JSON.stringify({ customOrderAssetIds: order })
      });
    } catch {
      // Keep local fallback silently.
    }
  }

  async function reorderSelectedProjectAssets(input: ReorderInput): Promise<void> {
    if (!selectedProjectId) return;
    const draggedIds = input.draggedIds.filter((id) => selectedProjectVisibleAssets.some((asset) => asset.id === id));
    if (draggedIds.length === 0) return;

    const base = selectedGridMode === "CUSTOM"
      ? selectedProjectCustomOrder
      : selectedProjectAssetsTimeOrdered.map((asset) => asset.id);
    const baseWithoutDragged = base.filter((id) => !draggedIds.includes(id));
    const insertAt = Math.min(Math.max(0, input.targetIndex), baseWithoutDragged.length);
    const nextOrder = [...baseWithoutDragged.slice(0, insertAt), ...draggedIds, ...baseWithoutDragged.slice(insertAt)];

    if (selectedGridMode !== "CUSTOM") {
      setSelectedGridMode("CUSTOM");
    }
    await persistCustomOrder(selectedProjectId, nextOrder);
  }

  async function setSelectedProjectCustomOrder(assetIds: string[]): Promise<void> {
    if (!selectedProjectId) return;
    const allowedIds = new Set(selectedProjectAssets.map((asset) => asset.id));
    const filtered = assetIds.filter((id) => allowedIds.has(id));
    const normalized = normalizeCustomOrder(selectedProjectAssets, filtered);
    if (selectedGridMode !== "CUSTOM") {
      setSelectedGridMode("CUSTOM");
    }
    await persistCustomOrder(selectedProjectId, normalized);
  }

  async function moveItemsToFolder(itemIds: string[], folderId: string): Promise<void> {
    const uniqueIds = [...new Set(itemIds)];
    if (uniqueIds.length === 0) return;
    const knownJobIds = new Set(jobs.map((job) => job.id));

    const assetIds = uniqueIds.filter((id) => !id.startsWith("pending:") && !id.startsWith("failed:"));
    const pendingJobIds = uniqueIds
      .filter((id) => id.startsWith("pending:"))
      .map((id) => id.slice("pending:".length));
    const failedJobIds = uniqueIds
      .filter((id) => id.startsWith("failed:"))
      .map((id) => id.slice("failed:".length));
    const movableJobIds = [...new Set([...pendingJobIds, ...failedJobIds])]
      .filter((id) => knownJobIds.has(id));

    try {
      if (assetIds.length > 0) {
        await apiRequest<{ movedCount: number }>("/v1/drive/assets/batch-move", {
          method: "POST",
          body: JSON.stringify({ assetIds, folderId })
        });
        setAssets((prev) => prev.map((asset) => (assetIds.includes(asset.id) ? { ...asset, folderId } : asset)));
        setCustomOrderByFolderId((prev) => {
          const next: Record<string, string[]> = {};
          for (const [key, order] of Object.entries(prev)) {
            next[key] = order.filter((id) => !assetIds.includes(id));
          }
          return next;
        });
        setSelectedAssetIds((prev) => prev.filter((id) => !assetIds.includes(id)));
      }

      if (movableJobIds.length > 0) {
        await apiRequest<{ movedCount: number }>("/v1/generation/jobs/batch-move", {
          method: "POST",
          body: JSON.stringify({ workspaceId: WORKSPACE_ID, jobIds: movableJobIds, folderId })
        });
        setJobs((prev) =>
          prev.map((job) => (movableJobIds.includes(job.id) ? { ...job, request: { ...job.request, folderId } } : job))
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move items");
      throw e;
    }
  }

  async function deleteAssets(assetIds: string[]): Promise<Asset[]> {
    const uniqueIds = [...new Set(assetIds)];
    if (uniqueIds.length === 0) return [];
    const snapshot = assets.filter((asset) => uniqueIds.includes(asset.id));

    try {
      await apiRequest<{ deletedCount: number }>("/v1/drive/assets/batch", {
        method: "DELETE",
        body: JSON.stringify({ assetIds: uniqueIds })
      });
      setAssets((prev) => prev.filter((asset) => !uniqueIds.includes(asset.id)));
      setCustomOrderByFolderId((prev) => {
        const next: Record<string, string[]> = {};
        for (const [key, order] of Object.entries(prev)) {
          next[key] = order.filter((id) => !uniqueIds.includes(id));
        }
        return next;
      });
      setSelectedAssetIds((prev) => prev.filter((id) => !uniqueIds.includes(id)));
      return snapshot;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete assets");
      throw e;
    }
  }

  async function deleteGenerationJobs(jobIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(jobIds)];
    if (uniqueIds.length === 0) return;
    const knownJobIds = new Set(jobs.map((job) => job.id));
    const deletableIds = uniqueIds.filter((id) => knownJobIds.has(id));
    if (deletableIds.length === 0) return;

    try {
      await apiRequest<{ deletedCount: number }>("/v1/generation/jobs/batch", {
        method: "DELETE",
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, jobIds: deletableIds })
      });
      setJobs((prev) => prev.filter((job) => !deletableIds.includes(job.id)));
      setNotifications((prev) => prev.filter((item) => !item.jobId || !deletableIds.includes(item.jobId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete generation jobs");
      throw e;
    }
  }

  async function restoreAssets(assetIds: string[], snapshot?: Asset[]): Promise<void> {
    const uniqueIds = [...new Set(assetIds)];
    if (uniqueIds.length === 0) return;

    try {
      await apiRequest<{ restoredCount: number }>("/v1/drive/assets/batch-restore", {
        method: "POST",
        body: JSON.stringify({ assetIds: uniqueIds })
      });
      if (snapshot && snapshot.length > 0) {
        setAssets((prev) => {
          const existing = new Set(prev.map((asset) => asset.id));
          const restored = snapshot
            .filter((asset) => !existing.has(asset.id));
          return [...prev, ...restored];
        });
      } else {
        await refreshAssets({ silent: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore assets");
      throw e;
    }
  }

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshMedia({ silent: true });
    }, 5000);
    return () => {
      clearInterval(timer);
      if (refreshRetryTimerRef.current) {
        window.clearTimeout(refreshRetryTimerRef.current);
        refreshRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return;
    const urls = realtimeSseUrls();
    if (urls.length === 0) return;

    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let urlIndex = 0;

    const closeSource = () => {
      if (!source) return;
      source.close();
      source = null;
    };

    const scheduleReconnect = (delayMs: number) => {
      if (disposed) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, delayMs);
    };

    const onMessage = (raw: string) => {
      const parsed = (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return null;
        }
      })();
      const normalized = normalizeGenerationJob(parsed);
      if (!normalized) return;
      setJobs((prev) => mergeRealtimeJobs(prev, [normalized]));
    };

    const connect = () => {
      if (disposed) return;
      closeSource();
      const nextUrl = urls[urlIndex] ?? urls[0];
      if (!nextUrl) return;
      const nextSource = new EventSource(nextUrl);
      source = nextSource;
      let opened = false;

      nextSource.addEventListener("open", () => {
        opened = true;
        reconnectAttempt = 0;
        urlIndex = 0;
      });
      nextSource.addEventListener("job.update", (event) => {
        onMessage((event as MessageEvent).data);
      });
      nextSource.onmessage = (event) => {
        onMessage(event.data);
      };
      nextSource.onerror = () => {
        closeSource();
        if (disposed) return;
        if (!opened && urlIndex < urls.length - 1) {
          urlIndex += 1;
          scheduleReconnect(250);
          return;
        }
        const delay = Math.min(
          REALTIME_RECONNECT_MAX_MS,
          REALTIME_RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt)
        );
        reconnectAttempt += 1;
        urlIndex = 0;
        scheduleReconnect(delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      closeSource();
    };
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedAssetIds([]);
      return;
    }
    const selectedIds = new Set(selectedProjectAssets.map((asset) => asset.id));
    setSelectedAssetIds((prev) => prev.filter((id) => selectedIds.has(id)));
  }, [selectedProjectAssets, selectedProjectId]);

  const hasPrimedJobNotificationsRef = useRef(false);
  const lastJobStatusByIdRef = useRef<Record<string, GenerationJob["status"]>>({});
  const notifiedTerminalJobIdsRef = useRef<Set<string>>(new Set());
  const jobNotificationsPrimedAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(NOTIFIED_TERMINAL_JOB_IDS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const validIds = parsed.filter((id): id is string => typeof id === "string");
      notifiedTerminalJobIdsRef.current = new Set(validIds);
    } catch {
      notifiedTerminalJobIdsRef.current = new Set();
    }
  }, []);

  function rememberNotifiedJob(jobId: string): void {
    if (!jobId) return;
    const next = new Set(notifiedTerminalJobIdsRef.current);
    next.add(jobId);
    notifiedTerminalJobIdsRef.current = next;
    if (typeof window === "undefined") return;
    try {
      const compact = Array.from(next).slice(-500);
      window.localStorage.setItem(NOTIFIED_TERMINAL_JOB_IDS_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // Ignore storage failures.
    }
  }
  const assetByJobId = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const asset of assets) {
      const jobId = jobTagFromAsset(asset);
      if (!jobId || map.has(jobId)) continue;
      map.set(jobId, asset);
    }
    return map;
  }, [assets]);

  useEffect(() => {
    const nextStatusById: Record<string, GenerationJob["status"]> = {};
    for (const job of jobs) {
      nextStatusById[job.id] = job.status;
    }

    if (!hasPrimedJobNotificationsRef.current) {
      lastJobStatusByIdRef.current = nextStatusById;
      hasPrimedJobNotificationsRef.current = true;
      jobNotificationsPrimedAtRef.current = Date.now();
      return;
    }

    for (const job of jobs) {
      const previousStatus = lastJobStatusByIdRef.current[job.id];
      const hasPrevious = typeof previousStatus !== "undefined";
      const isTerminal = job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELED";
      const terminalAtTime = parseIsoTime(job.updatedAt ?? job.createdAt);
      const firstSeenTerminal =
        !hasPrevious &&
        isTerminal &&
        !loadingAssets &&
        terminalAtTime > 0 &&
        terminalAtTime >= (jobNotificationsPrimedAtRef.current - FIRST_SEEN_TERMINAL_NOTIFY_GRACE_MS);
      const justSucceeded =
        (hasPrevious && job.status === "SUCCEEDED" && previousStatus !== "SUCCEEDED") ||
        (firstSeenTerminal && job.status === "SUCCEEDED");
      const justFailed =
        (
          hasPrevious &&
          (job.status === "FAILED" || job.status === "CANCELED") &&
          previousStatus !== "FAILED" &&
          previousStatus !== "CANCELED"
        ) ||
        (firstSeenTerminal && (job.status === "FAILED" || job.status === "CANCELED"));
      if (!justSucceeded && !justFailed) continue;
      if (isLocalGenerationJobId(job.id)) continue;
      if (notifiedTerminalJobIdsRef.current.has(job.id)) continue;

      const model = job.request.model;
      const aspectRatio = typeof job.request.settings.aspectRatio === "string" ? job.request.settings.aspectRatio : "1:1";
      const resolution = typeof job.request.settings.resolution === "string" ? job.request.settings.resolution : "1K";
      const folderId = job.request.folderId ?? null;
      const generatedAsset = assetByJobId.get(job.id);
      const imageName = generatedAsset?.name ?? null;
      const imageAssetId = generatedAsset?.id ?? null;
      const imagePreviewUrl = generatedAsset?.previewUrl ?? null;

      if (justSucceeded) {
        pushNotification({
          kind: "GENERATION_SUCCEEDED",
          title: "Generation complete",
          message: `${model} · ${aspectRatio} · ${resolution}`,
          typeLabel: "Generation complete",
          imageName,
          imageAssetId,
          imagePreviewUrl,
          folderId,
          jobId: job.id
        });
        rememberNotifiedJob(job.id);
        continue;
      }

      const failure = generationFailureForJob(job);
      pushNotification({
        kind: "GENERATION_FAILED",
        title: failure.category === "SAFETY_BLOCK" || failure.category === "CONTENT_POLICY"
          ? "Generation blocked"
          : "Generation failed",
        message: `${failure.userMessage} (${generationFailureCategoryLabel(failure.category)} · ${model} · ${aspectRatio} · ${resolution})`,
        typeLabel: failure.category === "SAFETY_BLOCK" || failure.category === "CONTENT_POLICY"
          ? "Generation blocked"
          : "Generation failed",
        imageName,
        imageAssetId,
        imagePreviewUrl,
        folderId,
        jobId: job.id
      });
      rememberNotifiedJob(job.id);
    }

    lastJobStatusByIdRef.current = nextStatusById;
  }, [assetByJobId, jobs, loadingAssets]);

  const value: ProjectsContextValue = {
    workspaceId: WORKSPACE_ID,
    folders,
    sidebarFolders,
    projectCards,
    dashboardProjectCards,
    assets,
    jobs,
    selectedProjectAssets,
    selectedProjectVisibleAssets,
    selectedProjectPendingJobs,
    selectedProjectFailedJobs,
    selectedProjectHasCustomOrder,
    notifications,
    unreadNotificationCount,
    loading,
    loadingAssets,
    error,
    selectedProjectId,
    selectedProject,
    sidebarFocus,
    projectSelectionToken,
    createModalOpen,
    selectedAsset,
    selectedAssetVersions,
    versionsLoading,
    selectedGridMode,
    selectedAssetIds,
    selectionActive,
    draggedItemIds,
    setCreateModalOpen,
    reorderSidebarFolders,
    reorderDashboardFolders,
    selectProject,
    setSidebarFocusDashboard,
    setSidebarFocusFolder,
    setSelectedGridMode,
    setDraggedItemIds,
    toggleAssetSelection,
    clearAssetSelection,
    pushNotification,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    clearAllNotifications,
    dismissNotification,
    refreshProjects,
    refreshAssets,
    refreshJobs,
    refreshMedia,
    addOptimisticGenerationJob,
    reconcileOptimisticGenerationJob,
    removeGenerationJob,
    createProject,
    renameProject,
    deleteProject,
    downloadProject,
    openAsset,
    closeAsset,
    reorderSelectedProjectAssets,
    setSelectedProjectCustomOrder,
    moveItemsToFolder,
    deleteAssets,
    deleteGenerationJobs,
    restoreAssets
  };

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjects must be used inside ProjectsProvider");
  }
  return context;
}
