import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import { buildApp } from "../../src/app.js";
import { resolveApiDataPath } from "../../src/lib/data-paths.js";

let app: FastifyInstance;
const previousPersistenceFlag = process.env.AIDRIVE_DISABLE_PERSISTENCE;

function removePreviewBlobIfPresent(blobKey: string): void {
  const filePath = path.join(resolveApiDataPath("previews"), blobKey);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup.
  }
}

beforeAll(async () => {
  process.env.AIDRIVE_DISABLE_PERSISTENCE = "1";
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  if (typeof previousPersistenceFlag === "undefined") {
    delete process.env.AIDRIVE_DISABLE_PERSISTENCE;
    return;
  }
  process.env.AIDRIVE_DISABLE_PERSISTENCE = previousPersistenceFlag;
});

describe("api route integration", () => {
  it("returns mobile profile defaults for mobile user agents", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ui/profile",
      headers: {
        "x-user-id": "user_demo",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
      }
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.profile.surface).toBe("mobile");
    expect(payload.profile.generatePanel.toolsDefaultCollapsed).toBe(true);
    expect(payload.profile.referenceImages.maxPerImageDataUrlBytes).toBeLessThan(1_900_000);
  });

  it("uses explicit surface overrides for ui profile", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ui/profile?surface=desktop",
      headers: {
        "x-user-id": "user_demo",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
      }
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.profile.surface).toBe("desktop");
    expect(payload.profile.generatePanel.toolsDefaultCollapsed).toBe(false);
    expect(payload.profile.referenceImages.safeGenerationBodyBytes).toBe(7 * 1024 * 1024);
  });

  it("creates folder and asset", async () => {
    const folderRes = await app.inject({
      method: "POST",
      url: "/v1/drive/folders",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", name: "Brand" }
    });
    expect(folderRes.statusCode).toBe(201);

    const folder = folderRes.json().folder;

    const assetRes = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: folder.id,
        name: "shot-01.png",
        mimeType: "image/png",
        tags: ["campaign"]
      }
    });

    expect(assetRes.statusCode).toBe(201);
    expect(assetRes.json().asset.name).toBe("shot-01.png");
  });

  it("filters assets by query and tag", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/drive/assets/ws_demo?q=shot&tag=campaign",
      headers: { "x-user-id": "user_demo" }
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().assets)).toBe(true);
  });

  it("normalizes legacy pollinations preview URLs in asset listings", async () => {
    const folderRes = await app.inject({
      method: "POST",
      url: "/v1/drive/folders",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", name: "Legacy Preview Folder" }
    });
    expect(folderRes.statusCode).toBe(201);
    const folderId = folderRes.json().folder.id as string;

    const assetRes = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId,
        name: "legacy-preview.png",
        mimeType: "image/png",
        tags: ["legacy"]
      }
    });
    expect(assetRes.statusCode).toBe(201);
    const assetId = assetRes.json().asset.id as string;

    const legacyPreviewUrl = "https://image.pollinations.ai/p/legacy%20preview?seed=123&width=1024&height=1024&nologo=true";
    const completeUpload = await app.inject({
      method: "POST",
      url: "/v1/drive/uploads/complete",
      headers: { "x-user-id": "user_demo" },
      payload: {
        assetId,
        storageKey: "uploads/ws_demo/legacy-preview.png",
        checksum: "legacy-preview-checksum",
        metadata: {
          previewUrl: legacyPreviewUrl,
          aspectRatio: "1:1",
          resolution: "1K"
        }
      }
    });
    expect(completeUpload.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: "/v1/drive/assets/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(list.statusCode).toBe(200);
    const previewUrl = String(list.json().previews?.[assetId] ?? "");
    expect(previewUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(previewUrl)).toContain("Preview unavailable");
  });

  it("externalizes oversized inline previews and serves them via preview route", async () => {
    const folderRes = await app.inject({
      method: "POST",
      url: "/v1/drive/folders",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", name: "Externalized Preview Folder" }
    });
    expect(folderRes.statusCode).toBe(201);
    const folderId = folderRes.json().folder.id as string;

    const assetRes = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId,
        name: "externalized-preview.png",
        mimeType: "image/png",
        tags: ["externalized"]
      }
    });
    expect(assetRes.statusCode).toBe(201);
    const assetId = assetRes.json().asset.id as string;

    const oversizedPreviewDataUrl = `data:image/png;base64,${Buffer.alloc(40_000, 7).toString("base64")}`;
    const completeUpload = await app.inject({
      method: "POST",
      url: "/v1/drive/uploads/complete",
      headers: { "x-user-id": "user_demo" },
      payload: {
        assetId,
        storageKey: "uploads/ws_demo/externalized-preview.png",
        checksum: "externalized-preview-checksum",
        metadata: {
          previewDataUrl: oversizedPreviewDataUrl,
          aspectRatio: "1:1",
          resolution: "1K"
        }
      }
    });
    expect(completeUpload.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: "/v1/drive/assets/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(list.statusCode).toBe(200);
    const previewUrl = String(list.json().previews?.[assetId] ?? "");
    expect(previewUrl.startsWith("/v1/previews/")).toBe(true);

    const previewRes = await app.inject({
      method: "GET",
      url: previewUrl,
      headers: { "x-user-id": "user_demo" }
    });
    expect(previewRes.statusCode).toBe(200);
    expect(String(previewRes.headers["content-type"] ?? "")).toContain("image/");

    const assetFileRes = await app.inject({
      method: "GET",
      url: `/v1/drive/assets/${assetId}/file`,
      headers: { "x-user-id": "user_demo" }
    });
    expect(assetFileRes.statusCode).toBe(200);
    expect(String(assetFileRes.headers["content-type"] ?? "")).toContain("image/");

    const previewBlob = previewUrl.replace("/v1/previews/", "");
    removePreviewBlobIfPresent(previewBlob);
  });

  it("serves preview files from storageKey fallback when metadata preview fields are missing", async () => {
    const folderRes = await app.inject({
      method: "POST",
      url: "/v1/drive/folders",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", name: "StorageKey Fallback Folder" }
    });
    expect(folderRes.statusCode).toBe(201);
    const folderId = folderRes.json().folder.id as string;

    const assetRes = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId,
        name: "storage-key-fallback.png",
        mimeType: "image/png",
        tags: ["storage-key-fallback"]
      }
    });
    expect(assetRes.statusCode).toBe(201);
    const assetId = assetRes.json().asset.id as string;

    const previewBlob = "1234567890abcdef1234567890abcdef12345678.png";
    const previewDir = resolveApiDataPath("previews");
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(
      path.join(previewDir, previewBlob),
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64")
    );

    const completeUpload = await app.inject({
      method: "POST",
      url: "/v1/drive/uploads/complete",
      headers: { "x-user-id": "user_demo" },
      payload: {
        assetId,
        storageKey: `previews/${previewBlob}`,
        checksum: "storage-key-preview-checksum",
        metadata: {}
      }
    });
    expect(completeUpload.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: "/v1/drive/assets/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().previews?.[assetId]).toBe(`/v1/previews/${previewBlob}`);

    const assetFileRes = await app.inject({
      method: "GET",
      url: `/v1/drive/assets/${assetId}/file`,
      headers: { "x-user-id": "user_demo" }
    });
    expect(assetFileRes.statusCode).toBe(200);
    expect(String(assetFileRes.headers["content-type"] ?? "")).toContain("image/");

    removePreviewBlobIfPresent(previewBlob);
  });

  it("creates and lists generation job", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const targetFolder = foldersRes.json().folders[0];

    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: targetFolder.id,
        prompt: "cinematic mountain sunrise",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: { quality: 1 }
      }
    });

    expect(run.statusCode).toBe(202);

    const list = await app.inject({
      method: "GET",
      url: "/v1/generation/jobs/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs.length).toBeGreaterThan(0);
  });

  it("reports accurate media spend totals from finalized transactions", async () => {
    const baselineRes = await app.inject({
      method: "GET",
      url: "/v1/billing/ws_demo/media-spend",
      headers: { "x-user-id": "user_demo" }
    });
    expect(baselineRes.statusCode).toBe(200);
    const baseline = baselineRes.json();

    const stamp = Date.now();
    const now = new Date().toISOString();
    const imageJobId = `job-media-spend-image-${stamp}`;
    const videoJobId = `job-media-spend-video-${stamp}`;

    app.ctx.store.generationJobs.push(
      {
        id: imageJobId,
        workspaceId: "ws_demo",
        createdBy: "user_demo",
        status: "SUCCEEDED",
        request: {
          workspaceId: "ws_demo",
          folderId: undefined,
          prompt: "test image spend",
          model: "Gemini 2.0 flash",
          type: "IMAGE",
          settings: { quality: 1 }
        },
        result: null,
        error: null,
        failure: null,
        reservedCredits: 4,
        createdAt: now,
        updatedAt: now
      },
      {
        id: videoJobId,
        workspaceId: "ws_demo",
        createdBy: "user_demo",
        status: "SUCCEEDED",
        request: {
          workspaceId: "ws_demo",
          folderId: undefined,
          prompt: "test video spend",
          model: "Kling 1.6",
          type: "VIDEO",
          settings: { quality: 1 }
        },
        result: null,
        error: null,
        failure: null,
        reservedCredits: 20,
        createdAt: now,
        updatedAt: now
      }
    );

    app.ctx.store.creditTransactions.push(
      {
        id: `tx-media-spend-image-${stamp}`,
        workspaceId: "ws_demo",
        jobId: imageJobId,
        type: "FINALIZE",
        amount: 7,
        balanceAfter: 0,
        occurredAt: now
      },
      {
        id: `tx-media-spend-video-${stamp}`,
        workspaceId: "ws_demo",
        jobId: videoJobId,
        type: "FINALIZE",
        amount: 18,
        balanceAfter: 0,
        occurredAt: now
      },
      {
        id: `tx-media-spend-topup-${stamp}`,
        workspaceId: "ws_demo",
        type: "TOP_UP",
        amount: 50,
        balanceAfter: 0,
        occurredAt: now
      }
    );

    const summaryRes = await app.inject({
      method: "GET",
      url: "/v1/billing/ws_demo/media-spend",
      headers: { "x-user-id": "user_demo" }
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json();
    const usdCentsPerCredit = Number(summary.pricing?.usdCentsPerCredit ?? 0);

    expect(summary.currency).toBe("USD");
    expect(summary.estimated).toBe(true);
    expect(usdCentsPerCredit).toBeGreaterThan(0);
    expect(summary.totals.imageCredits - baseline.totals.imageCredits).toBe(7);
    expect(summary.totals.videoCredits - baseline.totals.videoCredits).toBe(18);
    expect(summary.totals.totalCredits - baseline.totals.totalCredits).toBe(25);
    expect(summary.totals.imageUsdCents - baseline.totals.imageUsdCents).toBe(7 * usdCentsPerCredit);
    expect(summary.totals.videoUsdCents - baseline.totals.videoUsdCents).toBe(18 * usdCentsPerCredit);
    expect(summary.totals.totalUsdCents - baseline.totals.totalUsdCents).toBe(25 * usdCentsPerCredit);
    expect(summary.counts.imageTransactions - baseline.counts.imageTransactions).toBe(1);
    expect(summary.counts.videoTransactions - baseline.counts.videoTransactions).toBe(1);
  });

  it("rejects generation without target folderId or assetId", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        prompt: "sunrise over ocean",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: { quality: 1 }
      }
    });

    expect(run.statusCode).toBe(400);
    expect(run.json().error).toMatch(/requires a target/i);
  });

  it("returns 413 for oversized generation payloads with reference images", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const targetFolder = foldersRes.json().folders[0];

    const hugeReference = `data:image/png;base64,${"A".repeat(10_500_000)}`;
    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: targetFolder.id,
        prompt: "portrait with reference",
        model: "nano banana pro",
        type: "IMAGE",
        settings: {
          aspectRatio: "1:1",
          resolution: "1K",
          referenceImageDataUrl1: hugeReference
        }
      }
    });

    expect(run.statusCode).toBe(413);
    expect(String(run.json().error ?? "")).toMatch(/payload too large/i);
  });

  it("accepts nano banana pro requests with small reference images", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const targetFolder = foldersRes.json().folders[0];

    const tinyReference = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: targetFolder.id,
        prompt: "portrait with reference photo",
        model: "nano banana pro",
        type: "IMAGE",
        settings: {
          aspectRatio: "1:1",
          resolution: "1K",
          referenceImageDataUrl1: tinyReference
        }
      }
    });

    expect(run.statusCode).toBe(202);
    expect(run.json().job?.request?.model).toBe("nano banana pro");
  });

  it("supports permission check", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/permissions/check",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        resourceType: "WORKSPACE",
        resourceId: "ws_demo",
        action: "asset:write"
      }
    });

    expect(res.statusCode).toBe(200);
    expect(typeof res.json().allowed).toBe("boolean");
  });

  it("creates blocked placeholder image asset when prompt is blocked", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const targetFolder = foldersRes.json().folders[0];

    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: targetFolder.id,
        prompt: "explicit minor portrait in studio",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: { aspectRatio: "9:16", resolution: "1K" }
      }
    });
    expect(run.statusCode).toBe(202);
    expect(run.json().job.status).toBe("FAILED");
    expect(run.json().job.failure?.category).toBe("SAFETY_BLOCK");
    expect(typeof run.json().job.failure?.suggestedFix).toBe("string");
    expect(run.json().job.failure?.provider).toBe("local-policy");
    expect(run.json().job.failure?.errorCode).toBe("LOCAL_POLICY_BLOCK");
    expect(run.json().job.failure?.debugContext?.failureOrigin).toBe("LOCAL_POLICY_GATE");
    expect(run.json().job.failure?.debugContext?.providerAttempted).toBe(false);
    expect(String(run.json().job.failure?.debugContext?.policyMatchedTokens ?? "")).toContain("explicit minor");

    const assetsRes = await app.inject({
      method: "GET",
      url: "/v1/drive/assets/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(assetsRes.statusCode).toBe(200);

    const created = assetsRes
      .json()
      .assets
      .find((asset: { folderId: string; name: string }) => asset.folderId === targetFolder.id && /^.+-\d{4}\.png$/i.test(asset.name));
    expect(created).toBeDefined();
    expect(assetsRes.json().aspectRatios[created.id]).toBe("9:16");
    const preview = String(assetsRes.json().previews[created.id] ?? "");
    expect(
      preview.includes("data:image/svg+xml") ||
      /^\/v1\/previews\/[a-f0-9]{40}\.svg$/i.test(preview)
    ).toBe(true);
  });

  it("deletes failed generation jobs", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const targetFolder = foldersRes.json().folders[0];

    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: targetFolder.id,
        prompt: "explicit minor portrait in studio",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: { aspectRatio: "9:16", resolution: "1K" }
      }
    });
    expect(run.statusCode).toBe(202);
    const jobId = run.json().job.id as string;

    const del = await app.inject({
      method: "DELETE",
      url: "/v1/generation/jobs/batch",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", jobIds: [jobId] }
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deletedCount).toBe(1);

    const list = await app.inject({
      method: "GET",
      url: "/v1/generation/jobs/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs.some((job: { id: string }) => job.id === jobId)).toBe(false);
  });

  it("ignores missing IDs in generation job batch delete", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const targetFolder = foldersRes.json().folders[0];

    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: targetFolder.id,
        prompt: "explicit minor portrait in studio",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: { aspectRatio: "1:1", resolution: "1K" }
      }
    });
    expect(run.statusCode).toBe(202);
    const jobId = run.json().job.id as string;

    const del = await app.inject({
      method: "DELETE",
      url: "/v1/generation/jobs/batch",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", jobIds: [jobId, "job_missing_123"] }
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deletedCount).toBe(1);
  });

  it("ignores missing IDs in generation job batch move", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const [folderA, folderB] = foldersRes.json().folders;

    const run = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs",
      headers: { "x-user-id": "user_demo" },
      payload: {
        workspaceId: "ws_demo",
        folderId: folderA.id,
        prompt: "explicit minor portrait in studio",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: { aspectRatio: "1:1", resolution: "1K" }
      }
    });
    expect(run.statusCode).toBe(202);
    const jobId = run.json().job.id as string;

    const move = await app.inject({
      method: "POST",
      url: "/v1/generation/jobs/batch-move",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", jobIds: [jobId, "job_missing_456"], folderId: folderB.id }
    });
    expect(move.statusCode).toBe(200);
    expect(move.json().movedCount).toBe(1);
  });

  it("persists folder layout and batch moves assets", async () => {
    const foldersRes = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    const [folderA, folderB] = foldersRes.json().folders;

    const a1 = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", folderId: folderA.id, name: "a1.png", mimeType: "image/png", tags: [] }
    });
    const a2 = await app.inject({
      method: "POST",
      url: "/v1/drive/assets",
      headers: { "x-user-id": "user_demo" },
      payload: { workspaceId: "ws_demo", folderId: folderA.id, name: "a2.png", mimeType: "image/png", tags: [] }
    });
    const asset1 = a1.json().asset;
    const asset2 = a2.json().asset;

    const layoutRes = await app.inject({
      method: "PATCH",
      url: `/v1/drive/folders/${folderA.id}/layout`,
      headers: { "x-user-id": "user_demo" },
      payload: { customOrderAssetIds: [asset2.id, asset1.id] }
    });
    expect(layoutRes.statusCode).toBe(200);
    expect(layoutRes.json().customOrderAssetIds).toEqual([asset2.id, asset1.id]);

    const moveRes = await app.inject({
      method: "POST",
      url: "/v1/drive/assets/batch-move",
      headers: { "x-user-id": "user_demo" },
      payload: { assetIds: [asset1.id, asset2.id], folderId: folderB.id }
    });
    expect(moveRes.statusCode).toBe(200);
    expect(moveRes.json().movedCount).toBe(2);
  });

  it("persists workspace folder order", async () => {
    const initial = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(initial.statusCode).toBe(200);
    const initialFolders = initial.json().folders as Array<{ id: string }>;
    expect(initialFolders.length).toBeGreaterThan(1);

    const [first, second] = initialFolders;
    const reorderRes = await app.inject({
      method: "PATCH",
      url: "/v1/drive/folders/ws_demo/order",
      headers: { "x-user-id": "user_demo" },
      payload: { folderOrderIds: [second.id, first.id] }
    });
    expect(reorderRes.statusCode).toBe(200);
    expect(reorderRes.json().folderOrderIds[0]).toBe(second.id);
    expect(reorderRes.json().folderOrderIds[1]).toBe(first.id);

    const refreshed = await app.inject({
      method: "GET",
      url: "/v1/drive/folders/ws_demo",
      headers: { "x-user-id": "user_demo" }
    });
    expect(refreshed.statusCode).toBe(200);
    const refreshedFolders = refreshed.json().folders as Array<{ id: string }>;
    expect(refreshedFolders[0].id).toBe(second.id);
    expect(refreshedFolders[1].id).toBe(first.id);
  });
});
