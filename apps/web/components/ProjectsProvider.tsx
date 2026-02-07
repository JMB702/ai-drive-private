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
  type ProjectViewModel,
  buildProjectCards,
  pickDefaultProjectId,
  readStoredTargetProjectId,
  writeStoredTargetProjectId
} from "../lib/projects";

type ProjectsContextValue = {
  workspaceId: string;
  folders: Folder[];
  projectCards: ProjectViewModel[];
  assets: Asset[];
  jobs: GenerationJob[];
  selectedProjectAssets: Asset[];
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
  setCreateModalOpen: (open: boolean) => void;
  selectProject: (projectId: string) => void;
  refreshProjects: (preferredProjectId?: string | null) => Promise<void>;
  refreshAssets: (opts?: { silent?: boolean }) => Promise<void>;
  refreshJobs: (opts?: { silent?: boolean }) => Promise<void>;
  createProject: (name: string) => Promise<string | null>;
  openAsset: (asset: Asset) => Promise<void>;
  closeAsset: () => void;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

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

  const selectedProject = useMemo(() => folders.find((f) => f.id === selectedProjectId) ?? null, [folders, selectedProjectId]);
  const selectedProjectAssets = useMemo(
    () => (selectedProjectId ? assets.filter((asset) => asset.folderId === selectedProjectId) : []),
    [assets, selectedProjectId]
  );
  const selectedProjectPendingJobs = useMemo(
    () => jobs.filter((job) => job.request.folderId === selectedProjectId && (job.status === "QUEUED" || job.status === "RUNNING")),
    [jobs, selectedProjectId]
  );
  const projectCards = useMemo(() => buildProjectCards(folders, selectedProjectId), [folders, selectedProjectId]);

  const value: ProjectsContextValue = {
    workspaceId: WORKSPACE_ID,
    folders,
    projectCards,
    assets,
    jobs,
    selectedProjectAssets,
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
    setCreateModalOpen,
    selectProject,
    refreshProjects,
    refreshAssets,
    refreshJobs,
    createProject,
    openAsset,
    closeAsset
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
