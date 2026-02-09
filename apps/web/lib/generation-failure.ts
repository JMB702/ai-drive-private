import type { GenerationFailure, GenerationJob } from "./projects";

const CLIENT_FALLBACK_VERSION = "client-fallback-v2";
const LOCAL_POLICY_HINT_TOKENS = ["csam", "terror propaganda", "explicit minor"] as const;

function classifyFallback(raw: string): {
  category: GenerationFailure["category"];
  suggestedFix: string;
  retryable: boolean;
} {
  const lower = raw.toLowerCase();

  if (lower.includes("prompt blocked by safety policy") || lower.includes("safety block")) {
    return {
      category: "SAFETY_BLOCK",
      suggestedFix: "Revise the prompt to remove disallowed content and retry.",
      retryable: false
    };
  }
  if ((lower.includes("safety") || lower.includes("policy")) && lower.includes("block")) {
    return {
      category: "CONTENT_POLICY",
      suggestedFix: "Adjust prompt/reference images to comply with policy, then retry.",
      retryable: false
    };
  }
  if (lower.includes("invalid_argument") || lower.includes("invalid argument")) {
    return {
      category: "API_INVALID_ARGUMENT",
      suggestedFix: "Check model, aspect ratio, resolution, and reference image inputs.",
      retryable: false
    };
  }
  if (lower.includes("unauthenticated") || lower.includes("permission_denied") || lower.includes("401") || lower.includes("403")) {
    return {
      category: "API_AUTH",
      suggestedFix: "Verify API key, permissions, and billing status.",
      retryable: false
    };
  }
  if (lower.includes("rate limit") || lower.includes("quota") || lower.includes("resource_exhausted") || lower.includes("429")) {
    return {
      category: "API_RATE_LIMIT",
      suggestedFix: "Retry later, reduce parallel requests, or increase provider quota.",
      retryable: true
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      category: "API_TIMEOUT",
      suggestedFix: "Retry. If repeated, reduce prompt/reference complexity.",
      retryable: true
    };
  }
  if (lower.includes("unavailable") || lower.includes("gateway") || lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("504")) {
    return {
      category: "API_UNAVAILABLE",
      suggestedFix: "Retry shortly or fail over to another model.",
      retryable: true
    };
  }
  if (lower.includes("network") || lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("enotfound")) {
    return {
      category: "NETWORK",
      suggestedFix: "Check connectivity and retry.",
      retryable: true
    };
  }
  if (lower.includes("aspect ratio is not enabled")) {
    return {
      category: "ASPECT_RATIO_UNSUPPORTED",
      suggestedFix: "Use a supported aspect ratio/model combination.",
      retryable: false
    };
  }
  if (lower.includes("could not produce requested aspect ratio")) {
    return {
      category: "ASPECT_RATIO_MISMATCH",
      suggestedFix: "Retry or switch models.",
      retryable: false
    };
  }

  return {
    category: "UNKNOWN",
    suggestedFix: "Open diagnostics and review raw error details before retrying.",
    retryable: false
  };
}

function parseStatusCode(raw: string): number | null {
  const match = raw.match(/\b([45]\d{2})\b/);
  if (!match?.[1]) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}

function parseErrorCode(raw: string): string | null {
  const statusMatch = raw.match(/"status"\s*:\s*"([A-Z_]+)"/);
  if (statusMatch?.[1]) return statusMatch[1];
  const codeMatch = raw.match(/"code"\s*:\s*"([A-Z_]+)"/);
  if (codeMatch?.[1]) return codeMatch[1];
  return null;
}

function fallbackFailure(job: GenerationJob): GenerationFailure {
  const raw = job.error?.trim() || "Generation failed";
  const classified = classifyFallback(raw);
  const statusCode = parseStatusCode(raw);
  const errorCode = parseErrorCode(raw);
  return {
    category: classified.category,
    provider: "unknown",
    statusCode,
    errorCode,
    userMessage: raw,
    suggestedFix: classified.suggestedFix,
    retryable: classified.retryable,
    rawMessage: raw,
    debugContext: {
      diagnosticsVersion: CLIENT_FALLBACK_VERSION,
      rawMessageLength: raw.length,
      statusCode,
      errorCode
    }
  };
}

