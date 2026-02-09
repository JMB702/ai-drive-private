import { describe, expect, it } from "vitest";
import {
  buildGenerationFailureReport,
  generationFailureForJob
} from "../lib/generation-failure";
import type { GenerationJob } from "../lib/projects";

function sampleJob(overrides?: Partial<GenerationJob>): GenerationJob {
  const base: GenerationJob = {
    id: "job-1",
    status: "FAILED",
    createdAt: "2026-02-08T14:20:51.977Z",
    error: "Prompt blocked by safety policy",
    request: {
      folderId: "folder-1",
      model: "Gemini 2.0 flash",
      type: "IMAGE",
      prompt: "explicit minor portrait in studio",
      settings: {
        aspectRatio: "9:16",
        resolution: "1K"
      }
    }
  };
  return {
    ...base,
    ...overrides,
    request: {
      ...base.request,
      ...(overrides?.request ?? {}),
      settings: {
        ...base.request.settings,
        ...(overrides?.request?.settings ?? {})
      }
    }
  };
}

describe("generation failure diagnostics", () => {
  it("classifies fallback safety errors when structured failure is missing", () => {
    const failure = generationFailureForJob(sampleJob({ failure: null }));
    expect(failure.category).toBe("SAFETY_BLOCK");
    expect(failure.retryable).toBe(false);
  });

  it("infers local policy origin from fallback safety blocks when prompt matches local rules", () => {
    const report = buildGenerationFailureReport(sampleJob({ failure: null }));
    expect(report).toContain("source: client-fallback-diagnostics");
    expect(report).toContain("failureOrigin: LOCAL_POLICY_GATE");
    expect(report).toContain("diagnosisConfidence: MEDIUM");
  });

  it("builds a rich report with reference-input and triage details", () => {
    const report = buildGenerationFailureReport(
      sampleJob({
        request: {
          folderId: "girls",
          model: "Gemini 2.0 flash",
          type: "IMAGE",
          prompt: "portrait in studio",
          settings: {
            aspectRatio: "9:16",
            resolution: "1K",
            referenceImageDataUrl1: "data:image/png;base64,iVBORw0KGgo=",
            __clientRequestId: "req-123"
          }
        }
      }),
      { folderName: "Girls" }
    );

    expect(report).toContain("referenceInputs:");
    expect(report).toContain("triageChecklist:");
    expect(report).toContain("requestSettings:");
    expect(report).toContain("referenceImageDataUrl1: image/png base64(");
    expect(report).toContain("folder: Girls");
    expect(report).toContain("classificationMethod: client-inferred");
    expect(report).toContain("diagnosticsGap: Missing structured server failure payload; classification inferred from rawMessage.");
  });

  it("reports local policy origin when server diagnostics include local policy metadata", () => {
    const report = buildGenerationFailureReport(sampleJob({
      failure: {
        category: "SAFETY_BLOCK",
        provider: "local-policy",
        statusCode: null,
        errorCode: "LOCAL_POLICY_BLOCK",
        userMessage: "Prompt blocked by local safety policy (explicit minor).",
        suggestedFix: "Remove blocked term(s): explicit minor and retry.",
        retryable: false,
        rawMessage: "Prompt blocked by safety policy",
        debugContext: {
          diagnosticsVersion: "v2",
          failureOrigin: "LOCAL_POLICY_GATE",
          providerAttempted: false,
          policySource: "local-token-filter-v1",
          policyMatchedTokens: "explicit minor"
        }
      }
    }));

    expect(report).toContain("source: server-diagnostics");
    expect(report).toContain("failureOrigin: LOCAL_POLICY_GATE");
    expect(report).toContain("providerAttempted: no");
    expect(report).toContain("diagnosisConfidence: HIGH");
  });
});
