import type { GenerationFailure, GenerationFailureCategory, GenerationRequest } from "@aidrive/shared";

const MAX_RAW_MESSAGE_LENGTH = 4000;
const CLIENT_REQUEST_ID_KEY = "__clientRequestId";
const MAX_SETTINGS_SNAPSHOT_LENGTH = 800;
type FailureDebugValue = string | number | boolean | null;

function toRawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sanitizeRawMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > MAX_RAW_MESSAGE_LENGTH ? `${compact.slice(0, MAX_RAW_MESSAGE_LENGTH)}…` : compact;
}

function parseStatusCode(message: string): number | null {
  const regex = /\b([45]\d{2})\b/g;
  let match = regex.exec(message);
  while (match) {
    const code = Number(match[1]);
    if (Number.isFinite(code)) return code;
    match = regex.exec(message);
  }
  return null;
}

function parseErrorCode(message: string): string | null {
  const statusMatch = message.match(/"status"\s*:\s*"([A-Z_]+)"/);
  if (statusMatch?.[1]) return statusMatch[1];
  const codeMatch = message.match(/"code"\s*:\s*"([A-Z_]+)"/);
  if (codeMatch?.[1]) return codeMatch[1];
  return null;
}

function parseProviderMessage(message: string): string | null {
  const msgMatch = message.match(/"message"\s*:\s*"([^"]+)"/);
  if (!msgMatch?.[1]) return null;
  const unescaped = msgMatch[1]
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ");
  return unescaped.slice(0, 300);
}

