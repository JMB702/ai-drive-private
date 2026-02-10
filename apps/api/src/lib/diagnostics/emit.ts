import type { DiagnosticEvent } from "@aidrive/shared";
import { randomUUID } from "crypto";
import {
  type DiagnosticEmitInput,
  type DiagnosticEmitResult,
  type DiagnosticsIngestInput,
  nowIso
} from "./types.js";
import { redactDiagnosticContext } from "./redact.js";
import { buildDiagnosticFingerprint, processDiagnosticEvent } from "./incident-engine.js";
import { appendDiagnosticEvent, pruneDiagnosticEventFiles } from "./store.js";

type LogLike = {
  debug: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

function toEvent(input: DiagnosticsIngestInput): DiagnosticEvent {
  const ts = nowIso();
  const context = input.context ?? {};
  return {
    id: randomUUID(),
    ts,
    severity: input.severity,
    category: input.category,
    component: input.component,
    eventName: input.eventName,
    message: input.message,
    workspaceId: input.workspaceId ?? null,
    requestId: input.requestId ?? null,
    traceId: input.traceId ?? null,
    fingerprint: buildDiagnosticFingerprint({
      component: input.component,
      category: input.category,
      context
    }),
    context
  };
}

export class DiagnosticsEmitter {
  constructor(private readonly log: LogLike | null = null) {}

  emit(input: DiagnosticEmitInput): DiagnosticEmitResult | null {
    try {
      const redactedContext = redactDiagnosticContext(input.context);
      const event = toEvent({
        severity: input.severity,
        category: input.category,
        component: input.component,
        eventName: input.eventName,
        message: input.message,
        workspaceId: input.workspaceId ?? null,
        requestId: input.requestId ?? null,
        traceId: input.traceId ?? null,
        context: redactedContext
      });
      appendDiagnosticEvent(event);
      pruneDiagnosticEventFiles();
      const incident = processDiagnosticEvent(event);
      this.log?.debug(
        {
          eventId: event.id,
          eventName: event.eventName,
          severity: event.severity,
          category: event.category,
          incidentId: incident?.id ?? null
        },
        "diagnostics event emitted"
      );
      return { event, incident };
    } catch (error) {
      this.log?.error(error, "diagnostics emit failure");
      return null;
    }
  }

  ingest(input: DiagnosticsIngestInput): DiagnosticEmitResult | null {
    try {
      const event = toEvent(input);
      appendDiagnosticEvent(event);
      pruneDiagnosticEventFiles();
      const incident = processDiagnosticEvent(event);
      this.log?.debug(
        {
          eventId: event.id,
          eventName: event.eventName,
          severity: event.severity,
          category: event.category,
          incidentId: incident?.id ?? null
        },
        "diagnostics event ingested"
      );
      return { event, incident };
    } catch (error) {
      this.log?.error(error, "diagnostics ingest failure");
      return null;
    }
  }
}

