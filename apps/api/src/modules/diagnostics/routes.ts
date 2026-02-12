import type { DiagnosticCategory, DiagnosticSeverity } from "@aidrive/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getActorId } from "../../lib/auth.js";
import {
  buildIncidentAgentPrompts,
  buildIncidentPacket,
  patchDiagnosticIncidentStatus
} from "../../lib/diagnostics/incident-engine.js";
import {
  parseAgentUsageReport,
  toolFeedbackContext,
  toolUsageContext
} from "../../lib/diagnostics/agent-report.js";
import { getDiagnosticIncidentById, listDiagnosticEvents, listDiagnosticIncidents } from "../../lib/diagnostics/store.js";
import { TRACE_HEADER_NAME } from "../../lib/diagnostics/types.js";
import { DomainError } from "../../lib/errors.js";

const diagnosticSeverities = ["INFO", "WARN", "HIGH", "CRITICAL"] as const;
const diagnosticCategories = [
  "GENERATION",
  "PROVIDER",
  "PROXY",
  "PERSISTENCE",
  "REALTIME",
  "CLIENT",
  "SUPERVISOR",
  "IMAGE_PROXY",
  "SYSTEM"
] as const;
const incidentStatuses = ["OPEN", "ACKED", "RESOLVED"] as const;

const incidentsQuerySchema = z.object({
  status: z.enum(incidentStatuses).optional(),
  severity: z.enum(diagnosticSeverities).optional(),
  since: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

const eventsQuerySchema = z.object({
  severity: z.enum(diagnosticSeverities).optional(),
  category: z.enum(diagnosticCategories).optional(),
  eventName: z.string().min(1).optional(),
  incidentId: z.string().min(1).optional(),
  since: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  cursor: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional()
});

const ingestPayloadSchema = z.object({
  severity: z.enum(diagnosticSeverities),
  category: z.enum(diagnosticCategories),
  component: z.string().min(2).max(120),
  eventName: z.string().min(2).max(120),
  message: z.string().min(2).max(500),
  workspaceId: z.string().min(1).max(120).optional().nullable(),
  requestId: z.string().min(1).max(120).optional().nullable(),
  traceId: z.string().min(1).max(120).optional().nullable(),
  context: z.record(z.unknown()).optional()
});

const agentReportToolSchema = z.object({
  tool: z.string().min(2).max(80),
  endpoint: z.string().min(1).max(200).optional(),
  purpose: z.string().min(1).max(200).optional(),
  outcome: z.string().min(2).max(40),
  helpfulnessScore: z.coerce.number().int().min(1).max(5).optional(),
  improvementSuggestion: z.string().min(1).max(280).optional(),
  autoImproved: z.boolean().optional(),
  deferred: z.boolean().optional(),
  deferNote: z.string().min(1).max(280).optional()
});

const agentReportSchema = z.object({
  agentId: z.string().min(1).max(120).optional().nullable(),
  reportText: z.string().min(1).max(20000).optional(),
  tools: z.array(agentReportToolSchema).max(200).optional(),
  diagnosticsEvidenceComplete: z.boolean().optional()
});

function headerToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 120);
  }
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    if (typeof first === "string") return first.trim().slice(0, 120);
  }
  return null;
}

function traceIdFromRequest(request: FastifyRequest): string | null {
  return headerToString(request.headers[TRACE_HEADER_NAME]);
}

function requireDiagnosticsAccess(app: FastifyInstance, request: FastifyRequest): string {
  const actorId = getActorId(request);
  const members = app.ctx.store.workspaceMembers;
  if (members.length === 0 && actorId === "user_demo") {
    return actorId;
  }
  const allowed = members.some((member) =>
    member.userId === actorId && (member.role === "OWNER" || member.role === "ADMIN")
  );
  if (!allowed) {
    throw new DomainError("Owner or admin access required", 403);
  }
  return actorId;
}

