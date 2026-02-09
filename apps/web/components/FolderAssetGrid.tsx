"use client";

import { type CSSProperties, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import {
  ASSET_DRAG_MIME,
  type Asset,
  type AssetVersion,
  type GridMode,
  type GenerationJob,
  GENERATION_CLIENT_REQUEST_ID_KEY,
  WORKSPACE_ID,
  downloadAssetFile,
  fallbackImagePreview,
  generationClientRequestId,
  setActiveDraggedAssetIds,
  readDraggedAssetIds,
  resolveAssetPreview,
  sortAssetsNewestFirst
} from "../lib/projects";
import {
  copyGenerationFailureReport,
  generationFailureCategoryLabel,
  generationFailureForJob
} from "../lib/generation-failure";
import { useProjects } from "./ProjectsProvider";

type UndoState = {
  ids: string[];
  snapshot: Asset[];
};

type LingeredPending = {
  job: GenerationJob;
  expiresAt: number;
};

const PENDING_TILE_LINGER_MS = 15000;
const QUEUED_LABEL_MS = 2000;
const POST_MODAL_LINGER_MS = 1000;
const EMPTY_JOBS: GenerationJob[] = [];
const GRID_TILE_HEIGHT_STORAGE_KEY = "aidrive:grid-tile-height-by-scope";
const GRID_SKELETON_META_STORAGE_KEY = "aidrive:grid-skeleton-meta-by-scope";
const GRID_TILE_HEIGHT_MIN = 120;
const GRID_TILE_HEIGHT_MAX = 280;
const GRID_TILE_HEIGHT_DEFAULT = 190;
const GRID_ZOOM_PERCENT_MIN = 20;
const GRID_ZOOM_PERCENT_MAX = 100;

type FolderAssetGridProps = {
  scope?: "project" | "all";
};

function parseAspectRatio(aspectRatio?: string): number {
  if (!aspectRatio || !/^\d+:\d+$/.test(aspectRatio)) return 1;
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h) return 1;
  return w / h;
}

function parseAspectRatioOrNull(aspectRatio?: string): number | null {
  if (!aspectRatio || !/^\d+:\d+$/.test(aspectRatio)) return null;
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h) return null;
  return w / h;
}

function parseRatioFromPreviewUrl(previewUrl?: string): number | null {
  if (!previewUrl || previewUrl.startsWith("data:")) return null;
  try {
    const url = new URL(previewUrl);
    const width = Number(url.searchParams.get("width"));
    const height = Number(url.searchParams.get("height"));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return width / height;
  } catch {
    return null;
  }
}

