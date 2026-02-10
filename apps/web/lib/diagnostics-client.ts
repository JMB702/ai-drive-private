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

export type ClientDiagnosticInput = {
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

const DIAGNOSTIC_INGEST_PATH = "/api/proxy/v1/diagnostics/ingest";
const DEFAULT_WORKSPACE_ID = "ws_demo";
const TRACE_HEADER_NAME = "x-aidrive-trace-id";

function compactMessage(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 320) return compact;
  return `${compact.slice(0, 319)}…`;
}

export function createTraceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function postClientDiagnostic(input: ClientDiagnosticInput): Promise<void> {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const traceId = input.traceId ?? createTraceId();
  try {
    await fetch(DIAGNOSTIC_INGEST_PATH, {
      method: "POST",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        "x-user-id": "user_demo",
        [TRACE_HEADER_NAME]: traceId
      },
      body: JSON.stringify({
        severity: input.severity,
        category: input.category,
        component: input.component,
        eventName: input.eventName,
        message: compactMessage(input.message),
        workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
        requestId: input.requestId ?? null,
        traceId,
        context: input.context
      })
    });
  } catch {
    // Diagnostics must not break UI actions.
  }
}
