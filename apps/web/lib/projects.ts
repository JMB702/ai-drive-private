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
  error: string | null;
  request: {
    folderId?: string;
    model: string;
    type: "IMAGE" | "VIDEO";
    prompt: string;
    settings: Record<string, string | number | boolean>;
  };
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

export function fallbackImagePreview(seed: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#0f1728"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#91a4bf" font-size="34" font-family="Arial, sans-serif">Preview unavailable</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function resolveAssetPreview(asset: Asset): string {
  return asset.previewUrl || fallbackImagePreview(asset.id);
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

export async function downloadAssetFile(asset: Asset): Promise<void> {
  const url = resolveAssetPreview(asset);
  const fileName = asset.name?.trim() ? asset.name : `generated-${asset.id}.png`;

  if (url.startsWith("data:")) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
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