function parseRatioFromDataUrl(dataUrl?: string): number | null {
  if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) return null;
  if (typeof atob !== "function") return null;
  try {
    const base64 = dataUrl.slice("data:image/png;base64,".length, "data:image/png;base64,".length + 64);
    const raw = atob(base64);
    if (raw.length < 24) return null;
    // PNG header + IHDR width/height.
    if (raw.charCodeAt(1) !== 80 || raw.charCodeAt(2) !== 78 || raw.charCodeAt(3) !== 71) return null;
    const bytes = Array.from(raw.slice(16, 24)).map((ch) => ch.charCodeAt(0));
    const width = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    const height = ((bytes[4] << 24) >>> 0) + (bytes[5] << 16) + (bytes[6] << 8) + bytes[7];
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return width / height;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tileHeightToZoomPercent(tileHeight: number): number {
  const safeHeight = clamp(tileHeight, GRID_TILE_HEIGHT_MIN, GRID_TILE_HEIGHT_MAX);
  const heightSpan = GRID_TILE_HEIGHT_MAX - GRID_TILE_HEIGHT_MIN;
  const zoomSpan = GRID_ZOOM_PERCENT_MAX - GRID_ZOOM_PERCENT_MIN;
  if (heightSpan <= 0) return GRID_ZOOM_PERCENT_MAX;
  const normalized = (safeHeight - GRID_TILE_HEIGHT_MIN) / heightSpan;
  return clamp(Math.round(GRID_ZOOM_PERCENT_MIN + (normalized * zoomSpan)), GRID_ZOOM_PERCENT_MIN, GRID_ZOOM_PERCENT_MAX);
}

function zoomPercentToTileHeight(zoomPercent: number): number {
  const safePercent = clamp(zoomPercent, GRID_ZOOM_PERCENT_MIN, GRID_ZOOM_PERCENT_MAX);
  const zoomSpan = GRID_ZOOM_PERCENT_MAX - GRID_ZOOM_PERCENT_MIN;
  const heightSpan = GRID_TILE_HEIGHT_MAX - GRID_TILE_HEIGHT_MIN;
  if (zoomSpan <= 0) return GRID_TILE_HEIGHT_MAX;
  const normalized = (safePercent - GRID_ZOOM_PERCENT_MIN) / zoomSpan;
  return clamp(Math.round(GRID_TILE_HEIGHT_MIN + (normalized * heightSpan)), GRID_TILE_HEIGHT_MIN, GRID_TILE_HEIGHT_MAX);
}

function assetModelName(asset: Asset): string | null {
  const hidden = new Set(["generated", "upload", "uploaded", "edited", "transform"]);
  for (const rawTag of asset.tags) {
    const tag = rawTag.trim();
    if (!tag) continue;
    if (hidden.has(tag.toLowerCase())) continue;
    return tag;
  }
  return null;
}

export function FolderAssetGrid({ scope = "project" }: FolderAssetGridProps) {
  const {
    selectedProject,
    assets,
    folders,
    selectedProjectVisibleAssets,
    loadingAssets,
    selectedProjectPendingJobs,
    selectedProjectFailedJobs,
    selectedProjectHasCustomOrder,
    selectedGridMode,
    setSelectedGridMode,
    selectedAssetIds,
    selectionActive,
    selectedAsset,
    toggleAssetSelection,
    clearAssetSelection,
    openAsset,
    setSelectedProjectCustomOrder,
    deleteAssets,
    deleteGenerationJobs,
    restoreAssets,
    moveItemsToFolder,
    refreshMedia,
    addOptimisticGenerationJob,
    reconcileOptimisticGenerationJob,
    removeGenerationJob,
    setDraggedItemIds
  } = useProjects();
  const isAllImagesScope = scope === "all";
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [visualOrder, setVisualOrder] = useState<string[]>([]);
  const [loadedRatios, setLoadedRatios] = useState<Record<string, number>>({});
  const [imageLoadedById, setImageLoadedById] = useState<Record<string, boolean>>({});
  const [gridTileHeightByScope, setGridTileHeightByScope] = useState<Record<string, number>>({});
  const [skeletonMetaByScope, setSkeletonMetaByScope] = useState<Record<string, { count: number; ratios: number[] }>>({});
  const [lingeredPendingById, setLingeredPendingById] = useState<Record<string, LingeredPending>>({});
  const [pendingStatusNow, setPendingStatusNow] = useState(() => Date.now());
  const [favoriteIds, setFavoriteIds] = useState<Record<string, boolean>>({});
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [allScopeSelectedAssetIds, setAllScopeSelectedAssetIds] = useState<string[]>([]);
  const [openMoreAssetId, setOpenMoreAssetId] = useState<string | null>(null);
  const [moreMenuFolderMode, setMoreMenuFolderMode] = useState<"add" | "move" | null>(null);
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [lingerAssetId, setLingerAssetId] = useState<string | null>(null);
  const [lingerFading, setLingerFading] = useState(false);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const lingerTimerRef = useRef<number | null>(null);
  const lingerFadeTimerRef = useRef<number | null>(null);
  const gridScaleLoadedRef = useRef(false);
  const lastModalAssetIdRef = useRef<string | null>(null);
  const lastAssetIdsRef = useRef<string[]>([]);
  const draggingIdsRef = useRef<string[]>([]);
  const hoveredAssetIdRef = useRef<string | null>(null);
  const scopedSelectedAssetIds = isAllImagesScope ? allScopeSelectedAssetIds : selectedAssetIds;
  const scopedSelectionActive = scopedSelectedAssetIds.length > 0;
  const scopeGridKey = isAllImagesScope ? "__all__" : (selectedProject?.id ?? "__none__");
  const gridTileHeight = gridTileHeightByScope[scopeGridKey] ?? GRID_TILE_HEIGHT_DEFAULT;
  const gridZoomPercent = tileHeightToZoomPercent(gridTileHeight);
  const selectedSet = useMemo(() => new Set(scopedSelectedAssetIds), [scopedSelectedAssetIds]);
  const scopedGridMode: GridMode = isAllImagesScope ? "TIME" : selectedGridMode;
  const scopedAssets = useMemo(
    () =>
      isAllImagesScope
        ? sortAssetsNewestFirst(assets.filter((asset) => asset.mimeType.toLowerCase().startsWith("image/")))
        : selectedProjectVisibleAssets,
    [assets, isAllImagesScope, selectedProjectVisibleAssets]
  );
  const scopedPendingJobs = useMemo(
    () => (isAllImagesScope ? EMPTY_JOBS : selectedProjectPendingJobs),
    [isAllImagesScope, selectedProjectPendingJobs]
  );
  const scopedFailedJobs = useMemo(
    () => (isAllImagesScope ? EMPTY_JOBS : selectedProjectFailedJobs),
    [isAllImagesScope, selectedProjectFailedJobs]
  );
  const folderOptions = useMemo(() => folders.map((folder) => ({ id: folder.id, name: folder.name })), [folders]);
  const assetsById = useMemo(
    () => new Map(scopedAssets.map((asset) => [asset.id, asset])),
    [scopedAssets]
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      setPendingStatusNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("aidrive:favorites");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        setFavoriteIds(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GRID_TILE_HEIGHT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (!parsed || typeof parsed !== "object") return;
      const normalized: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!Number.isFinite(value)) continue;
        normalized[key] = clamp(Math.round(value), GRID_TILE_HEIGHT_MIN, GRID_TILE_HEIGHT_MAX);
      }
      setGridTileHeightByScope(normalized);
    } catch {
      // ignore
    } finally {
      gridScaleLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GRID_SKELETON_META_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, { count: number; ratios: number[] }>;
      if (!parsed || typeof parsed !== "object") return;
      const next: Record<string, { count: number; ratios: number[] }> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object") continue;
        const count = Number(value.count);
        const rawRatios = Array.isArray(value.ratios) ? value.ratios : [];
        const ratios = rawRatios
          .map((ratio) => Number(ratio))
          .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
          .slice(0, 200);
        next[key] = { count: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : ratios.length, ratios };
      }
      setSkeletonMetaByScope(next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!gridScaleLoadedRef.current) return;
    try {
      window.localStorage.setItem(GRID_TILE_HEIGHT_STORAGE_KEY, JSON.stringify(gridTileHeightByScope));
    } catch {
      // ignore
    }
  }, [gridTileHeightByScope]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GRID_SKELETON_META_STORAGE_KEY, JSON.stringify(skeletonMetaByScope));
    } catch {
      // ignore
    }
  }, [skeletonMetaByScope]);

  useEffect(() => {
    hoveredAssetIdRef.current = hoveredAssetId;
  }, [hoveredAssetId]);

  useEffect(() => {
    return () => {
      if (lingerTimerRef.current) {
        window.clearTimeout(lingerTimerRef.current);
      }
      if (lingerFadeTimerRef.current) {
        window.clearTimeout(lingerFadeTimerRef.current);
      }
    };
  }, []);

  function clearLingerTimers(): void {
    if (lingerTimerRef.current) {
      window.clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = null;
    }
    if (lingerFadeTimerRef.current) {
      window.clearTimeout(lingerFadeTimerRef.current);
      lingerFadeTimerRef.current = null;
    }
  }

  function beginLingerForAsset(assetId: string): void {
    clearLingerTimers();
    setLingerAssetId(assetId);
    setLingerFading(false);

    const tryFade = () => {
      if (hoveredAssetIdRef.current === assetId) {
        lingerTimerRef.current = window.setTimeout(tryFade, 220);
        return;
      }
      setLingerFading(true);
      lingerFadeTimerRef.current = window.setTimeout(() => {
        setLingerAssetId((current) => (current === assetId ? null : current));
        setLingerFading(false);
        lingerFadeTimerRef.current = null;
      }, 900);
    };

    lingerTimerRef.current = window.setTimeout(tryFade, POST_MODAL_LINGER_MS);
  }

  useEffect(() => {
    if (selectedAsset) {
      lastModalAssetIdRef.current = selectedAsset.id;
      return;
    }
    const last = lastModalAssetIdRef.current;
    if (!last) return;
    beginLingerForAsset(last);
    lastModalAssetIdRef.current = null;
  }, [selectedAsset]);

  useEffect(() => {
    if (hoveredAssetId !== lingerAssetId) return;
    if (!lingerFading) return;
    setLingerFading(false);
    if (lingerFadeTimerRef.current) {
      window.clearTimeout(lingerFadeTimerRef.current);
      lingerFadeTimerRef.current = null;
    }
  }, [hoveredAssetId, lingerAssetId, lingerFading]);

  useEffect(() => {
    function onDocPointer(event: MouseEvent): void {
      const target = event.target as HTMLElement;
      if (target.closest(".asset-more-menu") || target.closest(".asset-more-button")) return;
      setOpenMoreAssetId(null);
      setMoreMenuFolderMode(null);
    }
    function onEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setOpenMoreAssetId(null);
      setMoreMenuFolderMode(null);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  useEffect(() => {
    if (!isAllImagesScope) return;
    setAllScopeSelectedAssetIds([]);
  }, [isAllImagesScope]);

  useEffect(() => {
    const now = Date.now();
    const activePendingJobIdByClientId = new Map<string, string>();
    for (const job of scopedPendingJobs) {
      const clientId = generationClientRequestId(job);
      if (clientId) {
        activePendingJobIdByClientId.set(clientId, job.id);
      }
    }
    setLingeredPendingById((prev) => {
      const next: Record<string, LingeredPending> = {};
      for (const [jobId, entry] of Object.entries(prev)) {
        if (entry.expiresAt <= now) continue;
        const clientId = generationClientRequestId(entry.job);
        if (clientId) {
          const activeJobId = activePendingJobIdByClientId.get(clientId);
          if (activeJobId && activeJobId !== entry.job.id) {
            continue;
          }
        }
        next[jobId] = entry;
      }
      for (const job of scopedPendingJobs) {
        next[job.id] = { job, expiresAt: now + PENDING_TILE_LINGER_MS };
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && prevKeys.every((key) => key in next && prev[key].job.id === next[key].job.id)) {
        return prev;
      }
      return next;
    });
  }, [scopedPendingJobs]);
  const pendingEntries = useMemo(() => {
    const now = Date.now();
    return Object.values(lingeredPendingById)
      .filter((entry) => entry.expiresAt > now)
      .sort((a, b) => Date.parse(b.job.createdAt) - Date.parse(a.job.createdAt));
  }, [lingeredPendingById]);
  const pendingVisualIds = useMemo(
    () => pendingEntries.map((entry) => `pending:${entry.job.id}`),
    [pendingEntries]
  );
  const stablePendingVisualIds = pendingVisualIds;
  const pendingByVisualId = useMemo(
    () => new Map<string, GenerationJob>(pendingEntries.map((entry) => [`pending:${entry.job.id}`, entry.job])),
    [pendingEntries]
  );
  const failedEntries = useMemo(
    () => scopedFailedJobs,
    [scopedFailedJobs]
  );
  const failedVisualIds = useMemo(
    () => failedEntries.map((job) => `failed:${job.id}`),
    [failedEntries]
  );
  const failedByVisualId = useMemo(
    () => new Map(failedEntries.map((job) => [`failed:${job.id}`, job])),
    [failedEntries]
  );
  const orderedVisualIds = useMemo(() => {
    const base = scopedAssets.map((asset) => asset.id);
    const canonical = [...stablePendingVisualIds, ...base, ...failedVisualIds];
    if (scopedGridMode === "TIME") {
      return canonical;
    }
    if (visualOrder.length === 0) {
      return canonical;
    }
    const canonicalSet = new Set(canonical);
    const fromVisual = visualOrder.filter((id) => canonicalSet.has(id));
    const seen = new Set(fromVisual);
    const orderedPending = stablePendingVisualIds.filter((id) => seen.has(id));
    const missingPending = stablePendingVisualIds.filter((id) => !seen.has(id));
    const fromVisualAssets = fromVisual.filter((id) => !id.startsWith("pending:") && !id.startsWith("failed:"));
    const missingAssets = base.filter((id) => !seen.has(id));
    const orderedFailed = failedVisualIds.filter((id) => seen.has(id));
    const missingFailed = failedVisualIds.filter((id) => !seen.has(id));
    // Keep pending tiles anchored left and surface newly arrived assets first
    // so custom mode still opens with fresh generations at the top-left.
    // Failed tiles are placed after non-failed images.
    return [...orderedPending, ...missingPending, ...missingAssets, ...fromVisualAssets, ...orderedFailed, ...missingFailed];
  }, [failedVisualIds, scopedAssets, scopedGridMode, stablePendingVisualIds, visualOrder]);

  const filteredVisualIds = useMemo(() => {
    if (!favoritesOnly) return orderedVisualIds;
    return orderedVisualIds.filter((visualId) => {
      const asset = assetsById.get(visualId);
      if (!asset) return false;
      return Boolean(favoriteIds[asset.id]);
    });
  }, [assetsById, favoriteIds, favoritesOnly, orderedVisualIds]);
  const bootSkeletonRatios = useMemo(() => {
    const meta = skeletonMetaByScope[scopeGridKey];
    if (!meta) {
      const defaults = [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16, 3 / 2, 2 / 3];
      return Array.from({ length: 16 }, (_, index) => defaults[index % defaults.length]);
    }
    const base = meta.ratios.length > 0 ? meta.ratios : [1];
    const max = Math.min(Math.max(meta.count, 0), 120);
    return Array.from({ length: max }, (_, index) => base[index % base.length] ?? 1);
  }, [scopeGridKey, skeletonMetaByScope]);
  const showBootSkeletons = loadingAssets && scopedAssets.length === 0 && bootSkeletonRatios.length > 0;

  function clearUndoTimer(): void {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }

  function startUndoWindow(ids: string[], snapshot: UndoState["snapshot"]): void {
    clearUndoTimer();
    setUndoState({ ids, snapshot });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, 6000);
  }

  async function onUndoDelete(): Promise<void> {
    if (!undoState) return;
    setBusy(true);
    try {
      await restoreAssets(undoState.ids, undoState.snapshot);
      setMessage("Delete undone.");
    } catch {
      setMessage("Unable to undo delete.");
    } finally {
      setBusy(false);
      clearUndoTimer();
      setUndoState(null);
    }
  }

  async function onDeleteFromTile(assetId: string): Promise<void> {
    const ids = scopedSelectionActive && selectedSet.has(assetId) ? scopedSelectedAssetIds : [assetId];
    setBusy(true);
    try {
      const snapshot = await deleteAssets(ids);
      startUndoWindow(ids, snapshot);
      setMessage(`Deleted ${ids.length} image${ids.length > 1 ? "s" : ""}.`);
    } catch {
      setMessage("Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadFromTile(assetId: string): Promise<void> {
    const ids = scopedSelectionActive && selectedSet.has(assetId) ? scopedSelectedAssetIds : [assetId];
    const lookup = new Map(scopedAssets.map((asset) => [asset.id, asset]));
    setBusy(true);
    try {
      for (const id of ids) {
        const asset = lookup.get(id);
        if (!asset) continue;
        // Small spacing to avoid browser throttling multiple downloads.
        await downloadAssetFile(asset);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      setMessage(`Downloaded ${ids.length} image${ids.length > 1 ? "s" : ""}.`);
    } catch {
      setMessage("Download failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toDataUrlFromAsset(asset: Asset): Promise<string> {
    const response = await fetch(resolveAssetPreview(asset));
    if (!response.ok) {
      throw new Error(`Image fetch failed (${response.status})`);
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to convert image"));
      reader.readAsDataURL(blob);
    });
  }

  function toggleFavorite(assetId: string): void {
    setFavoriteIds((prev) => {
      const next = { ...prev, [assetId]: !prev[assetId] };
      try {
        window.localStorage.setItem("aidrive:favorites", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  async function onCopyImageToClipboard(asset: Asset): Promise<void> {
    if (!navigator.clipboard || typeof (window as any).ClipboardItem === "undefined") {
      setMessage("Clipboard image copy is not supported in this browser.");
      return;
    }
    try {
      const response = await fetch(resolveAssetPreview(asset));
      if (!response.ok) throw new Error("Image fetch failed");
      const blob = await response.blob();
      const ClipboardItemCtor = (window as any).ClipboardItem as {
        new (items: Record<string, Blob>): ClipboardItem;
      };
      await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || "image/png"]: blob })]);
      setMessage("Image copied to clipboard.");
    } catch {
      setMessage("Unable to copy image.");
    }
  }

  async function onSendAsReference(asset: Asset): Promise<void> {
    try {
      const dataUrl = await toDataUrlFromAsset(asset);
      window.dispatchEvent(new CustomEvent("aidrive:add-reference", {
        detail: {
          id: asset.id,
          name: asset.name,
          dataUrl
        }
      }));
      setMessage("Sent to Generate panel as reference.");
    } catch {
      setMessage("Could not send image as reference.");
    }
  }

  async function onCopyToFolder(asset: Asset, folderId: string): Promise<void> {
    setBusy(true);
    try {
      await apiRequest<{ asset: Asset }>(`/v1/drive/assets/${asset.id}/copy`, {
        method: "POST",
        body: JSON.stringify({ folderId })
      });
      await refreshMedia({ silent: true });
      setMessage("Image copied to folder.");
    } catch {
      setMessage("Copy to folder failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onMoveToFolder(asset: Asset, folderId: string): Promise<void> {
    setBusy(true);
    try {
      await moveItemsToFolder([asset.id], folderId);
      setMessage("Image moved.");
    } catch {
      setMessage("Move failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onRegenerateFromAsset(asset: Asset): Promise<void> {
    setBusy(true);
    let optimisticId: string | null = null;
    let snapshot: Asset[] = [];
    try {
      const versions = await apiRequest<{ versions: AssetVersion[] }>(`/v1/versions/${asset.id}`);
      const latest = versions.versions[0];
      const prompt = typeof latest?.metadata?.prompt === "string" ? latest.metadata.prompt.trim() : "";
      const model = typeof latest?.metadata?.model === "string"
        ? latest.metadata.model.trim()
        : (assetModelName(asset) ?? "").trim();
      const aspectRatio = typeof latest?.metadata?.aspectRatio === "string"
        ? latest.metadata.aspectRatio
        : (asset.aspectRatio ?? "1:1");
      const resolution = typeof latest?.metadata?.resolution === "string"
        ? latest.metadata.resolution
        : (asset.resolution ?? "1K");
      const quality = typeof latest?.metadata?.quality === "string"
        ? latest.metadata.quality
        : resolution;
      if (!prompt || !model) {
        setMessage("Regenerate unavailable: missing prompt/model metadata.");
        return;
      }
      const clientRequestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requestPayload: GenerationJob["request"] = {
        folderId: asset.folderId ?? selectedProject?.id ?? undefined,
        prompt,
        model,
        type: "IMAGE",
        settings: {
          quality,
          resolution,
          aspectRatio,
          [GENERATION_CLIENT_REQUEST_ID_KEY]: clientRequestId
        }
      };
      optimisticId = addOptimisticGenerationJob(requestPayload);
      setVisualOrder((current) => {
        const pendingId = `pending:${optimisticId}`;
        if (current.includes(asset.id)) {
          return current.map((id) => (id === asset.id ? pendingId : id));
        }
        return [pendingId, ...current];
      });
      snapshot = await deleteAssets([asset.id]);
      const result = await apiRequest<{ job: GenerationJob }>("/v1/generation/jobs", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          ...requestPayload
        })
      });
      reconcileOptimisticGenerationJob(optimisticId, result.job);
      setMessage("Regenerating image...");
      setTimeout(() => {
        void refreshMedia({ silent: true });
      }, 250);
    } catch {
      if (optimisticId) {
        removeGenerationJob(optimisticId);
        setVisualOrder((current) => current.filter((id) => id !== `pending:${optimisticId}`));
      }
      if (snapshot.length > 0) {
        try {
          await restoreAssets([asset.id], snapshot);
        } catch {
          // ignore
        }
      }
      setMessage("Regenerate failed.");
    } finally {
      setBusy(false);
    }
  }

  function onConfirmDeleteAsset(assetId: string): void {
    if (!window.confirm("Delete this image?")) return;
    if (!window.confirm("Confirm delete? This image will be removed.")) return;
    void onDeleteFromTile(assetId);
  }

  async function onCopyFailedDiagnostics(job: GenerationJob): Promise<void> {
    try {
      await copyGenerationFailureReport(job, { folderName: selectedProject?.name ?? null });
      setMessage("Diagnostics copied. Paste it into chat.");
    } catch {
      setMessage("Unable to copy diagnostics.");
    }
  }

  async function onDeleteFailedGeneration(jobId: string): Promise<void> {
    setBusy(true);
    try {
      await deleteGenerationJobs([jobId]);
      setMessage("Failed generation removed.");
    } catch {
      setMessage("Failed generation could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  function onDragStart(event: DragEvent<HTMLElement>, assetId: string): void {
    const ids = scopedSelectionActive && selectedSet.has(assetId) ? scopedSelectedAssetIds : [assetId];
    draggingIdsRef.current = ids;
    setDraggingIds(ids);
    setDraggedItemIds(ids);
    setActiveDraggedAssetIds(ids);
    setDropIndex(null);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(ids));
    event.dataTransfer.setData("text/plain", JSON.stringify(ids));
    const firstAsset = assetsById.get(ids[0]);
    if (firstAsset) {
      event.dataTransfer.setData("text/uri-list", resolveAssetPreview(firstAsset));
    }
    if (ids.length > 1) {
      const topId = ids[ids.length - 1];
      const topAsset = assetsById.get(topId);
      const ghost = document.createElement("div");
      ghost.style.position = "fixed";
      ghost.style.top = "-10000px";
      ghost.style.left = "-10000px";
      ghost.style.width = "130px";
      ghost.style.height = "92px";
      ghost.style.pointerEvents = "none";
      for (let i = 2; i >= 0; i -= 1) {
        const layer = document.createElement("div");
        layer.style.position = "absolute";
        layer.style.inset = `${i * 3}px`;
        layer.style.border = "1px solid rgba(255,143,41,0.7)";
        layer.style.borderRadius = "10px";
        layer.style.background = i === 0 ? "rgba(18,25,43,0.95)" : "rgba(9,14,26,0.9)";
        if (i === 0 && topAsset) {
          layer.style.backgroundImage = `url("${resolveAssetPreview(topAsset)}")`;
          layer.style.backgroundSize = "cover";
          layer.style.backgroundPosition = "center";
        }
        ghost.appendChild(layer);
      }
      const badge = document.createElement("div");
      badge.textContent = `🖼 ${ids.length}`;
      badge.style.position = "absolute";
      badge.style.right = "8px";
      badge.style.top = "8px";
      badge.style.fontWeight = "700";
      badge.style.color = "#ff8f29";
      badge.style.fontSize = "14px";
      ghost.appendChild(badge);
      const stat = document.createElement("div");
      stat.textContent = `${ids.length} images`;
      stat.style.position = "absolute";
      stat.style.left = "8px";
      stat.style.bottom = "8px";
      stat.style.padding = "4px 8px";
      stat.style.borderRadius = "999px";
      stat.style.background = "rgba(6,10,20,0.86)";
      stat.style.color = "#eaf1ff";
      stat.style.fontSize = "12px";
      stat.style.fontWeight = "700";
      ghost.appendChild(stat);
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 24, 24);
      setTimeout(() => ghost.remove(), 0);
    }
  }

  function onDragEnd(): void {
    draggingIdsRef.current = [];
    setDraggingIds([]);
    setDraggedItemIds([]);
    setActiveDraggedAssetIds([]);
    setDropIndex(null);
  }

  function onDropAtIndex(event: DragEvent, index: number): void {
    if (isAllImagesScope) return;
    event.preventDefault();
    const dragged = draggingIdsRef.current.length > 0
      ? draggingIdsRef.current
      : (draggingIds.length > 0 ? draggingIds : readDraggedAssetIds(event));
    if (dragged.length === 0) return;

    if (scopedGridMode === "TIME" && selectedProjectHasCustomOrder) {
      clearAssetSelection();
      for (const id of dragged) {
        toggleAssetSelection(id);
      }
      setSelectedGridMode("CUSTOM");
      setVisualOrder([]);
      draggingIdsRef.current = [];
      setDraggingIds([]);
      setDropIndex(null);
      return;
    }

    const base = [...orderedVisualIds];
    const withoutDragged = base.filter((id) => !dragged.includes(id));
    const insertAt = Math.max(0, Math.min(index, withoutDragged.length));
    const nextVisual = [...withoutDragged.slice(0, insertAt), ...dragged, ...withoutDragged.slice(insertAt)];
    setVisualOrder(nextVisual);

    const realAssetIds = nextVisual.filter((id) => !id.startsWith("pending:") && !id.startsWith("failed:"));
    if (scopedGridMode !== "CUSTOM") {
      setSelectedGridMode("CUSTOM");
    }
    void setSelectedProjectCustomOrder(realAssetIds);
    draggingIdsRef.current = [];
    setDraggingIds([]);
    setDropIndex(null);
  }

  useEffect(() => {
    setVisualOrder([]);
    lastAssetIdsRef.current = [];
    setLoadedRatios({});
    setImageLoadedById({});
    setLingeredPendingById({});
  }, [isAllImagesScope, selectedProject?.id]);

  useEffect(() => {
    const visibleIds = new Set(scopedAssets.map((asset) => asset.id));
    setImageLoadedById((prev) => {
      const next: Record<string, boolean> = {};
      for (const [id, loaded] of Object.entries(prev)) {
        if (visibleIds.has(id)) next[id] = loaded;
      }
      for (const asset of scopedAssets) {
        if (!(asset.id in next)) next[asset.id] = false;
      }
      return next;
    });
  }, [scopedAssets]);

  useEffect(() => {
    if (loadingAssets) return;
    const imageAssets = scopedAssets.filter((asset) => asset.mimeType.toLowerCase().startsWith("image/"));
    const ratios = imageAssets.map((asset) => {
      const parsed = parseAspectRatioOrNull(asset.aspectRatio);
      if (parsed) return parsed;
      const loaded = loadedRatios[asset.id];
      if (loaded && Number.isFinite(loaded) && loaded > 0) return loaded;
      return 1;
    });
    setSkeletonMetaByScope((prev) => ({
      ...prev,
      [scopeGridKey]: {
        count: imageAssets.length,
        ratios
      }
    }));
  }, [loadedRatios, loadingAssets, scopeGridKey, scopedAssets]);

  useEffect(() => {
    const prevAssetIds = lastAssetIdsRef.current;
    const currentAssetIds = scopedAssets.map((asset) => asset.id);
    if (prevAssetIds.length === 0) {
      // Initial project load should preserve canonical order from provider.
      lastAssetIdsRef.current = currentAssetIds;
      return;
    }
    const prevSet = new Set(prevAssetIds);
    const newAssetIds = currentAssetIds.filter((id) => !prevSet.has(id));
    if (newAssetIds.length > 0) {
      const pendingInOrder = orderedVisualIds.filter((id) => id.startsWith("pending:"));
      const consumedPendingVisualIds = pendingInOrder.slice(0, newAssetIds.length);
      setVisualOrder((current) => {
        // Seed from current canonical order when local order is not initialized.
        let next = current.length > 0 ? [...current] : [...orderedVisualIds];
        for (const newId of newAssetIds) {
          if (next.includes(newId)) continue;
          const pendingIndex = next.findIndex((id) => id.startsWith("pending:"));
          if (pendingIndex >= 0) {
            next[pendingIndex] = newId;
          } else if (!next.includes(newId)) {
            next = [newId, ...next];
          }
        }
        return next;
      });
      if (consumedPendingVisualIds.length > 0) {
        setLingeredPendingById((prev) => {
          const next = { ...prev };
          for (const visualId of consumedPendingVisualIds) {
            const jobId = visualId.slice("pending:".length);
            delete next[jobId];
          }
          return next;
        });
      }
    }
    lastAssetIdsRef.current = currentAssetIds;
  }, [orderedVisualIds, scopedAssets]);

  const emptyState =
    !showBootSkeletons &&
    filteredVisualIds.length === 0 &&
    (isAllImagesScope || !selectedProject);
  const tileMetrics = useMemo(() => {
    const metrics: Record<string, { width: number; height: number }> = {};
    if (filteredVisualIds.length === 0) return metrics;
    const rowHeight = clamp(gridTileHeight, GRID_TILE_HEIGHT_MIN, GRID_TILE_HEIGHT_MAX);

    const items = filteredVisualIds.map((visualId) => {
      const pending = pendingByVisualId.get(visualId);
      const failed = failedByVisualId.get(visualId);
      const asset = assetsById.get(visualId);
      const pendingRatio = pending
        ? parseAspectRatio(String(pending.request.settings.aspectRatio ?? "1:1"))
        : null;
      const failedRatio = failed
        ? parseAspectRatio(String(failed.request.settings.aspectRatio ?? "1:1"))
        : null;
      const metadataRatio = asset ? parseAspectRatioOrNull(asset.aspectRatio) : null;
      const dataRatio = asset ? parseRatioFromDataUrl(asset.previewUrl) : null;
      const previewRatio = asset ? parseRatioFromPreviewUrl(asset.previewUrl) : null;
      const ratio = pendingRatio ?? failedRatio ?? metadataRatio ?? dataRatio ?? previewRatio;
      const safeRatio = typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
      return {
        visualId,
        ratio: safeRatio
      };
    });

    for (const entry of items) {
      metrics[entry.visualId] = {
        width: Math.max(84, rowHeight * entry.ratio),
        height: rowHeight
      };
    }

    return metrics;
  }, [assetsById, failedByVisualId, filteredVisualIds, gridTileHeight, pendingByVisualId]);

  function clearScopedSelection(): void {
    if (isAllImagesScope) {
      setAllScopeSelectedAssetIds([]);
      return;
    }
    clearAssetSelection();
  }

  function toggleScopedSelection(assetId: string): void {
    if (isAllImagesScope) {
      setAllScopeSelectedAssetIds((prev) => {
        if (prev.includes(assetId)) return prev.filter((id) => id !== assetId);
        return [...prev, assetId];
      });
      return;
    }
    toggleAssetSelection(assetId);
  }

  function markImageLoaded(assetId: string): void {
    // Defer hide to after paint so skeleton never disappears before image is visible.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setImageLoadedById((prev) => (prev[assetId] ? prev : { ...prev, [assetId]: true }));
      });
    });
  }

  function onChangeGridSize(nextZoomPercent: number): void {
    const next = zoomPercentToTileHeight(Math.round(nextZoomPercent));
    setGridTileHeightByScope((prev) => ({ ...prev, [scopeGridKey]: next }));
  }

  const selectedImageIds = useMemo(
    () => scopedSelectedAssetIds.filter((id) => {
      const asset = assetsById.get(id);
      return Boolean(asset && asset.mimeType.toLowerCase().startsWith("image/"));
    }),
    [assetsById, scopedSelectedAssetIds]
  );

  useEffect(() => {
    if (!scopedSelectionActive) return;
    function onDocumentPointerDown(event: MouseEvent): void {
      const target = event.target as HTMLElement;
      if (target.closest(".asset-card")) return;
      if (target.closest(".selection-bar")) return;
      if (target.closest(".asset-more-menu")) return;
      clearScopedSelection();
    }
    document.addEventListener("mousedown", onDocumentPointerDown);
    return () => document.removeEventListener("mousedown", onDocumentPointerDown);
  }, [scopedSelectionActive]);

  async function onBulkDownload(): Promise<void> {
    if (selectedImageIds.length === 0) return;
    setBusy(true);
    try {
      for (const id of selectedImageIds) {
        const asset = assetsById.get(id);
        if (!asset) continue;
        await downloadAssetFile(asset);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      setMessage(`Downloaded ${selectedImageIds.length} image${selectedImageIds.length > 1 ? "s" : ""}.`);
    } catch {
      setMessage("Bulk download failed.");
    } finally {
      setBusy(false);
    }
  }

  function onBulkFavorite(nextValue: boolean): void {
    if (selectedImageIds.length === 0) return;
    setFavoriteIds((prev) => {
      const next = { ...prev };
      for (const id of selectedImageIds) {
        next[id] = nextValue;
      }
      try {
        window.localStorage.setItem("aidrive:favorites", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setMessage(`${nextValue ? "Favorited" : "Unfavorited"} ${selectedImageIds.length} image${selectedImageIds.length > 1 ? "s" : ""}.`);
  }

  async function onBulkDelete(): Promise<void> {
    if (selectedImageIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedImageIds.length} selected image${selectedImageIds.length > 1 ? "s" : ""}?`)) return;
    setBusy(true);
    try {
      const snapshot = await deleteAssets(selectedImageIds);
      startUndoWindow(selectedImageIds, snapshot);
      setMessage(`Deleted ${selectedImageIds.length} image${selectedImageIds.length > 1 ? "s" : ""}.`);
      clearScopedSelection();
    } catch {
      setMessage("Bulk delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="folder-grid-wrap">
      <div className="folder-grid-toolbar">
        <div className="folder-grid-toolbar-left">
          {!isAllImagesScope ? (
            <div className="mode-toggle">
              <button
                className={`btn ${selectedGridMode === "TIME" ? "active" : ""}`}
                onClick={() => setSelectedGridMode("TIME")}
                type="button"
              >
                Time & Date
              </button>
              <button
                className={`btn ${selectedGridMode === "CUSTOM" ? "active" : ""}`}
                onClick={() => setSelectedGridMode("CUSTOM")}
                type="button"
              >
                Custom Order
              </button>
            </div>
          ) : null}

          <button
            className={`favorite-filter-btn ${favoritesOnly ? "active" : ""}`}
            type="button"
            aria-pressed={favoritesOnly}
            aria-label="Toggle favorites filter"
            title={favoritesOnly ? "Showing favorites only" : "Show favorites only"}
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            {favoritesOnly ? "♥" : "♡"}
          </button>

          {scopedSelectionActive ? (
            <div className="selection-bar">
              <span>{scopedSelectedAssetIds.length} selected</span>
              <button className="btn" type="button" onClick={() => void onBulkDownload()} disabled={busy || selectedImageIds.length === 0}>Download</button>
              <button className="btn" type="button" onClick={() => onBulkFavorite(true)} disabled={busy || selectedImageIds.length === 0}>Favorite</button>
              <button className="btn" type="button" onClick={() => onBulkFavorite(false)} disabled={busy || selectedImageIds.length === 0}>Unfavorite</button>
              <button className="btn danger" type="button" onClick={() => void onBulkDelete()} disabled={busy || selectedImageIds.length === 0}>Delete</button>
              <button className="btn" type="button" onClick={clearScopedSelection}>Clear</button>
            </div>
          ) : null}
        </div>

        <label className="grid-scale-control" htmlFor="grid-scale-slider">
          <span>Zoom</span>
          <strong>{gridZoomPercent}%</strong>
          <input
            id="grid-scale-slider"
            type="range"
            min={GRID_ZOOM_PERCENT_MIN}
            max={GRID_ZOOM_PERCENT_MAX}
            step={1}
            value={gridZoomPercent}
            onChange={(event) => onChangeGridSize(Number(event.target.value))}
          />
        </label>
      </div>

      {emptyState ? (
        <p className="muted">
          {favoritesOnly ? "No favorite images here yet." : isAllImagesScope ? "No images yet." : "No images in this project yet."}
        </p>
      ) : null}

      <div
        ref={flowRef}
        className={`asset-flow ${!isAllImagesScope && draggingIds.length > 0 ? "drag-active" : ""}`}
      >
        {showBootSkeletons
          ? bootSkeletonRatios.map((ratio, index) => (
            <div className="asset-shell" key={`boot-skeleton-${scopeGridKey}-${index}`}>
              <div
                className="asset-card loading-only"
                style={{
                  "--asset-ratio": String(ratio),
                  "--asset-row-height": `${gridTileHeight}px`,
                  width: `${Math.max(84, gridTileHeight * ratio)}px`,
                  height: `${gridTileHeight}px`
                } as CSSProperties}
              >
                <div className="asset-loading-art" />
              </div>
            </div>
          ))
          : null}
        {filteredVisualIds.map((visualId, index) => {
          const pending = pendingByVisualId.get(visualId);
          const failed = failedByVisualId.get(visualId);
          const asset = assetsById.get(visualId);
          const isPending = Boolean(pending);
          const isFailed = Boolean(failed);
          if (!asset && !pending && !failed) return null;
          const tileKey = visualId;
          const dragKey = isPending || isFailed ? visualId : asset!.id;
          const ratioFromMetadata = isPending || isFailed
            ? String(parseAspectRatio(String((pending ?? failed)?.request.settings.aspectRatio ?? "1:1")))
            : String(
                parseAspectRatioOrNull(asset!.aspectRatio) ??
                loadedRatios[asset!.id] ??
                parseRatioFromDataUrl(asset!.previewUrl ?? undefined) ??
                parseRatioFromPreviewUrl(asset!.previewUrl ?? undefined) ??
                1
              );
          const ratioFromImage =
            parseRatioFromDataUrl(asset?.previewUrl ?? undefined) ??
            parseRatioFromPreviewUrl(asset?.previewUrl ?? undefined);
          const ratioFromAsset = Number(ratioFromMetadata) || ratioFromImage || 1;
          const ratio = isPending || isFailed
            ? ratioFromMetadata
            : String(ratioFromAsset);
          const metric = tileMetrics[visualId];
          const overlayIconPx = clamp(Math.round((metric?.height ?? gridTileHeight) * 0.18), 24, 34);
          const overlayInsetPx = clamp(Math.round((metric?.height ?? gridTileHeight) * 0.045), 6, 10);
          const overlayGapPx = clamp(Math.round((metric?.height ?? gridTileHeight) * 0.04), 4, 8);
          const canSelect = !isPending && !isFailed;
          const modelLabel = isPending || isFailed
            ? String((pending ?? failed)?.request.model ?? "Unknown model")
            : String((asset ? assetModelName(asset) : null) ?? "Unknown model");
          const failedFailure = failed ? generationFailureForJob(failed) : null;
          const failedCategory = failedFailure ? generationFailureCategoryLabel(failedFailure.category) : "Unknown Failure";
          const failedReason = failedFailure?.userMessage ?? failed?.error ?? "Unknown error";
          const failedFix = failedFailure?.suggestedFix ?? null;
          const lingerClass = asset && lingerAssetId === asset.id
            ? (lingerFading ? "linger-fading" : "linger-active")
            : "";
          return (
          <div className="asset-shell" key={tileKey}>
            {!isAllImagesScope && draggingIds.length > 0 ? (
              <div
                className={`asset-drop-slot ${dropIndex === index ? "active" : ""}`}
                onDragOver={(event) => {
                  if (draggingIdsRef.current.length === 0 && draggingIds.length === 0) return;
                  event.preventDefault();
                  setDropIndex(index);
                }}
                onDrop={(event) => onDropAtIndex(event, index)}
              />
            ) : null}
            <div
              className={`asset-card ${isPending ? "pending" : ""} ${isFailed ? "failed" : ""} ${asset && selectedSet.has(asset.id) ? "selected" : ""} ${asset && favoriteIds[asset.id] ? "is-favorite" : ""} ${asset && openMoreAssetId === asset.id ? "open-more" : ""} ${lingerClass}`}
              draggable={Boolean(asset) && !isPending && !isFailed}
              onDragStart={(event) => onDragStart(event, dragKey)}
              onDragEnd={onDragEnd}
              onDragOver={(event) => {
                if (isAllImagesScope) return;
                if (draggingIdsRef.current.length === 0 && draggingIds.length === 0) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const before = event.clientX < rect.left + rect.width / 2;
                setDropIndex(before ? index : index + 1);
              }}
              onDrop={(event) => {
                if (isAllImagesScope) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const before = event.clientX < rect.left + rect.width / 2;
                onDropAtIndex(event, before ? index : index + 1);
              }}
              onClick={() => {
                if (!canSelect) return;
                if (scopedSelectionActive) {
                  toggleScopedSelection(asset!.id);
                  return;
                }
                void openAsset(asset!);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (!canSelect) return;
                if (scopedSelectionActive) {
                  toggleScopedSelection(asset!.id);
                } else {
                  void openAsset(asset!);
                }
              }}
              onMouseEnter={() => {
                if (!asset) return;
                setHoveredAssetId(asset.id);
              }}
              onMouseLeave={() => {
                if (!asset) return;
                setHoveredAssetId((current) => (current === asset.id ? null : current));
              }}
              role="button"
              tabIndex={0}
              style={{
                "--asset-ratio": ratio,
                "--asset-row-height": `${gridTileHeight}px`,
                "--overlay-icon-size": `${overlayIconPx}px`,
                "--overlay-action-inset": `${overlayInsetPx}px`,
                "--overlay-action-gap": `${overlayGapPx}px`,
                width: metric ? `${metric.width}px` : undefined,
                height: metric ? `${metric.height}px` : undefined
              } as CSSProperties}
            >
              {isPending ? (
                <>
                  <div className="pending-art" />
                  <div className="asset-meta">
                    <strong>
                      {(() => {
                        if (!pending) return "Generating...";
                        if (pending.status === "RUNNING") return "Generating...";
                        const createdAt = Date.parse(pending.createdAt);
                        if (!Number.isFinite(createdAt)) return "Generating...";
                        return pendingStatusNow - createdAt < QUEUED_LABEL_MS ? "Queued..." : "Generating...";
                      })()}
                    </strong>
                    <small>{modelLabel}</small>
                    <small>{String(pending?.request.settings.aspectRatio ?? "1:1")} · {String(pending?.request.settings.resolution ?? "1K")}</small>
                  </div>
                </>
              ) : isFailed ? (
                <>
                  <div className="failed-art" />
                  <div className="asset-card-actions bottom-left" style={{ opacity: 1 }}>
                    <button
                      className="action-icon"
                      type="button"
                      aria-label="Delete failed generation"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!failed) return;
                        void onDeleteFailedGeneration(failed.id);
                      }}
                      disabled={busy}
                    >
                      🗑
                    </button>
                  </div>
                  <div className="asset-meta">
                    <strong>Failed · {failedCategory}</strong>
                    <small>{modelLabel}</small>
                    <small>{String(failed?.request.settings.aspectRatio ?? "1:1")} · {String(failed?.request.settings.resolution ?? "1K")}</small>
                    <small className="failed-reason">{failedReason}</small>
                    {failedFix ? <small className="failed-fix">Fix: {failedFix}</small> : null}
                    <button
                      className="failed-copy-btn"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!failed) return;
                        void onCopyFailedDiagnostics(failed);
                      }}
                    >
                      Copy for Codex
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {!imageLoadedById[asset!.id] ? <div className="asset-loading-art" /> : null}
                  <img
                    ref={(element) => {
                      if (!element) return;
                      // Cached images can already be complete before onLoad fires.
                      if (element.complete && element.naturalWidth > 0) {
                        markImageLoaded(asset!.id);
                      }
                    }}
                    src={resolveAssetPreview(asset!)}
                    alt={asset!.name}
                    loading={index < 6 ? "eager" : "lazy"}
                    fetchPriority={index < 6 ? "high" : "auto"}
                    decoding="async"
                    style={{ objectFit: "cover", objectPosition: "center" }}
                    onLoad={(event) => {
                      markImageLoaded(asset!.id);
                    }}
                    onError={(event) => {
                      const element = event.currentTarget;
                      if (element.dataset.fallback === "1") {
                        markImageLoaded(asset!.id);
                        return;
                      }
                      element.dataset.fallback = "1";
                      element.src = fallbackImagePreview(asset!.id);
                    }}
                  />
                  <div className="asset-model-chip">
                    <strong title={modelLabel}>{modelLabel}</strong>
                    <small>{asset?.resolution ?? "1K"} · {asset?.aspectRatio ?? "1:1"}</small>
                  </div>

                  <div className={`asset-card-actions top-left ${selectedSet.has(asset!.id) ? "sticky" : ""}`}>
                    <button
                      className={`action-icon checkbox ${selectedSet.has(asset!.id) ? "checked" : ""}`}
                      type="button"
                        aria-label={`Select ${asset!.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleScopedSelection(asset!.id);
                        }}
                      />
                  </div>

                  <div className="asset-right-actions">
                    <button
                      className={`action-icon round favorite-action ${favoriteIds[asset!.id] ? "active" : ""}`}
                      type="button"
                      aria-label={`Favorite ${asset!.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFavorite(asset!.id);
                      }}
                    >
                      {favoriteIds[asset!.id] ? "♥" : "♡"}
                    </button>
                    <button
                      className="action-icon round"
                      type="button"
                      aria-label={`Download ${asset!.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDownloadFromTile(asset!.id);
                      }}
                      disabled={busy}
                    >
                      ⬇
                    </button>
                    <button
                      className="action-icon round"
                      type="button"
                      aria-label={`Copy ${asset!.name} to clipboard`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onCopyImageToClipboard(asset!);
                      }}
                      disabled={busy}
                    >
                      ⧉
                    </button>
                    <button
                      className={`action-icon round asset-more-button ${openMoreAssetId === asset!.id ? "active" : ""}`}
                      type="button"
                      aria-label={`More options for ${asset!.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (openMoreAssetId === asset!.id) {
                          setOpenMoreAssetId(null);
                          setMoreMenuFolderMode(null);
                          return;
                        }
                        setOpenMoreAssetId(asset!.id);
                        setMoreMenuFolderMode(null);
                      }}
                    >
                      ⋮
                    </button>
                  </div>

                  {openMoreAssetId === asset!.id ? (
                    <div
                      className="asset-more-menu"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        className="asset-more-item"
                        type="button"
                        onClick={() => {
                          void onSendAsReference(asset!);
                          setOpenMoreAssetId(null);
                          setMoreMenuFolderMode(null);
                        }}
                      >
                        Reference
                      </button>
                      <button
                        className="asset-more-item"
                        type="button"
                        onClick={() => {
                          void onRegenerateFromAsset(asset!);
                          setOpenMoreAssetId(null);
                          setMoreMenuFolderMode(null);
                        }}
                      >
                        Regenerate
                      </button>
                      <button
                        className="asset-more-item"
                        type="button"
                        onClick={() => setMoreMenuFolderMode((prev) => (prev === "add" ? null : "add"))}
                      >
                        Add to folder
                      </button>
                      {moreMenuFolderMode === "add" ? (
                        <div className="asset-more-folder-list">
                          {folderOptions.filter((folder) => folder.id !== asset!.folderId).map((folder) => (
                            <button
                              key={`add-${asset!.id}-${folder.id}`}
                              className="asset-more-folder-item"
                              type="button"
                              onClick={() => {
                                void onCopyToFolder(asset!, folder.id);
                                setOpenMoreAssetId(null);
                                setMoreMenuFolderMode(null);
                              }}
                            >
                              {folder.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        className="asset-more-item"
                        type="button"
                        onClick={() => setMoreMenuFolderMode((prev) => (prev === "move" ? null : "move"))}
                      >
                        Move to
                      </button>
                      {moreMenuFolderMode === "move" ? (
                        <div className="asset-more-folder-list">
                          {folderOptions.filter((folder) => folder.id !== asset!.folderId).map((folder) => (
                            <button
                              key={`move-${asset!.id}-${folder.id}`}
                              className="asset-more-folder-item"
                              type="button"
                              onClick={() => {
                                void onMoveToFolder(asset!, folder.id);
                                setOpenMoreAssetId(null);
                                setMoreMenuFolderMode(null);
                              }}
                            >
                              {folder.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        className="asset-more-item danger"
                        type="button"
                        onClick={() => {
                          onConfirmDeleteAsset(asset!.id);
                          setOpenMoreAssetId(null);
                          setMoreMenuFolderMode(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
          );
        })}

        {!isAllImagesScope && draggingIds.length > 0 && filteredVisualIds.length > 0 ? (
          <div
            className={`asset-drop-slot end ${dropIndex === filteredVisualIds.length ? "active" : ""}`}
            onDragOver={(event) => {
              if (draggingIdsRef.current.length === 0 && draggingIds.length === 0) return;
              event.preventDefault();
              setDropIndex(filteredVisualIds.length);
            }}
            onDrop={(event) => onDropAtIndex(event, filteredVisualIds.length)}
          />
        ) : null}
      </div>

      {undoState ? (
        <div className="undo-toast">
          <span>Images deleted.</span>
          <button className="btn" type="button" onClick={() => void onUndoDelete()} disabled={busy}>Undo</button>
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
