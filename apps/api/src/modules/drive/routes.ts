import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { createAsset, createAssetVersion, resolveEffectivePermission } from "../../lib/services.js";
import { nowIso } from "../../lib/time.js";
import { getActorId, requireWorkspaceMember } from "../../lib/auth.js";

const createFolderSchema = z.object({
  workspaceId: z.string(),
  parentId: z.string().nullable().optional(),
  name: z.string().min(1)
});

const createAssetSchema = z.object({
  workspaceId: z.string(),
  folderId: z.string().nullable().optional(),
  name: z.string(),
  mimeType: z.string(),
  tags: z.array(z.string()).default([])
});

const initUploadSchema = z.object({
  workspaceId: z.string(),
  fileName: z.string().min(1)
});

const completeUploadSchema = z.object({
  assetId: z.string(),
  storageKey: z.string(),
  checksum: z.string(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
});

const moveSchema = z.object({
  folderId: z.string().nullable()
});

const copySchema = z.object({
  name: z.string().optional(),
  folderId: z.string().nullable().optional()
});

const patchFolderLayoutSchema = z.object({
  customOrderAssetIds: z.array(z.string())
});

const batchMoveSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  folderId: z.string().nullable()
});

const batchIdsSchema = z.object({
  assetIds: z.array(z.string()).min(1)
});

function canWriteAsset(app: FastifyInstance, workspaceId: string, assetId: string, request: any): boolean {
  const { actorId, role } = requireWorkspaceMember(request, workspaceId);
  return resolveEffectivePermission({
    grants: app.ctx.store.permissionGrants,
    role,
    principalId: actorId,
    action: "asset:write",
    resourceType: "ASSET",
    resourceId: assetId
  });
}

