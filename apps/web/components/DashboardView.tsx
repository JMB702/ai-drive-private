"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { ProjectGrid } from "./ProjectGrid";
import { useProjects } from "./ProjectsProvider";
import { AssetViewerModal } from "./AssetViewerModal";
import { FolderAssetGrid } from "./FolderAssetGrid";
import { DashboardSpendModule } from "./DashboardSpendModule";

export function DashboardView() {
  const {
    selectedProject,
    loading,
    loadingAssets,
    error,
    selectedAsset,
    selectedProjectId,
    sidebarFocus,
    projectSelectionToken,
    setSidebarFocusDashboard,
    setSidebarFocusFolder,
    setSidebarFocusAllImages
  } = useProjects();
  const projectTilesRef = useRef<HTMLElement | null>(null);
  const photoGridRef = useRef<HTMLElement | null>(null);
  const hasAlignedInitialFolderViewRef = useRef(false);

  useLayoutEffect(() => {
    if (!selectedProjectId) return;
    if (sidebarFocus !== "folder") return;
    setSidebarFocusFolder();
    const photoPanel = photoGridRef.current;
    if (!photoPanel) return;

    const sidebarTop =
      (document.querySelector(".rebuild-sidebar") as HTMLElement | null)?.getBoundingClientRect().top ?? 14;
    const panelTop = Math.max(0, window.scrollY + photoPanel.getBoundingClientRect().top - sidebarTop);
    const isInitialFolderRestore = projectSelectionToken === 0;

    // On refresh, jump directly to the folder position (no animated scroll).
    if (isInitialFolderRestore) {
      if (!hasAlignedInitialFolderViewRef.current || Math.abs(window.scrollY - panelTop) > 2) {
        window.scrollTo({ top: panelTop, behavior: "auto" });
      }
      hasAlignedInitialFolderViewRef.current = true;
      return;
    }

    window.scrollTo({ top: panelTop, behavior: "smooth" });
  }, [projectSelectionToken, selectedProjectId, setSidebarFocusFolder, sidebarFocus]);

  useEffect(() => {
    if (selectedProjectId) return;
    hasAlignedInitialFolderViewRef.current = false;
  }, [selectedProjectId]);

  useEffect(() => {
    const updateFocus = () => {
      const projectTiles = projectTilesRef.current;
      const photoPanel = photoGridRef.current;
      if (!projectTiles || !photoPanel) return;

      const projectRect = projectTiles.getBoundingClientRect();
      const photoRect = photoPanel.getBoundingClientRect();
      const projectsVisible = projectRect.bottom > 120 && projectRect.top < window.innerHeight * 0.7;

      if (selectedProjectId) {
        if (projectsVisible) {
          setSidebarFocusDashboard();
        } else {
          setSidebarFocusFolder();
        }
        return;
      }

      const focusLine = Math.min(Math.max(150, window.innerHeight * 0.28), 260);
      const allImagesVisible = photoRect.top <= focusLine && photoRect.bottom > focusLine;
      if (allImagesVisible) {
        setSidebarFocusAllImages();
      } else {
        setSidebarFocusDashboard();
      }
    };

    updateFocus();
    window.addEventListener("scroll", updateFocus, { passive: true });
    window.addEventListener("resize", updateFocus);
    return () => {
      window.removeEventListener("scroll", updateFocus);
      window.removeEventListener("resize", updateFocus);
    };
  }, [selectedProjectId, setSidebarFocusAllImages, setSidebarFocusDashboard, setSidebarFocusFolder]);

  return (
    <main className="page">
      <header className="page-head dashboard-page-head">
        <h2>Dashboard</h2>
        <p>Projects are folders. Select one, then generate directly into it.</p>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <div className="dashboard-top-grid">
        <section className="panel dashboard-projects-panel" ref={projectTilesRef}>
          <header className="dashboard-mobile-panel-head">
            <h2>Dashboard</h2>
          </header>
          {loading ? <p className="muted">Loading projects...</p> : <ProjectGrid />}
        </section>

        <aside className="panel compact dashboard-spend-panel">
          <DashboardSpendModule />
        </aside>
      </div>

      <section className="panel compact dashboard-folder-panel dashboard-photo-panel" ref={photoGridRef}>
        <h3>{selectedProject ? `${selectedProject.name} · Images` : "All Images"}</h3>
        {loadingAssets ? <p className="muted">Loading images...</p> : null}
        <FolderAssetGrid scope={selectedProject ? "project" : "all"} />
      </section>

      {selectedAsset ? <AssetViewerModal /> : null}
    </main>
  );
}
