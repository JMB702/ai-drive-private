import fs from "fs";
import path from "path";
import type { InMemoryStore } from "./types.js";
import { createStore } from "./store.js";

const STORE_FILE_NAME = "api-store.json";

function candidateStorePaths(cwd: string): string[] {
  return [
    path.join(cwd, ".data", STORE_FILE_NAME),
    path.join(cwd, "..", ".data", STORE_FILE_NAME),
    path.join(cwd, "..", "..", ".data", STORE_FILE_NAME)
  ];
}

function withDefaults(raw: Partial<InMemoryStore>): InMemoryStore {
  const base = createStore();
  return {
    ...base,
    ...raw,
    workspaceCreditBalance: { ...base.workspaceCreditBalance, ...(raw.workspaceCreditBalance ?? {}) },
    folderLayouts: { ...base.folderLayouts, ...(raw.folderLayouts ?? {}) },
    workspaceFolderOrder: { ...base.workspaceFolderOrder, ...(raw.workspaceFolderOrder ?? {}) }
  };
}

function resolveReadableStorePath(cwd: string): string | null {
  for (const filePath of candidateStorePaths(cwd)) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function resolveWritableStorePath(cwd: string): string {
  return candidateStorePaths(cwd)[0];
}

export function loadPersistedStore(cwd = process.cwd()): { store: InMemoryStore; sourcePath: string } | null {
  const filePath = resolveReadableStorePath(cwd);
  if (!filePath) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<InMemoryStore>;
    return { store: withDefaults(parsed), sourcePath: filePath };
  } catch {
    return null;
  }
}

export function savePersistedStore(store: InMemoryStore, cwd = process.cwd()): string {
  const filePath = resolveWritableStorePath(cwd);
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store), "utf8");
  return filePath;
}
