import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationRequest } from "@aidrive/shared";
import { createAdapters } from "../src/providers/adapters.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("A2E adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses ai2everyone CDN URL for uploaded references", async () => {
    const signedUploadUrl = "https://a2e-prod-jumpy.r2.cloudflarestorage.com/adam2eve/stable/user/u1/ref123?sig=abc";
    const expectedCdnUrl = "https://a2e-prod-jumpy.ai2everyone.com/adam2eve/stable/user/u1/ref123";
    const outputImageUrl = "https://a2e-prod-jumpy.ai2everyone.com/stable/generated/out.png";
    let capturedStartBody: Record<string, unknown> | null = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/v1/r2/get_upload_presigned_url")) {
        return jsonResponse({
          code: 0,
          data: {
            uploadUrl: signedUploadUrl,
            key: "adam2eve/stable/user/u1/ref123",
            bucket: "a2e-prod-jumpy",
            expiresIn: 300
          }
        });
      }

      if (url === signedUploadUrl && method === "PUT") {
        return new Response(null, { status: 200 });
      }

      if (url.endsWith("/api/v1/userText2image/start")) {
        capturedStartBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse({
          code: 0,
          data: [
            {
              _id: "task_1",
              current_status: "completed",
              image_urls: [outputImageUrl]
            }
          ]
        });
      }

      if (url === outputImageUrl && method === "GET") {
        return new Response(Uint8Array.from([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }

      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    const adapter = createAdapters({
      A2E_API_KEY: "test-key",
      A2E_API_BASE_URL: "https://video.a2e.ai"
    } as never).find((candidate) => candidate.supports.includes("A2E Image generator"));

    if (!adapter) throw new Error("A2E adapter missing");

    const request: GenerationRequest = {
      workspaceId: "ws_demo",
      folderId: "folder_demo_root",
      prompt: "A portrait photo",
      model: "A2E Image generator",
      type: "IMAGE",
      settings: {
        aspectRatio: "1:1",
        resolution: "1K",
        referenceImageDataUrl1: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/"
      }
    };

    await adapter.submit(request);

    expect(capturedStartBody).not.toBeNull();
    expect(capturedStartBody?.input_images).toEqual([expectedCdnUrl]);
    expect(String((capturedStartBody?.input_images as string[])[0])).not.toContain("cloudflarestorage.com");
  });
});