function refineUnknownFailure(failure: GenerationFailure, job: GenerationJob): GenerationFailure {
  if (failure.category !== "UNKNOWN") return failure;
  const raw = failure.rawMessage?.trim() || job.error?.trim() || failure.userMessage || "Generation failed";
  const classified = classifyFallback(raw);
  if (classified.category === "UNKNOWN") return failure;

  return {
    ...failure,
    category: classified.category,
    suggestedFix: classified.suggestedFix,
    retryable: classified.retryable,
    userMessage: failure.userMessage?.trim() ? failure.userMessage : raw,
    rawMessage: raw,
    statusCode: failure.statusCode ?? parseStatusCode(raw),
    errorCode: failure.errorCode ?? parseErrorCode(raw),
    debugContext: {
      ...failure.debugContext,
      diagnosticsVersion: CLIENT_FALLBACK_VERSION,
      reclassifiedByClient: true
    }
  };
}

export function generationFailureForJob(job: GenerationJob): GenerationFailure {
  const base = job.failure ?? fallbackFailure(job);
  return refineUnknownFailure(base, job);
}

export function generationFailureCategoryLabel(category: GenerationFailure["category"]): string {
  switch (category) {
    case "SAFETY_BLOCK":
      return "Safety Block";
    case "CONTENT_POLICY":
      return "Content Policy";
    case "API_INVALID_ARGUMENT":
      return "API Invalid Argument";
    case "API_AUTH":
      return "API Auth";
    case "API_RATE_LIMIT":
      return "API Rate Limit";
    case "API_UNAVAILABLE":
      return "API Unavailable";
    case "API_TIMEOUT":
      return "API Timeout";
    case "ASPECT_RATIO_UNSUPPORTED":
      return "Aspect Ratio Unsupported";
    case "ASPECT_RATIO_MISMATCH":
      return "Aspect Ratio Mismatch";
    case "NETWORK":
      return "Network Error";
    case "UNKNOWN":
    default:
      return "Unknown Failure";
  }
}

type FailureOrigin =
  | "LOCAL_POLICY_GATE"
  | "PROVIDER_POLICY"
  | "PROVIDER_REQUEST"
  | "NETWORK_OR_TRANSPORT"
  | "UNKNOWN";

type DiagnosisConfidence = "HIGH" | "MEDIUM" | "LOW";

type FailureOriginDiagnosis = {
  origin: FailureOrigin;
  confidence: DiagnosisConfidence;
  providerAttempted: "yes" | "no" | "unknown";
  classificationMethod: "server-structured" | "client-inferred";
  diagnosticsGap: string;
  evidence: string;
};

