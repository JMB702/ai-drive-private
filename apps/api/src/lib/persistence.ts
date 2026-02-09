import fs from "fs";
import path from "path";
import type { InMemoryStore } from "./types.js";
import { createStore } from "./store.js";
import { sanitizeInlinePreviewMetadata } from "./media-preview.js";
import { resolveApiDataPath } from "./data-paths.js";

const STORE_FILE_NAME = "api-store.json";
const MAX_PERSISTED_TERMINAL_JOBS = 600;

function legacyCandidateStorePaths(cwd: string): string[] {
  return [
    path.join(cwd, ".data", STORE_FILE_NAME),
    path.join(cwd, "apps", "api", ".data", STORE_FILE_NAME),
    path.join(cwd, "..", ".data", STORE_FILE_NAME),
    path.join(cwd, "..", "..", ".data", STORE_FILE_NAME)
  ];
}

function preferredStorePath(): string {
  return resolveApiDataPath(STORE_FILE_NAME);
}

function candidateStorePaths(cwd: string): string[] {
  const seen = new Set<string>();
  const list = [preferredStorePath(), ...legacyCandidateStorePaths(cwd)];
  const ordered: string[] = [];
  for (const candidate of list) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    ordered.push(resolved);
  }
  return ordered;
}

function withDefaults(raw: Partial<InMemoryStore>): InMemoryStore {
  const base = createStore();
  const store = {
    ...base,
    ...raw,
    workspaceCreditBalance: { ...base.workspaceCreditBalance, ...(raw.workspaceCreditBalance ?? {}) },
    folderLayouts: { ...base.folderLayouts, ...(raw.folderLayouts ?? {}) },
    workspaceFolderOrder: { ...base.workspaceFolderOrder, ...(raw.workspaceFolderOrder ?? {}) }
  };
  compactStore(store);
  return store;
}

function compactStore(store: InMemoryStore): void {
  for (const job of store.generationJobs) {
    if (job.result?.providerMetadata) {
      sanitizeInlinePreviewMetadata(job.result.providerMetadata);
    }
  }
  for (const version of store.versions) {
    sanitizeInlinePreviewMetadata(version.metadata);
  }

  const terminal = store.generationJobs
    .filter((job) => job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELED")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  if (terminal.length <= MAX_PERSISTED_TERMINAL_JOBS) return;

  const keepTerminalIds = new Set(terminal.slice(0, MAX_PERSISTED_TERMINAL_JOBS).map((job) => job.id));
  store.generationJobs = store.generationJobs.filter((job) => {
    if (job.status === "QUEUED" || job.status === "RUNNING") return true;
    return keepTerminalIds.has(job.id);
  });
}

function storeRecordCount(store: InMemoryStore): number {
  const assets = Array.isArray(store.assets) ? store.assets.length : 0;
  const versions = Array.isArray(store.versions) ? store.versions.length : 0;
  const jobs = Array.isArray(store.generationJobs) ? store.generationJobs.length : 0;
  const folders = Array.isArray(store.folders) ? store.folders.length : 0;
  return assets + versions + jobs + folders;
}

function loadStoreCandidate(filePath: string): { store: InMemoryStore; sourcePath: string; recordCount: number; mtimeMs: number } | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<InMemoryStore>;
    const store = withDefaults(parsed);
    const stat = fs.statSync(filePath);
    return {
      store,
      sourcePath: filePath,
      recordCount: storeRecordCount(store),
      mtimeMs: stat.mtimeMs
    };
  } catch {
    return null;
  }
}

function resolveWritableStorePath(): string {
  return preferredStorePath();
}

export function loadPersistedStore(cwd = process.cwd()): { store: InMemoryStore; sourcePath: string } | null {
  const candidates = candidateStorePaths(cwd)
    .map((filePath) => loadStoreCandidate(filePath))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  if (candidates.length === 0) return null;

  const preferred = path.resolve(preferredStorePath());
  const preferredCandidate = candidates.find((candidate) => path.resolve(candidate.sourcePath) === preferred);
  if (preferredCandidate && preferredCandidate.recordCount > 0) {
    return { store: preferredCandidate.store, sourcePath: preferredCandidate.sourcePath };
  }

  candidates.sort((left, right) => {
    if (left.recordCount !== right.recordCount) {
      return right.recordCount - left.recordCount;
    }
    return right.mtimeMs - left.mtimeMs;
  });
  const selected = candidates[0];
  return { store: selected.store, sourcePath: selected.sourcePath };
}

export function savePersistedStore(store: InMemoryStore, _cwd = process.cwd()): string {
  compactStore(store);
  const filePath = resolveWritableStorePath();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store), "utf8");
  return filePath;
}

export async function savePersistedStoreAsync(store: InMemoryStore, _cwd = process.cwd()): Promise<string> {
  compactStore(store);
  const filePath = resolveWritableStorePath();
  const directory = path.dirname(filePath);
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(store), "utf8");
  return filePath;
}

export function persistedStorePaths(cwd = process.cwd()): string[] {
  return candidateStorePaths(cwd);
}

export function persistedStorePrimaryPath(): string {
  return preferredStorePath();
}

export function resolveLegacyStorePath(cwd = process.cwd()): string | null {
  const preferred = path.resolve(preferredStorePath());
  for (const candidate of legacyCandidateStorePaths(cwd)) {
    const resolved = path.resolve(candidate);
    if (resolved === preferred) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}
