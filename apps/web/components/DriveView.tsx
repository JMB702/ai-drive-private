"use client";

import { AssetViewerModal } from "./AssetViewerModal";
import { FolderAssetGrid } from "./FolderAssetGrid";
import { useProjects } from "./ProjectsProvider";

export function DriveView() {
  const { selectedProject, loadingAssets, error, selectedAsset } = useProjects();

  return (
    <main className="page">
      <header className="page-head">
        <h2>Drive</h2>
        <p>{selectedProject ? `Folder: ${selectedProject.name}` : "Select a project from the sidebar."}</p>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="panel">
        {loadingAssets ? <p className="muted">Loading images...</p> : null}
        {!loadingAssets && !selectedProject ? <p className="muted">No project selected.</p> : null}
        {!loadingAssets && selectedProject ? <FolderAssetGrid /> : null}
      </section>

      {selectedAsset ? <AssetViewerModal /> : null}
    </main>
  );
}
