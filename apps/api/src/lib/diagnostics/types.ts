import type {
  CauseStatus,
  DiagnosticCategory,
  DiagnosticEvent,
  DiagnosticIncident,
  DiagnosticSeverity,
  IncidentStatus
} from "@aidrive/shared";

export type DiagnosticScalar = string | number | boolean | null;

export interface DiagnosticContext {
  [key: string]: DiagnosticScalar;
}

export interface DiagnosticEmitInput {
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  component: string;
  eventName: string;
  message: string;
  workspaceId?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  context?: Record<string, unknown>;
}

export interface DiagnosticEmitResult {
  event: DiagnosticEvent;
  incident: DiagnosticIncident | null;
}

export interface DiagnosticsIngestInput {
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  component: string;
  eventName: string;
  message: string;
  workspaceId?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  context?: DiagnosticContext;
}

export interface DiagnosticsIndexFile {
  version: number;
  incidents: DiagnosticIncident[];
  recentWarnByFingerprint: Record<string, string[]>;
}

export interface DiagnosticEventQuery {
  severity?: DiagnosticSeverity;
  category?: DiagnosticCategory;
  eventName?: string;
  incidentId?: string;
  since?: string;
  limit?: number;
  cursor?: string;
  fingerprint?: string;
}

export interface DiagnosticIncidentQuery {
  status?: IncidentStatus;
  severity?: DiagnosticSeverity;
  since?: string;
  limit?: number;
}

export type IncidentPatch = {
  status: IncidentStatus;
};

export const DIAGNOSTICS_RETENTION_DAYS = 30;
export const WARN_THRESHOLD_COUNT = 3;
export const WARN_THRESHOLD_WINDOW_MS = 5 * 60 * 1000;
export const TRACE_HEADER_NAME = "x-aidrive-trace-id";

export const IMMEDIATE_OPEN_SEVERITIES: ReadonlySet<DiagnosticSeverity> = new Set(["CRITICAL", "HIGH"]);

export const THRESHOLD_WARN_EVENT_TOKENS: readonly string[] = [
  "timeout",
  "rate_limit",
  "network",
  "fallback",
  "proxy"
];

export function severityRank(severity: DiagnosticSeverity): number {
  if (severity === "CRITICAL") return 4;
  if (severity === "HIGH") return 3;
  if (severity === "WARN") return 2;
  return 1;
}

export function maxSeverity(left: DiagnosticSeverity, right: DiagnosticSeverity): DiagnosticSeverity {
  return severityRank(left) >= severityRank(right) ? left : right;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function inferCauseStatusFromContext(context: DiagnosticContext): CauseStatus {
  const explicit = context.causeStatus;
  if (explicit === "KNOWN" || explicit === "UNKNOWN") return explicit;

  if (context.failureCategory === "UNKNOWN") return "UNKNOWN";
  if (context.rootCauseUnknown === true) return "UNKNOWN";
  if (context.errorCode === null && context.statusCode === null && context.provider === "unknown") return "UNKNOWN";
  return "KNOWN";
}

export function isWarnThresholdEvent(eventName: string): boolean {
  const normalized = eventName.trim().toLowerCase();
  return THRESHOLD_WARN_EVENT_TOKENS.some((token) => normalized.includes(token));
}
