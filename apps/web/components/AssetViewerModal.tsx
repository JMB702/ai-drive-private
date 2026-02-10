"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { downloadAssetFile, fallbackImagePreview, resolveAssetPreview, toDisplayPreviewUrl } from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

const UNKNOWN_MODEL_VALUES = new Set(["unknown", "unknown model", "model unknown", "n/a", "na", "none"]);

function normalizeModelName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (UNKNOWN_MODEL_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function metadataModelName(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const settings = metadata.settings;
  const settingsModel =
    settings && typeof settings === "object" && "model" in settings
      ? (settings as { model?: unknown }).model
      : null;
  const candidates = [
    metadata.model,
    metadata.modelName,
    metadata.providerModel,
    metadata.generator,
    settingsModel
  ];
  for (const candidate of candidates) {
    const normalized = normalizeModelName(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function modelFromTags(tags: string[]): string | null {
  const hidden = new Set(["generated", "upload", "uploaded", "edited", "transform"]);
  for (const rawTag of tags) {
    const tag = normalizeModelName(rawTag);
    if (!tag) continue;
    if (hidden.has(tag.toLowerCase())) continue;
    return tag;
  }
  return null;
}

function parseAspectRatioValue(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+:\d+$/.test(value)) return null;
  const [w, h] = value.split(":").map(Number);
  if (!w || !h) return null;
  return w / h;
}

function parseRatioFromUrl(url: string): number | null {
  if (url.startsWith("data:image/")) {
    const commaIndex = url.indexOf(",");
    if (commaIndex <= 0) return null;
    try {
      const header = url.slice(0, commaIndex).toLowerCase();
      const base64 = url.slice(commaIndex + 1);
      const raw = atob(base64);
      const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));

      if (header.includes("image/png")) {
        if (bytes.length < 24) return null;
        if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
        const width = ((bytes[16] << 24) >>> 0) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19];
        const height = ((bytes[20] << 24) >>> 0) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23];
        if (!width || !height) return null;
        return width / height;
      }

      if (header.includes("image/jpeg") || header.includes("image/jpg")) {
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
        let offset = 2;
        while (offset + 9 < bytes.length) {
          if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
          }
          const marker = bytes[offset + 1];
          const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
          if (length < 2 || offset + 2 + length > bytes.length) break;
          const isSof =
            marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
            marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 ||
            marker === 0xca || marker === 0xcb || marker === 0xcd || marker === 0xce || marker === 0xcf;
          if (isSof) {
            const height = (bytes[offset + 5] << 8) + bytes[offset + 6];
            const width = (bytes[offset + 7] << 8) + bytes[offset + 8];
            if (!width || !height) return null;
            return width / height;
          }
          offset += 2 + length;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(url);
    const width = Number(parsed.searchParams.get("width"));
    const height = Number(parsed.searchParams.get("height"));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return width / height;
  } catch {
    return null;
  }
}

export function AssetViewerModal() {
  const { selectedAsset, selectedAssetVersions, versionsLoading, closeAsset, selectedProjectVisibleAssets, openAsset } = useProjects();
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [viewerUrlIndex, setViewerUrlIndex] = useState(0);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [imageHovered, setImageHovered] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stageFrameRef = useRef<HTMLDivElement | null>(null);

  if (!selectedAsset) return null;
  const activeAsset = selectedAsset;

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  const selectedIndex = useMemo(
    () => selectedProjectVisibleAssets.findIndex((asset) => asset.id === activeAsset.id),
    [activeAsset.id, selectedProjectVisibleAssets]
  );
  const prevAsset = selectedIndex > 0 ? selectedProjectVisibleAssets[selectedIndex - 1] : null;
  const nextAsset = selectedIndex >= 0 && selectedIndex < selectedProjectVisibleAssets.length - 1
    ? selectedProjectVisibleAssets[selectedIndex + 1]
    : null;

  function openPrevious(): void {
    if (!prevAsset) return;
    void openAsset(prevAsset);
  }

  function openNext(): void {
    if (!nextAsset) return;
    void openAsset(nextAsset);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (prevAsset) {
          void openAsset(prevAsset);
        }
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (nextAsset) {
          void openAsset(nextAsset);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeAsset();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeAsset, nextAsset, openAsset, prevAsset]);

  const latest = selectedAssetVersions[0] ?? null;
  const prompt = latest?.metadata?.prompt;
  const metadataModel = metadataModelName((latest?.metadata ?? null) as Record<string, unknown> | null);
  const tagModel = modelFromTags(activeAsset.tags);
  const listModel = modelFromTags(selectedProjectVisibleAssets.find((asset) => asset.id === activeAsset.id)?.tags ?? []);
  const model = metadataModel ?? tagModel ?? listModel ?? "Unknown";
  const quality = latest?.metadata?.quality;
  const orderedViewerUrls = useMemo(() => {
    const metadata = latest?.metadata ?? {};
    const fallbackUrl = resolveAssetPreview(activeAsset);
    const placeholderUrl = fallbackImagePreview(activeAsset.id);
    const fallbackIsPlaceholder = fallbackUrl === placeholderUrl;
    const candidates = [
      fallbackIsPlaceholder ? null : fallbackUrl,
      typeof metadata.previewDataUrl === "string" ? toDisplayPreviewUrl(metadata.previewDataUrl) : null,
      typeof metadata.previewUrl === "string" ? toDisplayPreviewUrl(metadata.previewUrl) : null,
      typeof metadata.outputUrl === "string" ? toDisplayPreviewUrl(metadata.outputUrl) : null
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .filter((value, index, arr) => arr.indexOf(value) === index);
    if (candidates.length === 0) return [placeholderUrl];

    const targetRatio = parseAspectRatioValue(metadata.aspectRatio) ?? parseAspectRatioValue(activeAsset.aspectRatio);
    if (!targetRatio) return candidates;

    const scored = candidates.map((candidate) => {
      const ratio = parseRatioFromUrl(candidate);
      return {
        candidate,
        diff: ratio ? Math.abs(ratio - targetRatio) : Number.POSITIVE_INFINITY
      };
    });
    scored.sort((a, b) => a.diff - b.diff);
    const ranked = scored.map((item) => item.candidate);
    if (fallbackIsPlaceholder) {
      ranked.push(placeholderUrl);
    }
    return ranked;
  }, [activeAsset, latest?.metadata]);
  const latestViewerUrl = orderedViewerUrls[viewerUrlIndex] ?? fallbackImagePreview(activeAsset.id);

  useEffect(() => {
    setViewerUrlIndex(0);
  }, [activeAsset.id, orderedViewerUrls]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  async function onDownload(): Promise<void> {
    setDownloadBusy(true);
    try {
      await downloadAssetFile({
        id: activeAsset.id,
        name: activeAsset.name,
        mimeType: activeAsset.mimeType,
        folderId: activeAsset.folderId,
        tags: activeAsset.tags,
        createdAt: activeAsset.createdAt,
        previewUrl: latestViewerUrl,
        aspectRatio: activeAsset.aspectRatio,
        resolution: activeAsset.resolution
      });
    } finally {
      setDownloadBusy(false);
    }
  }

  function updateImageHoverFromPointer(clientX: number, clientY: number): void {
    const image = imageRef.current;
    const frame = stageFrameRef.current;
    if (!image) {
      setImageHovered(false);
      return;
    }
    const rect = image.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    // Keep nav available outside narrow/vertical images by expanding hover zone into side gutters.
    const sideGutter = frameRect ? Math.max(0, (frameRect.width - rect.width) / 2) : 0;
    const horizontalBuffer = Math.max(56, sideGutter + 18);
    const verticalBuffer = 24;
    const withinHorizontal = clientX >= rect.left - horizontalBuffer && clientX <= rect.right + horizontalBuffer;
    const withinVertical = clientY >= rect.top - verticalBuffer && clientY <= rect.bottom + verticalBuffer;
    setImageHovered(withinHorizontal && withinVertical);
  }

  const modal = (
    <div className="asset-modal-backdrop" onClick={closeAsset}>
      <div className={`asset-modal ${infoCollapsed ? "info-collapsed" : ""}`} onClick={closeAsset}>
        <div className="asset-modal-controls">
          <button
            className="asset-modal-action info"
            type="button"
            aria-label={infoCollapsed ? "Show information panel" : "Dismiss information panel"}
            onClick={(event) => {
              event.stopPropagation();
              setInfoCollapsed((value) => !value);
            }}
          >
            <span className="asset-modal-action-glyph">{infoCollapsed ? "↤" : "↦"}</span>
            <span className="asset-modal-action-text">{infoCollapsed ? "Show Info" : "Dismiss Info"}</span>
          </button>
          <button
            className="asset-modal-action close"
            type="button"
            aria-label="Close image viewer"
            onClick={(event) => {
              event.stopPropagation();
              closeAsset();
            }}
          >
            <span className="asset-modal-action-glyph">×</span>
            <span className="asset-modal-action-text">Close</span>
          </button>
        </div>

        <div className="asset-stage">
          <div
            ref={stageFrameRef}
            className="asset-stage-frame"
            onMouseMove={(event) => updateImageHoverFromPointer(event.clientX, event.clientY)}
            onMouseEnter={(event) => updateImageHoverFromPointer(event.clientX, event.clientY)}
            onMouseLeave={() => setImageHovered(false)}
          >
            <img
              ref={imageRef}
              key={latestViewerUrl}
              src={latestViewerUrl}
              alt={activeAsset.name}
              className="asset-stage-image"
              style={{
                width: "auto",
                height: "auto",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                objectPosition: "center"
              }}
              onClick={(event) => event.stopPropagation()}
              onError={(event) => {
                const element = event.currentTarget;
                const nextIndex = viewerUrlIndex + 1;
                if (nextIndex < orderedViewerUrls.length) {
                  setViewerUrlIndex(nextIndex);
                  return;
                }
                element.src = fallbackImagePreview(activeAsset.id);
              }}
            />

            {prevAsset ? (
              <button
                className={`asset-nav asset-nav-left ${imageHovered ? "visible" : ""}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openPrevious();
                }}
                aria-label="Previous image"
                onMouseEnter={() => setImageHovered(true)}
              >
                ‹
              </button>
            ) : null}

            {nextAsset ? (
              <button
                className={`asset-nav asset-nav-right ${imageHovered ? "visible" : ""}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openNext();
                }}
                aria-label="Next image"
                onMouseEnter={() => setImageHovered(true)}
              >
                ›
              </button>
            ) : null}
          </div>
        </div>

        <aside className={`asset-side ${infoCollapsed ? "collapsed" : ""}`} onClick={(event) => event.stopPropagation()}>
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
              <strong>{String(model)}</strong>
              <span>Type</span>
              <strong>{activeAsset.mimeType}</strong>
              <span>Quality</span>
              <strong>{quality ? String(quality) : "Standard"}</strong>
              <span>Versions</span>
              <strong>{selectedAssetVersions.length || 1}</strong>
            </div>
          </section>

          <div className="info-actions">
            <div className="action-row">
              <button className="generate-btn" type="button" disabled title="Video generation coming soon">Animate</button>
              <button className="btn" type="button" disabled title="Multi shot coming soon">Multi Shot</button>
            </div>
            <div className="action-row">
              <button className="btn">Open in</button>
              <button className="btn">Reference</button>
            </div>
            <div className="action-row">
              <button className="btn" type="button" onClick={() => void onDownload()} disabled={downloadBusy}>
                {downloadBusy ? "Downloading..." : "Download"}
              </button>
              <button className="btn">Favorite</button>
              <button className="btn">Share</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );

  return portalRoot ? createPortal(modal, portalRoot) : modal;
}
