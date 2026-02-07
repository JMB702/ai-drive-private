"use client";

import { aspectRatioStyle, fallbackImagePreview, resolveAssetPreview } from "../lib/projects";
import { AssetViewerModal } from "./AssetViewerModal";
import { useProjects } from "./ProjectsProvider";

export function DriveView() {
  const { selectedProject, selectedProjectAssets, loadingAssets, error, openAsset, selectedAsset } = useProjects();

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
        {!loadingAssets && selectedProject && selectedProjectAssets.length === 0 ? (
          <p className="muted">No images in this project yet.</p>
        ) : null}

        {!loadingAssets && selectedProjectAssets.length > 0 ? (
          <div className="asset-grid">
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