function hashFingerprint(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `f${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function estimateBase64Bytes(data: string): number {
  const padding = (data.match(/=*$/)?.[0].length ?? 0);
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function referenceImageStats(settings: Record<string, string | number | boolean>): {
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

function formatSettingValue(value: string | number | boolean): string {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 72 ? `${compact.slice(0, 71)}…` : compact;
  }
  return String(value);
}

function settingsSnapshot(settings: Record<string, string | number | boolean>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("referenceImageDataUrl")) continue;
    parts.push(`${key}=${formatSettingValue(value)}`);
  }
  const snapshot = parts.sort((a, b) => a.localeCompare(b)).join("; ");
  if (snapshot.length <= MAX_SETTINGS_SNAPSHOT_LENGTH) return snapshot || "(none)";
  return `${snapshot.slice(0, MAX_SETTINGS_SNAPSHOT_LENGTH - 1)}…`;
}

function referenceImageCount(settings: Record<string, string | number | boolean>): number {
  return Object.entries(settings).filter(([key, value]) =>
    key.startsWith("referenceImageDataUrl") &&
    typeof value === "string" &&
    value.startsWith("data:image/")
  ).length;
}

function categoryFor(rawMessage: string, statusCode: number | null): GenerationFailureCategory {
  const lower = rawMessage.toLowerCase();

  if (lower.includes("prompt blocked by safety policy")) return "SAFETY_BLOCK";
  if (lower.includes("aspect ratio is not enabled")) return "ASPECT_RATIO_UNSUPPORTED";
  // Gemini can report ratio failure even when the underlying cause is a blocked/empty image response.
  if (lower.includes("did not include inline image data")) return "CONTENT_POLICY";
  if (lower.includes("missing a2e_api_key")) return "API_AUTH";
  if (lower.includes("reference images must be public urls")) return "API_INVALID_ARGUMENT";
  if (lower.includes("a2e reference upload init failed")) return "API_INVALID_ARGUMENT";
  if (lower.includes("validation failed")) return "API_INVALID_ARGUMENT";
  if (lower.includes("missing_field")) return "API_INVALID_ARGUMENT";
  if (lower.includes("generation_error")) return "API_UNAVAILABLE";
  if (lower.includes("a2e did not return image url") && lower.includes("status=failed")) return "API_UNAVAILABLE";
  if (lower.includes("a2e task still processing after")) return "API_TIMEOUT";
  if (lower.includes("a2e did not return image url") && lower.includes("status=processing")) return "API_TIMEOUT";
  if (lower.includes("could not produce requested aspect ratio")) return "ASPECT_RATIO_MISMATCH";

  if (lower.includes("unauthenticated") || lower.includes("permission_denied") || statusCode === 401 || statusCode === 403) {
    return "API_AUTH";
  }
  if (lower.includes("resource_exhausted") || lower.includes("rate limit") || lower.includes("quota") || statusCode === 429) {
    return "API_RATE_LIMIT";
  }
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("aborterror") || lower.includes("etimedout")) {
    return "API_TIMEOUT";
  }
  if (
    lower.includes("unavailable") ||
    lower.includes("gateway") ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504
  ) {
    return "API_UNAVAILABLE";
  }
  if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("fetch failed") || lower.includes("network")) {
    return "NETWORK";
  }
  if (lower.includes("invalid_argument") || lower.includes("invalid argument")) return "API_INVALID_ARGUMENT";
  if ((lower.includes("safety") || lower.includes("policy")) && lower.includes("block")) return "CONTENT_POLICY";

  return "UNKNOWN";
}

function adviceFor(category: GenerationFailureCategory): {
  userMessage: string;
  suggestedFix: string;
  retryable: boolean;
} {
  switch (category) {
    case "SAFETY_BLOCK":
      return {
        userMessage: "Generation was blocked by safety policy.",
        suggestedFix: "Revise the prompt to remove disallowed content and retry.",
        retryable: false
      };
    case "CONTENT_POLICY":
      return {
        userMessage: "The provider blocked this request due to content policy.",
        suggestedFix: "Adjust the prompt/reference images to comply with policy, then retry.",
        retryable: false
      };
    case "API_INVALID_ARGUMENT":
      return {
        userMessage: "Provider rejected the request format or settings.",
        suggestedFix: "Check model, aspect ratio, resolution, and reference image inputs for unsupported values.",
        retryable: false
      };
    case "API_AUTH":
      return {
        userMessage: "Provider authentication/authorization failed.",
        suggestedFix: "Verify API key, permissions, and billing status for the configured provider account.",
        retryable: false
      };
    case "API_RATE_LIMIT":
      return {
        userMessage: "Provider rate limit or quota was exceeded.",
        suggestedFix: "Wait and retry, reduce parallel requests, or increase provider quota.",
        retryable: true
      };
    case "API_TIMEOUT":
      return {
        userMessage: "Generation request timed out.",
        suggestedFix: "Retry the request. If it repeats, reduce prompt/reference complexity or check network latency.",
        retryable: true
      };
    case "API_UNAVAILABLE":
      return {
        userMessage: "Provider service is temporarily unavailable.",
        suggestedFix: "Retry shortly. If persistent, check provider status and fail over to another model.",
        retryable: true
      };
    case "ASPECT_RATIO_UNSUPPORTED":
      return {
        userMessage: "Selected model does not support the requested aspect ratio.",
        suggestedFix: "Use a supported aspect ratio/model combination or switch models.",
        retryable: false
      };
    case "ASPECT_RATIO_MISMATCH":
      return {
        userMessage: "Provider could not return the requested aspect ratio.",
        suggestedFix: "Retry or switch model; if needed use 1:1 then crop/extend intentionally.",
        retryable: false
      };
    case "NETWORK":
      return {
        userMessage: "Network error occurred while contacting the provider.",
        suggestedFix: "Retry and verify API/network connectivity.",
        retryable: true
      };
    case "UNKNOWN":
    default:
      return {
        userMessage: "Generation failed for an unknown reason.",
        suggestedFix: "Use diagnostics to inspect raw provider error, then adjust request settings or provider config.",
        retryable: false
      };
  }
}

function debugContext(
  request: GenerationRequest,
  provider: string,
  statusCode: number | null,
  errorCode: string | null,
  rawMessage: string,
  overrides?: Record<string, FailureDebugValue>
): Record<string, string | number | boolean | null> {
  const referenceStats = referenceImageStats(request.settings);
  const promptSnippet = request.prompt.trim().slice(0, 120).replace(/\s+/g, " ");
  const providerMessage = parseProviderMessage(rawMessage);
  const context: Record<string, FailureDebugValue> = {
    provider,
    model: request.model,
    type: request.type,
    promptLength: request.prompt.length,
    promptSnippet: promptSnippet || "(empty)",
    hasNegativePrompt: typeof request.negativePrompt === "string" && request.negativePrompt.trim().length > 0,
    negativePromptLength: typeof request.negativePrompt === "string" ? request.negativePrompt.length : 0,
    aspectRatio: typeof request.settings.aspectRatio === "string" ? request.settings.aspectRatio : null,
    resolution: typeof request.settings.resolution === "string" ? request.settings.resolution : null,
    quality: typeof request.settings.quality === "string" ? request.settings.quality : null,
    referenceImageCount: referenceImageCount(request.settings),
    referenceImageTotalBytes: referenceStats.totalBytes,
    referenceImageMimeTypes: referenceStats.mimeTypes,
    clientRequestId: typeof request.settings[CLIENT_REQUEST_ID_KEY] === "string" ? request.settings[CLIENT_REQUEST_ID_KEY] : null,
    requestSettingsSnapshot: settingsSnapshot(request.settings),
    statusCode,
    errorCode,
    providerAttempted: provider !== "unknown",
    providerMessage,
    rawMessageLength: rawMessage.length,
    errorFingerprint: hashFingerprint(`${provider}|${request.model}|${rawMessage}`),
    diagnosticsVersion: "v2"
  };
  return {
    ...context,
    ...(overrides ?? {})
  };
}

export function diagnoseGenerationFailure(input: {
  request: GenerationRequest;
  provider: string;
  error: unknown;
  forcedCategory?: GenerationFailureCategory;
  debugContextOverrides?: Record<string, FailureDebugValue>;
}): GenerationFailure {
  const rawMessage = sanitizeRawMessage(toRawMessage(input.error));
  const statusCode = parseStatusCode(rawMessage);
  const errorCode = parseErrorCode(rawMessage);
  const category = input.forcedCategory ?? categoryFor(rawMessage, statusCode);
  const advice = adviceFor(category);

  return {
    category,
    provider: input.provider,
    statusCode,
    errorCode,
    userMessage: advice.userMessage,
    suggestedFix: advice.suggestedFix,
    retryable: advice.retryable,
    rawMessage,
    debugContext: debugContext(input.request, input.provider, statusCode, errorCode, rawMessage, input.debugContextOverrides)
  };
}
