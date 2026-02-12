import fs from "fs";
import path from "path";
import type { InMemoryStore } from "./types.js";
import { createStore } from "./store.js";
import { previewBlobKeyFromStorageKey, sanitizeInlinePreviewMetadata } from "./media-preview.js";
import { resolveApiDataPath } from "./data-paths.js";

const STORE_FILE_NAME = "api-store.json";
const MAX_PERSISTED_TERMINAL_JOBS = 600;

export type PersistenceDiagnosticEvent = {
  eventName: string;
  message: string;
  context?: Record<string, string | number | boolean | null>;
};

type PersistenceDiagnosticHook = ((event: PersistenceDiagnosticEvent) => void) | null;

let persistenceDiagnosticHook: PersistenceDiagnosticHook = null;

function emitPersistenceDiagnostic(event: PersistenceDiagnosticEvent): void {
  try {
    persistenceDiagnosticHook?.(event);
  } catch {
    // Persistence operations must stay best-effort.
  }
}

export function setPersistenceDiagnosticsHook(hook: PersistenceDiagnosticHook): void {
  persistenceDiagnosticHook = hook;
}

function legacyCandidateStorePaths(cwd: string): string[] {
  return [
    path.join(cwd, ".data", STORE_FILE_NAME),
    path.join(cwd, "apps", "api", ".data", STORE_FILE_NAME),
    path.join(cwd, "..", ".data", STORE_FILE_NAME),
    path.join(cwd, "..", "..", ".data", STORE_FILE_NAME)
  ];
}

function bundledRecoveryCandidateStorePaths(cwd: string): string[] {
  return [
    path.join(cwd, ".recovery-data", STORE_FILE_NAME),
    path.join(cwd, "apps", "api", ".recovery-data", STORE_FILE_NAME),
    path.join(cwd, "..", ".recovery-data", STORE_FILE_NAME),
    path.join(cwd, "..", "..", ".recovery-data", STORE_FILE_NAME)
  ];
}

function preferredStorePath(): string {
  return resolveApiDataPath(STORE_FILE_NAME);
}

function candidateStorePaths(cwd: string): string[] {
  const seen = new Set<string>();
  const list = [
    preferredStorePath(),
    ...legacyCandidateStorePaths(cwd),
    ...bundledRecoveryCandidateStorePaths(cwd)
  ];
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
  const previousCount = store.generationJobs.length;
  store.generationJobs = store.generationJobs.filter((job) => {
    if (job.status === "QUEUED" || job.status === "RUNNING") return true;
    return keepTerminalIds.has(job.id);
  });
  const removed = Math.max(0, previousCount - store.generationJobs.length);
  if (removed > 0) {
    emitPersistenceDiagnostic({
      eventName: "persistence.compaction.pruned_terminal_jobs",
      message: "Persisted store terminal jobs were compacted",
      context: {
        removed,
        retainedTerminal: keepTerminalIds.size
      }
    });
  }
}

function storeRecordCount(store: InMemoryStore): number {
  const assets = Array.isArray(store.assets) ? store.assets.length : 0;
  const versions = Array.isArray(store.versions) ? store.versions.length : 0;
  const jobs = Array.isArray(store.generationJobs) ? store.generationJobs.length : 0;
  const folders = Array.isArray(store.folders) ? store.folders.length : 0;
  return assets + versions + jobs + folders;
}

function isLikelySampleOnlyStore(store: InMemoryStore): boolean {
  const assets = Array.isArray(store.assets) ? store.assets.length : 0;
  const versions = Array.isArray(store.versions) ? store.versions.length : 0;
  if (assets > 0 || versions > 0) return false;

  const folders = Array.isArray(store.folders) ? store.folders : [];
  const activeFolders = folders.filter((folder) => folder && folder.deletedAt === null);
  if (activeFolders.length === 0) return true;
  if (activeFolders.length > 12) return false;
  return activeFolders.every((folder) => /^sample project \d{2}$/i.test(String(folder.name ?? "")));
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
    emitPersistenceDiagnostic({
      eventName: "persistence.load.parse_error",
      message: "Persisted store could not be parsed",
      context: {
        sourcePath: filePath
      }
    });
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
  if (
    preferredCandidate &&
    preferredCandidate.recordCount > 0 &&
    !isLikelySampleOnlyStore(preferredCandidate.store)
  ) {
    return { store: preferredCandidate.store, sourcePath: preferredCandidate.sourcePath };
  }

  const nonSampleCandidates = candidates.filter(
    (candidate) => candidate.recordCount > 0 && !isLikelySampleOnlyStore(candidate.store)
  );
  if (nonSampleCandidates.length > 0) {
    nonSampleCandidates.sort((left, right) => {
      if (left.recordCount !== right.recordCount) {
        return right.recordCount - left.recordCount;
      }
      return right.mtimeMs - left.mtimeMs;
    });
    const selected = nonSampleCandidates[0];
    return { store: selected.store, sourcePath: selected.sourcePath };
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

const PREVIEW_BLOB_KEY_PATTERN = /^[a-f0-9]{40}\.[a-z0-9]+$/i;

function normalizedPreviewBlobKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!PREVIEW_BLOB_KEY_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function previewBlobKeysFromStore(store: InMemoryStore): string[] {
  const keys = new Set<string>();

  for (const version of store.versions) {
    const metadata = version.metadata && typeof version.metadata === "object"
      ? (version.metadata as Record<string, unknown>)
      : {};
    const fromMetadata = normalizedPreviewBlobKey(metadata.previewBlob);
    if (fromMetadata) keys.add(fromMetadata);
    const fromStorage = previewBlobKeyFromStorageKey(version.storageKey);
    if (fromStorage) keys.add(fromStorage);
  }

  for (const job of store.generationJobs) {
    const providerMetadata = job.result?.providerMetadata;
    if (!providerMetadata || typeof providerMetadata !== "object") continue;
    const fromMetadata = normalizedPreviewBlobKey((providerMetadata as Record<string, unknown>).previewBlob);
    if (fromMetadata) keys.add(fromMetadata);
  }

  return [...keys];
}

export type SyncedPreviewBlobs = {
  sourceDir: string;
  targetDir: string;
  copied: number;
  skipped: number;
  missing: number;
};

export function syncPreviewBlobsFromStoreSource(store: InMemoryStore, sourcePath: string): SyncedPreviewBlobs | null {
  const sourceDir = path.resolve(path.dirname(sourcePath), "previews");
  if (!fs.existsSync(sourceDir)) return null;

  const targetDir = resolveApiDataPath("previews");
  fs.mkdirSync(targetDir, { recursive: true });
  const blobs = previewBlobKeysFromStore(store);
  let copied = 0;
  let skipped = 0;
  let missing = 0;

  for (const blobKey of blobs) {
    const sourceFile = path.join(sourceDir, blobKey);
    if (!fs.existsSync(sourceFile)) {
      missing += 1;
      continue;
    }
    const targetFile = path.join(targetDir, blobKey);
    if (fs.existsSync(targetFile)) {
      skipped += 1;
      continue;
    }
    fs.copyFileSync(sourceFile, targetFile);
    copied += 1;
  }

  return {
    sourceDir,
    targetDir,
    copied,
    skipped,
    missing
  };
}
