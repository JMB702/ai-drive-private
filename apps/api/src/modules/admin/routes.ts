import fs from "fs";
import path from "path";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { getActorId } from "../../lib/auth.js";
import { resolveApiDataPath } from "../../lib/data-paths.js";
import { DomainError } from "../../lib/errors.js";
import { previewBlobKeyFromStorageKey, sanitizeInlinePreviewMetadata } from "../../lib/media-preview.js";
import { savePersistedStore } from "../../lib/persistence.js";
import { createStore } from "../../lib/store.js";
import type { InMemoryStore } from "../../lib/types.js";

const importSnapshotSchema = z.object({
  replace: z.boolean().default(true),
  snapshot: z.record(z.unknown())
});

const importPreviewBlobSchema = z.object({
  blobKey: z.string().regex(/^[a-f0-9]{40}\.[a-z0-9]+$/i),
  dataBase64: z.string().min(1)
});

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(numeric)) continue;
    out[key] = numeric;
  }
  return out;
}

function normalizeStringArrayMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(raw)) continue;
    out[key] = raw.filter((item): item is string => typeof item === "string");
  }
  return out;
}

function normalizeVersionMetadata(version: InMemoryStore["versions"][number]): InMemoryStore["versions"][number] {
  if (!version || typeof version !== "object") return version;
  const mutable = version as InMemoryStore["versions"][number] & { metadata?: Record<string, unknown> };
  const metadata = toPreviewMetadata(mutable.metadata);
  sanitizeInlinePreviewMetadata(metadata);
  const previewBlob = previewBlobKeyFromStorageKey(mutable.storageKey);
  if (previewBlob && typeof metadata.previewBlob !== "string") {
    metadata.previewBlob = previewBlob;
  }
  mutable.metadata = metadata as InMemoryStore["versions"][number]["metadata"];
  return mutable;
}

function normalizeJobMetadata(job: InMemoryStore["generationJobs"][number]): InMemoryStore["generationJobs"][number] {
  if (!job || typeof job !== "object") return job;
  const mutable = job as InMemoryStore["generationJobs"][number] & {
    result?: { providerMetadata?: Record<string, unknown> };
  };
  if (mutable.result?.providerMetadata && typeof mutable.result.providerMetadata === "object") {
    sanitizeInlinePreviewMetadata(mutable.result.providerMetadata);
  }
  return mutable;
}

function toPreviewMetadata(value: unknown): Record<string, string | number | boolean | null | undefined> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string | number | boolean | null | undefined> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean" ||
      raw === null ||
      typeof raw === "undefined"
    ) {
      out[key] = raw;
    }
  }
  return out;
}

function buildImportedStore(snapshotRaw: Record<string, unknown>): InMemoryStore {
  const store = createStore();
  store.users = normalizeArray<InMemoryStore["users"][number]>(snapshotRaw.users);
  store.workspaces = normalizeArray<InMemoryStore["workspaces"][number]>(snapshotRaw.workspaces);
  store.workspaceMembers = normalizeArray<InMemoryStore["workspaceMembers"][number]>(snapshotRaw.workspaceMembers);
  store.folders = normalizeArray<InMemoryStore["folders"][number]>(snapshotRaw.folders);
  store.assets = normalizeArray<InMemoryStore["assets"][number]>(snapshotRaw.assets);
  store.versions = normalizeArray<InMemoryStore["versions"][number]>(snapshotRaw.versions).map(normalizeVersionMetadata);
  store.lineageEdges = normalizeArray<InMemoryStore["lineageEdges"][number]>(snapshotRaw.lineageEdges);
  store.generationJobs = normalizeArray<InMemoryStore["generationJobs"][number]>(snapshotRaw.generationJobs).map(normalizeJobMetadata);
  store.permissionGrants = normalizeArray<InMemoryStore["permissionGrants"][number]>(snapshotRaw.permissionGrants);
  store.shareLinks = normalizeArray<InMemoryStore["shareLinks"][number]>(snapshotRaw.shareLinks);
  store.creditTransactions = normalizeArray<InMemoryStore["creditTransactions"][number]>(snapshotRaw.creditTransactions);
  store.moderationEvents = normalizeArray<InMemoryStore["moderationEvents"][number]>(snapshotRaw.moderationEvents);
  store.auditEvents = normalizeArray<InMemoryStore["auditEvents"][number]>(snapshotRaw.auditEvents);
  store.workspaceCreditBalance = normalizeNumberMap(snapshotRaw.workspaceCreditBalance);
  store.folderLayouts = normalizeStringArrayMap(snapshotRaw.folderLayouts);
  store.workspaceFolderOrder = normalizeStringArrayMap(snapshotRaw.workspaceFolderOrder);
  return store;
}

