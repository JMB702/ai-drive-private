import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

describe("api route integration", () => {
  it("creates folder and asset", async () => {
    const folderRes = await app.inject({
      method: "POST",
      url: "/v1/drive/folders",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", name: "Brand" }
    });
    expect(folderRes.statusCode).toBe(201);

    const folder = folderRes.json().folder;

    const assetRes = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: folder.id,
        name: "shot-01.png",
        mimeType: "image/png",
        tags: ["campaign"]
      }
    });

    expect(assetRes.statusCode).toBe(201);
    expect(assetRes.json().asset.name).toBe("shot-01.png");
  });

  it("filters assets by query and tag", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/drive/assets/ws_demo?q=shot&tag=campaign",
      headers: { "x-user-id": "user_demo" }
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().assets)).toBe(true);
  });

  it("creates and lists generation job", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const targetFolder = foldersRes.json().folders[0];

    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: targetFolder.id,
        prompt: "cinematic mountain sunrise",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: { quality: 1 }
      }
    });

    expect(run.statusCode).toBe(202);

    const list = await app.inject({
      method: "GET",
      url: "/v1/generation/jobs/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs.length).toBeGreaterThan(0);
  });

  it("rejects generation without target folderId or assetId", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        prompt: "sunrise over ocean",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: { quality: 1 }
      }
    });

    expect(run.statusCode).toBe(400);
    expect(run.json().error).toMatch(/requires a target/i);
  });

  it("supports permission check", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/permissions/check",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        resourceType: "WORKSPACE",
        resourceId: "ws_demo",
        action: "asset:write"
      }
    });

    expect(res.statusCode).toBe(200);
    expect(typeof res.json().allowed).toBe("boolean");
  });

  it("persists folder layout and batch moves assets", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const [folderA, folderB] = foldersRes.json().folders;

    const a1 = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", folderId: folderA.id, name: "a1.png", mimeType: "image/png", tags: [] }
    });
    const a2 = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", folderId: folderA.id, name: "a2.png", mimeType: "image/png", tags: [] }
    });
    const asset1 = a1.json().asset;
    const asset2 = a2.json().asset;

    const layoutRes = await app.inject({
      method: "PATCH",
      url: `/v1/drive/folders/${folderA.id}/layout`,
      headers: { "x-user-id": "user_demo" },
      payload: { customOrderAssetIds: [asset2.id, asset1.id] }
    });
    expect(layoutRes.statusCode).toBe(200);
    expect(layoutRes.json().customOrderAssetIds).toEqual([asset2.id, asset1.id]);

    const moveRes = await app.inject({
      method: "POST",
      url: "/v1/drive/assets/batch-move",
      headers: { "x-user-id": "user_demo" },
      payload: { assetIds: [asset1.id, asset2.id], folderId: folderB.id }
    });
    expect(moveRes.statusCode).toBe(200);
    expect(moveRes.json().movedCount).toBe(2);
  });
});