function asString(value: string | number | boolean | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: string | number | boolean | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toYesNoUnknown(value: boolean | null): "yes" | "no" | "unknown" {
  if (value == null) return "unknown";
  return value ? "yes" : "no";
}

function promptPolicyMatches(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  return LOCAL_POLICY_HINT_TOKENS.filter((token) => lower.includes(token));
}

function inferFailureOrigin(job: GenerationJob, failure: GenerationFailure): FailureOriginDiagnosis {
  const debugContext = failure.debugContext ?? {};
  const classificationMethod = job.failure ? "server-structured" : "client-inferred";
  const diagnosticsGap = job.failure
    ? "none"
    : "Missing structured server failure payload; classification inferred from rawMessage.";
  const provider = failure.provider.trim().toLowerCase();
  const policySource = asString(debugContext.policySource);
  const explicitOrigin = asString(debugContext.failureOrigin);
  const providerAttemptedHint = asBoolean(debugContext.providerAttempted);
  const promptMatches = promptPolicyMatches(job.request.prompt);
  const localPolicySignal =
    provider === "local-policy" ||
    provider === "safety" ||
    explicitOrigin === "LOCAL_POLICY_GATE" ||
    (policySource?.toLowerCase().includes("local") ?? false) ||
    (
      classificationMethod === "client-inferred" &&
      provider === "unknown" &&
      (failure.category === "SAFETY_BLOCK" || failure.category === "CONTENT_POLICY") &&
      promptMatches.length > 0
    );

  let origin: FailureOrigin = "UNKNOWN";
  let confidence: DiagnosisConfidence = classificationMethod === "server-structured" ? "MEDIUM" : "LOW";
  let providerAttempted = toYesNoUnknown(providerAttemptedHint);

  if (localPolicySignal) {
    origin = "LOCAL_POLICY_GATE";
    confidence = classificationMethod === "server-structured" ? "HIGH" : "MEDIUM";
    if (providerAttempted === "unknown") providerAttempted = "no";
  } else if (failure.category === "SAFETY_BLOCK" || failure.category === "CONTENT_POLICY") {
    if (provider !== "unknown") {
      origin = "PROVIDER_POLICY";
      confidence = "HIGH";
      if (providerAttempted === "unknown") providerAttempted = "yes";
    } else {
      origin = "UNKNOWN";
      confidence = "LOW";
    }
  } else if (
    failure.category === "API_INVALID_ARGUMENT" ||
    failure.category === "API_AUTH" ||
    failure.category === "API_RATE_LIMIT" ||
    failure.category === "API_TIMEOUT" ||
    failure.category === "API_UNAVAILABLE" ||
    failure.category === "ASPECT_RATIO_UNSUPPORTED" ||
    failure.category === "ASPECT_RATIO_MISMATCH"
  ) {
    origin = "PROVIDER_REQUEST";
    confidence = provider === "unknown" ? "MEDIUM" : "HIGH";
    if (providerAttempted === "unknown") providerAttempted = provider === "unknown" ? "unknown" : "yes";
  } else if (failure.category === "NETWORK") {
    origin = "NETWORK_OR_TRANSPORT";
    confidence = "HIGH";
    if (providerAttempted === "unknown") providerAttempted = "yes";
  }

  const evidence = [
    `category=${failure.category}`,
    `provider=${failure.provider || "unknown"}`,
    `source=${classificationMethod}`,
    `policySource=${policySource ?? "n/a"}`,
    `promptPolicyMatches=${promptMatches.join(",") || "n/a"}`
  ].join("; ");

  return {
    origin,
    confidence,
    providerAttempted,
    classificationMethod,
    diagnosticsGap,
    evidence
  };
}

function formatDetails(details: Record<string, string | number | boolean | null>): string {
  const entries = Object.entries(details).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "(none)";
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join("\n");
}

function estimateBase64Bytes(payload: string): number {
  const padding = (payload.match(/=*$/)?.[0].length ?? 0);
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function referenceInputSummary(settings: Record<string, string | number | boolean>): {
  count: number;
  totalBytes: number;
  mimeTypes: string;
} {
  let count = 0;
  let totalBytes = 0;
  const mimeTypes = new Set<string>();
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith("referenceImageDataUrl")) continue;
    if (typeof value !== "string") continue;
    const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) continue;
    count += 1;
    mimeTypes.add(match[1].toLowerCase());
    totalBytes += estimateBase64Bytes(match[2]);
  }
  return {
    count,
    totalBytes,
    mimeTypes: [...mimeTypes].join(",") || "n/a"
  };
}

