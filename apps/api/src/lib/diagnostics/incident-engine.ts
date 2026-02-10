import { randomUUID } from "crypto";
import type { DiagnosticContext, DiagnosticsIndexFile } from "./types.js";
import {
  type DiagnosticEvent,
  type DiagnosticIncident,
  type DiagnosticIncidentPrompts,
  type DiagnosticSeverity,
  type IncidentStatus
} from "@aidrive/shared";
import {
  DIAGNOSTICS_RETENTION_DAYS,
  IMMEDIATE_OPEN_SEVERITIES,
  WARN_THRESHOLD_COUNT,
  WARN_THRESHOLD_WINDOW_MS,
  inferCauseStatusFromContext,
  isWarnThresholdEvent,
  maxSeverity,
  severityRank
} from "./types.js";
import {
  getDiagnosticIncidentById,
  listDiagnosticEvents,
  readDiagnosticsIndex,
  writeDiagnosticsIndex
} from "./store.js";
import { buildIncidentPrompts } from "./agent-prompts.js";

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

export function buildDiagnosticFingerprint(event: {
  component: string;
  category: string;
  context: DiagnosticContext;
}): string {
  const component = event.component.trim().toLowerCase();
  const category = event.category.trim().toLowerCase();
  const errorCode = typeof event.context.errorCode === "string"
    ? event.context.errorCode.toLowerCase()
    : (typeof event.context.statusCode === "number" ? `http_${event.context.statusCode}` : "none");
  const route = typeof event.context.route === "string" ? normalizeRoute(event.context.route) : "none";
  const model = typeof event.context.model === "string" ? normalizeModel(event.context.model) : "none";
  return hashFingerprint(`${component}|${category}|${errorCode}|${route}|${model}`);
}

