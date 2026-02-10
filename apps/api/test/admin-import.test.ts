import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const previousDataDir = process.env.AIDRIVE_DATA_DIR;
const previousPersistenceFlag = process.env.AIDRIVE_DISABLE_PERSISTENCE;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidrive-admin-import-"));

describe("admin import routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    process.env.AIDRIVE_DATA_DIR = tempRoot;
    process.env.AIDRIVE_DISABLE_PERSISTENCE = "1";
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (previousDataDir) {
      process.env.AIDRIVE_DATA_DIR = previousDataDir;
    } else {
      delete process.env.AIDRIVE_DATA_DIR;
    }
    if (previousPersistenceFlag) {
      process.env.AIDRIVE_DISABLE_PERSISTENCE = previousPersistenceFlag;
    } else {
      delete process.env.AIDRIVE_DISABLE_PERSISTENCE;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("replaces snapshot and stores preview blobs", async () => {
    const snapshot = {
      users: [{ id: "user_demo", email: "owner@example.com", displayName: "Owner", createdAt: new Date().toISOString() }],
      workspaces: [{ id: "ws_demo", name: "Demo", createdBy: "user_demo", createdAt: new Date().toISOString() }],
      workspaceMembers: [{ workspaceId: "ws_demo", userId: "user_demo", role: "OWNER", joinedAt: new Date().toISOString() }],
      folders: [],
      assets: [],
      versions: [],
      workspaceCreditBalance: { ws_demo: 123 }
    };

    const imported = await app.inject({
      method: "POST",
      url: "/v1/admin/import/snapshot",
      payload: { replace: true, snapshot }
    });
    expect(imported.statusCode).toBe(200);
    const importedBody = imported.json() as { counts: { assets: number; workspaces: number } };
    expect(importedBody.counts.workspaces).toBe(1);
    expect(importedBody.counts.assets).toBe(0);

    const blobKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
    const previewPayload = Buffer.from("test-preview-bytes").toString("base64");
    const uploaded = await app.inject({
      method: "POST",
      url: "/v1/admin/import/preview",
      payload: { blobKey, dataBase64: previewPayload }
    });
    expect(uploaded.statusCode).toBe(200);

    const status = await app.inject({
      method: "GET",
      url: "/v1/admin/import/status"
    });
    expect(status.statusCode).toBe(200);
    const statusBody = status.json() as { previewBlobCount: number; counts: { workspaces: number } };
    expect(statusBody.counts.workspaces).toBe(1);
    expect(statusBody.previewBlobCount).toBe(1);
  });
});