function summarizeSettingValue(key: string, value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  if (key.startsWith("referenceImageDataUrl")) {
    const match = value.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
    if (match?.[1] && match?.[2]) {
      return `${match[1]} base64(${match[2].length} chars)`;
    }
    return "reference image data";
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 139)}…` : compact;
}

function formatRequestSettings(settings: Record<string, string | number | boolean>): string {
  const entries = Object.entries(settings).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "(none)";
  return entries.map(([key, value]) => `${key}: ${summarizeSettingValue(key, value)}`).join("\n");
}

function triageChecklist(failure: GenerationFailure, diagnosis: FailureOriginDiagnosis): string[] {
  switch (failure.category) {
    case "SAFETY_BLOCK":
    case "CONTENT_POLICY":
      if (diagnosis.origin === "LOCAL_POLICY_GATE") {
        return [
          "Local safety precheck blocked the prompt before provider submission.",
          "Remove or rewrite blocked local-policy terms and retry.",
          "If this seems incorrect, share this report so local policy rules can be adjusted."
        ];
      }
      return [
        "Remove disallowed terms/content from prompt and reference images.",
        "Retry with a safer wording while preserving intent.",
        "If still blocked, escalate with this report and full prompt context."
      ];
    case "API_INVALID_ARGUMENT":
      return [
        "Verify model supports the requested aspect ratio and resolution.",
        "Check reference image formats and count limits.",
        "Retry with a minimal prompt and no references to isolate bad inputs."
      ];
    case "API_AUTH":
      return [
        "Confirm API key is loaded on the backend process.",
        "Verify provider account permissions and billing.",
        "Retry after key rotation if needed."
      ];
    case "API_RATE_LIMIT":
    case "API_TIMEOUT":
    case "API_UNAVAILABLE":
    case "NETWORK":
      return [
        "Retry after a short delay.",
        "Reduce concurrent generation count.",
        "Switch model/provider if retries keep failing."
      ];
    case "ASPECT_RATIO_UNSUPPORTED":
    case "ASPECT_RATIO_MISMATCH":
      return [
        "Try a supported ratio for this model (or switch models).",
        "Retry once without references to isolate model behavior.",
        "Use the failure placeholder as provenance if keeping layout order matters."
      ];
    case "UNKNOWN":
    default:
      return [
        "Review rawMessage and debugContext for upstream provider signals.",
        "Retry once with one model and one image to reduce variables.",
        "Escalate with this full report and server logs if it repeats."
      ];
  }
}

export function buildGenerationFailureReport(job: GenerationJob, opts?: { folderName?: string | null }): string {
  const failure = generationFailureForJob(job);
  const request = job.request;
  const generatedAt = new Date().toISOString();
  const createdAtMs = Date.parse(job.createdAt);
  const jobAgeSeconds = Number.isFinite(createdAtMs)
    ? Math.max(0, Math.floor((Date.now() - createdAtMs) / 1000))
    : null;
  const references = referenceInputSummary(request.settings);
  const debugContext = failure.debugContext ?? {};
  const fingerprint = typeof debugContext.errorFingerprint === "string"
    ? debugContext.errorFingerprint
    : "n/a";
  const source = job.failure ? "server-diagnostics" : "client-fallback-diagnostics";
  const diagnosis = inferFailureOrigin(job, failure);

  return [
    "Generation Failure Diagnostic Report",
    `generatedAt: ${generatedAt}`,
    `source: ${source}`,
    `diagnosticsVersion: ${String(debugContext.diagnosticsVersion ?? CLIENT_FALLBACK_VERSION)}`,
    `classificationMethod: ${diagnosis.classificationMethod}`,
    `jobId: ${job.id}`,
    `status: ${job.status}`,
    `createdAt: ${job.createdAt}`,
    `jobAgeSeconds: ${jobAgeSeconds ?? "n/a"}`,
    `folder: ${opts?.folderName ?? request.folderId ?? "unknown"}`,
    `model: ${request.model}`,
    `type: ${request.type}`,
    `aspectRatio: ${String(request.settings.aspectRatio ?? "1:1")}`,
    `resolution: ${String(request.settings.resolution ?? "1K")}`,
    `category: ${failure.category} (${generationFailureCategoryLabel(failure.category)})`,
    `failureOrigin: ${diagnosis.origin}`,
    `diagnosisConfidence: ${diagnosis.confidence}`,
    `provider: ${failure.provider}`,
    `providerAttempted: ${diagnosis.providerAttempted}`,
    `statusCode: ${failure.statusCode ?? "n/a"}`,
    `errorCode: ${failure.errorCode ?? "n/a"}`,
    `retryable: ${failure.retryable ? "yes" : "no"}`,
    `errorFingerprint: ${fingerprint}`,
    `diagnosticsGap: ${diagnosis.diagnosticsGap}`,
    `originEvidence: ${diagnosis.evidence}`,
    `userMessage: ${failure.userMessage}`,
    `suggestedFix: ${failure.suggestedFix}`,
    "referenceInputs:",
    `count: ${references.count}`,
    `totalBytes: ${references.totalBytes}`,
    `mimeTypes: ${references.mimeTypes}`,
    "requestSettings:",
    formatRequestSettings(request.settings),
    "triageChecklist:",
    ...triageChecklist(failure, diagnosis).map((item, index) => `${index + 1}. ${item}`),
    "debugContext:",
    formatDetails(debugContext),
    "rawMessage:",
    failure.rawMessage,
    "prompt:",
    request.prompt,
    "negativePrompt:",
    request.negativePrompt?.trim() ? request.negativePrompt : "(none)"
  ].join("\n");
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard API unavailable");
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export async function copyGenerationFailureReport(job: GenerationJob, opts?: { folderName?: string | null }): Promise<void> {
  const report = buildGenerationFailureReport(job, opts);
  await copyText(report);
}
