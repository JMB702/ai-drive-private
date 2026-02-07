import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { buildLineageGraph, createAssetVersion } from "../../lib/services.js";

const createVersionSchema = z.object({
  assetId: z.string(),
  source: z.enum(["UPLOAD", "GENERATE", "EDIT", "TRANSFORM"]),
  storageKey: z.string(),
  checksum: z.string(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  createdBy: z.string(),
  parentVersionId: z.string().optional(),
  transformType: z.string().optional()
});

export async function registerVersionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/versions/:assetId", async (request) => {
    const { assetId } = request.params as { assetId: string };
    const versions = app.ctx.store.versions
      .filter((v) => v.assetId === assetId)
      .sort((a, b) => b.version - a.version);
    return {
      versions,
      lineage: buildLineageGraph(app.ctx.store, assetId)
    };
  });

  app.post("/v1/versions", async (request, reply) => {
    const body = createVersionSchema.parse(request.body);
    const version = createAssetVersion({
      store: app.ctx.store,
      assetId: body.assetId,
      source: body.source,
      storageKey: body.storageKey,
      checksum: body.checksum,
      metadata: body.metadata,
      createdBy: body.createdBy,
      parentVersionId: body.parentVersionId,
      transformType: body.transformType
    });
    return reply.code(201).send({ version });
  });

  app.post("/v1/versions/:versionId/promote", async (request) => {
    const { versionId } = request.params as { versionId: string };
    const version = app.ctx.store.versions.find((v) => v.id === versionId);
    return { promoted: Boolean(version), version };
  });
}
