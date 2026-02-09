export const WORKSPACE_ID = "ws_demo";
export const TARGET_PROJECT_STORAGE_KEY = "aidrive:lastTargetProjectId";
export const SAMPLE_PROJECT_COUNT = 8;
export const AUTO_SEED_SAMPLE_PROJECTS = true;

export const SAMPLE_PROJECT_NAMES = Array.from({ length: SAMPLE_PROJECT_COUNT }, (_, i) =>
  `Sample Project ${String(i + 1).padStart(2, "0")}`
);

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt?: string;
  layout?: {
    customOrderAssetIds: string[];
  };
};

export type Asset = {
  id: string;
  name: string;
  mimeType: string;
  folderId: string | null;
  tags: string[];
  createdAt?: string;
  previewUrl?: string;
  aspectRatio?: string;
  resolution?: string;
};

export type AssetVersion = {
  id: string;
  assetId: string;
  version: number;
  source: "UPLOAD" | "GENERATE" | "EDIT" | "TRANSFORM";
  storageKey: string;
  checksum: string;
  metadata: Record<string, string | number | boolean | null>;
  createdBy: string;
  createdAt: string;
};

export type GenerationJob = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  createdAt: string;
  updatedAt?: string;
  error: string | null;
  failure?: GenerationFailure | null;
  request: {
    folderId?: string;
    model: string;
    type: "IMAGE" | "VIDEO";
    prompt: string;
    negativePrompt?: string;
    settings: Record<string, string | number | boolean>;
  };
};

export type GenerationFailure = {
  category:
    | "SAFETY_BLOCK"
    | "CONTENT_POLICY"
    | "API_INVALID_ARGUMENT"
    | "API_AUTH"
    | "API_RATE_LIMIT"
    | "API_UNAVAILABLE"
    | "API_TIMEOUT"
    | "ASPECT_RATIO_UNSUPPORTED"
    | "ASPECT_RATIO_MISMATCH"
    | "NETWORK"
    | "UNKNOWN";
  provider: string;
  statusCode: number | null;
  errorCode: string | null;
  userMessage: string;
  suggestedFix: string;
  retryable: boolean;
  rawMessage: string;
  debugContext: Record<string, string | number | boolean | null>;
};

export type ProjectViewModel = {
  id: string;
  name: string;
  isSelected: boolean;
  createdAt?: string;
};

export type GridMode = "TIME" | "CUSTOM";

export const GRID_MODE_STORAGE_KEY = "aidrive:gridModeByFolder";
export const FOLDER_ORDER_STORAGE_PREFIX = "aidrive:folderOrder:";
export const ASSET_DRAG_MIME = "application/x-aidrive-asset-ids";
export const PROJECT_DRAG_MIME = "application/x-aidrive-project-id";
export const PROJECT_DRAG_IDS_MIME = "application/x-aidrive-project-ids";
export const SIDEBAR_PROJECT_ORDER_STORAGE_KEY = "aidrive:sidebarProjectOrder";
export const DASHBOARD_PROJECT_ORDER_STORAGE_KEY = "aidrive:dashboardProjectOrder";
export const GENERATION_CLIENT_REQUEST_ID_KEY = "__clientRequestId";
export const PROJECT_THUMBNAIL_PREFS_STORAGE_KEY = "aidrive:projectThumbnailPrefs";
let activeDraggedAssetIds: string[] = [];

export type ProjectThumbnailPreference = {
  mode: "asset" | "upload";
  assetId?: string;
  uploadDataUrl?: string;
  cropY: number;
};

export type GeneratePanelState = {
  prompt: string;
  model: string;
  type: "IMAGE" | "VIDEO";
  aspectRatio: string;
  resolution: string;
  targetProjectId: string | null;
  canSubmit: boolean;
  error: string | null;
};

export function readGenerationClientRequestId(
  settings: Record<string, string | number | boolean> | undefined
): string | null {
  if (!settings) return null;
  const value = settings[GENERATION_CLIENT_REQUEST_ID_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function generationClientRequestId(job: GenerationJob): string | null {
  return readGenerationClientRequestId(job.request.settings);
}

export function isLocalGenerationJobId(jobId: string): boolean {
  return jobId.startsWith("local:");
}

export function readStoredTargetProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TARGET_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredTargetProjectId(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TARGET_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // Ignore storage write failures in restricted/private browser modes.
  }
}

export function pickDefaultProjectId(folders: Folder[], preferredId?: string | null): string | null {
  if (folders.length === 0) return null;

  if (preferredId && folders.some((f) => f.id === preferredId)) {
    return preferredId;
  }

  const sorted = [...folders].sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });

  return sorted[0]?.id ?? folders[0].id;
}

export function sortAssetsNewestFirst(assets: Asset[]): Asset[] {
  return [...assets].sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });
}

