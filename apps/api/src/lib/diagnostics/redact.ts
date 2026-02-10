import { createHash } from "crypto";
import type { DiagnosticContext, DiagnosticScalar } from "./types.js";

const STRING_LIMIT = 300;
const OBJECT_LIMIT = 1200;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|password|secret|authorization|cookie|set-cookie|session|bearer|credential)/i;

const SAFE_SETTING_KEYS = new Set([
  "model",
  "type",
  "aspectRatio",
  "resolution",
  "quality",
  "__clientRequestId",
  "clientRequestId"
]);

function truncate(value: string, max = STRING_LIMIT): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

function scrubSecrets(value: string): string {
  let next = value;
  next = next.replace(/(sk-[A-Za-z0-9_-]{12,})/g, "[redacted-key]");
  next = next.replace(/(AIza[0-9A-Za-z-_]{12,})/g, "[redacted-key]");
  next = next.replace(/(Bearer\s+[A-Za-z0-9._-]{12,})/gi, "Bearer [redacted]");
  next = next.replace(/([A-Za-z0-9+/]{48,}={0,2})/g, "[redacted-token]");
  return next;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function estimateBase64Bytes(payload: string): number {
  const padding = (payload.match(/=*$/)?.[0].length ?? 0);
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function extractReferenceStats(value: string): { bytes: number; mimeType: string | null } {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return { bytes: 0, mimeType: null };
  return {
    bytes: estimateBase64Bytes(match[2]),
    mimeType: match[1].toLowerCase()
  };
}

function toScalar(value: unknown): DiagnosticScalar | null {
  if (value === null) return null;
  if (typeof value === "string") return truncate(scrubSecrets(value));
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function addSanitizedSettings(context: DiagnosticContext, settings: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (!SAFE_SETTING_KEYS.has(key)) continue;
    const scalar = toScalar(value);
    if (scalar === null) continue;
    if (key === "__clientRequestId") {
      context.clientRequestId = scalar;
      continue;
    }
    context[key] = scalar;
  }
}

export function redactDiagnosticContext(input: Record<string, unknown> | undefined): DiagnosticContext {
  const output: DiagnosticContext = {};
  if (!input || typeof input !== "object") {
    return output;
  }

  let referenceImageCount = 0;
  let referenceImageTotalBytes = 0;
  const referenceMimeTypes = new Set<string>();

  for (const [key, rawValue] of Object.entries(input)) {
    if (isSensitiveKey(key)) continue;

    if (key === "prompt" && typeof rawValue === "string") {
      output.promptHash = hashText(rawValue);
      output.promptLength = rawValue.length;
      continue;
    }
    if (key === "negativePrompt" && typeof rawValue === "string") {
      output.negativePromptLength = rawValue.length;
      continue;
    }
    if (key.startsWith("referenceImageDataUrl") && typeof rawValue === "string") {
      const stats = extractReferenceStats(rawValue);
      if (stats.bytes > 0) {
        referenceImageCount += 1;
        referenceImageTotalBytes += stats.bytes;
      }
      if (stats.mimeType) {
        referenceMimeTypes.add(stats.mimeType);
      }
      continue;
    }
    if (key === "settings" && rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      addSanitizedSettings(output, rawValue as Record<string, unknown>);
      for (const [settingKey, settingValue] of Object.entries(rawValue as Record<string, unknown>)) {
        if (!settingKey.startsWith("referenceImageDataUrl") || typeof settingValue !== "string") continue;
        const stats = extractReferenceStats(settingValue);
        if (stats.bytes > 0) {
          referenceImageCount += 1;
          referenceImageTotalBytes += stats.bytes;
        }
        if (stats.mimeType) {
          referenceMimeTypes.add(stats.mimeType);
        }
      }
      continue;
    }

    const scalar = toScalar(rawValue);
    if (scalar !== null) {
      output[key] = scalar;
      continue;
    }

    if (Array.isArray(rawValue)) {
      output[key] = truncate(scrubSecrets(JSON.stringify(rawValue)), OBJECT_LIMIT);
      continue;
    }

    if (rawValue && typeof rawValue === "object") {
      output[key] = truncate(scrubSecrets(JSON.stringify(rawValue)), OBJECT_LIMIT);
    }
  }

  if (referenceImageCount > 0) {
    output.referenceImageCount = referenceImageCount;
    output.referenceImageTotalBytes = referenceImageTotalBytes;
    output.referenceImageMimeTypes = Array.from(referenceMimeTypes).join(",") || "n/a";
  }

  return output;
}

