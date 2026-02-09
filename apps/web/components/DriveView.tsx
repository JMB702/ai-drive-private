"use client";

import { useLayoutEffect, useRef } from "react";
import { AssetViewerModal } from "./AssetViewerModal";
import { FolderAssetGrid } from "./FolderAssetGrid";
import { ProjectGrid } from "./ProjectGrid";
import { useProjects } from "./ProjectsProvider";

export function DriveView() {
  const { loading, loadingAssets, error, selectedAsset } = useProjects();
  const photoGridRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const photoPanel = photoGridRef.current;
    if (!photoPanel) return;
    const sidebarTop =
      (document.querySelector(".rebuild-sidebar") as HTMLElement | null)?.getBoundingClientRect().top ?? 14;
    const panelTop = Math.max(0, window.scrollY + photoPanel.getBoundingClientRect().top - sidebarTop);
    window.scrollTo({ top: panelTop, behavior: "smooth" });
  }, []);

  return (
    <main className="page">
      <header className="page-head">
        <h2>All Images</h2>
        <p>All rendered photos across every folder, ordered by generation time.</p>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="panel">
        {loading ? <p className="muted">Loading projects...</p> : <ProjectGrid />}
      </section>

      <section className="panel compact dashboard-folder-panel dashboard-photo-panel" ref={photoGridRef}>
        <h3>All Images</h3>
        {loadingAssets ? <p className="muted">Loading images...</p> : null}
        <FolderAssetGrid scope="all" />
      </section>

      {selectedAsset ? <AssetViewerModal /> : null}
    </main>
  );
}
