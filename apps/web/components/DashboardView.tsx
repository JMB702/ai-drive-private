"use client";

import { ProjectGrid } from "./ProjectGrid";
import { useProjects } from "./ProjectsProvider";
import { AssetViewerModal } from "./AssetViewerModal";
import { FolderAssetGrid } from "./FolderAssetGrid";

export function DashboardView() {
  const {
    selectedProject,
    loading,
    loadingAssets,
    error,
    folders,
    selectedAsset
  } = useProjects();

  return (
    <main className="page">
      <header className="page-head">
        <h2>Dashboard</h2>
        <p>Projects are folders. Select one, then generate directly into it.</p>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="panel">
        {loading ? <p className="muted">Loading projects...</p> : <ProjectGrid />}
      </section>

      <section className="panel compact">
        <h3>{selectedProject ? `${selectedProject.name} · Images` : "Select a project"}</h3>
        <p className="muted mono">Total projects: {folders.length}</p>
        {loadingAssets ? <p className="muted">Loading images...</p> : <FolderAssetGrid />}
      </section>

      {selectedAsset ? <AssetViewerModal /> : null}
    </main>
  );
}