export async function registerDiagnosticsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/diagnostics/incidents", async (request) => {
    requireDiagnosticsAccess(app, request);
    const query = incidentsQuerySchema.parse(request.query ?? {});
    const incidents = listDiagnosticIncidents(query);
    return { incidents };
  });

  app.get("/v1/diagnostics/incidents/:incidentId", async (request, reply) => {
    requireDiagnosticsAccess(app, request);
    const { incidentId } = request.params as { incidentId: string };
    const incident = getDiagnosticIncidentById(incidentId);
    if (!incident) {
      return reply.status(404).send({ error: "Incident not found" });
    }
    return { incident };
  });

  app.post("/v1/diagnostics/incidents/:incidentId/ack", async (request, reply) => {
    requireDiagnosticsAccess(app, request);
    const { incidentId } = request.params as { incidentId: string };
    const incident = patchDiagnosticIncidentStatus(incidentId, "ACKED");
    if (!incident) {
      return reply.status(404).send({ error: "Incident not found" });
    }
    return { incident };
  });

  app.post("/v1/diagnostics/incidents/:incidentId/resolve", async (request, reply) => {
    requireDiagnosticsAccess(app, request);
    const { incidentId } = request.params as { incidentId: string };
    const incident = patchDiagnosticIncidentStatus(incidentId, "RESOLVED");
    if (!incident) {
      return reply.status(404).send({ error: "Incident not found" });
    }
    return { incident };
  });

  app.get("/v1/diagnostics/incidents/:incidentId/packet", async (request, reply) => {
    requireDiagnosticsAccess(app, request);
    const { incidentId } = request.params as { incidentId: string };
    const packet = buildIncidentPacket(incidentId);
    if (!packet) {
      return reply.status(404).send({ error: "Incident not found" });
    }
    return { packet };
  });

  app.post("/v1/diagnostics/incidents/:incidentId/agent-report", async (request, reply) => {
    requireDiagnosticsAccess(app, request);
    const { incidentId } = request.params as { incidentId: string };
    const incident = getDiagnosticIncidentById(incidentId);
    if (!incident) {
      return reply.status(404).send({ error: "Incident not found" });
    }

    const body = agentReportSchema.parse(request.body ?? {});
    const parsedFromText = body.reportText ? parseAgentUsageReport(body.reportText) : null;
    const tools = body.tools ?? parsedFromText?.tools ?? [];
    const evidenceComplete = typeof body.diagnosticsEvidenceComplete === "boolean"
      ? body.diagnosticsEvidenceComplete
      : (parsedFromText?.diagnosticsEvidenceComplete ?? null);
    const agentId = body.agentId ?? null;

    let usedEvents = 0;
    let feedbackEvents = 0;
    for (const tool of tools) {
      const usedResult = app.ctx.diagnostics.emit({
        severity: tool.outcome === "success" ? "INFO" : "WARN",
        category: "CLIENT",
        component: "agent.report",
        eventName: "diagnostics.tool.used",
        message: `Agent reported tool usage: ${tool.tool}`,
        workspaceId: "ws_demo",
        context: toolUsageContext(incidentId, tool, agentId)
      });
      if (usedResult?.event) usedEvents += 1;

      if (typeof tool.helpfulnessScore === "number" || typeof tool.improvementSuggestion === "string") {
        const feedbackResult = app.ctx.diagnostics.emit({
          severity: (tool.helpfulnessScore ?? 0) >= 4 ? "INFO" : "WARN",
          category: "CLIENT",
          component: "agent.report",
          eventName: "diagnostics.tool.feedback",
          message: `Agent reported tool feedback: ${tool.tool}`,
          workspaceId: "ws_demo",
          context: toolFeedbackContext(incidentId, tool, agentId)
        });
        if (feedbackResult?.event) feedbackEvents += 1;
      }
    }

    app.ctx.diagnostics.emit({
      severity: evidenceComplete === false ? "WARN" : "INFO",
      category: "SYSTEM",
      component: "agent.report",
      eventName: "diagnostics.agent.report",
      message: "Agent diagnostics usage report ingested",
      workspaceId: "ws_demo",
      context: {
        incidentId,
        agentId,
        toolCount: tools.length,
        usedEvents,
        feedbackEvents,
        diagnosticsEvidenceComplete: evidenceComplete
      }
    });

    return reply.code(202).send({
      accepted: true,
      incidentId,
      toolCount: tools.length,
      usedEvents,
      feedbackEvents,
      diagnosticsEvidenceComplete: evidenceComplete
    });
  });

  app.get("/v1/diagnostics/incidents/:incidentId/prompts", async (request, reply) => {
    requireDiagnosticsAccess(app, request);
    const { incidentId } = request.params as { incidentId: string };
    const prompts = buildIncidentAgentPrompts(incidentId);
    if (!prompts) {
      return reply.status(404).send({ error: "Incident not found" });
    }
    return { prompts };
  });

  app.get("/v1/diagnostics/events", async (request) => {
    requireDiagnosticsAccess(app, request);
    const query = eventsQuerySchema.parse(request.query ?? {});
    const { events, nextCursor } = listDiagnosticEvents(query);
    return { events, nextCursor };
  });

  app.post("/v1/diagnostics/ingest", async (request, reply) => {
    requireDiagnosticsAccess(app, request);
    const body = ingestPayloadSchema.parse(request.body ?? {});
    const traceId = body.traceId ?? traceIdFromRequest(request);
    const result = app.ctx.diagnostics.emit({
      severity: body.severity as DiagnosticSeverity,
      category: body.category as DiagnosticCategory,
      component: body.component,
      eventName: body.eventName,
      message: body.message,
      workspaceId: body.workspaceId ?? null,
      requestId: body.requestId ?? null,
      traceId,
      context: body.context
    });
    return reply.code(202).send({
      accepted: true,
      incidentId: result?.incident?.id ?? null,
      eventId: result?.event?.id ?? null
    });
  });
}
