"use client";

import { useMemo } from "react";
import { downloadAssetFile, fallbackImagePreview, resolveAssetPreview } from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

export function AllVideosView() {
  const { assets, folders, loadingAssets, error } = useProjects();

  const videos = useMemo(
    () =>
      [...assets]
        .filter((asset) => asset.mimeType.toLowerCase().startsWith("video/"))
        .sort((a, b) => {
          const at = a.createdAt ? Date.parse(a.createdAt) : 0;
          const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
          return bt - at;
        }),
    [assets]
  );
  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );

  return (
    <main className="page">
      <header className="page-head">
        <h2>All Videos</h2>
        <p>Latest video assets across all folders.</p>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="panel">
        {loadingAssets ? <p className="muted">Loading videos...</p> : null}
        {!loadingAssets && videos.length === 0 ? <p className="muted">No videos yet.</p> : null}
        {!loadingAssets && videos.length > 0 ? (
          <div className="video-grid">
            {videos.map((video) => (
              <article key={video.id} className="video-card">
                <img
                  src={video.previewUrl ? resolveAssetPreview(video) : fallbackImagePreview(video.id)}
                  alt={video.name}
                  loading="lazy"
                />
                <div className="video-meta">
                  <strong>{video.name}</strong>
                  <small>{video.folderId ? folderNameById.get(video.folderId) ?? "Unknown folder" : "Unfiled"}</small>
                </div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void downloadAssetFile(video);
                  }}
                >
                  Download
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
