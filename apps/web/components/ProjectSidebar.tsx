"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  fallbackImagePreview,
  type ProjectThumbnailPreference,
  PROJECT_DRAG_MIME,
  PROJECT_THUMBNAIL_PREFS_STORAGE_KEY,
  readDraggedAssetIds,
  readDraggedProjectId,
  resolveAssetPreview
} from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

export function ProjectSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    sidebarFolders,
    assets,
    selectedProjectId,
    sidebarFocus,
    selectProject,
    setSidebarFocusDashboard,
    setCreateModalOpen,
    moveItemsToFolder,
    reorderSidebarFolders,
    deleteProject
  } = useProjects();
  const [dropProjectId, setDropProjectId] = useState<string | null>(null);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dropInsert, setDropInsert] = useState<{ folderId: string; before: boolean } | null>(null);
  const [thumbnailPrefs, setThumbnailPrefs] = useState<Record<string, ProjectThumbnailPreference>>({});
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [thumbLoadStateByFolderId, setThumbLoadStateByFolderId] = useState<Record<string, { src: string; loaded: boolean }>>({});
  const sidebarCardRef = useRef<HTMLDivElement | null>(null);
  const PROJECT_EDITOR_EVENT = "aidrive:open-project-editor";
  const PROJECT_EDITOR_STORAGE_KEY = "aidrive:openProjectEditorId";

  const latestAssetByFolderId = useMemo(() => {
    const latest = new Map<string, (typeof assets)[number]>();
    for (const asset of assets) {
      if (!asset.folderId) continue;
      const current = latest.get(asset.folderId);
      if (!current) {
        latest.set(asset.folderId, asset);
        continue;
      }
      const currentTime = current.createdAt ? Date.parse(current.createdAt) : 0;
      const nextTime = asset.createdAt ? Date.parse(asset.createdAt) : 0;
      if (nextTime >= currentTime) {
        latest.set(asset.folderId, asset);
      }
    }
    return latest;
  }, [assets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PROJECT_THUMBNAIL_PREFS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, ProjectThumbnailPreference>;
      if (parsed && typeof parsed === "object") {
        setThumbnailPrefs(parsed);
      }
    } catch {
      // Ignore malformed local storage.
    }
  }, []);

  useEffect(() => {
    const valid = new Set(sidebarFolders.map((folder) => folder.id));
    setThumbLoadStateByFolderId((prev) => {
      const next: Record<string, { src: string; loaded: boolean }> = {};
      for (const [folderId, value] of Object.entries(prev)) {
        if (valid.has(folderId)) {
          next[folderId] = value;
        }
      }
      return next;
    });
  }, [sidebarFolders]);

  useEffect(() => {
    const node = sidebarCardRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      if (!node.contains(event.target as Node)) return;
      const maxTop = node.scrollHeight - node.clientHeight;
      if (maxTop <= 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      let deltaY = event.deltaY;
      if (event.deltaMode === 1) deltaY *= 16;
      if (event.deltaMode === 2) deltaY *= node.clientHeight;

      const nextTop = Math.max(0, Math.min(maxTop, node.scrollTop + deltaY));
      const changed = Math.abs(nextTop - node.scrollTop) > 0.5;
      node.scrollTop = nextTop;
      if (changed || Math.abs(deltaY) > 0.01) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  function parseAspectRatio(value: string | undefined): number {
    if (!value) return 1;
    const match = value.match(/^(\d+):(\d+)$/);
    if (!match) return 1;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return 1;
    return width / height;
  }

  function defaultCropForAsset(assetAspectRatio: string | undefined): number {
    return parseAspectRatio(assetAspectRatio) < 1 ? 0 : 50;
  }

  function resolveSidebarThumb(folderId: string): { src: string | null; cropY: number } {
    const pref = thumbnailPrefs[folderId];
    if (pref?.mode === "upload" && pref.uploadDataUrl) {
      return { src: pref.uploadDataUrl, cropY: pref.cropY ?? 50 };
    }
    if (pref?.mode === "asset" && pref.assetId) {
      const asset = assets.find((item) => item.id === pref.assetId);
      if (asset) {
        return { src: resolveAssetPreview(asset), cropY: pref.cropY ?? defaultCropForAsset(asset.aspectRatio) };
      }
    }
    const latest = latestAssetByFolderId.get(folderId);
    if (!latest) return { src: null, cropY: 50 };
    return { src: resolveAssetPreview(latest), cropY: defaultCropForAsset(latest.aspectRatio) };
  }

  function markSidebarThumbLoaded(folderId: string, src: string): void {
    if (!src) return;
    setThumbLoadStateByFolderId((prev) => {
      const current = prev[folderId];
      if (current && current.src === src && current.loaded) return prev;
      return {
        ...prev,
        [folderId]: { src, loaded: true }
      };
    });
  }

  function openProject(projectId: string) {
    selectProject(projectId);
    onNavigate?.();
    if (pathname !== "/") {
      router.push("/");
    }
  }

  function focusDashboard(): void {
    setSidebarFocusDashboard();
    onNavigate?.();
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    if (pathname !== "/") {
      router.push("/");
      return;
    }
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <div className="sidebar-card" ref={sidebarCardRef}>
      <div className="sidebar-brand">
        <span className="brand-dot" aria-hidden="true" />
        <div>
          <h1>AI Drive</h1>
          <p>Project Dashboard</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button className={pathname === "/" && sidebarFocus === "dashboard" ? "active" : ""} type="button" onClick={focusDashboard}>Dashboard</button>
        <Link className={pathname === "/drive" ? "active" : ""} href="/drive" onClick={onNavigate}>All Images</Link>
        <Link className={pathname === "/videos" ? "active" : ""} href="/videos" onClick={onNavigate}>All Videos</Link>
      </nav>

      <div className="sidebar-projects">
        <div className="sidebar-projects-head">
          <strong>Projects</strong>
          <button className="chip-btn" onClick={() => setCreateModalOpen(true)}>+ New</button>
        </div>

        {sidebarFolders.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          sidebarFolders.map((folder) => (
            <div
              key={folder.id}
              onClick={() => openProject(folder.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openProject(folder.id);
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(PROJECT_DRAG_MIME, folder.id);
                event.dataTransfer.setData("text/plain", folder.id);
                setDraggingProjectId(folder.id);
              }}
              onDragEnd={() => {
                setDropProjectId(null);
                setDraggingProjectId(null);
                setDropInsert(null);
              }}
              className={`project-link ${pathname === "/" && sidebarFocus === "folder" && folder.id === selectedProjectId ? "selected" : ""} ${dropProjectId === folder.id ? "drop-target" : ""} ${dropInsert?.folderId === folder.id && dropInsert.before ? "insert-before" : ""} ${dropInsert?.folderId === folder.id && !dropInsert.before ? "insert-after" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggingProjectId) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const before = event.clientY < rect.top + rect.height / 2;
                  setDropInsert({ folderId: folder.id, before });
                  return;
                }
                setDropProjectId(folder.id);
              }}
              onDragLeave={() => {
                setDropProjectId((current) => (current === folder.id ? null : current));
                setDropInsert((current) => (current?.folderId === folder.id ? null : current));
              }}
              onDrop={(event) => {
                const draggedProjectId = readDraggedProjectId(event);
                if (draggedProjectId) {
                  event.preventDefault();
                  setDropProjectId(null);
                  const currentIndex = sidebarFolders.findIndex((item) => item.id === folder.id);
                  const before = dropInsert?.folderId === folder.id ? dropInsert.before : true;
                  reorderSidebarFolders(draggedProjectId, before ? currentIndex : currentIndex + 1);
                  setDropInsert(null);
                  setDraggingProjectId(null);
                  return;
                }
                const ids = readDraggedAssetIds(event);
                if (ids.length === 0) return;
                event.preventDefault();
                setDropProjectId(null);
                setDropInsert(null);
                void moveItemsToFolder(ids, folder.id);
              }}
              draggable
              role="button"
              tabIndex={0}
            >
              <span className="project-link-thumb" aria-hidden="true">
                {(() => {
                  const thumb = resolveSidebarThumb(folder.id);
                  const thumbLoaded =
                    !thumb.src ||
                    (thumbLoadStateByFolderId[folder.id]?.src === thumb.src && thumbLoadStateByFolderId[folder.id]?.loaded);
                  if (!thumb.src) return <span className="project-link-thumb-fallback">🖼</span>;
                  return (
                    <>
                      <img
                        src={thumb.src}
                        alt=""
                        style={{ objectPosition: `50% ${thumb.cropY}%` }}
                        draggable={false}
                        onLoad={() => markSidebarThumbLoaded(folder.id, thumb.src ?? "")}
                        onError={(event) => {
                          const element = event.currentTarget;
                          if (element.dataset.fallback !== "1") {
                            element.dataset.fallback = "1";
                            element.src = fallbackImagePreview(folder.id);
                          }
                          markSidebarThumbLoaded(folder.id, thumb.src ?? "");
                        }}
                      />
                      {!thumbLoaded ? (
                        <span className="project-link-thumb-loading">
                          <span className="project-link-thumb-loading-ring" />
                        </span>
                      ) : null}
                    </>
                  );
                })()}
              </span>
              <span className="project-link-name">{folder.name}</span>
              <span className="project-link-actions">
                <button
                  className="action-icon"
                  type="button"
                  aria-label={`Delete ${folder.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    const confirmed = window.confirm(`Delete "${folder.name}" and all of its images?`);
                    if (!confirmed) return;
                    setBusyProjectId(folder.id);
                    void deleteProject(folder.id).finally(() => setBusyProjectId(null));
                  }}
                  disabled={busyProjectId === folder.id}
                >
                  🗑
                </button>
                <button
                  className="action-icon"
                  type="button"
                  aria-label={`Edit ${folder.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem(PROJECT_EDITOR_STORAGE_KEY, folder.id);
                      window.dispatchEvent(new CustomEvent(PROJECT_EDITOR_EVENT, { detail: folder.id }));
                    }
                    if (pathname !== "/") {
                      router.push("/");
                    }
                  }}
                  disabled={busyProjectId === folder.id}
                >
                  ✎
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
