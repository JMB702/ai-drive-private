import { describe, expect, it } from "vitest";
import type { GenerationRequest } from "@aidrive/shared";
import { diagnoseGenerationFailure } from "../src/lib/generation-failure.js";

function sampleRequest(): GenerationRequest {
  return {
    workspaceId: "ws_demo",
    folderId: "folder_demo_root",
    prompt: "Sexy naked women",
    model: "Gemini 2.0 flash",
    type: "IMAGE",
    settings: {
      aspectRatio: "1:1",
      resolution: "1K"
    }
  };
}

describe("generation failure classification", () => {
  it("classifies missing inline image data as content policy, not aspect ratio mismatch", () => {
    const failure = diagnoseGenerationFailure({
      request: sampleRequest(),
      provider: "gemini",
      error:
        "Could not produce requested aspect ratio (1:1). Gemini: Gemini image attempts failed. Primary: Gemini image response did not include inline image data. Secondary: Gemini image response did not include inline image data"
    });

    expect(failure.category).toBe("CONTENT_POLICY");
    expect(failure.userMessage).toContain("content policy");
  });

  it("keeps explicit ratio mismatch classification for true ratio failures", () => {
    const failure = diagnoseGenerationFailure({
      request: sampleRequest(),
      provider: "gemini",
      error: "Could not produce requested aspect ratio (1:1)."
    });

    expect(failure.category).toBe("ASPECT_RATIO_MISMATCH");
  });

  it("classifies missing A2E key as API auth failure", () => {
    const failure = diagnoseGenerationFailure({
      request: sampleRequest(),
      provider: "a2e",
      error: "Missing A2E_API_KEY for image generation"
    });

    expect(failure.category).toBe("API_AUTH");
  });

  it("classifies A2E reference-url requirement as invalid argument", () => {
    const failure = diagnoseGenerationFailure({
      request: sampleRequest(),
      provider: "a2e",
      error: "A2E reference images must be public URLs (http/https). data:image inputs are not supported by userText2image."
    });

    expect(failure.category).toBe("API_INVALID_ARGUMENT");
    expect(failure.userMessage).toContain("rejected the request format");
  });

  it("classifies A2E reference upload validation failures as invalid argument", () => {
    const failure = diagnoseGenerationFailure({
      request: sampleRequest(),
      provider: "a2e",
      error: "A2E reference upload init failed: 400 {\"code\":400,\"msg\":\"Validation Failed\",\"errors\":[{\"message\":\"required\",\"field\":\"key\",\"code\":\"missing_field\"}]}"
    });

    expect(failure.category).toBe("API_INVALID_ARGUMENT");
  });

  it("classifies A2E failed task generation_error as provider unavailable/retryable", () => {
    const failure = diagnoseGenerationFailure({
      request: sampleRequest(),
      provider: "a2e",
      error: "A2E did not return image URL. status=failed taskId=abc123 detail=GENERATION_ERROR:FAILURE"
    });

    expect(failure.category).toBe("API_UNAVAILABLE");
    expect(failure.retryable).toBe(true);
  });

  it("classifies A2E stuck processing as timeout/retryable", () => {
    const failure = diagnoseGenerationFailure({
      request: sampleRequest(),
      provider: "a2e",
      error: "A2E did not return image URL. status=processing taskId=abc123"
    });

    expect(failure.category).toBe("API_TIMEOUT");
    expect(failure.retryable).toBe(true);
  });
});
