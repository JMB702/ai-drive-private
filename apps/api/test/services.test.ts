import { describe, expect, it } from "vitest";
import { createStore } from "../src/lib/store.js";
import {
  buildLineageGraph,
  createAsset,
  createAssetVersion,
  finalizeCredits,
  reserveCredits,
  resolveEffectivePermission,
  transitionModeration
} from "../src/lib/services.js";

function seedAsset(store = createStore()) {
  const asset = createAsset({
    workspaceId: "ws1",
    folderId: null,
    name: "hero.png",
    mimeType: "image/png",
    createdBy: "u1"
  });
  store.assets.push(asset);
  return { store, asset };
}

describe("permissions", () => {
  it("applies explicit DENY over role allow", () => {
    const allowed = resolveEffectivePermission({
      role: "EDITOR",
      principalId: "u1",
      action: "asset:write",
      resourceType: "ASSET",
      resourceId: "a1",
      grants: [
        {
          id: "g1",
          workspaceId: "ws1",
          resourceType: "ASSET",
          resourceId: "a1",
          principalType: "USER",
          principalId: "u1",
          action: "asset:write",
          effect: "DENY"
        }
      ]
    });

    expect(allowed).toBe(false);
  });
});

describe("lineage", () => {
  it("creates parent-child version graph", () => {
    const { store, asset } = seedAsset();
    const v1 = createAssetVersion({
      store,
      assetId: asset.id,
      source: "UPLOAD",
      storageKey: "s3://a",
      checksum: "c1",
      metadata: {},
      createdBy: "u1"
    });

    const v2 = createAssetVersion({
      store,
      assetId: asset.id,
      source: "GENERATE",
      storageKey: "s3://b",
      checksum: "c2",
      metadata: {},
      createdBy: "u1",
      parentVersionId: v1.id,
      transformType: "UPSCALE"
    });

    const graph = buildLineageGraph(store, asset.id);
    const v1Node = graph.find((n) => n.version.id === v1.id);
    const v2Node = graph.find((n) => n.version.id === v2.id);

    expect(v1Node?.children).toContain(v2.id);
    expect(v2Node?.parents).toContain(v1.id);
  });
});

describe("billing", () => {
  it("reserves and refunds correctly", () => {
    const store = createStore();
    store.workspaceCreditBalance.ws1 = 100;

    reserveCredits(store, "ws1", "job1", 20);
    expect(store.workspaceCreditBalance.ws1).toBe(80);

    const txs = finalizeCredits(store, "ws1", "job1", 20, 15);
    expect(txs.map((t) => t.type)).toEqual(["FINALIZE", "REFUND"]);
    expect(store.workspaceCreditBalance.ws1).toBe(85);
  });
});

describe("moderation", () => {
  it("enforces moderation transition rules", () => {
    const store = createStore();
    const ok = transitionModeration(store, {
      workspaceId: "ws1",
      assetVersionId: "v1",
      from: "PENDING",
      to: "QUARANTINED",
      actorId: "mod1",
      reason: "policy violation"
    });
    expect(ok.status).toBe("QUARANTINED");

    expect(() =>
      transitionModeration(store, {
        workspaceId: "ws1",
        assetVersionId: "v1",
        from: "REJECTED",
        to: "APPROVED",
        actorId: "mod1",
        reason: "undo"
      })
    ).toThrowError(/Invalid moderation transition/);
  });
});
