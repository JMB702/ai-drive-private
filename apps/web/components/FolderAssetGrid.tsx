"use client";

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSET_DRAG_MIME,
  type Asset,
  downloadAssetFile,
  fallbackImagePreview,
  readDraggedAssetIds,
  resolveAssetPreview
} from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

type UndoState = {
  ids: string[];
  snapshot: Asset[];
};

function parseAspectRatio(aspectRatio?: string): number {
  if (!aspectRatio || !/^\d+:\d+$/.test(aspectRatio)) return 1;
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h) return 1;
  return w / h;
}

export function FolderAssetGrid() {
  const {
    selectedProject,
    selectedProjectVisibleAssets,
    selectedProjectPendingJobs,
    selectedGridMode,
    setSelectedGridMode,
    selectedAssetIds,
    selectionActive,
    toggleAssetSelection,
    clearAssetSelection,
    openAsset,
    setSelectedProjectCustomOrder,
    deleteAssets,
    restoreAssets
  } = useProjects();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [visualOrder, setVisualOrder] = useState<string[]>([]);
  const undoTimerRef = useRef<number | null>(null);
  const lastAssetIdsRef = useRef<string[]>([]);
  const draggingIdsRef = useRef<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const assetsById = useMemo(
    () => new Map(selectedProjectVisibleAssets.map((asset) => [asset.id, asset])),
    [selectedProjectVisibleAssets]
  );
  const pendingVisualIds = useMemo(
    () => selectedProjectPendingJobs.map((job) => `pending:${job.id}`),
    [selectedProjectPendingJobs]
  );
  const pendingByVisualId = useMemo(
    () => new Map(selectedProjectPendingJobs.map((job) => [`pending:${job.id}`, job])),
    [selectedProjectPendingJobs]
  );
  const orderedVisualIds = useMemo(() => {
    const base = selectedProjectVisibleAssets.map((asset) => asset.id);
    if (selectedGridMode === "TIME") {
      return [...pendingVisualIds, ...base];
    }
    const existing = new Set(base);
    const pendingSet = new Set(pendingVisualIds);
    const fromVisual = visualOrder.filter((id) => existing.has(id) || pendingSet.has(id));
    const seen = new Set(fromVisual);
    const missingAssets = base.filter((id) => !seen.has(id));
    const missingPending = pendingVisualIds.filter((id) => !seen.has(id));
    // New pending tiles should appear top-left by default unless already positioned in visualOrder.
    return [...missingPending, ...fromVisual, ...missingAssets];
  }, [pendingVisualIds, selectedGridMode, selectedProjectVisibleAssets, visualOrder]);

  function clearUndoTimer(): void {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }

  function startUndoWindow(ids: string[], snapshot: UndoState["snapshot"]): void {
    clearUndoTimer();
    setUndoState({ ids, snapshot });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, 6000);
  }

  async function onUndoDelete(): Promise<void> {
    if (!undoState) return;
    setBusy(true);
    try {
      await restoreAssets(undoState.ids, undoState.snapshot);
      setMessage("Delete undone.");
    } catch {
      setMessage("Unable to undo delete.");
    } finally {
      setBusy(false);
      clearUndoTimer();
      setUndoState(null);
    }
  }

  async function onDeleteFromTile(assetId: string): Promise<void> {
    const ids = selectionActive && selectedSet.has(assetId) ? selectedAssetIds : [assetId];
    setBusy(true);
    try {
      const snapshot = await deleteAssets(ids);
      startUndoWindow(ids, snapshot);
      setMessage(`Deleted ${ids.length} image${ids.length > 1 ? "s" : ""}.`);
    } catch {
      setMessage("Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadFromTile(assetId: string): Promise<void> {
    const ids = selectionActive && selectedSet.has(assetId) ? selectedAssetIds : [assetId];
    const lookup = new Map(selectedProjectVisibleAssets.map((asset) => [asset.id, asset]));
    setBusy(true);
    try {
      for (const id of ids) {
        const asset = lookup.get(id);
        if (!asset) continue;
        // Small spacing to avoid browser throttling multiple downloads.
        await downloadAssetFile(asset);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      setMessage(`Downloaded ${ids.length} image${ids.length > 1 ? "s" : ""}.`);
    } catch {
      setMessage("Download failed.");
    } finally {
      setBusy(false);
    }
  }

  function onDragStart(event: DragEvent<HTMLElement>, assetId: string): void {
    const ids = selectionActive && selectedSet.has(assetId) ? selectedAssetIds : [assetId];
    draggingIdsRef.current = ids;
    setDraggingIds(ids);
    setDropIndex(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(ids));
    event.dataTransfer.setData("text/plain", JSON.stringify(ids));
    if (ids.length > 1) {
      const topId = ids[ids.length - 1];
      const topAsset = assetsById.get(topId);
      const ghost = document.createElement("div");
      ghost.style.position = "fixed";
      ghost.style.top = "-10000px";
      ghost.style.left = "-10000px";
      ghost.style.width = "130px";
      ghost.style.height = "92px";
      ghost.style.pointerEvents = "none";
      for (let i = 2; i >= 0; i -= 1) {
        const layer = document.createElement("div");
        layer.style.position = "absolute";
        layer.style.inset = `${i * 3}px`;
        layer.style.border = "1px solid rgba(255,143,41,0.7)";
        layer.style.borderRadius = "10px";
        layer.style.background = i === 0 ? "rgba(18,25,43,0.95)" : "rgba(9,14,26,0.9)";
        if (i === 0 && topAsset) {
          layer.style.backgroundImage = `url("${resolveAssetPreview(topAsset)}")`;
          layer.style.backgroundSize = "cover";
          layer.style.backgroundPosition = "center";
        }
        ghost.appendChild(layer);
      }
      const badge = document.createElement("div");
      badge.textContent = `${ids.length}`;
      badge.style.position = "absolute";
      badge.style.right = "8px";
      badge.style.top = "8px";
      badge.style.fontWeight = "700";
      badge.style.color = "#ff8f29";
      ghost.appendChild(badge);
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 24, 24);
      setTimeout(() => ghost.remove(), 0);
    }
  }

  function onDragEnd(): void {
    draggingIdsRef.current = [];
    setDraggingIds([]);
    setDropIndex(null);
  }

  function onDropAtIndex(event: DragEvent, index: number): void {
    event.preventDefault();
    const dragged = draggingIdsRef.current.length > 0
      ? draggingIdsRef.current
      : (draggingIds.length > 0 ? draggingIds : readDraggedAssetIds(event));
    if (dragged.length === 0) return;
    const base = [...orderedVisualIds];
    const withoutDragged = base.filter((id) => !dragged.includes(id));
    const insertAt = Math.max(0, Math.min(index, withoutDragged.length));
    const nextVisual = [...withoutDragged.slice(0, insertAt), ...dragged, ...withoutDragged.slice(insertAt)];
    setVisualOrder(nextVisual);

    const realAssetIds = nextVisual.filter((id) => !id.startsWith("pending:"));
    if (selectedGridMode !== "CUSTOM") {
      setSelectedGridMode("CUSTOM");
    }
    void setSelectedProjectCustomOrder(realAssetIds);
    draggingIdsRef.current = [];
    setDraggingIds([]);
    setDropIndex(null);
  }

  useEffect(() => {
    setVisualOrder([]);
    lastAssetIdsRef.current = [];
  }, [selectedProject?.id]);

  useEffect(() => {
    const prevAssetIds = lastAssetIdsRef.current;
    const currentAssetIds = selectedProjectVisibleAssets.map((asset) => asset.id);
    const prevSet = new Set(prevAssetIds);
    const newAssetIds = currentAssetIds.filter((id) => !prevSet.has(id));
    if (newAssetIds.length > 0) {
      setVisualOrder((current) => {
        let next = [...current];
        for (const newId of newAssetIds) {
          const pendingIndex = next.findIndex((id) => id.startsWith("pending:"));
          if (pendingIndex >= 0) {
            next[pendingIndex] = newId;
          } else if (!next.includes(newId)) {
            next = [newId, ...next];
          }
        }
        return next;
      });
    }
    lastAssetIdsRef.current = currentAssetIds;
  }, [selectedProjectVisibleAssets]);

  const emptyState = !selectedProject || (selectedProjectVisibleAssets.length === 0 && selectedProjectPendingJobs.length === 0);

  return (
    <div className="folder-grid-wrap">
      <div className="folder-grid-toolbar">
        <div className="mode-toggle">
          <button
            className={`btn ${selectedGridMode === "TIME" ? "active" : ""}`}
            onClick={() => setSelectedGridMode("TIME")}
            type="button"
          >
            Time & Date
          </button>
          <button
            className={`btn ${selectedGridMode === "CUSTOM" ? "active" : ""}`}
            onClick={() => setSelectedGridMode("CUSTOM")}
            type="button"
          >
            Custom Order
          </button>
        </div>

        {selectionActive ? (
          <div className="selection-bar">
            <span>{selectedAssetIds.length} selected</span>
            <button className="btn" type="button" onClick={clearAssetSelection}>Clear</button>
          </div>
        ) : null}
      </div>

      {emptyState ? <p className="muted">No images in this project yet.</p> : null}

      <div
        className="asset-flow"
        onClickCapture={(event) => {
          if (!selectionActive) return;
          const target = event.target as HTMLElement;
          if (!target.closest(".asset-card")) {
            clearAssetSelection();
          }
        }}
      >
        {orderedVisualIds.map((visualId, index) => {
          const pending = pendingByVisualId.get(visualId);
          const asset = assetsById.get(visualId);
          const isPending = Boolean(pending);
          if (!asset && !pending) return null;
          const tileKey = visualId;
          const dragKey = isPending ? visualId : asset!.id;
          const ratio = isPending
            ? String(parseAspectRatio(String(pending?.request.settings.aspectRatio ?? "1:1")))
            : String(parseAspectRatio(asset!.aspectRatio));
          const canSelect = !isPending;
          return (
          <div className="asset-shell" key={tileKey}>
            <div
              className={`asset-drop-slot ${dropIndex === index ? "active" : ""}`}
              onDragOver={(event) => {
                if (draggingIdsRef.current.length === 0 && draggingIds.length === 0) return;
                event.preventDefault();
                setDropIndex(index);
              }}
              onDrop={(event) => onDropAtIndex(event, index)}
            />
            <div
              className={`asset-card ${asset && selectedSet.has(asset.id) ? "selected" : ""}`}
              draggable
              onDragStart={(event) => onDragStart(event, dragKey)}
              onDragEnd={onDragEnd}
              onDragOver={(event) => {
                if (draggingIdsRef.current.length === 0 && draggingIds.length === 0) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const before = event.clientX < rect.left + rect.width / 2;
                setDropIndex(before ? index : index + 1);
              }}
              onDrop={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const before = event.clientX < rect.left + rect.width / 2;
                onDropAtIndex(event, before ? index : index + 1);
              }}
              onClick={() => {
                if (!canSelect) return;
                if (selectionActive) {
                  toggleAssetSelection(asset!.id);
                  return;
                }
                void openAsset(asset!);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (!canSelect) return;
                if (selectionActive) {
                  toggleAssetSelection(asset!.id);
                } else {
                  void openAsset(asset!);
                }
              }}
              role="button"
              tabIndex={0}
              style={{ aspectRatio: ratio }}
            >
              {isPending ? (
                <>
                  <div className="pending-art" />
                  <div className="asset-meta">
                    <strong>Generating...</strong>
                    <small>{String(pending?.request.settings.aspectRatio ?? "1:1")} · {String(pending?.request.settings.resolution ?? "1K")}</small>
                  </div>
                </>
              ) : (
                <>
                  <img
                    src={resolveAssetPreview(asset!)}
                    alt={asset!.name}
                    loading="lazy"
                    onError={(event) => {
                      const element = event.currentTarget;
                      if (element.dataset.fallback === "1") return;
                      element.dataset.fallback = "1";
                      element.src = fallbackImagePreview(asset!.id);
                    }}
                  />

                  <div className="asset-card-actions top-left">
                    <button
                      className={`action-icon checkbox ${selectedSet.has(asset!.id) ? "checked" : ""}`}
                      type="button"
                      aria-label={`Select ${asset!.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleAssetSelection(asset!.id);
                      }}
                    />
                  </div>

                  <div className="asset-card-actions bottom-left">
                    <button
                      className="action-icon"
                      type="button"
                      aria-label={`Delete ${asset!.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDeleteFromTile(asset!.id);
                      }}
                      disabled={busy}
                    >
                      🗑
                    </button>
                  </div>

                  <div className="asset-card-actions bottom-right">
                    <button
                      className="action-icon"
                      type="button"
                      aria-label={`Download ${asset!.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDownloadFromTile(asset!.id);
                      }}
                      disabled={busy}
                    >
                      ⬇
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          );
        })}

        {orderedVisualIds.length > 0 ? (
          <div
            className={`asset-drop-slot end ${dropIndex === orderedVisualIds.length ? "active" : ""}`}
            onDragOver={(event) => {
              if (draggingIdsRef.current.length === 0 && draggingIds.length === 0) return;
              event.preventDefault();
              setDropIndex(orderedVisualIds.length);
            }}
            onDrop={(event) => onDropAtIndex(event, orderedVisualIds.length)}
          />
        ) : null}
      </div>

      {undoState ? (
        <div className="undo-toast">
          <span>Images deleted.</span>
          <button className="btn" type="button" onClick={() => void onUndoDelete()} disabled={busy}>Undo</button>
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
