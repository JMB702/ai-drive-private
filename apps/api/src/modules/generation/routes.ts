import type { GenerationJob } from "@aidrive/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { createAsset, createAssetVersion, createGenerationJob, estimateCredits, finalizeCredits, reserveCredits } from "../../lib/services.js";
import { getActorId, requireWorkspaceMember } from "../../lib/auth.js";
import { nowIso } from "../../lib/time.js";
import { diagnoseGenerationFailure } from "../../lib/generation-failure.js";
import { sanitizeInlinePreviewMetadata } from "../../lib/media-preview.js";
import { TRACE_HEADER_NAME } from "../../lib/diagnostics/types.js";

const MAX_LIST_TERMINAL_JOBS = 300;
const FINALIZED_JOB_TTL_MS = 60 * 60 * 1000;
const FINALIZED_JOB_MAX = 4_000;
const FINALIZED_JOB_WARN_AT = 3_500;

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

const batchMoveJobsSchema = z.object({
  workspaceId: z.string(),
  jobIds: z.array(z.string()).min(1),
  folderId: z.string()
});

const batchDeleteJobsSchema = z.object({
  workspaceId: z.string(),
  jobIds: z.array(z.string()).min(1)
});

const LOCAL_PROMPT_BLOCKED_TOKENS = ["csam", "terror propaganda", "explicit minor"] as const;

function promptBlockMatches(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  return LOCAL_PROMPT_BLOCKED_TOKENS.filter((token) => lower.includes(token));
}

function blockedPreviewDimensions(aspectRatio: string): { width: number; height: number } {
  const match = aspectRatio.match(/^(\d+):(\d+)$/);
  if (!match) return { width: 1080, height: 1080 };
  const widthUnit = Number(match[1]);
  const heightUnit = Number(match[2]);
  if (!widthUnit || !heightUnit) return { width: 1080, height: 1080 };

  const longEdge = 1280;
  if (widthUnit >= heightUnit) {
    return {
      width: longEdge,
      height: Math.max(256, Math.round((longEdge * heightUnit) / widthUnit))
    };
  }
  return {
    width: Math.max(256, Math.round((longEdge * widthUnit) / heightUnit)),
    height: longEdge
  };
}

