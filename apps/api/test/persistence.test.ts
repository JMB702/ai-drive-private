import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../src/lib/store.js";
import { loadPersistedStore, persistedStorePrimaryPath, savePersistedStore } from "../src/lib/persistence.js";

const previousDataDir = process.env.AIDRIVE_DATA_DIR;

function writeStore(filePath: string, raw: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(raw), "utf8");
}

function assetStub(id: string) {
  return {
    id,
    workspaceId: "ws_demo",
    folderId: null,
    name: `${id}.png`,
    mimeType: "image/png",
    tags: [],
    deletedAt: null,
    createdBy: "user_demo",
    createdAt: new Date().toISOString()
  };
}

function versionStub(id: string, assetId: string) {
  return {
    id,
    assetId,
    version: 1,
    source: "UPLOAD",
    storageKey: `uploads/${assetId}.png`,
    checksum: `${id}-checksum`,
    metadata: {},
    createdBy: "user_demo",
    createdAt: new Date().toISOString()
  };
}

afterEach(() => {
  if (typeof previousDataDir === "string") {
    process.env.AIDRIVE_DATA_DIR = previousDataDir;
  } else {
    delete process.env.AIDRIVE_DATA_DIR;
  }
});

describe("persistence store path resolution", () => {
  it("prefers primary store path when it is populated", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidrive-persist-primary-"));
    process.env.AIDRIVE_DATA_DIR = path.join(cwd, "api-data");

    const primaryStore = path.join(process.env.AIDRIVE_DATA_DIR, "api-store.json");
    const legacyStore = path.join(cwd, ".data", "api-store.json");
    writeStore(primaryStore, { ...createStore(), assets: [assetStub("primary")] });
    writeStore(legacyStore, { ...createStore(), assets: [assetStub("legacy-1"), assetStub("legacy-2")] });

    const loaded = loadPersistedStore(cwd);
    expect(loaded).not.toBeNull();
    expect(loaded?.sourcePath).toBe(path.resolve(primaryStore));
  });

  it("falls back to richest legacy store when primary is empty", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidrive-persist-legacy-"));
    process.env.AIDRIVE_DATA_DIR = path.join(cwd, "api-data");

    const primaryStore = path.join(process.env.AIDRIVE_DATA_DIR, "api-store.json");
    const legacyStore = path.join(cwd, ".data", "api-store.json");
    writeStore(primaryStore, createStore());
    writeStore(legacyStore, {
      ...createStore(),
      assets: [assetStub("legacy-1")],
      versions: [versionStub("v1", "legacy-1")]
    });

    const loaded = loadPersistedStore(cwd);
    expect(loaded).not.toBeNull();
    expect(loaded?.sourcePath).toBe(path.resolve(legacyStore));
  });

  it("writes persisted data to the primary path", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidrive-persist-write-"));
    process.env.AIDRIVE_DATA_DIR = path.join(cwd, "api-data");

    const store = createStore();
    const savedPath = savePersistedStore(store, cwd);
    expect(savedPath).toBe(path.resolve(persistedStorePrimaryPath()));
    expect(fs.existsSync(savedPath)).toBe(true);
  });
});