export async function registerDriveRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/drive/folders", async (request, reply) => {
    const body = createFolderSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, body.workspaceId);
    const allowed = resolveEffectivePermission({
      grants: app.ctx.store.permissionGrants,
      role: actor.role,
      principalId: actor.actorId,
      action: "folder:write",
      resourceType: "WORKSPACE",
      resourceId: body.workspaceId
    });
    if (!allowed) {
      return reply.status(403).send({ error: "No permission to create folder" });
    }

    const folder = {
      id: nanoid(),
      workspaceId: body.workspaceId,
      parentId: body.parentId ?? null,
      name: body.name,
      deletedAt: null,
      createdBy: actor.actorId,
      createdAt: nowIso()
    };
    app.ctx.store.folders.push(folder);
    return reply.code(201).send({ folder });
  });

  app.get("/v1/drive/folders/:workspaceId", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    requireWorkspaceMember(request, workspaceId);
    const folders = app.ctx.store.folders
      .filter((f) => f.workspaceId === workspaceId && !f.deletedAt)
      .map((folder) => ({
        ...folder,
        layout: {
          customOrderAssetIds: app.ctx.store.folderLayouts[folder.id] ?? []
        }
      }));
    return { folders };
  });

  app.patch("/v1/drive/folders/:folderId/layout", async (request, reply) => {
    const { folderId } = request.params as { folderId: string };
    const body = patchFolderLayoutSchema.parse(request.body);
    const folder = app.ctx.store.folders.find((item) => item.id === folderId && !item.deletedAt);
    if (!folder) {
      return reply.status(404).send({ error: "Folder not found" });
    }

    const actor = requireWorkspaceMember(request, folder.workspaceId);
    const allowed = resolveEffectivePermission({
      grants: app.ctx.store.permissionGrants,
      role: actor.role,
      principalId: actor.actorId,
      action: "folder:write",
      resourceType: "WORKSPACE",
      resourceId: folder.workspaceId
    });
    if (!allowed) {
      return reply.status(403).send({ error: "No permission to update folder layout" });
    }

    const assetIdsInFolder = new Set(
      app.ctx.store.assets.filter((asset) => asset.folderId === folderId && !asset.deletedAt).map((asset) => asset.id)
    );
    app.ctx.store.folderLayouts[folderId] = body.customOrderAssetIds.filter((assetId) => assetIdsInFolder.has(assetId));
    return { folderId, customOrderAssetIds: app.ctx.store.folderLayouts[folderId] };
  });

  app.post("/v1/drive/assets", async (request, reply) => {
    const body = createAssetSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, body.workspaceId);
    const asset = createAsset({
      workspaceId: body.workspaceId,
      folderId: body.folderId ?? null,
      name: body.name,
      mimeType: body.mimeType,
      createdBy: actor.actorId,
      tags: body.tags
    });
    app.ctx.store.assets.push(asset);
    return reply.code(201).send({ asset });
  });

  app.get("/v1/drive/assets/:workspaceId", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = (request.query as { q?: string; tag?: string }) ?? {};
    requireWorkspaceMember(request, workspaceId);
    let assets = app.ctx.store.assets.filter((a) => a.workspaceId === workspaceId && !a.deletedAt);

    if (query.q) {
      const q = query.q.toLowerCase();
      assets = assets.filter((a) => a.name.toLowerCase().includes(q));
    }
    if (query.tag) {
      assets = assets.filter((a) => a.tags.includes(query.tag as string));
    }

    const previews: Record<string, string> = {};
    const aspectRatios: Record<string, string> = {};
    const resolutions: Record<string, string> = {};
    for (const asset of assets) {
      const latest = app.ctx.store.versions
        .filter((v) => v.assetId === asset.id)
        .sort((a, b) => b.version - a.version)[0];
      const preview = latest?.metadata?.previewUrl ?? latest?.metadata?.previewDataUrl;
      if (typeof preview === "string" && preview.length > 0) {
        previews[asset.id] = preview;
      }
      const ratio = latest?.metadata?.aspectRatio;
      if (typeof ratio === "string" && /^\d+:\d+$/.test(ratio)) {
        aspectRatios[asset.id] = ratio;
      }
      const resolution = latest?.metadata?.resolution;
      if (typeof resolution === "string" && resolution.length > 0) {
        resolutions[asset.id] = resolution;
      }
    }

    return { assets, previews, aspectRatios, resolutions };
  });

  app.post("/v1/drive/uploads/init", async (request) => {
    const body = initUploadSchema.parse(request.body);
    requireWorkspaceMember(request, body.workspaceId);
    return app.ctx.storage.createSignedUpload(body.workspaceId, body.fileName);
  });

  app.post("/v1/drive/uploads/complete", async (request, reply) => {
    const body = completeUploadSchema.parse(request.body);
    const actorId = getActorId(request);
    const asset = app.ctx.store.assets.find((a) => a.id === body.assetId);
    if (!asset) {
      return reply.status(404).send({ error: "Asset not found" });
    }
    requireWorkspaceMember(request, asset.workspaceId);

    const version = createAssetVersion({
      store: app.ctx.store,
      assetId: body.assetId,
      source: "UPLOAD",
      storageKey: body.storageKey,
      checksum: body.checksum,
      createdBy: actorId,
      metadata: body.metadata
    });
    return reply.code(201).send({ version });
  });

  app.post("/v1/drive/assets/batch-move", async (request, reply) => {
    const body = batchMoveSchema.parse(request.body);
    const sourceAssets = app.ctx.store.assets.filter((asset) => body.assetIds.includes(asset.id));
    if (sourceAssets.length !== body.assetIds.length) {
      return reply.status(404).send({ error: "One or more assets not found" });
    }

    for (const asset of sourceAssets) {
      if (!canWriteAsset(app, asset.workspaceId, asset.id, request)) {
        return reply.status(403).send({ error: "No permission to move one or more assets" });
      }
    }

    if (body.folderId) {
      const destination = app.ctx.store.folders.find((folder) => folder.id === body.folderId && !folder.deletedAt);
      if (!destination) {
        return reply.status(404).send({ error: "Destination folder not found" });
      }
      for (const asset of sourceAssets) {
        if (asset.workspaceId !== destination.workspaceId) {
          return reply.status(400).send({ error: "Cross-workspace move not allowed" });
        }
      }
    }

    const moved = sourceAssets.map((asset) => {
      asset.folderId = body.folderId;
      return asset;
    });
    return { movedCount: moved.length, assets: moved };
  });

  app.delete("/v1/drive/assets/batch", async (request, reply) => {
    const body = batchIdsSchema.parse(request.body);
    const assets = app.ctx.store.assets.filter((asset) => body.assetIds.includes(asset.id));
    if (assets.length !== body.assetIds.length) {
      return reply.status(404).send({ error: "One or more assets not found" });
    }

    for (const asset of assets) {
      if (!canWriteAsset(app, asset.workspaceId, asset.id, request)) {
        return reply.status(403).send({ error: "No permission to delete one or more assets" });
      }
    }

    for (const asset of assets) {
      asset.deletedAt = nowIso();
    }
    return { deletedCount: assets.length };
  });

  app.post("/v1/drive/assets/batch-restore", async (request, reply) => {
    const body = batchIdsSchema.parse(request.body);
    const assets = app.ctx.store.assets.filter((asset) => body.assetIds.includes(asset.id));
    if (assets.length !== body.assetIds.length) {
      return reply.status(404).send({ error: "One or more assets not found" });
    }

    for (const asset of assets) {
      if (!canWriteAsset(app, asset.workspaceId, asset.id, request)) {
        return reply.status(403).send({ error: "No permission to restore one or more assets" });
      }
    }

    for (const asset of assets) {
      asset.deletedAt = null;
    }
    return { restoredCount: assets.length, assets };
  });

  app.post("/v1/drive/assets/:assetId/move", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const body = moveSchema.parse(request.body);
    const asset = app.ctx.store.assets.find((a) => a.id === assetId);
    if (!asset) {
      return reply.status(404).send({ error: "Asset not found" });
    }
    if (!canWriteAsset(app, asset.workspaceId, asset.id, request)) {
      return reply.status(403).send({ error: "No permission to move asset" });
    }
    asset.folderId = body.folderId;
    return { moved: true, asset };
  });

  app.post("/v1/drive/assets/:assetId/copy", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const body = copySchema.parse(request.body);
    const source = app.ctx.store.assets.find((a) => a.id === assetId);
    if (!source) {
      return reply.status(404).send({ error: "Asset not found" });
    }
    requireWorkspaceMember(request, source.workspaceId);

    const copy = createAsset({
      workspaceId: source.workspaceId,
      folderId: body.folderId ?? source.folderId,
      name: body.name ?? `${source.name} (copy)`,
      mimeType: source.mimeType,
      createdBy: getActorId(request),
      tags: [...source.tags]
    });
    app.ctx.store.assets.push(copy);

    const versions = app.ctx.store.versions
      .filter((v) => v.assetId === source.id)
      .sort((a, b) => a.version - b.version);
    let parentVersionId: string | undefined;
    for (const version of versions) {
      const cloned = createAssetVersion({
        store: app.ctx.store,
        assetId: copy.id,
        source: version.source,
        storageKey: version.storageKey,
        checksum: version.checksum,
        metadata: version.metadata,
        createdBy: getActorId(request),
        parentVersionId,
        transformType: "COPY"
      });
      parentVersionId = cloned.id;
    }

    return reply.code(201).send({ asset: copy });
  });

  app.post("/v1/drive/assets/:assetId/restore", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const asset = app.ctx.store.assets.find((a) => a.id === assetId);
    if (!asset) {
      return reply.status(404).send({ error: "Asset not found" });
    }
    if (!canWriteAsset(app, asset.workspaceId, asset.id, request)) {
      return reply.status(403).send({ error: "No permission to restore asset" });
    }
    asset.deletedAt = null;
    return { restored: true, asset };
  });

  app.delete("/v1/drive/assets/:assetId", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const asset = app.ctx.store.assets.find((a) => a.id === assetId);
    if (!asset) {
      return reply.status(404).send({ error: "Asset not found" });
    }
    if (!canWriteAsset(app, asset.workspaceId, asset.id, request)) {
      return reply.status(403).send({ error: "No permission to delete asset" });
    }
    asset.deletedAt = nowIso();
    return { deleted: true };
  });
}