function createBlockedPreviewDataUrl(aspectRatio: string): string {
  const { width, height } = blockedPreviewDimensions(aspectRatio);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#171c2c"/><stop offset="100%" stop-color="#252d44"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.12)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.76)}" rx="${Math.max(20, Math.round(Math.min(width, height) * 0.04))}" fill="rgba(6,10,20,0.54)" stroke="rgba(243,245,252,0.22)" stroke-width="2"/><text x="50%" y="47%" text-anchor="middle" fill="#f7f9ff" font-family="Arial, sans-serif" font-size="${Math.max(30, Math.round(Math.min(width, height) * 0.07))}" font-weight="700">Blocked</text><text x="50%" y="58%" text-anchor="middle" fill="#c8d0de" font-family="Arial, sans-serif" font-size="${Math.max(16, Math.round(Math.min(width, height) * 0.032))}">Content policy prevented generation</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function sanitizeLine(value: string, max = 88): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const limited = compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
  return limited.replace(/[<>&"]/g, "");
}

function createFailedPreviewDataUrl(input: {
  aspectRatio: string;
  category: string;
  userMessage: string;
  suggestedFix: string;
}): string {
  const { width, height } = blockedPreviewDimensions(input.aspectRatio);
  const category = sanitizeLine(input.category, 44);
  const message = sanitizeLine(input.userMessage, 74);
  const fix = sanitizeLine(input.suggestedFix, 74);
  const titleSize = Math.max(28, Math.round(Math.min(width, height) * 0.065));
  const detailSize = Math.max(14, Math.round(Math.min(width, height) * 0.03));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2a1a30"/><stop offset="100%" stop-color="#1b2234"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.12)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.76)}" rx="${Math.max(20, Math.round(Math.min(width, height) * 0.04))}" fill="rgba(7,10,20,0.6)" stroke="rgba(255,128,168,0.4)" stroke-width="2"/><text x="50%" y="41%" text-anchor="middle" fill="#ffe9f0" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700">Failed</text><text x="50%" y="52%" text-anchor="middle" fill="#ffc9d8" font-family="Arial, sans-serif" font-size="${detailSize}" font-weight="700">${category}</text><text x="50%" y="62%" text-anchor="middle" fill="#e9dfef" font-family="Arial, sans-serif" font-size="${detailSize}">${message}</text><text x="50%" y="72%" text-anchor="middle" fill="#c6d4ea" font-family="Arial, sans-serif" font-size="${detailSize}">Fix: ${fix}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function folderNamePrefix(app: FastifyInstance, folderId: string): string {
  const folder = app.ctx.store.folders.find((item) => item.id === folderId);
  const raw = (folder?.name ?? "image")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw.length > 0 ? raw : "image";
}

function nextFolderAssetName(app: FastifyInstance, folderId: string, extension: string): string {
  const prefix = folderNamePrefix(app, folderId);
  const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)(?:\\.[A-Za-z0-9]+)?$`, "i");
  let max = 0;
  for (const asset of app.ctx.store.assets) {
    if (asset.folderId !== folderId) continue;
    const base = asset.name.replace(/\.[A-Za-z0-9]+$/, "");
    const match = base.match(pattern);
    if (!match) continue;
    const seq = Number.parseInt(match[1], 10);
    if (Number.isFinite(seq) && seq > max) {
      max = seq;
    }
  }
  const next = String(max + 1).padStart(4, "0");
  return `${prefix}-${next}.${extension}`;
}

function requestTraceId(request: { headers: Record<string, unknown> }): string | null {
  const candidate = request.headers[TRACE_HEADER_NAME];
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim().slice(0, 120);
  }
  if (Array.isArray(candidate)) {
    const first = candidate.find((value) => typeof value === "string" && value.trim().length > 0);
    if (typeof first === "string") return first.trim().slice(0, 120);
  }
  return null;
}

export async function registerGenerationRoutes(app: FastifyInstance): Promise<void> {
  const finalizedJobs = new Map<string, number>();
  let lastFinalizedPressureWarning = 0;

  function pruneFinalizedJobs(nowMs = Date.now()): void {
    for (const [jobId, seenAt] of finalizedJobs) {
      if (nowMs - seenAt <= FINALIZED_JOB_TTL_MS) continue;
      finalizedJobs.delete(jobId);
    }
  }

  function oldestFinalizedJobId(): string | null {
    let oldestId: string | null = null;
    let oldestSeenAt = Number.POSITIVE_INFINITY;
    for (const [jobId, seenAt] of finalizedJobs) {
      if (seenAt >= oldestSeenAt) continue;
      oldestSeenAt = seenAt;
      oldestId = jobId;
    }
    return oldestId;
  }

  function recordFinalizedJob(jobId: string, workspaceId: string): void {
    const nowMs = Date.now();
    pruneFinalizedJobs(nowMs);
    finalizedJobs.set(jobId, nowMs);

    if (finalizedJobs.size >= FINALIZED_JOB_WARN_AT && (nowMs - lastFinalizedPressureWarning) > 60_000) {
      lastFinalizedPressureWarning = nowMs;
      app.ctx.diagnostics.emit({
        severity: "WARN",
        category: "SYSTEM",
        component: "generation.finalized_jobs",
        eventName: "generation.finalized_jobs.memory_pressure",
        message: "Finalized jobs cache is approaching memory cap",
        workspaceId,
        context: {
          cacheSize: finalizedJobs.size,
          warnThreshold: FINALIZED_JOB_WARN_AT,
          max: FINALIZED_JOB_MAX,
          ttlMs: FINALIZED_JOB_TTL_MS
        }
      });
    }

    let evicted = 0;
    while (finalizedJobs.size > FINALIZED_JOB_MAX) {
      const oldestId = oldestFinalizedJobId();
      if (!oldestId) break;
      finalizedJobs.delete(oldestId);
      evicted += 1;
    }
    if (evicted > 0) {
      app.ctx.diagnostics.emit({
        severity: "HIGH",
        category: "SYSTEM",
        component: "generation.finalized_jobs",
        eventName: "generation.finalized_jobs.evicted",
        message: "Finalized jobs cache exceeded cap and evicted entries",
        workspaceId,
        context: {
          cacheSize: finalizedJobs.size,
          max: FINALIZED_JOB_MAX,
          evicted,
          ttlMs: FINALIZED_JOB_TTL_MS
        }
      });
    }
  }

  function finalizeJobOutcome(params: {
    jobId: string;
    workspaceId: string;
    actorId: string;
    creditCost: number;
    body: z.infer<typeof generationRequestSchema>;
  }): void {
    const { jobId, workspaceId, actorId, creditCost, body } = params;
    pruneFinalizedJobs();
    if (finalizedJobs.has(jobId)) return;

    const job = app.ctx.store.generationJobs.find((item) => item.id === jobId);
    if (!job) return;
    if (job.status !== "SUCCEEDED" && job.status !== "FAILED") return;

    recordFinalizedJob(jobId, workspaceId);

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
        const extension = body.type === "VIDEO" ? "mp4" : "png";
        const generatedAsset = createAsset({
          workspaceId: body.workspaceId,
          folderId: body.folderId,
          name: nextFolderAssetName(app, body.folderId, extension),
          mimeType: body.type === "VIDEO" ? "video/mp4" : "image/png",
          createdBy: actorId,
          tags: ["generated", body.model, `job:${job.id}`]
        });
        app.ctx.store.assets.push(generatedAsset);
        const existingOrder = app.ctx.store.folderLayouts[body.folderId] ?? [];
        app.ctx.store.folderLayouts[body.folderId] = [
          generatedAsset.id,
          ...existingOrder.filter((id) => id !== generatedAsset.id)
        ];

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

    if (body.type !== "IMAGE") {
      return;
    }

    const aspectRatio = typeof body.settings.aspectRatio === "string" ? body.settings.aspectRatio : "1:1";
    const resolution = typeof body.settings.resolution === "string" ? body.settings.resolution : "1K";
    const failure = job.failure ?? diagnoseGenerationFailure({
      request: job.request,
      provider: "unknown",
      error: job.error ?? "Generation failed"
    });
    const metadata = {
      failed: true,
      failureCategory: failure.category,
      failureMessage: failure.userMessage,
      failureSuggestedFix: failure.suggestedFix,
      failureRawMessage: failure.rawMessage.slice(0, 1400),
      generationJobId: job.id,
      model: body.model,
      prompt: body.prompt,
      aspectRatio,
      resolution,
      quality: typeof body.settings.quality === "string" ? body.settings.quality : resolution,
      previewDataUrl: createFailedPreviewDataUrl({
        aspectRatio,
        category: failure.category,
        userMessage: failure.userMessage,
        suggestedFix: failure.suggestedFix
      })
    };

    if (body.assetId) {
      createAssetVersion({
        store: app.ctx.store,
        assetId: body.assetId,
        source: "GENERATE",
        storageKey: `failed/${body.workspaceId}/${job.id}.png`,
        checksum: `failed-${job.id}`,
        metadata,
        createdBy: actorId
      });
      const existingAsset = app.ctx.store.assets.find((asset) => asset.id === body.assetId);
      if (existingAsset) {
        const nextTags = new Set(existingAsset.tags);
        nextTags.add("failed");
        nextTags.add(`job:${job.id}`);
        existingAsset.tags = [...nextTags];
      }
      return;
    }

    if (!body.folderId) {
      return;
    }

    const generatedAsset = createAsset({
      workspaceId: body.workspaceId,
      folderId: body.folderId,
      name: nextFolderAssetName(app, body.folderId, "png"),
      mimeType: "image/png",
      createdBy: actorId,
      tags: ["generated", "failed", body.model, `job:${job.id}`]
    });
    app.ctx.store.assets.push(generatedAsset);
    const existingOrder = app.ctx.store.folderLayouts[body.folderId] ?? [];
    app.ctx.store.folderLayouts[body.folderId] = [
      generatedAsset.id,
      ...existingOrder.filter((id) => id !== generatedAsset.id)
    ];

    createAssetVersion({
      store: app.ctx.store,
      assetId: generatedAsset.id,
      source: "GENERATE",
      storageKey: `failed/${body.workspaceId}/${job.id}.png`,
      checksum: `failed-${job.id}`,
      metadata,
      createdBy: actorId
    });
  }

  app.post("/v1/generation/jobs", async (request, reply) => {
    const body = generationRequestSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, body.workspaceId);
    const traceId = requestTraceId(request);
    const requestSettings = traceId
      ? { ...body.settings, __traceId: traceId }
      : body.settings;

    if (!body.folderId && !body.assetId) {
      return reply.status(400).send({ error: "Generation requires a target folderId or assetId" });
    }

    const blockedTokens = promptBlockMatches(body.prompt);
    const isBlocked = blockedTokens.length > 0;
    if (isBlocked) {
      const aspectRatio = typeof body.settings.aspectRatio === "string" ? body.settings.aspectRatio : "1:1";
      const resolution = typeof body.settings.resolution === "string" ? body.settings.resolution : "1K";
      const blockedMessage = "Prompt blocked by safety policy";
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
          settings: requestSettings
        },
        reservedCredits: 0
      });
      job.status = "FAILED";
      const blockedFailure = diagnoseGenerationFailure({
        request: job.request,
        provider: "local-policy",
        error: blockedMessage,
        forcedCategory: "SAFETY_BLOCK",
        debugContextOverrides: {
          failureOrigin: "LOCAL_POLICY_GATE",
          policySource: "local-token-filter-v1",
          policyMatchedTokens: blockedTokens.join(","),
          policyMatchedCount: blockedTokens.length,
          providerAttempted: false
        }
      });
      blockedFailure.errorCode = "LOCAL_POLICY_BLOCK";
      blockedFailure.userMessage = blockedTokens.length > 0
        ? `Prompt blocked by local safety policy (${blockedTokens.join(", ")}).`
        : "Prompt blocked by local safety policy.";
      blockedFailure.suggestedFix = blockedTokens.length > 0
        ? `Remove blocked term(s): ${blockedTokens.join(", ")} and retry.`
        : "Revise the prompt to remove disallowed content and retry.";
      job.error = blockedFailure.userMessage;
      job.failure = blockedFailure;
      job.updatedAt = nowIso();
      app.ctx.store.generationJobs.push(job);

      if (body.type === "IMAGE") {
        const metadata = {
          blocked: true,
          blockedReason: blockedFailure.userMessage,
          failureCategory: blockedFailure.category,
          failureMessage: blockedFailure.userMessage,
          failureSuggestedFix: blockedFailure.suggestedFix,
          generationJobId: job.id,
          model: body.model,
          prompt: body.prompt,
          aspectRatio,
          resolution,
          quality: typeof body.settings.quality === "string" ? body.settings.quality : resolution,
          previewDataUrl: createBlockedPreviewDataUrl(aspectRatio)
        };

        if (body.assetId) {
          createAssetVersion({
            store: app.ctx.store,
            assetId: body.assetId,
            source: "GENERATE",
            storageKey: `blocked/${body.workspaceId}/${job.id}.png`,
            checksum: `blocked-${job.id}`,
            metadata,
            createdBy: actor.actorId
          });
          const existingAsset = app.ctx.store.assets.find((asset) => asset.id === body.assetId);
          if (existingAsset) {
            const nextTags = new Set(existingAsset.tags);
            nextTags.add("blocked");
            nextTags.add(`job:${job.id}`);
            existingAsset.tags = [...nextTags];
          }
        } else if (body.folderId) {
          const generatedAsset = createAsset({
            workspaceId: body.workspaceId,
            folderId: body.folderId,
            name: nextFolderAssetName(app, body.folderId, "png"),
            mimeType: "image/png",
            createdBy: actor.actorId,
            tags: ["generated", "blocked", body.model, `job:${job.id}`]
          });
          app.ctx.store.assets.push(generatedAsset);
          const existingOrder = app.ctx.store.folderLayouts[body.folderId] ?? [];
          app.ctx.store.folderLayouts[body.folderId] = [
            generatedAsset.id,
            ...existingOrder.filter((id) => id !== generatedAsset.id)
          ];

          createAssetVersion({
            store: app.ctx.store,
            assetId: generatedAsset.id,
            source: "GENERATE",
            storageKey: `blocked/${body.workspaceId}/${job.id}.png`,
            checksum: `blocked-${job.id}`,
            metadata,
            createdBy: actor.actorId
          });
        }
      }

      app.ctx.runtime.notifyJobSubscribers(job, "generation.routes.blocked");
      return reply.code(202).send({ job });
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
        settings: requestSettings
      },
      reservedCredits: creditCost
    });

    reserveCredits(app.ctx.store, body.workspaceId, job.id, creditCost);
    app.ctx.store.generationJobs.push(job);
    app.ctx.runtime.notifyJobSubscribers(job, "generation.routes.created");

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
    const scopedJobs = app.ctx.store.generationJobs
      .filter((j) => j.workspaceId === workspaceId)
      .filter((j) => actor.role === "OWNER" || actor.role === "ADMIN" || j.createdBy === actor.actorId);
    const activeJobs = scopedJobs.filter((job) => job.status === "QUEUED" || job.status === "RUNNING");
    const terminalJobs = scopedJobs
      .filter((job) => job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELED")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, MAX_LIST_TERMINAL_JOBS);
    const jobs = [...activeJobs, ...terminalJobs]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    for (const job of jobs) {
      if (job.result?.providerMetadata) {
        sanitizeInlinePreviewMetadata(job.result.providerMetadata);
      }
    }
    return { jobs };
  });

  app.post("/v1/generation/jobs/batch-move", async (request, reply) => {
    const body = batchMoveJobsSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, body.workspaceId);
    const destination = app.ctx.store.folders.find((folder) => folder.id === body.folderId && !folder.deletedAt);
    if (!destination) {
      return reply.status(404).send({ error: "Destination folder not found" });
    }
    if (destination.workspaceId !== body.workspaceId) {
      return reply.status(400).send({ error: "Destination folder is outside workspace" });
    }

    const requestedJobIds = new Set(body.jobIds);
    const jobs = app.ctx.store.generationJobs.filter((job) => requestedJobIds.has(job.id));
    if (jobs.length === 0) {
      return { movedCount: 0, jobs: [] };
    }

    const forbidden = jobs.some((job) =>
      job.workspaceId !== body.workspaceId ||
      (job.createdBy !== actor.actorId && actor.role !== "OWNER" && actor.role !== "ADMIN") ||
      (job.status !== "QUEUED" && job.status !== "RUNNING" && job.status !== "FAILED" && job.status !== "CANCELED") ||
      job.request.type !== "IMAGE"
    );
    if (forbidden) {
      return reply.status(403).send({ error: "One or more jobs cannot be moved" });
    }

    for (const job of jobs) {
      job.request.folderId = body.folderId;
    }
    return { movedCount: jobs.length, jobs };
  });

  app.delete("/v1/generation/jobs/batch", async (request, reply) => {
    const body = batchDeleteJobsSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, body.workspaceId);
    const requestedJobIds = new Set(body.jobIds);
    const jobs = app.ctx.store.generationJobs.filter((job) => requestedJobIds.has(job.id));
    if (jobs.length === 0) {
      return { deletedCount: 0 };
    }

    const forbidden = jobs.some((job) =>
      job.workspaceId !== body.workspaceId ||
      (job.createdBy !== actor.actorId && actor.role !== "OWNER" && actor.role !== "ADMIN") ||
      (job.status !== "FAILED" && job.status !== "CANCELED")
    );
    if (forbidden) {
      return reply.status(403).send({ error: "One or more jobs cannot be deleted" });
    }

    app.ctx.store.generationJobs = app.ctx.store.generationJobs.filter((job) => !requestedJobIds.has(job.id));
    return { deletedCount: jobs.length };
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
    app.ctx.runtime.notifyJobSubscribers(job, "generation.routes.canceled");
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
