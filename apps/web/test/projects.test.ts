import { describe, expect, it } from "vitest";
import {
  SAMPLE_PROJECT_NAMES,
  buildProjectCards,
  latestNonFailedImageByFolderId,
  latestPreferredFolderThumbnailById,
  isSuccessfulGeneratedImageAsset,
  latestSuccessfulGeneratedImageByFolderId,
  normalizeCustomOrder,
  orderAssetsByCustom,
  pickDefaultProjectId
} from "../lib/projects";

describe("projects helpers", () => {
  it("builds project cards from real folders only", () => {
    const cards = buildProjectCards(
      [
        { id: "p1", name: "Project 1", parentId: null },
        { id: "p2", name: "Project 2", parentId: null }
      ],
      "p2"
    );

    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe("p1");
    expect(cards[1].isSelected).toBe(true);
  });

  it("picks preferred id when present; otherwise newest folder", () => {
    const folders = [
      { id: "a", name: "A", parentId: null, createdAt: "2026-02-01T00:00:00.000Z" },
      { id: "b", name: "B", parentId: null, createdAt: "2026-02-03T00:00:00.000Z" }
    ];

    expect(pickDefaultProjectId(folders, "a")).toBe("a");
    expect(pickDefaultProjectId(folders, "missing")).toBe("b");
  });

  it("keeps eight stable sample names", () => {
    expect(SAMPLE_PROJECT_NAMES).toHaveLength(8);
    expect(SAMPLE_PROJECT_NAMES[0]).toBe("Sample Project 01");
  });

  it("normalizes custom order with newest-first prepends for new assets", () => {
    const assets = [
      { id: "a", name: "A", mimeType: "image/png", folderId: "f1", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", name: "B", mimeType: "image/png", folderId: "f1", tags: [], createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "c", name: "C", mimeType: "image/png", folderId: "f1", tags: [], createdAt: "2026-01-03T00:00:00.000Z" }
    ];
    const normalized = normalizeCustomOrder(assets, ["b", "a"]);
    expect(normalized).toEqual(["c", "b", "a"]);
  });

  it("orders assets by custom order when available", () => {
    const assets = [
      { id: "a", name: "A", mimeType: "image/png", folderId: "f1", tags: [] },
      { id: "b", name: "B", mimeType: "image/png", folderId: "f1", tags: [] },
      { id: "c", name: "C", mimeType: "image/png", folderId: "f1", tags: [] }
    ];
    const ordered = orderAssetsByCustom(assets, ["c", "a", "b"]);
    expect(ordered.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("accepts only successful generated images for project thumbnails", () => {
    expect(
      isSuccessfulGeneratedImageAsset({
        id: "ok",
        name: "ok.png",
        mimeType: "image/png",
        folderId: "f1",
        tags: ["generated", "model:gemini"]
      })
    ).toBe(true);

    expect(
      isSuccessfulGeneratedImageAsset({
        id: "fail",
        name: "fail.png",
        mimeType: "image/png",
        folderId: "f1",
        tags: ["generated", "failed"]
      })
    ).toBe(false);

    expect(
      isSuccessfulGeneratedImageAsset({
        id: "upload",
        name: "upload.png",
        mimeType: "image/png",
        folderId: "f1",
        tags: []
      })
    ).toBe(false);
  });

  it("picks latest successful generated image per folder", () => {
    const latest = latestSuccessfulGeneratedImageByFolderId([
      {
        id: "older-success",
        name: "older.png",
        mimeType: "image/png",
        folderId: "f1",
        tags: ["generated"],
        createdAt: "2026-02-01T00:00:00.000Z"
      },
      {
        id: "newer-failed",
        name: "failed.png",
        mimeType: "image/png",
        folderId: "f1",
        tags: ["generated", "failed"],
        createdAt: "2026-02-02T00:00:00.000Z"
      },
      {
        id: "latest-success",
        name: "latest.png",
        mimeType: "image/png",
        folderId: "f1",
        tags: ["generated", "nano banana"],
        createdAt: "2026-02-03T00:00:00.000Z"
      },
      {
        id: "video",
        name: "clip.mp4",
        mimeType: "video/mp4",
        folderId: "f1",
        tags: ["generated"],
        createdAt: "2026-02-04T00:00:00.000Z"
      }
    ]);

    expect(latest.get("f1")?.id).toBe("latest-success");
  });

  it("falls back to latest non-failed image when generated success is unavailable", () => {
    const fallback = latestPreferredFolderThumbnailById([
      {
        id: "upload-latest",
        name: "upload.png",
        mimeType: "image/png",
        folderId: "f2",
        tags: [],
        createdAt: "2026-02-03T00:00:00.000Z"
      },
      {
        id: "failed-generated",
        name: "failed.png",
        mimeType: "image/png",
        folderId: "f2",
        tags: ["generated", "failed"],
        createdAt: "2026-02-04T00:00:00.000Z"
      }
    ]);
    expect(fallback.get("f2")?.id).toBe("upload-latest");
  });

  it("latestNonFailedImageByFolderId excludes blocked/failed images", () => {
    const latest = latestNonFailedImageByFolderId([
      {
        id: "ok",
        name: "ok.png",
        mimeType: "image/png",
        folderId: "f3",
        tags: [],
        createdAt: "2026-02-01T00:00:00.000Z"
      },
      {
        id: "blocked",
        name: "blocked.png",
        mimeType: "image/png",
        folderId: "f3",
        tags: ["blocked"],
        createdAt: "2026-02-02T00:00:00.000Z"
      }
    ]);
    expect(latest.get("f3")?.id).toBe("ok");
  });
});