function replaceStore(target: InMemoryStore, source: InMemoryStore): void {
  target.users = source.users;
  target.workspaces = source.workspaces;
  target.workspaceMembers = source.workspaceMembers;
  target.folders = source.folders;
  target.assets = source.assets;
  target.versions = source.versions;
  target.lineageEdges = source.lineageEdges;
  target.generationJobs = source.generationJobs;
  target.permissionGrants = source.permissionGrants;
  target.shareLinks = source.shareLinks;
  target.creditTransactions = source.creditTransactions;
  target.moderationEvents = source.moderationEvents;
  target.auditEvents = source.auditEvents;
  target.workspaceCreditBalance = source.workspaceCreditBalance;
  target.folderLayouts = source.folderLayouts;
  target.workspaceFolderOrder = source.workspaceFolderOrder;
}

function storeCounts(store: InMemoryStore): Record<string, number> {
  return {
    users: store.users.length,
    workspaces: store.workspaces.length,
    workspaceMembers: store.workspaceMembers.length,
    folders: store.folders.length,
    assets: store.assets.length,
    versions: store.versions.length,
    generationJobs: store.generationJobs.length,
    creditTransactions: store.creditTransactions.length
  };
}

function previewBlobCount(): number {
  const dir = resolveApiDataPath("previews");
  try {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((name) => /^[a-f0-9]{40}\.[a-z0-9]+$/i.test(name)).length;
  } catch {
    return 0;
  }
}

function requireAdminAccess(app: FastifyInstance, request: FastifyRequest): string {
  const actorId = getActorId(request);
  const members = app.ctx.store.workspaceMembers;
  if (members.length === 0 && actorId === "user_demo") return actorId;
  const isOwner = members.some((member) => member.userId === actorId && member.role === "OWNER");
  if (!isOwner) {
    throw new DomainError("Owner access required", 403);
  }
  return actorId;
}

function resolvePreviewFilePath(blobKey: string): string {
  const previewDirectory = path.resolve(resolveApiDataPath("previews"));
  const filePath = path.resolve(previewDirectory, blobKey.toLowerCase());
  if (!filePath.startsWith(`${previewDirectory}${path.sep}`)) {
    throw new DomainError("Invalid preview blob path", 400);
  }
  return filePath;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/import/status", async (request) => {
    requireAdminAccess(app, request);
    return {
      counts: storeCounts(app.ctx.store),
      previewBlobCount: previewBlobCount(),
      dataDir: resolveApiDataPath()
    };
  });

  app.post("/v1/admin/import/snapshot", async (request, reply) => {
    requireAdminAccess(app, request);
    const body = importSnapshotSchema.parse(request.body);
    if (!body.replace) {
      return reply.status(400).send({ error: "Non-replacing import is not supported" });
    }
    const imported = buildImportedStore(body.snapshot);
    replaceStore(app.ctx.store, imported);
    const savedPath = savePersistedStore(app.ctx.store);
    return {
      imported: true,
      savedPath,
      counts: storeCounts(app.ctx.store)
    };
  });

  app.post("/v1/admin/import/preview", async (request, reply) => {
    requireAdminAccess(app, request);
    const body = importPreviewBlobSchema.parse(request.body);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(body.dataBase64, "base64");
    } catch {
      return reply.status(400).send({ error: "Invalid base64 payload" });
    }
    if (bytes.length === 0) {
      return reply.status(400).send({ error: "Preview payload is empty" });
    }
    const filePath = resolvePreviewFilePath(body.blobKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
    return { uploaded: true, blobKey: body.blobKey.toLowerCase(), bytes: bytes.length };
  });
}
