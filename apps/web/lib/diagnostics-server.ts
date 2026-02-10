import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

export type DiagnosticSeverity = "INFO" | "WARN" | "HIGH" | "CRITICAL";
export type DiagnosticCategory =
  | "GENERATION"
  | "PROVIDER"
  | "PROXY"
  | "PERSISTENCE"
  | "REALTIME"
  | "CLIENT"
  | "SUPERVISOR"
  | "IMAGE_PROXY"
  | "SYSTEM";

export type ServerDiagnosticInput = {
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  component: string;
  eventName: string;
  message: string;
  workspaceId?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  context?: Record<string, unknown>;
};

const TRACE_HEADER_NAME = "x-aidrive-trace-id";
const DIAGNOSTIC_TIMEOUT_MS = Math.max(600, Number(process.env.AIDRIVE_DIAGNOSTIC_TIMEOUT_MS ?? 1500));

type DiagnosticEventRecord = {
  id: string;
  ts: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  component: string;
  eventName: string;
  message: string;
  workspaceId: string | null;
  requestId: string | null;
  traceId: string | null;
  fingerprint: string;
  context: Record<string, string | number | boolean | null>;
};

function compactMessage(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 320) return compact;
  return `${compact.slice(0, 319)}…`;
}

function hashFingerprint(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `diag_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeRoute(routeRaw: string): string {
  const segments = routeRaw
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ":n";
      if (/^[a-f0-9-]{8,}$/i.test(segment)) return ":id";
      if (/^[A-Za-z0-9_-]{16,}$/.test(segment)) return ":id";
      return segment.toLowerCase();
    });
  return segments.join("/");
}

function normalizeModel(modelRaw: string): string {
  return modelRaw.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 64);
}

function toScalar(value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length <= 280 ? compact : `${compact.slice(0, 279)}…`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function compactContext(input: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    const scalar = toScalar(value);
    if (scalar !== null) {
      out[key] = scalar;
      continue;
    }
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (Array.isArray(value) || typeof value === "object") {
      try {
        const encoded = JSON.stringify(value);
        out[key] = encoded.length <= 280 ? encoded : `${encoded.slice(0, 279)}…`;
      } catch {
        out[key] = null;
      }
    }
  }
  return out;
}

function diagnosticApiTargets(): string[] {
  const fromEnv = [
    process.env.AIDRIVE_DIAGNOSTICS_API_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.API_BASE_URL
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  const apiPort = process.env.API_PORT?.trim() || "4100";
  const fallback = [
    `http://127.0.0.1:${apiPort}`,
    "http://127.0.0.1:4100",
    "http://127.0.0.1:4000"
  ];

  const targets = [...fromEnv, ...fallback]
    .map((value) => value.endsWith("/") ? value.slice(0, -1) : value)
    .filter((value, index, list) => list.indexOf(value) === index);
  return targets;
}

function diagnosticsDataDirectory(): string {
  const configured = process.env.AIDRIVE_DATA_DIR;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return path.resolve(configured.trim());
  }
  return path.join(process.cwd(), "apps", "api", ".data");
}

function diagnosticsEventFilePath(dateIso: string): string {
  const day = dateIso.slice(0, 10);
  const directory = path.join(diagnosticsDataDirectory(), "diagnostics");
  return path.join(directory, `events-${day}.ndjson`);
}

function buildEventRecord(input: ServerDiagnosticInput): DiagnosticEventRecord {
  const ts = new Date().toISOString();
  const context = compactContext(input.context);
  const errorCode = typeof context.errorCode === "string"
    ? context.errorCode.toLowerCase()
    : (typeof context.statusCode === "number" ? `http_${context.statusCode}` : "none");
  const route = typeof context.route === "string" ? normalizeRoute(context.route) : "none";
  const model = typeof context.model === "string" ? normalizeModel(context.model) : "none";
  const fingerprint = hashFingerprint(`${input.component.toLowerCase()}|${input.category.toLowerCase()}|${errorCode}|${route}|${model}`);

  return {
    id: randomUUID(),
    ts,
    severity: input.severity,
    category: input.category,
    component: input.component,
    eventName: input.eventName,
    message: compactMessage(input.message),
    workspaceId: input.workspaceId ?? null,
    requestId: input.requestId ?? null,
    traceId: input.traceId ?? null,
    fingerprint,
    context
  };
}

function appendLocalDiagnosticRecord(event: DiagnosticEventRecord): void {
  const filePath = diagnosticsEventFilePath(event.ts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

async function postDiagnosticIngest(baseUrl: string, payload: DiagnosticEventRecord): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIAGNOSTIC_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/diagnostics/ingest`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-user-id": "user_demo",
        [TRACE_HEADER_NAME]: payload.traceId ?? payload.id
      },
      body: JSON.stringify({
        severity: payload.severity,
        category: payload.category,
        component: payload.component,
        eventName: payload.eventName,
        message: payload.message,
        workspaceId: payload.workspaceId,
        requestId: payload.requestId,
        traceId: payload.traceId,
        context: payload.context
      })
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function createServerTraceId(headerValue?: string | null): string {
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim().slice(0, 120);
  }
  return randomUUID();
}

export async function emitServerDiagnostic(input: ServerDiagnosticInput): Promise<void> {
  const event = buildEventRecord(input);
  const targets = diagnosticApiTargets();
  for (const target of targets) {
    const posted = await postDiagnosticIngest(target, event);
    if (posted) return;
  }

  try {
    appendLocalDiagnosticRecord(event);
  } catch {
    // Ignore telemetry fallback failures.
  }
}
