"use client";

import { aspectRatioStyle, fallbackImagePreview, resolveAssetPreview } from "../lib/projects";
import { ProjectGrid } from "./ProjectGrid";
import { useProjects } from "./ProjectsProvider";
import { AssetViewerModal } from "./AssetViewerModal";

export function DashboardView() {
  const {
    selectedProject,
    loading,
    loadingAssets,
    error,
    folders,
    selectedProjectAssets,
    selectedProjectPendingJobs,
    openAsset,
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

        {loadingAssets ? <p className="muted">Loading images...</p> : null}
        {!loadingAssets && selectedProject && selectedProjectAssets.length === 0 && selectedProjectPendingJobs.length === 0 ? (
          <p className="muted">No images in this project yet. Use Generate below.</p>
        ) : null}

        {(selectedProjectAssets.length > 0 || selectedProjectPendingJobs.length > 0) ? (
          <div className="asset-grid">
            {selectedProjectPendingJobs.map((job) => (
              <div
                key={job.id}
                className="asset-tile pending"
                style={aspectRatioStyle(String(job.request.settings.aspectRatio ?? "1:1"))}
              >
                <div className="pending-art" />
                <div className="asset-meta">
                  <strong>Generating...</strong>
                  <small>{job.request.settings.aspectRatio ? String(job.request.settings.aspectRatio) : "1:1"} · {job.request.settings.resolution ? String(job.request.settings.resolution) : "1K"}</small>
                </div>
              </div>
            ))}

            {selectedProjectAssets.map((asset) => (
              <button
                key={asset.id}
                className="asset-tile"
                style={aspectRatioStyle(asset.aspectRatio ?? "1:1")}
                onClick={() => void openAsset(asset)}
              >
                <img
                  src={resolveAssetPreview(asset)}
                  alt={asset.name}
                  loading="lazy"
                  onError={(event) => {
                    const element = event.currentTarget;
                    if (element.dataset.fallback === "1") return;
                    element.dataset.fallback = "1";
                    element.src = fallbackImagePreview(asset.id);
                  }}
                />
                <div className="asset-meta">
                  <strong>{asset.name}</strong>
                  <small>{asset.mimeType} · {asset.aspectRatio ?? "1:1"} · {asset.resolution ?? "1K"}</small>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {selectedAsset ? <AssetViewerModal /> : null}
    </main>
  );
}
