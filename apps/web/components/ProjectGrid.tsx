"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  fallbackImagePreview,
  isSuccessfulGeneratedImageAsset,
  latestPreferredFolderThumbnailById,
  type ProjectThumbnailPreference,
  PROJECT_THUMBNAIL_PREFS_STORAGE_KEY,
  PROJECT_DRAG_IDS_MIME,
  PROJECT_DRAG_MIME,
  readDraggedAssetIds,
  readDraggedProjectIds,
  resolveAssetPreview
} from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

const PROJECT_EDITOR_EVENT = "aidrive:open-project-editor";
const PROJECT_EDITOR_STORAGE_KEY = "aidrive:openProjectEditorId";
const MOBILE_HOLD_TOOLS_DELAY_MS = 420;
const MOBILE_HOLD_CANCEL_DISTANCE_PX = 12;
const MOBILE_DRAG_START_DISTANCE_PX = 18;

function clampCropY(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value)));
}

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

export function ProjectGrid() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    dashboardProjectCards,
    folders,
    assets,
    sidebarFocus,
    selectProject,
    setCreateModalOpen,
    moveItemsToFolder,
    reorderDashboardFolders,
    renameProject,
    deleteProject,
    downloadProject
  } = useProjects();

  const [dropProjectId, setDropProjectId] = useState<string | null>(null);
  const [draggingProjectIds, setDraggingProjectIds] = useState<string[]>([]);
  const draggingProjectIdsRef = useRef<string[]>([]);
  const suppressOpenRef = useRef(false);
  const [dropInsert, setDropInsert] = useState<{ folderId: string; before: boolean } | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [touchUi, setTouchUi] = useState(false);
  const [openMobileToolsProjectId, setOpenMobileToolsProjectId] = useState<string | null>(null);
  const [mobileDraggingProjectId, setMobileDraggingProjectId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [thumbLoadStateByProjectId, setThumbLoadStateByProjectId] = useState<Record<string, { src: string; loaded: boolean }>>({});

  const [thumbnailPrefs, setThumbnailPrefs] = useState<Record<string, ProjectThumbnailPreference>>({});
  const [editTarget, setEditTarget] = useState<{ id: string; name: string } | null>(null);
  const [editName, setEditName] = useState("");
  const [editMode, setEditMode] = useState<"auto" | "asset" | "upload">("auto");
  const [editAssetId, setEditAssetId] = useState<string | null>(null);
  const [editUploadDataUrl, setEditUploadDataUrl] = useState<string | null>(null);
  const [editCropY, setEditCropY] = useState(50);
  const [assetFilter, setAssetFilter] = useState("");
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [pendingEditorProjectId, setPendingEditorProjectId] = useState<string | null>(null);
  const cropBoxRef = useRef<HTMLDivElement | null>(null);
  const cropDragRef = useRef<{ pointerY: number; cropY: number; height: number } | null>(null);
  const dropInsertRef = useRef<{ folderId: string; before: boolean } | null>(null);
  const mobileHoldRef = useRef<{
    pointerId: number;
    projectId: string;
    startX: number;
    startY: number;
    longPressTriggered: boolean;
    dragStarted: boolean;
    timerId: number | null;
  } | null>(null);

  const selectionActive = selectedProjectIds.length > 0;

  const assetById = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>();
    for (const asset of assets) map.set(asset.id, asset);
    return map;
  }, [assets]);

  const folderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of folders) map.set(folder.id, folder.name);
    return map;
  }, [folders]);

  const latestAssetByProjectId = useMemo(() => latestPreferredFolderThumbnailById(assets), [assets]);

  const pickableAssets = useMemo(() => {
    const sorted = [...assets].sort((a, b) => {
      const at = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bt - at;
    });
    const query = assetFilter.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter((asset) => {
      const folderName = asset.folderId ? (folderNameById.get(asset.folderId) ?? "") : "";
      return (
        asset.name.toLowerCase().includes(query) ||
        folderName.toLowerCase().includes(query)
      );
    });
  }, [assetFilter, assets, folderNameById]);

  useEffect(() => {
    const valid = new Set(dashboardProjectCards.map((project) => project.id));
    setSelectedProjectIds((prev) => prev.filter((id) => valid.has(id)));
    setOpenMobileToolsProjectId((prev) => (prev && valid.has(prev) ? prev : null));
    setMobileDraggingProjectId((prev) => (prev && valid.has(prev) ? prev : null));
    setThumbnailPrefs((prev) => {
      const next: Record<string, ProjectThumbnailPreference> = {};
      for (const [folderId, pref] of Object.entries(prev)) {
        if (valid.has(folderId)) next[folderId] = pref;
      }
      return next;
    });
  }, [dashboardProjectCards]);

  useEffect(() => {
    const valid = new Set(dashboardProjectCards.map((project) => project.id));
    setThumbLoadStateByProjectId((prev) => {
      const next: Record<string, { src: string; loaded: boolean }> = {};
      for (const [projectId, value] of Object.entries(prev)) {
        if (valid.has(projectId)) {
          next[projectId] = value;
        }
      }
      return next;
    });
  }, [dashboardProjectCards]);

  useEffect(() => {
    dropInsertRef.current = dropInsert;
  }, [dropInsert]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PROJECT_THUMBNAIL_PREFS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, ProjectThumbnailPreference>;
      if (!parsed || typeof parsed !== "object") return;
      setThumbnailPrefs(parsed);
    } catch {
      // Ignore malformed local data.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PROJECT_THUMBNAIL_PREFS_STORAGE_KEY, JSON.stringify(thumbnailPrefs));
    } catch {
      // Ignore storage write failures.
    }
  }, [thumbnailPrefs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromStorage = window.localStorage.getItem(PROJECT_EDITOR_STORAGE_KEY);
    if (fromStorage) {
      setPendingEditorProjectId(fromStorage);
      window.localStorage.removeItem(PROJECT_EDITOR_STORAGE_KEY);
    }
    const handler = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (!custom.detail) return;
      setPendingEditorProjectId(custom.detail);
    };
    window.addEventListener(PROJECT_EDITOR_EVENT, handler as EventListener);
    return () => window.removeEventListener(PROJECT_EDITOR_EVENT, handler as EventListener);
  }, []);

  function toggleProjectSelection(projectId: string): void {
    setSelectedProjectIds((prev) => {
      if (prev.includes(projectId)) return prev.filter((id) => id !== projectId);
      return [...prev, projectId];
    });
  }

  function resolveCardImage(projectId: string): { src: string | null; cropY: number } {
    const pref = thumbnailPrefs[projectId];
    if (pref?.mode === "upload" && pref.uploadDataUrl) {
      return { src: pref.uploadDataUrl, cropY: clampCropY(pref.cropY) };
    }
    if (pref?.mode === "asset" && pref.assetId) {
      const asset = assetById.get(pref.assetId);
      if (asset && isSuccessfulGeneratedImageAsset(asset)) {
        return {
          src: resolveAssetPreview(asset),
          cropY: clampCropY(pref.cropY ?? defaultCropForAsset(asset.aspectRatio))
        };
      }
    }
    const latestAsset = latestAssetByProjectId.get(projectId);
    if (!latestAsset) return { src: null, cropY: 50 };
    return {
      src: resolveAssetPreview(latestAsset),
      cropY: defaultCropForAsset(latestAsset.aspectRatio)
    };
  }

  function markProjectThumbLoaded(projectId: string, src: string): void {
    if (!src) return;
    setThumbLoadStateByProjectId((prev) => {
      const current = prev[projectId];
      if (current && current.src === src && current.loaded) return prev;
      return {
        ...prev,
        [projectId]: { src, loaded: true }
      };
    });
  }

  function openEditModal(projectId: string, projectName: string): void {
    const pref = thumbnailPrefs[projectId];
    const latestAsset = latestAssetByProjectId.get(projectId);
    const fallbackCrop = defaultCropForAsset(latestAsset?.aspectRatio);
    setEditTarget({ id: projectId, name: projectName });
    setEditName(projectName);
    setAssetFilter("");

    if (pref?.mode === "upload" && pref.uploadDataUrl) {
      setEditMode("upload");
      setEditAssetId(null);
      setEditUploadDataUrl(pref.uploadDataUrl);
      setEditCropY(clampCropY(pref.cropY));
      return;
    }
    if (pref?.mode === "asset" && pref.assetId && assetById.has(pref.assetId)) {
      const asset = assetById.get(pref.assetId);
      setEditMode("asset");
      setEditAssetId(pref.assetId);
      setEditUploadDataUrl(null);
      setEditCropY(clampCropY(pref.cropY ?? defaultCropForAsset(asset?.aspectRatio)));
      return;
    }
    setEditMode("auto");
    setEditAssetId(latestAsset?.id ?? null);
    setEditUploadDataUrl(null);
    setEditCropY(fallbackCrop);
  }

  useEffect(() => {
    if (!pendingEditorProjectId) return;
    const project = dashboardProjectCards.find((item) => item.id === pendingEditorProjectId);
    if (!project) return;
    openEditModal(project.id, project.name);
    setPendingEditorProjectId(null);
  }, [dashboardProjectCards, pendingEditorProjectId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setTouchUi(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (!openMobileToolsProjectId) return;
    function onPointerDown(event: PointerEvent): void {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".project-mobile-tools-menu") || target.closest(".project-mobile-hold-trigger")) return;
      setOpenMobileToolsProjectId(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMobileToolsProjectId]);

  useEffect(() => {
    return () => {
      const activeHold = mobileHoldRef.current;
      if (!activeHold?.timerId) return;
      window.clearTimeout(activeHold.timerId);
    };
  }, []);

  function clearMobileHoldTimer(): void {
    const activeHold = mobileHoldRef.current;
    if (!activeHold?.timerId) return;
    window.clearTimeout(activeHold.timerId);
    activeHold.timerId = null;
  }

  function suppressOpenOnce(): void {
    suppressOpenRef.current = true;
    window.setTimeout(() => {
      suppressOpenRef.current = false;
    }, 180);
  }

  function resetMobileHold(): void {
    clearMobileHoldTimer();
    mobileHoldRef.current = null;
    setMobileDraggingProjectId(null);
    setDropInsert(null);
  }

  function openProjectFromTap(projectId: string): void {
    setOpenMobileToolsProjectId(null);
    if (selectionActive) {
      toggleProjectSelection(projectId);
      return;
    }
    selectProject(projectId);
    if (pathname !== "/") {
      router.push("/");
    }
  }

  function queueDownloadProject(projectId: string, projectName: string): void {
    setBusyProjectId(projectId);
    void downloadProject(projectId)
      .then(() => setMessage(`Downloaded ${projectName}.`))
      .catch(() => setMessage(`Could not download ${projectName}.`))
      .finally(() => setBusyProjectId(null));
  }

  function updateMobileDropInsert(clientX: number, clientY: number, draggedProjectId: string): void {
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const shell = target?.closest<HTMLElement>("[data-project-card-id]");
    const targetProjectId = shell?.dataset.projectCardId;
    if (!shell || !targetProjectId || targetProjectId === draggedProjectId) {
      setDropInsert(null);
      return;
    }
    const rect = shell.getBoundingClientRect();
    const before = clientX < rect.left + rect.width / 2;
    setDropInsert({ folderId: targetProjectId, before });
  }

  function onMobileHoldPointerDown(event: ReactPointerEvent<HTMLElement>, projectId: string): void {
    if (!touchUi) return;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".project-mobile-tools-menu")) return;
    setOpenMobileToolsProjectId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    resetMobileHold();
    const nextHold = {
      pointerId: event.pointerId,
      projectId,
      startX: event.clientX,
      startY: event.clientY,
      longPressTriggered: false,
      dragStarted: false,
      timerId: window.setTimeout(() => {
        const activeHold = mobileHoldRef.current;
        if (!activeHold || activeHold.pointerId !== event.pointerId || activeHold.projectId !== projectId) return;
        activeHold.longPressTriggered = true;
        setOpenMobileToolsProjectId(projectId);
        suppressOpenOnce();
      }, MOBILE_HOLD_TOOLS_DELAY_MS)
    };
    mobileHoldRef.current = nextHold;
  }

  function onMobileHoldPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    if (!touchUi) return;
    const activeHold = mobileHoldRef.current;
    if (!activeHold || activeHold.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - activeHold.startX;
    const deltaY = event.clientY - activeHold.startY;
    const distance = Math.hypot(deltaX, deltaY);

    if (!activeHold.longPressTriggered) {
      if (distance > MOBILE_HOLD_CANCEL_DISTANCE_PX) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        resetMobileHold();
      }
      return;
    }

    event.preventDefault();
    if (!activeHold.dragStarted && distance > MOBILE_DRAG_START_DISTANCE_PX) {
      activeHold.dragStarted = true;
      setOpenMobileToolsProjectId(null);
      setMobileDraggingProjectId(activeHold.projectId);
    }
    if (!activeHold.dragStarted) return;
    updateMobileDropInsert(event.clientX, event.clientY, activeHold.projectId);
  }

  function onMobileHoldPointerUp(event: ReactPointerEvent<HTMLElement>): void {
    if (!touchUi) return;
    const activeHold = mobileHoldRef.current;
    if (!activeHold || activeHold.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearMobileHoldTimer();

    if (activeHold.dragStarted) {
      event.preventDefault();
      const target = dropInsertRef.current;
      if (target) {
        const currentIndex = dashboardProjectCards.findIndex((item) => item.id === target.folderId);
        if (currentIndex >= 0) {
          reorderDashboardFolders([activeHold.projectId], target.before ? currentIndex : currentIndex + 1);
        }
      }
      suppressOpenOnce();
      resetMobileHold();
      return;
    }

    if (activeHold.longPressTriggered) {
      event.preventDefault();
      suppressOpenOnce();
      mobileHoldRef.current = null;
      return;
    }

    mobileHoldRef.current = null;
  }

  function onMobileHoldPointerCancel(event: ReactPointerEvent<HTMLElement>): void {
    if (!touchUi) return;
    const activeHold = mobileHoldRef.current;
    if (!activeHold || activeHold.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetMobileHold();
  }

  async function handleUploadThumbnail(file: File): Promise<void> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
    setEditMode("upload");
    setEditUploadDataUrl(dataUrl);
    setEditAssetId(null);
    setEditCropY(50);
  }

  async function saveEditModal(): Promise<void> {
    if (!editTarget) return;
    const target = editTarget;
    setBusyProjectId(target.id);

    try {
      const trimmedName = editName.trim();
      if (trimmedName && trimmedName !== target.name) {
        await renameProject(target.id, trimmedName);
      }

      setThumbnailPrefs((prev) => {
        const next = { ...prev };
        if (editMode === "auto") {
          delete next[target.id];
          return next;
        }
        if (editMode === "asset" && editAssetId) {
          next[target.id] = {
            mode: "asset",
            assetId: editAssetId,
            cropY: clampCropY(editCropY)
          };
          return next;
        }
        if (editMode === "upload" && editUploadDataUrl) {
          next[target.id] = {
            mode: "upload",
            uploadDataUrl: editUploadDataUrl,
            cropY: clampCropY(editCropY)
          };
          return next;
        }
        delete next[target.id];
        return next;
      });

      setEditTarget(null);
    } catch (error) {
      const text = error instanceof Error && error.message ? error.message : "Could not save project settings.";
      setMessage(text);
    } finally {
      setBusyProjectId(null);
    }
  }

  function beginCropDrag(pointerY: number): void {
    if (editMode === "auto") return;
    const box = cropBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    cropDragRef.current = {
      pointerY,
      cropY: editCropY,
      height: Math.max(1, rect.height)
    };
    setIsDraggingCrop(true);
  }

  function moveCropDrag(pointerY: number): void {
    const drag = cropDragRef.current;
    if (!drag) return;
    const deltaY = pointerY - drag.pointerY;
    const next = drag.cropY - (deltaY / drag.height) * 100;
    setEditCropY(clampCropY(next));
  }

  function endCropDrag(): void {
    cropDragRef.current = null;
    setIsDraggingCrop(false);
  }

  return (
    <div className="project-grid-wrap">
      <button className="project-card new" onClick={() => setCreateModalOpen(true)}>
        <span className="plus">+</span>
        <strong>New Project</strong>
        <small>Create folder/project</small>
      </button>

      {dashboardProjectCards.map((project) => {
        const cardImage = resolveCardImage(project.id);
        const cardThumbLoaded =
          !cardImage.src ||
          (thumbLoadStateByProjectId[project.id]?.src === cardImage.src && thumbLoadStateByProjectId[project.id]?.loaded);
        return (
          <div
            key={project.id}
            className={`project-card-shell ${dropInsert?.folderId === project.id && dropInsert.before ? "insert-before" : ""} ${dropInsert?.folderId === project.id && !dropInsert.before ? "insert-after" : ""}`}
            data-project-card-id={project.id}
          >
            <div
              className={`project-card ${project.isSelected && sidebarFocus === "folder" ? "selected" : ""} ${dropProjectId === project.id ? "drop-target" : ""} ${mobileDraggingProjectId === project.id ? "mobile-dragging" : ""}`}
              onPointerDown={(event) => onMobileHoldPointerDown(event, project.id)}
              onPointerMove={onMobileHoldPointerMove}
              onPointerUp={onMobileHoldPointerUp}
              onPointerCancel={onMobileHoldPointerCancel}
              onClick={() => {
                if (suppressOpenRef.current) return;
                openProjectFromTap(project.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openProjectFromTap(project.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggingProjectIdsRef.current.length > 0 || draggingProjectIds.length > 0) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const before = event.clientX < rect.left + rect.width / 2;
                  setDropInsert({ folderId: project.id, before });
                  return;
                }
                setDropProjectId(project.id);
              }}
              onDragLeave={() => {
                setDropProjectId((current) => (current === project.id ? null : current));
                setDropInsert((current) => (current?.folderId === project.id ? null : current));
              }}
              onDrop={(event) => {
                const draggedProjectIds = readDraggedProjectIds(event);
                if (draggedProjectIds.length > 0) {
                  event.preventDefault();
                  setDropProjectId(null);
                  const currentIndex = dashboardProjectCards.findIndex((item) => item.id === project.id);
                  const before = dropInsert?.folderId === project.id ? dropInsert.before : true;
                  reorderDashboardFolders(draggedProjectIds, before ? currentIndex : currentIndex + 1);
                  setDropInsert(null);
                  setDraggingProjectIds([]);
                  draggingProjectIdsRef.current = [];
                  return;
                }
                const ids = readDraggedAssetIds(event);
                if (ids.length === 0) return;
                event.preventDefault();
                setDropProjectId(null);
                setDropInsert(null);
                void moveItemsToFolder(ids, project.id);
              }}
              onDragStart={(event) => {
                const ids = selectionActive && selectedProjectIds.includes(project.id)
                  ? selectedProjectIds
                  : [project.id];
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(PROJECT_DRAG_MIME, project.id);
                event.dataTransfer.setData(PROJECT_DRAG_IDS_MIME, JSON.stringify(ids));
                event.dataTransfer.setData("text/plain", JSON.stringify(ids));
                setDraggingProjectIds(ids);
                draggingProjectIdsRef.current = ids;
                suppressOpenRef.current = true;
              }}
              onDragEnd={() => {
                setDropProjectId(null);
                setDraggingProjectIds([]);
                draggingProjectIdsRef.current = [];
                setDropInsert(null);
                window.setTimeout(() => {
                  suppressOpenRef.current = false;
                }, 0);
              }}
              draggable={!touchUi}
              role="button"
              tabIndex={0}
            >
              {cardImage.src ? (
                <img
                  className="project-card-preview"
                  src={cardImage.src}
                  alt={`${project.name} thumbnail`}
                  loading="lazy"
                  style={{ objectPosition: `50% ${cardImage.cropY}%` }}
                  onLoad={() => markProjectThumbLoaded(project.id, cardImage.src ?? "")}
                  onError={(event) => {
                    const element = event.currentTarget;
                    if (element.dataset.fallback !== "1") {
                      element.dataset.fallback = "1";
                      element.src = fallbackImagePreview(project.id);
                    }
                    markProjectThumbLoaded(project.id, cardImage.src ?? "");
                  }}
                />
              ) : null}
              {!cardThumbLoaded ? (
                <div className="project-card-loading" aria-hidden="true">
                  <span className="project-card-loading-ring" />
                </div>
              ) : null}

              <div className="project-card-body">
                <strong>{project.name}</strong>
                <small>Project</small>
              </div>

              <span
                className="project-mobile-hold-trigger"
                aria-hidden="true"
              >
                📁
              </span>

              {openMobileToolsProjectId === project.id ? (
                <div
                  className="project-mobile-tools-menu"
                  role="menu"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="project-mobile-tools-item"
                    type="button"
                    onClick={() => {
                      toggleProjectSelection(project.id);
                      setOpenMobileToolsProjectId(null);
                    }}
                  >
                    {selectedProjectIds.includes(project.id) ? "Unselect" : "Select"}
                  </button>
                  <button
                    className="project-mobile-tools-item"
                    type="button"
                    onClick={() => {
                      openEditModal(project.id, project.name);
                      setOpenMobileToolsProjectId(null);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="project-mobile-tools-item"
                    type="button"
                    onClick={() => {
                      queueDownloadProject(project.id, project.name);
                      setOpenMobileToolsProjectId(null);
                    }}
                  >
                    Download
                  </button>
                  <button
                    className="project-mobile-tools-item danger"
                    type="button"
                    onClick={() => {
                      setDeleteTarget({ id: project.id, name: project.name });
                      setOpenMobileToolsProjectId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}

              <div className="project-card-actions top-left">
                <button
                  className={`action-icon checkbox ${selectedProjectIds.includes(project.id) ? "checked" : ""}`}
                  type="button"
                  aria-label={`Select ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleProjectSelection(project.id);
                  }}
                />
              </div>

              <div className="project-card-actions top-right">
                <button
                  className="action-icon"
                  type="button"
                  aria-label={`Edit ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditModal(project.id, project.name);
                  }}
                  disabled={busyProjectId === project.id}
                >
                  ✎
                </button>
              </div>

              <div className="project-card-actions bottom-left">
                <button
                  className="action-icon"
                  type="button"
                  aria-label={`Delete ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget({ id: project.id, name: project.name });
                  }}
                  disabled={busyProjectId === project.id}
                >
                  🗑
                </button>
              </div>

              <div className="project-card-actions bottom-right">
                <button
                  className="action-icon"
                  type="button"
                  aria-label={`Download ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    queueDownloadProject(project.id, project.name);
                  }}
                  disabled={busyProjectId === project.id}
                >
                  ⬇
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {selectionActive ? (
        <div className="selection-bar project-selection-bar">
          <span>{selectedProjectIds.length} folders selected</span>
          <button className="btn" type="button" onClick={() => setSelectedProjectIds([])}>Clear</button>
        </div>
      ) : null}
      {message ? <p className="muted project-grid-message">{message}</p> : null}

      {deleteTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (busyProjectId) return;
            setDeleteTarget(null);
          }}
        >
          <div className="modal-card modal-card-delete" onClick={(event) => event.stopPropagation()}>
            <h3>Delete folder</h3>
            <p className="muted">Delete "{deleteTarget.name}" and all of its images?</p>
            <div className="modal-actions">
              <button
                className="btn"
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(busyProjectId)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => {
                  const target = deleteTarget;
                  if (!target) return;
                  setBusyProjectId(target.id);
                  void deleteProject(target.id)
                    .then(() => setMessage(`Deleted ${target.name}.`))
                    .catch((error) => {
                      const text = error instanceof Error && error.message ? error.message : "";
                      setMessage(text ? `Could not delete ${target.name}: ${text}` : `Could not delete ${target.name}.`);
                    })
                    .finally(() => {
                      setBusyProjectId(null);
                      setDeleteTarget(null);
                    });
                }}
                disabled={busyProjectId === deleteTarget.id}
              >
                {busyProjectId === deleteTarget.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (busyProjectId) return;
            setEditTarget(null);
          }}
        >
          <div className="modal-card modal-card-project-edit" onClick={(event) => event.stopPropagation()}>
            <div className="project-edit-head">
              <h3>Edit folder</h3>
              <button
                className="btn"
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={Boolean(busyProjectId)}
                aria-label="Close editor"
              >
                x
              </button>
            </div>

            <div className="project-edit-content">
              <div className="modal-form">
                <label className="project-edit-label">
                  <span>Name</span>
                  <input className="input" value={editName} onChange={(event) => setEditName(event.target.value)} />
                </label>

                <div className="project-edit-label">
                  <span>Thumbnail source</span>
                  <div className="project-edit-mode">
                    <button className={`btn ${editMode === "auto" ? "active" : ""}`} type="button" onClick={() => setEditMode("auto")}>Auto</button>
                    <button className={`btn ${editMode === "asset" ? "active" : ""}`} type="button" onClick={() => setEditMode("asset")}>Choose image</button>
                    <button className={`btn ${editMode === "upload" ? "active" : ""}`} type="button" onClick={() => setEditMode("upload")}>Upload</button>
                  </div>
                </div>

                {editMode === "asset" ? (
                  <div className="project-edit-picker">
                    <input
                      className="input"
                      placeholder="Filter by image or folder name"
                      value={assetFilter}
                      onChange={(event) => setAssetFilter(event.target.value)}
                    />
                    <div className="project-edit-asset-list">
                      {pickableAssets.map((asset) => {
                        const folderName = asset.folderId ? (folderNameById.get(asset.folderId) ?? "Unknown folder") : "Unsorted";
                        return (
                          <button
                            key={asset.id}
                            className={`project-edit-asset-item ${editAssetId === asset.id ? "active" : ""}`}
                            type="button"
                            onClick={() => {
                              setEditAssetId(asset.id);
                              setEditCropY(defaultCropForAsset(asset.aspectRatio));
                            }}
                          >
                            <img src={resolveAssetPreview(asset)} alt={asset.name} loading="lazy" />
                            <span>{asset.name}</span>
                            <small>{folderName}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {editMode === "upload" ? (
                  <div className="project-edit-upload">
                    <label className="btn" htmlFor={`project-thumb-upload-${editTarget.id}`}>Upload image</label>
                    <input
                      id={`project-thumb-upload-${editTarget.id}`}
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        void handleUploadThumbnail(file);
                      }}
                    />
                  </div>
                ) : null}

              <div className="project-edit-preview">
                <strong>{editMode === "auto" ? "Preview" : "Preview (drag up/down to crop)"}</strong>
                <div
                  ref={cropBoxRef}
                  className={`project-edit-preview-box ${editMode !== "auto" ? "draggable" : ""} ${isDraggingCrop ? "dragging" : ""}`}
                  onPointerDown={(event) => {
                    if (editMode === "auto") return;
                    event.preventDefault();
                    beginCropDrag(event.clientY);
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!isDraggingCrop) return;
                    moveCropDrag(event.clientY);
                  }}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                    endCropDrag();
                  }}
                  onPointerCancel={() => endCropDrag()}
                >
                  {(() => {
                    let previewUrl: string | null = null;
                      if (editMode === "upload" && editUploadDataUrl) previewUrl = editUploadDataUrl;
                      if (editMode === "asset" && editAssetId) {
                        const asset = assetById.get(editAssetId);
                        previewUrl = asset ? resolveAssetPreview(asset) : null;
                      }
                      if (editMode === "auto") {
                        const latestAsset = latestAssetByProjectId.get(editTarget.id);
                        previewUrl = latestAsset ? resolveAssetPreview(latestAsset) : null;
                    }
                    if (!previewUrl) return <span className="muted">No preview available</span>;
                    return (
                      <img
                        src={previewUrl}
                        alt="Thumbnail preview"
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        style={{ objectPosition: `50% ${clampCropY(editCropY)}%` }}
                      />
                    );
                  })()}
                  {editMode !== "auto" ? (
                    <span className="project-edit-drag-hint">Drag up/down</span>
                  ) : null}
                </div>
              </div>
              </div>
            </div>

            <div className="modal-actions project-edit-actions">
              <button className="btn" type="button" onClick={() => setEditTarget(null)} disabled={Boolean(busyProjectId)}>Cancel</button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void saveEditModal();
                }}
                disabled={busyProjectId === editTarget.id}
              >
                {busyProjectId === editTarget.id ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