function retentionCutoff(nowMs: number): number {
  return nowMs - (DIAGNOSTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function pruneStaleIndexData(index: DiagnosticsIndexFile, nowMs: number): void {
  const cutoff = retentionCutoff(nowMs);

  index.incidents = index.incidents.filter((incident) => Date.parse(incident.lastSeen) >= cutoff);

  const nextWarnMap: Record<string, string[]> = {};
  for (const [fingerprint, timestamps] of Object.entries(index.recentWarnByFingerprint)) {
    const kept = timestamps.filter((iso) => {
      const ts = Date.parse(iso);
      return Number.isFinite(ts) && ts >= cutoff;
    });
    if (kept.length > 0) {
      nextWarnMap[fingerprint] = kept;
    }
  }
  index.recentWarnByFingerprint = nextWarnMap;
}

function shouldOpenForWarn(event: DiagnosticEvent, index: DiagnosticsIndexFile): boolean {
  if (event.severity !== "WARN") return false;
  if (!isWarnThresholdEvent(event.eventName)) return false;

  const nowMs = Date.parse(event.ts);
  const existing = index.recentWarnByFingerprint[event.fingerprint] ?? [];
  const next = [...existing, event.ts].filter((iso) => {
    const ts = Date.parse(iso);
    return Number.isFinite(ts) && (nowMs - ts) <= WARN_THRESHOLD_WINDOW_MS;
  });
  index.recentWarnByFingerprint[event.fingerprint] = next;
  return next.length >= WARN_THRESHOLD_COUNT;
}

function createIncidentFromEvent(event: DiagnosticEvent): DiagnosticIncident {
  const title = `${event.component}: ${event.message}`.slice(0, 160);
  return {
    id: randomUUID(),
    fingerprint: event.fingerprint,
    status: "OPEN",
    severity: event.severity,
    causeStatus: inferCauseStatusFromContext(event.context),
    title,
    firstSeen: event.ts,
    lastSeen: event.ts,
    count: 1,
    latestEventId: event.id
  };
}

function findActiveIncident(index: DiagnosticsIndexFile, fingerprint: string): DiagnosticIncident | null {
  const active = index.incidents.filter((incident) =>
    incident.fingerprint === fingerprint &&
    (incident.status === "OPEN" || incident.status === "ACKED")
  );
  if (active.length === 0) return null;
  active.sort((left, right) => Date.parse(right.lastSeen) - Date.parse(left.lastSeen));
  return active[0] ?? null;
}

function mergeEventIntoIncident(incident: DiagnosticIncident, event: DiagnosticEvent): void {
  incident.lastSeen = event.ts;
  incident.latestEventId = event.id;
  incident.count += 1;
  incident.severity = maxSeverity(incident.severity, event.severity);
  incident.causeStatus = inferCauseStatusFromContext(event.context);
  if (severityRank(event.severity) >= severityRank(incident.severity)) {
    incident.title = `${event.component}: ${event.message}`.slice(0, 160);
  }
}

export function processDiagnosticEvent(event: DiagnosticEvent): DiagnosticIncident | null {
  const nowMs = Date.parse(event.ts);
  const index = readDiagnosticsIndex();
  pruneStaleIndexData(index, Number.isFinite(nowMs) ? nowMs : Date.now());

  const existing = findActiveIncident(index, event.fingerprint);
  const immediateOpen = IMMEDIATE_OPEN_SEVERITIES.has(event.severity);
  const warnOpen = shouldOpenForWarn(event, index);

  if (existing) {
    mergeEventIntoIncident(existing, event);
    writeDiagnosticsIndex(index);
    return existing;
  }

  if (!immediateOpen && !warnOpen) {
    writeDiagnosticsIndex(index);
    return null;
  }

  const created = createIncidentFromEvent(event);
  index.incidents.unshift(created);
  writeDiagnosticsIndex(index);
  return created;
}

export function patchDiagnosticIncidentStatus(incidentId: string, status: IncidentStatus): DiagnosticIncident | null {
  const index = readDiagnosticsIndex();
  const incident = index.incidents.find((item) => item.id === incidentId);
  if (!incident) return null;
  incident.status = status;
  incident.lastSeen = new Date().toISOString();
  writeDiagnosticsIndex(index);
  return incident;
}

function incidentEventsByFingerprint(incident: DiagnosticIncident): DiagnosticEvent[] {
  const { events } = listDiagnosticEvents({
    fingerprint: incident.fingerprint,
    limit: 500
  });
  return events;
}

function timelineSummary(events: DiagnosticEvent[]): string {
  if (events.length === 0) return "No events found for this incident fingerprint.";
  const sorted = [...events].sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  const recent = sorted.slice(-30);
  return recent.map((event) => {
    const route = typeof event.context.route === "string" ? ` route=${event.context.route}` : "";
    const model = typeof event.context.model === "string" ? ` model=${event.context.model}` : "";
    const statusCode = typeof event.context.statusCode === "number" ? ` status=${event.context.statusCode}` : "";
    const errorCode = typeof event.context.errorCode === "string" ? ` code=${event.context.errorCode}` : "";
    const latency = typeof event.context.latencyMs === "number" ? ` latencyMs=${event.context.latencyMs}` : "";
    return `${event.ts} [${event.severity}] ${event.component}.${event.eventName}: ${event.message}${route}${model}${statusCode}${errorCode}${latency}`;
  }).join("\n");
}

type IncidentToolRollup = {
  used: number;
  success: number;
  errors: number;
  helpful: number;
  needsImprovement: number;
  lastUsedAt: string | null;
  lastFeedbackAt: string | null;
  latestImprovement: string | null;
};

function toolNameFromContext(event: DiagnosticEvent): string {
  const raw = event.context.tool;
  if (typeof raw !== "string") return "unknown_tool";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 60) : "unknown_tool";
}

function helpfulFromContext(event: DiagnosticEvent): boolean | null {
  const raw = event.context.helpful;
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function improvementFromContext(event: DiagnosticEvent): string | null {
  const raw = event.context.improvementSuggestion;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 280) : null;
}

function emptyToolRollup(): IncidentToolRollup {
  return {
    used: 0,
    success: 0,
    errors: 0,
    helpful: 0,
    needsImprovement: 0,
    lastUsedAt: null,
    lastFeedbackAt: null,
    latestImprovement: null
  };
}

function incidentToolFeedbackSummary(incidentId: string): string {
  const { events } = listDiagnosticEvents({
    incidentId,
    limit: 500
  });
  if (events.length === 0) return "No tool usage or feedback recorded for this incident.";

  const sorted = [...events].sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  const byTool = new Map<string, IncidentToolRollup>();
  for (const event of sorted) {
    if (event.eventName !== "diagnostics.tool.used" && event.eventName !== "diagnostics.tool.feedback") {
      continue;
    }
    const tool = toolNameFromContext(event);
    const rollup = byTool.get(tool) ?? emptyToolRollup();

    if (event.eventName === "diagnostics.tool.used") {
      rollup.used += 1;
      rollup.lastUsedAt = event.ts;
      const outcome = typeof event.context.outcome === "string" ? event.context.outcome : "unknown";
      if (outcome === "success") {
        rollup.success += 1;
      } else {
        rollup.errors += 1;
      }
    }

    if (event.eventName === "diagnostics.tool.feedback") {
      rollup.lastFeedbackAt = event.ts;
      const helpful = helpfulFromContext(event);
      if (helpful === true) {
        rollup.helpful += 1;
      } else {
        rollup.needsImprovement += 1;
      }
      if (helpful === false) {
        const improvement = improvementFromContext(event);
        if (improvement) {
          rollup.latestImprovement = improvement;
        }
      }
    }

    byTool.set(tool, rollup);
  }

  if (byTool.size === 0) {
    return "No tool usage or feedback recorded for this incident.";
  }

  return [...byTool.entries()].map(([tool, rollup]) => {
    const base = `tool=${tool} used=${rollup.used} success=${rollup.success} errors=${rollup.errors} helpful=${rollup.helpful} needsImprovement=${rollup.needsImprovement}`;
    const usedAt = rollup.lastUsedAt ? ` lastUsedAt=${rollup.lastUsedAt}` : "";
    const feedbackAt = rollup.lastFeedbackAt ? ` lastFeedbackAt=${rollup.lastFeedbackAt}` : "";
    const latestImprovement = rollup.latestImprovement ? ` latestImprovement=${rollup.latestImprovement}` : "";
    return `${base}${usedAt}${feedbackAt}${latestImprovement}`;
  }).join("\n");
}

export function buildIncidentPacket(incidentId: string): string | null {
  const incident = getDiagnosticIncidentById(incidentId);
  if (!incident) return null;
  const events = incidentEventsByFingerprint(incident);
  const prompts = buildIncidentPrompts(incident, events);
  const counts = {
    critical: events.filter((event) => event.severity === "CRITICAL").length,
    high: events.filter((event) => event.severity === "HIGH").length,
    warn: events.filter((event) => event.severity === "WARN").length,
    info: events.filter((event) => event.severity === "INFO").length
  };

  return [
    "AI Drive Incident Packet",
    `incidentId: ${incident.id}`,
    `fingerprint: ${incident.fingerprint}`,
    `status: ${incident.status}`,
    `severity: ${incident.severity}`,
    `causeStatus: ${incident.causeStatus}`,
    `title: ${incident.title}`,
    `count: ${incident.count}`,
    `firstSeen: ${incident.firstSeen}`,
    `lastSeen: ${incident.lastSeen}`,
    `latestEventId: ${incident.latestEventId}`,
    "",
    "severityBreakdown:",
    `critical: ${counts.critical}`,
    `high: ${counts.high}`,
    `warn: ${counts.warn}`,
    `info: ${counts.info}`,
    "",
    "whyThisMatters:",
    incident.causeStatus === "UNKNOWN"
      ? "Root cause is not yet known; investigation is required."
      : "Root cause classification is available from observed diagnostics.",
    "",
    "suggestedHotspots:",
    ...prompts.hotspots.map((path) => `- ${path}`),
    "",
    "PROMPT_TRIAGE_START",
    prompts.triage,
    "PROMPT_TRIAGE_END",
    "",
    "PROMPT_FIX_START",
    prompts.fix,
    "PROMPT_FIX_END",
    "",
    "PROMPT_VERIFY_START",
    prompts.verify,
    "PROMPT_VERIFY_END",
    "",
    "toolUsageFeedback:",
    incidentToolFeedbackSummary(incident.id),
    "",
    "timeline:",
    timelineSummary(events)
  ].join("\n");
}

export function buildIncidentAgentPrompts(incidentId: string): DiagnosticIncidentPrompts | null {
  const incident = getDiagnosticIncidentById(incidentId);
  if (!incident) return null;
  const events = incidentEventsByFingerprint(incident);
  return buildIncidentPrompts(incident, events);
}