export function normalizeCustomOrder(assets: Asset[], customOrder: string[] | undefined): string[] {
  const ordered = customOrder ?? [];
  const assetIds = new Set(assets.map((asset) => asset.id));
  const retained = ordered.filter((id) => assetIds.has(id));
  const retainedSet = new Set(retained);
  const newestFirst = sortAssetsNewestFirst(assets).map((asset) => asset.id);
  const prependNew = newestFirst.filter((id) => !retainedSet.has(id));
  return [...prependNew, ...retained];
}

export function orderAssetsByCustom(assets: Asset[], customOrder: string[] | undefined): Asset[] {
  const index = new Map(normalizeCustomOrder(assets, customOrder).map((id, i) => [id, i]));
  return [...assets].sort((a, b) => (index.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (index.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

export function buildProjectCards(folders: Folder[], selectedProjectId: string | null): ProjectViewModel[] {
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    isSelected: folder.id === selectedProjectId,
    createdAt: folder.createdAt
  }));
}

export function normalizeProjectOrderIds(folders: Folder[], orderIds: string[] | null | undefined): string[] {
  const folderIds = folders.map((folder) => folder.id);
  const folderIdSet = new Set(folderIds);
  const retained = (orderIds ?? []).filter((id) => folderIdSet.has(id));
  const retainedSet = new Set(retained);
  const missing = folderIds.filter((id) => !retainedSet.has(id));
  return [...retained, ...missing];
}

export function orderFoldersByIds(folders: Folder[], orderIds: string[] | null | undefined): Folder[] {
  const index = new Map(normalizeProjectOrderIds(folders, orderIds).map((id, i) => [id, i]));
  return [...folders].sort((a, b) => (index.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (index.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

export function fallbackImagePreview(seed: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#0f1728"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#91a4bf" font-size="34" font-family="Arial, sans-serif">Preview unavailable</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function normalizeLegacyPollinationsPreviewUrl(value: string): string {
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

export function toDisplayPreviewUrl(value: string): string {
  if (value.startsWith("data:image/svg+xml;utf8,")) {
    try {
      const prefix = "data:image/svg+xml;utf8,";
      const encoded = value.slice(prefix.length);
      const svg = decodeURIComponent(encoded);
      if (svg.includes("data-aidrive-keep-ratio=\"1\"")) {
        const withSlice = svg.replace(
          /preserveAspectRatio=["']xMidYMid\s+meet["']/gi,
          'preserveAspectRatio="xMidYMid slice"'
        );
        if (withSlice !== svg) {
          return `${prefix}${encodeURIComponent(withSlice)}`;
        }
        return value;
      }
      // Backward compatibility: unwrap historical aspect-ratio SVG wrappers
      // to the underlying source image so fullscreen view is clean.
      const imageHrefMatch = svg.match(/<image\b[^>]*\b(?:href|xlink:href)=["']([^"']+)["'][^>]*>/i);
      const embeddedHref = imageHrefMatch?.[1];
      if (embeddedHref && embeddedHref.startsWith("data:image/")) {
        return embeddedHref;
      }

      const withoutBg = svg.replace(
        /<rect\b[^>]*\bwidth=["']100%["'][^>]*\bheight=["']100%["'][^>]*\bfill=["'][^"']+["'][^>]*\/?>/gi,
        ""
      );
      if (withoutBg !== svg) {
        return `${prefix}${encodeURIComponent(withoutBg)}`;
      }
    } catch {
      // Keep original value if decoding fails.
    }
  }

  if (value.startsWith("data:image/")) return value;
  if (value.startsWith("/v1/")) {
    return `/api/proxy${value}`;
  }
  if (value.startsWith("/api/image?url=")) {
    try {
      const parsed = new URL(value, "http://local");
      const source = parsed.searchParams.get("url");
      if (!source) return value;
      const normalized = normalizeLegacyPollinationsPreviewUrl(source);
      if (normalized === source) return value;
      parsed.searchParams.set("url", normalized);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return value;
    }
  }
  // Direct URLs are much faster for <img> than proxying every request through Next.
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return normalizeLegacyPollinationsPreviewUrl(value);
  }
  return value;
}

export function resolveAssetPreview(asset: Asset): string {
  if (!asset.previewUrl) return fallbackImagePreview(asset.id);
  return toDisplayPreviewUrl(asset.previewUrl);
}

export function aspectRatioStyle(aspectRatio?: string): { aspectRatio: string } {
  const ratio = aspectRatio && /^\d+:\d+$/.test(aspectRatio) ? aspectRatio : "1:1";
  return { aspectRatio: ratio.replace(":", " / ") };
}

export function readGridModes(): Record<string, GridMode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GRID_MODE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, GridMode>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function writeGridModes(modes: Record<string, GridMode>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GRID_MODE_STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // Ignore storage write failures.
  }
}

export function readStoredFolderOrder(folderId: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${FOLDER_ORDER_STORAGE_PREFIX}${folderId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

export function writeStoredFolderOrder(folderId: string, order: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${FOLDER_ORDER_STORAGE_PREFIX}${folderId}`, JSON.stringify(order));
  } catch {
    // Ignore storage write failures.
  }
}

export function readStoredProjectOrder(storageKey: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

export function writeStoredProjectOrder(storageKey: string, order: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(order));
  } catch {
    // Ignore storage write failures.
  }
}

export async function downloadAssetFile(asset: Asset): Promise<void> {
  const url = resolveAssetPreview(asset);
  const preferredName = asset.name?.trim() ? asset.name : `generated-${asset.id}.png`;
  const directFileUrl = `/api/proxy/v1/drive/assets/${encodeURIComponent(asset.id)}/file`;

  function triggerBlobDownload(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Safari can produce unreadable files when the object URL is revoked immediately.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
  }

  function extensionForMimeType(mimeType: string | null): string | null {
    if (!mimeType) return null;
    const normalized = mimeType.split(";")[0].trim().toLowerCase();
    if (normalized === "image/png") return "png";
    if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
    if (normalized === "image/webp") return "webp";
    if (normalized === "image/avif") return "avif";
    if (normalized === "image/gif") return "gif";
    if (normalized === "image/svg+xml") return "svg";
    if (normalized === "video/mp4") return "mp4";
    if (normalized === "video/webm") return "webm";
    return null;
  }

  function withFileExtension(fileName: string, extension: string | null): string {
    const trimmed = fileName.trim();
    const base = trimmed.length > 0 ? trimmed : "download";
    if (!extension) return base;
    if (base.toLowerCase().endsWith(`.${extension}`)) return base;
    const withoutExt = base.replace(/\.[a-z0-9]+$/i, "");
    return `${withoutExt}.${extension}`;
  }

  function dataUrlMimeType(dataUrl: string): string | null {
    const match = dataUrl.match(/^data:([^;,]+)[;,]/i);
    return match ? match[1].toLowerCase() : null;
  }

  async function rasterizeSvgDataUrlToPng(dataUrl: string): Promise<string | null> {
    if (typeof Image === "undefined" || typeof document === "undefined") return null;
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        try {
          const width = image.naturalWidth || 1024;
          const height = image.naturalHeight || 1024;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  try {
    const primary = await fetch(directFileUrl, {
      headers: {
        "x-user-id": "user_demo"
      }
    });
    if (primary.ok) {
      const blob = await primary.blob();
      const mimeType = blob.type || primary.headers.get("content-type");
      if (mimeType && (mimeType.toLowerCase().startsWith("image/") || mimeType.toLowerCase().startsWith("video/"))) {
        const fileName = withFileExtension(preferredName, extensionForMimeType(mimeType));
        triggerBlobDownload(blob, fileName);
        return;
      }
    }
  } catch {
    // Fall back to preview URL download when direct asset file fetch fails.
  }

  if (url.startsWith("data:")) {
    let downloadUrl = url;
    let mimeType = dataUrlMimeType(downloadUrl);
    if (mimeType === "image/svg+xml") {
      const rasterized = await rasterizeSvgDataUrlToPng(downloadUrl);
      if (rasterized) {
        downloadUrl = rasterized;
        mimeType = "image/png";
      }
    }
    const dataResponse = await fetch(downloadUrl);
    const blob = await dataResponse.blob();
    const resolvedMimeType = mimeType || blob.type || null;
    const fileName = withFileExtension(preferredName, extensionForMimeType(resolvedMimeType));
    triggerBlobDownload(blob, fileName);
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const mimeType = blob.type || response.headers.get("content-type");
  if (mimeType && !mimeType.toLowerCase().startsWith("image/") && !mimeType.toLowerCase().startsWith("video/")) {
    throw new Error(`Download failed (unexpected content type: ${mimeType})`);
  }
  const fileName = withFileExtension(preferredName, extensionForMimeType(mimeType));
  triggerBlobDownload(blob, fileName);
}

export function readDraggedAssetIds(event: { dataTransfer: DataTransfer }): string[] {
  try {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME) || event.dataTransfer.getData("text/plain");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export function setActiveDraggedAssetIds(ids: string[]): void {
  activeDraggedAssetIds = ids.filter((value): value is string => typeof value === "string");
}

export function readActiveDraggedAssetIds(): string[] {
  return [...activeDraggedAssetIds];
}

export function readDraggedProjectId(event: { dataTransfer: DataTransfer }): string | null {
  const direct = event.dataTransfer.getData(PROJECT_DRAG_MIME);
  if (typeof direct === "string" && direct.length > 0) return direct;
  return null;
}

export function readDraggedProjectIds(event: { dataTransfer: DataTransfer }): string[] {
  try {
    const raw = event.dataTransfer.getData(PROJECT_DRAG_IDS_MIME);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === "string");
      }
    }
  } catch {
    // ignore
  }
  const single = readDraggedProjectId(event);
  return single ? [single] : [];
}
