"use client";

import { fallbackImagePreview, resolveAssetPreview } from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

export function AssetViewerModal() {
  const { selectedAsset, selectedAssetVersions, versionsLoading, closeAsset } = useProjects();

  if (!selectedAsset) return null;

  const latest = selectedAssetVersions[0] ?? null;
  const prompt = latest?.metadata?.prompt;
  const model = latest?.metadata?.model;
  const quality = latest?.metadata?.quality;

  return (
    <div className="asset-modal-backdrop" onClick={closeAsset}>
      <div className="asset-modal" onClick={(e) => e.stopPropagation()}>
        <button className="asset-close" onClick={closeAsset}>×</button>

        <div className="asset-stage">
          <img
            src={resolveAssetPreview(selectedAsset)}
            alt={selectedAsset.name}
            className="asset-stage-image"
            onError={(event) => {
              const element = event.currentTarget;
              if (element.dataset.fallback === "1") return;
              element.dataset.fallback = "1";
              element.src = fallbackImagePreview(selectedAsset.id);
            }}
          />
        </div>

        <aside className="asset-side">
          <div className="asset-side-head">
            <strong>{selectedAsset.name}</strong>
            <p className="muted">Author</p>
          </div>

          <section className="info-card">
            <div className="info-head">
              <strong>PROMPT</strong>
              <button className="chip-btn" type="button" onClick={() => navigator.clipboard.writeText(String(prompt ?? ""))}>Copy</button>
            </div>
            <p className="muted">{prompt ? String(prompt) : "Prompt metadata unavailable for this image."}</p>
          </section>

          <section className="info-card">
            <strong>INFORMATION</strong>
            {versionsLoading ? <p className="muted">Loading metadata...</p> : null}
            <div className="info-grid">
              <span>Model</span>
              <strong>{model ? String(model) : "Unknown"}</strong>
              <span>Type</span>
              <strong>{selectedAsset.mimeType}</strong>
              <span>Quality</span>
              <strong>{quality ? String(quality) : "Standard"}</strong>
              <span>Versions</span>
              <strong>{selectedAssetVersions.length || 1}</strong>
            </div>
          </section>

          <div className="info-actions">
            <button className="generate-btn" type="button">Animate</button>
            <div className="action-row">
              <button className="btn">Open in</button>
              <button className="btn">Reference</button>
            </div>
            <div className="action-row">
              <button className="btn">Download</button>
              <button className="btn">Favorite</button>
              <button className="btn">Share</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
