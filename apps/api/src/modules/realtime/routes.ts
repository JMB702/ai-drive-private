import type { FastifyInstance, FastifyRequest } from "fastify";
import { TRACE_HEADER_NAME } from "../../lib/diagnostics/types.js";

function headerTraceId(request: FastifyRequest): string {
  const value = request.headers[TRACE_HEADER_NAME];
  if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 120);
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    if (typeof first === "string") return first.trim().slice(0, 120);
  }
  return request.id;
}

export async function registerRealtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/realtime/jobs/stream", async (request, reply) => {
    const traceId = headerTraceId(request);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      [TRACE_HEADER_NAME]: traceId
    });

    let closed = false;

    const closeStream = (reason: string, error?: unknown, workspaceId: string | null = null): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      app.ctx.runtime.jobSubscribers.delete(listener as (job: any) => void);
      app.ctx.diagnostics.ingest({
        severity: reason === "client_disconnect" ? "INFO" : "WARN",
        category: "REALTIME",
        component: "realtime.sse",
        eventName: reason,
        message: reason === "client_disconnect"
          ? "Realtime SSE client disconnected"
          : "Realtime SSE stream closed due to error",
        workspaceId,
        requestId: request.id,
        traceId,
        context: {
          route: "/v1/realtime/jobs/stream",
          reason,
          error: error instanceof Error ? error.message : (error ? String(error) : null)
        }
      });
      try {
        reply.raw.end();
      } catch {
        // Socket is already gone.
      }
    };

    const safeWrite = (chunk: string, eventName: string, workspaceId: string | null = null): boolean => {
      if (closed) return false;
      try {
        reply.raw.write(chunk);
        return true;
      } catch (error) {
        app.ctx.diagnostics.ingest({
          severity: "WARN",
          category: "REALTIME",
          component: "realtime.sse",
          eventName,
          message: "Realtime SSE write failed",
          workspaceId,
          requestId: request.id,
          traceId,
          context: {
            route: "/v1/realtime/jobs/stream",
            error: error instanceof Error ? error.message : String(error)
          }
        });
        closeStream(eventName, error, workspaceId);
        return false;
      }
    };

    app.ctx.diagnostics.ingest({
      severity: "INFO",
      category: "REALTIME",
      component: "realtime.sse",
      eventName: "realtime.sse.connected",
      message: "Realtime SSE client connected",
      requestId: request.id,
      traceId,
      context: {
        route: "/v1/realtime/jobs/stream"
      }
    });

    const heartbeat = setInterval(() => {
      safeWrite(": heartbeat\n\n", "realtime.sse.heartbeat_failed");
    }, 15_000);

    const listener = (job: unknown) => {
      const workspaceId = (
        job &&
        typeof job === "object" &&
        typeof (job as { workspaceId?: unknown }).workspaceId === "string"
      )
        ? String((job as { workspaceId?: string }).workspaceId)
        : null;

      if (!safeWrite("event: job.update\n", "realtime.sse.write_failed", workspaceId)) return;
      safeWrite(`data: ${JSON.stringify(job)}\n\n`, "realtime.sse.write_failed", workspaceId);
    };

    app.ctx.runtime.jobSubscribers.add(listener as (job: any) => void);

    reply.raw.on("close", () => {
      closeStream("client_disconnect");
    });

    reply.raw.on("error", (error) => {
      closeStream("realtime.sse.stream_error", error);
    });
  });
}
