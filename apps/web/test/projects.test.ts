import { describe, expect, it } from "vitest";
import {
  SAMPLE_PROJECT_NAMES,
  buildProjectCards,
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
});
