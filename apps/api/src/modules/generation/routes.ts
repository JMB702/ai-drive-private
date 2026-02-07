import type { GenerationJob } from "@aidrive/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { createAsset, createAssetVersion, createGenerationJob, estimateCredits, finalizeCredits, reserveCredits } from "../../lib/services.js";
import { getActorId, requireWorkspaceMember } from "../../lib/auth.js";

const generationRequestSchema = z.object({
  workspaceId: z.string(),
  assetId: z.string().optional(),
  folderId: z.string().optional(),
  prompt: z.string().min(2),
  negativePrompt: z.string().optional(),
  model: z.string().min(2),
  type: z.enum(["IMAGE", "VIDEO"]),
  settings: z.record(z.union([z.string(), z.number(), z.boolean()])).default({})
});

function isPromptBlocked(prompt: string): boolean {
  const blockedTokens = ["csam", "terror propaganda", "explicit minor"];
  const lower = prompt.toLowerCase();
  return blockedTokens.some((token) => lower.includes(token));
}

export async function registerGenerationRoutes(app: FastifyInstance): Promise<void> {
  const finalizedJobs = new Set<string>();

  function finalizeJobOutcome(params: {
    jobId: string;
    workspaceId: string;
    actorId: string;
    creditCost: number;
    body: z.infer<typeof generationRequestSchema>;
  }): void {
    const { jobId, workspaceId, actorId, creditCost, body } = params;
    if (finalizedJobs.has(jobId)) return;

    const job = app.ctx.store.generationJobs.find((item) => item.id === jobId);
    if (!job) return;
    if (job.status !== "SUCCEEDED" && job.status !== "FAILED") return;

    finalizedJobs.add(jobId);

    if (job.status === "SUCCEEDED" && job.result) {
      const actual = Math.max(1, Math.floor(creditCost * 0.9));
      finalizeCredits(app.ctx.store, workspaceId, jobId, creditCost, actual);

      if (body.assetId) {
        const metadata = {
          ...job.result.providerMetadata,
          prompt: body.prompt,
          model: body.model,
          aspectRatio: typeof body.settings.aspectRatio === "string" ? body.settings.aspectRatio : "1:1",
          resolution: typeof body.settings.resolution === "string" ? body.settings.resolution : "1K",
          quality: typeof body.settings.quality === "string" ? body.settings.quality : "1K"
        };
        createAssetVersion({
          store: app.ctx.store,
          assetId: body.assetId,
          source: "GENERATE",
          storageKey: job.result.storageKey,
          checksum: job.result.checksum,
          metadata,
          createdBy: actorId
        });
        return;
      }

      if (body.folderId) {
        const generatedAsset = createAsset({
          workspaceId: body.workspaceId,
          folderId: body.folderId,
          name: `generated-${Date.now()}.${body.type === "VIDEO" ? "mp4" : "png"}`,
          mimeType: body.type === "VIDEO" ? "video/mp4" : "image/png",
          createdBy: actorId,
          tags: ["generated", body.model]
        });
        app.ctx.store.assets.push(generatedAsset);

        const metadata = {
          ...job.result.providerMetadata,
          prompt: body.prompt,
          model: body.model,
          aspectRatio: typeof body.settings.aspectRatio === "string" ? body.settings.aspectRatio : "1:1",
          resolution: typeof body.settings.resolution === "string" ? body.settings.resolution : "1K",
          quality: typeof body.settings.quality === "string" ? body.settings.quality : "1K"
        };

        createAssetVersion({
          store: app.ctx.store,
          assetId: generatedAsset.id,
          source: "GENERATE",
          storageKey: job.result.storageKey,
          checksum: job.result.checksum,
          metadata,
          createdBy: actorId
        });
      }
      return;
    }

    finalizeCredits(app.ctx.store, workspaceId, jobId, creditCost, 0);
  }

  app.post("/v1/generation/jobs", async (request, reply) => {
    const body = generationRequestSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, body.workspaceId);

    if (!body.folderId && !body.assetId) {
      return reply.status(400).send({ error: "Generation requires a target folderId or assetId" });
    }

    if (isPromptBlocked(body.prompt)) {
      return reply.status(400).send({ error: "Prompt blocked by safety policy" });
    }

    const creditCost = estimateCredits(body);
    const job = createGenerationJob({
      workspaceId: body.workspaceId,
      createdBy: actor.actorId,
      request: {
        workspaceId: body.workspaceId,
        assetId: body.assetId,
        folderId: body.folderId,
        prompt: body.prompt,
        negativePrompt: body.negativePrompt,
        model: body.model,
        type: body.type,
        settings: body.settings
      },
      reservedCredits: creditCost
    });

    reserveCredits(app.ctx.store, body.workspaceId, job.id, creditCost);
    app.ctx.store.generationJobs.push(job);
    app.ctx.runtime.jobSubscribers.forEach((subscriber) => subscriber(job));

    // Completion handling must be event-driven, not timeout-based.
    const subscriber = (updated: GenerationJob) => {
      if (updated.id !== job.id) return;
      finalizeJobOutcome({
        jobId: job.id,
        workspaceId: body.workspaceId,
        actorId: actor.actorId,
        creditCost,
        body
      });
      const complete = app.ctx.store.generationJobs.find((item) => item.id === job.id);
      if (complete && (complete.status === "SUCCEEDED" || complete.status === "FAILED")) {
        app.ctx.runtime.jobSubscribers.delete(subscriber);
      }
    };
    app.ctx.runtime.jobSubscribers.add(subscriber);

    app.ctx.generationQueue.push(job);

    return reply.code(202).send({ job });
  });

  app.get("/v1/generation/jobs/:workspaceId", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const actor = requireWorkspaceMember(request, workspaceId);
    const jobs = app.ctx.store.generationJobs
      .filter((j) => j.workspaceId === workspaceId)
      .filter((j) => actor.role === "OWNER" || actor.role === "ADMIN" || j.createdBy === actor.actorId);
    return { jobs };
  });

  app.post("/v1/generation/jobs/:jobId/cancel", async (request) => {
    const { jobId } = request.params as { jobId: string };
    const job = app.ctx.store.generationJobs.find((j) => j.id === jobId);
    if (!job || job.status === "SUCCEEDED") {
      return { canceled: false };
    }

    const actor = requireWorkspaceMember(request, job.workspaceId);
    if (actor.actorId !== job.createdBy && actor.role !== "OWNER" && actor.role !== "ADMIN") {
      return { canceled: false };
    }

    job.status = "CANCELED";
    app.ctx.runtime.jobSubscribers.forEach((subscriber) => subscriber(job));
    return { canceled: true, job };
  });

  app.post("/v1/generation/jobs/:jobId/retry", async (request) => {
    const { jobId } = request.params as { jobId: string };
    const existing = app.ctx.store.generationJobs.find((j) => j.id === jobId);
    if (!existing) {
      return { retried: false };
    }

    const actor = requireWorkspaceMember(request, existing.workspaceId);
    if (actor.actorId !== existing.createdBy && actor.role !== "OWNER" && actor.role !== "ADMIN") {
      return { retried: false };
    }

    const retry = createGenerationJob({
      workspaceId: existing.workspaceId,
      createdBy: getActorId(request),
      request: existing.request,
      reservedCredits: existing.reservedCredits
    });
    reserveCredits(app.ctx.store, retry.workspaceId, retry.id, retry.reservedCredits);
    app.ctx.store.generationJobs.push(retry);
    app.ctx.generationQueue.push(retry);
    return { retried: true, job: retry };
  });
}
