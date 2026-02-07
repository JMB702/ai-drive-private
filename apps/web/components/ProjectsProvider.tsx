"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
  normalizeCustomOrder,
  orderAssetsByCustom,
  pickDefaultProjectId,
  readGridModes,
  readStoredFolderOrder,
  readStoredTargetProjectId,
  sortAssetsNewestFirst,
  writeGridModes,
  writeStoredFolderOrder,
  writeStoredTargetProjectId
} from "../lib/projects";

type ReorderInput = {
  draggedIds: string[];
  targetIndex: number;
};

type ProjectsContextValue = {
  workspaceId: string;
  folders: Folder[];
  projectCards: ProjectViewModel[];
  assets: Asset[];
  jobs: GenerationJob[];
  selectedProjectAssets: Asset[];
  selectedProjectVisibleAssets: Asset[];
  selectedProjectPendingJobs: GenerationJob[];
  loading: boolean;
  loadingAssets: boolean;
  error: string | null;
  selectedProjectId: string | null;
  selectedProject: Folder | null;
  createModalOpen: boolean;
  selectedAsset: Asset | null;
  selectedAssetVersions: AssetVersion[];
  versionsLoading: boolean;
  selectedGridMode: GridMode;
  selectedAssetIds: string[];
  selectionActive: boolean;
  draggedItemIds: string[];
  setCreateModalOpen: (open: boolean) => void;
  selectProject: (projectId: string) => void;
  setSelectedGridMode: (mode: GridMode) => void;
  setDraggedItemIds: (itemIds: string[]) => void;
  toggleAssetSelection: (assetId: string) => void;
  clearAssetSelection: () => void;
  refreshProjects: (preferredProjectId?: string | null) => Promise<void>;
  refreshAssets: (opts?: { silent?: boolean }) => Promise<void>;
  refreshJobs: (opts?: { silent?: boolean }) => Promise<void>;
  createProject: (name: string) => Promise<string | null>;
  openAsset: (asset: Asset) => Promise<void>;
  closeAsset: () => void;
  reorderSelectedProjectAssets: (input: ReorderInput) => Promise<void>;
  setSelectedProjectCustomOrder: (assetIds: string[]) => Promise<void>;
  moveItemsToFolder: (itemIds: string[], folderId: string) => Promise<void>;
  deleteAssets: (assetIds: string[]) => Promise<Asset[]>;
  restoreAssets: (assetIds: string[], snapshot?: Asset[]) => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

async function fetchFolders(): Promise<Folder[]> {
  const result = await apiRequest<{ folders: Folder[] }>(`/v1/drive/folders/${WORKSPACE_ID}`);
  return result.folders;
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
  return result.assets.map((asset) => ({
    ...asset,
    previewUrl: previews[asset.id],
    aspectRatio: aspectRatios[asset.id],
    resolution: resolutions[asset.id]
  }));
}

async function fetchJobs(): Promise<GenerationJob[]> {
  const result = await apiRequest<{ jobs: GenerationJob[] }>(`/v1/generation/jobs/${WORKSPACE_ID}`);
  return result.jobs;
}

async function ensureSampleProjects(existing: Folder[]): Promise<Folder[]> {
  if (!AUTO_SEED_SAMPLE_PROJECTS) return existing;

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

  useEffect(() => {
    setModeByFolderId(readGridModes());
  }, []);

  async function refreshAssets(opts?: { silent?: boolean }): Promise<void> {
    if (!opts?.silent) setLoadingAssets(true);
    try {
      const items = await fetchAssets();
      setAssets(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assets");
    } finally {
      if (!opts?.silent) setLoadingAssets(false);
    }
  }

  async function refreshJobs(opts?: { silent?: boolean }): Promise<void> {
    try {
      const items = await fetchJobs();
      setJobs(items);
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : "Failed to load jobs");
      }
    }
  }

  async function refreshProjects(preferredProjectId?: string | null): Promise<void> {
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

      const stored = readStoredTargetProjectId();
      const fallback = pickDefaultProjectId(items, preferredProjectId ?? selectedProjectId ?? stored);
      setSelectedProjectId(fallback);

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

    await Promise.all([refreshAssets(), refreshJobs()]);
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
      await refreshProjects(projectId);
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

  function selectProject(projectId: string): void {
    setSelectedProjectId(projectId);
    writeStoredTargetProjectId(projectId);
    setSelectedAssetIds([]);
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
    () =>
      jobs
        .filter((job) => job.request.folderId === selectedProjectId && (job.status === "QUEUED" || job.status === "RUNNING"))
        .sort((a, b) => {
          const at = Date.parse(a.createdAt);
          const bt = Date.parse(b.createdAt);
          return bt - at;
        }),
    [jobs, selectedProjectId]
  );
  const projectCards = useMemo(() => buildProjectCards(folders, selectedProjectId), [folders, selectedProjectId]);
  const selectionActive = selectedAssetIds.length > 0;

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

    const assetIds = uniqueIds.filter((id) => !id.startsWith("pending:"));
    const pendingJobIds = uniqueIds
      .filter((id) => id.startsWith("pending:"))
      .map((id) => id.slice("pending:".length));

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

      if (pendingJobIds.length > 0) {
        await apiRequest<{ movedCount: number }>("/v1/generation/jobs/batch-move", {
          method: "POST",
          body: JSON.stringify({ workspaceId: WORKSPACE_ID, jobIds: pendingJobIds, folderId })
        });
        setJobs((prev) =>
          prev.map((job) => (pendingJobIds.includes(job.id) ? { ...job, request: { ...job.request, folderId } } : job))
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
      void refreshAssets({ silent: true });
      void refreshJobs({ silent: true });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedAssetIds([]);
      return;
    }
    const selectedIds = new Set(selectedProjectAssets.map((asset) => asset.id));
    setSelectedAssetIds((prev) => prev.filter((id) => selectedIds.has(id)));
  }, [selectedProjectAssets, selectedProjectId]);

  const value: ProjectsContextValue = {
    workspaceId: WORKSPACE_ID,
    folders,
    projectCards,
    assets,
    jobs,
    selectedProjectAssets,
    selectedProjectVisibleAssets,
    selectedProjectPendingJobs,
    loading,
    loadingAssets,
    error,
    selectedProjectId,
    selectedProject,
    createModalOpen,
    selectedAsset,
    selectedAssetVersions,
    versionsLoading,
    selectedGridMode,
    selectedAssetIds,
    selectionActive,
    draggedItemIds,
    setCreateModalOpen,
    selectProject,
    setSelectedGridMode,
    setDraggedItemIds,
    toggleAssetSelection,
    clearAssetSelection,
    refreshProjects,
    refreshAssets,
    refreshJobs,
    createProject,
    openAsset,
    closeAsset,
    reorderSelectedProjectAssets,
    setSelectedProjectCustomOrder,
    moveItemsToFolder,
    deleteAssets,
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
