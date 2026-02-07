import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { transitionModeration } from "../../lib/services.js";

const reportSchema = z.object({
  workspaceId: z.string(),
  assetVersionId: z.string(),
  actorId: z.string(),
  reason: z.string().min(3)
});

const reviewSchema = z.object({
  workspaceId: z.string(),
  assetVersionId: z.string(),
  from: z.enum(["PENDING", "APPROVED", "REJECTED", "QUARANTINED"]),
  to: z.enum(["PENDING", "APPROVED", "REJECTED", "QUARANTINED"]),
  actorId: z.string(),
  reason: z.string().min(3)
});

export async function registerModerationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/moderation/report", async (request, reply) => {
    const body = reportSchema.parse(request.body);
    const event = transitionModeration(app.ctx.store, {
      workspaceId: body.workspaceId,
      assetVersionId: body.assetVersionId,
      from: "PENDING",
      to: "QUARANTINED",
      actorId: body.actorId,
      reason: body.reason
    });
    return reply.code(201).send({ event });
  });

  app.post("/v1/moderation/review", async (request) => {
    const body = reviewSchema.parse(request.body);
    const event = transitionModeration(app.ctx.store, {
      workspaceId: body.workspaceId,
      assetVersionId: body.assetVersionId,
      from: body.from,
      to: body.to,
      actorId: body.actorId,
      reason: body.reason
    });
    return { event };
  });

  app.get("/v1/moderation/:workspaceId/events", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    return { events: app.ctx.store.moderationEvents.filter((e) => e.workspaceId === workspaceId) };
  });
}
