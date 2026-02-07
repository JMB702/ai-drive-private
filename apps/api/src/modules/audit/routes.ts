import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { nowIso } from "../../lib/time.js";

const createSchema = z.object({
  workspaceId: z.string(),
  actorId: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
});

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/audit/events", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const event = {
      id: nanoid(),
      workspaceId: body.workspaceId,
      actorId: body.actorId,
      action: body.action,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      metadata: body.metadata,
      createdAt: nowIso()
    };
    app.ctx.store.auditEvents.push(event);
    return reply.code(201).send({ event });
  });

  app.get("/v1/audit/:workspaceId/events", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    return { events: app.ctx.store.auditEvents.filter((e) => e.workspaceId === workspaceId) };
  });
}
