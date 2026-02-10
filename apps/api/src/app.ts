import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "path";
import type { FastifyRequest } from "fastify";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerWorkspaceRoutes } from "./modules/workspace/routes.js";
import { registerDriveRoutes } from "./modules/drive/routes.js";
import { registerVersionRoutes } from "./modules/versions/routes.js";
import { registerGenerationRoutes } from "./modules/generation/routes.js";
import { registerSharingRoutes } from "./modules/sharing/routes.js";
import { registerBillingRoutes } from "./modules/billing/routes.js";
import { registerModerationRoutes } from "./modules/moderation/routes.js";
import { registerAuditRoutes } from "./modules/audit/routes.js";
import { registerRealtimeRoutes } from "./modules/realtime/routes.js";
import { registerPermissionRoutes } from "./modules/permissions/routes.js";
import { registerAdminRoutes } from "./modules/admin/routes.js";
import { registerUiRoutes } from "./modules/ui/routes.js";
import { registerDiagnosticsRoutes } from "./modules/diagnostics/routes.js";
import { configureProviderDiagnostics, createAdapters } from "./providers/adapters.js";
import { createContext } from "./lib/context.js";
import { seedData } from "./lib/seed.js";
import { DomainError } from "./lib/errors.js";
import { loadEnv } from "./config/env.js";
import {
  loadPersistedStore,
  persistedStorePrimaryPath,
  savePersistedStore,
  savePersistedStoreAsync,
  setPersistenceDiagnosticsHook
} from "./lib/persistence.js";
import { DiagnosticsEmitter } from "./lib/diagnostics/emit.js";
import { TRACE_HEADER_NAME } from "./lib/diagnostics/types.js";
import { setMediaPreviewDiagnosticsHook } from "./lib/media-preview.js";

type RequestWithDiagnostics = FastifyRequest & {
  __diagnosticsStartMs?: number;
  __traceId?: string;
};

function headerToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 120);
  }
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    if (typeof first === "string") {
      return first.trim().slice(0, 120);
    }
  }
  return null;
}

function routeLabel(request: FastifyRequest): string {
  const options = (request as { routeOptions?: { url?: string } }).routeOptions;
  if (options?.url && options.url.length > 0) return options.url;
  return request.url;
}

function requestTraceId(request: FastifyRequest): string {
  const typed = request as RequestWithDiagnostics;
  if (typed.__traceId && typed.__traceId.length > 0) {
    return typed.__traceId;
  }
  return request.id;
}

function requestWorkspaceId(request: FastifyRequest): string | null {
  const sources: unknown[] = [
    request.params,
    request.query,
    (request as { body?: unknown }).body
  ];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const candidate = (source as Record<string, unknown>).workspaceId;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 280);
  }
  return String(error).slice(0, 280);
}

export async function buildApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: true,
    bodyLimit: env.API_BODY_LIMIT_MB * 1024 * 1024
  });
  await app.register(cors, { origin: true });

  const diagnostics = new DiagnosticsEmitter(app.log);
  configureProviderDiagnostics((event) => {
    const provider = typeof event.context?.provider === "string" ? event.context.provider : "unknown";
    diagnostics.emit({
      severity: event.severity,
      category: "PROVIDER",
      component: `provider.${provider}`,
      eventName: event.eventName,
      message: event.message,
      workspaceId: event.workspaceId,
      traceId: event.traceId ?? null,
      context: event.context
    });
  });

  setPersistenceDiagnosticsHook((event) => {
    diagnostics.emit({
      severity: "WARN",
      category: "PERSISTENCE",
      component: "api.persistence",
      eventName: event.eventName,
      message: event.message,
      context: event.context
    });
  });

  setMediaPreviewDiagnosticsHook((event) => {
    diagnostics.emit({
      severity: "WARN",
      category: "GENERATION",
      component: "media.preview",
      eventName: event.eventName,
      message: event.message,
      context: event.context
    });
  });

  const adapters = createAdapters(env);
  const ctx = createContext(adapters, diagnostics);
  const allowSampleSeed = process.env.AIDRIVE_SEED_SAMPLE_DATA === "1" || env.NODE_ENV !== "production";
  const seedProjectCount = allowSampleSeed ? 8 : 0;
  const persistenceDisabled = process.env.AIDRIVE_DISABLE_PERSISTENCE === "1";

  if (persistenceDisabled) {
    seedData(ctx, { sampleProjectCount: seedProjectCount });
    app.log.info("Store persistence disabled (AIDRIVE_DISABLE_PERSISTENCE=1)");
  } else {
    const persisted = loadPersistedStore();
    if (persisted) {
      Object.assign(ctx.store, persisted.store);
      app.log.info(`Loaded persisted store from ${persisted.sourcePath}`);
      const preferredStorePath = persistedStorePrimaryPath();
      if (path.resolve(persisted.sourcePath) !== path.resolve(preferredStorePath)) {
        try {
          const migratedPath = savePersistedStore(ctx.store);
          app.log.warn(`Migrated persisted store to ${migratedPath} (legacy source was ${persisted.sourcePath})`);
          diagnostics.emit({
            severity: "WARN",
            category: "PERSISTENCE",
            component: "api.persistence",
            eventName: "persistence.store.migrated",
            message: "Persisted store migrated from legacy path",
            context: {
              sourcePath: persisted.sourcePath,
              migratedPath
            }
          });
        } catch (error) {
          app.log.error(error);
          diagnostics.emit({
            severity: "HIGH",
            category: "PERSISTENCE",
            component: "api.persistence",
            eventName: "persistence.store.migration_failed",
            message: "Persisted store migration failed",
            context: {
              sourcePath: persisted.sourcePath,
              targetPath: preferredStorePath,
              error: errorMessage(error)
            }
          });
        }
      }
    } else {
      seedData(ctx, { sampleProjectCount: seedProjectCount });
    }
  }

  app.decorate("ctx", ctx);

  app.addHook("onRequest", async (request, reply) => {
    const typed = request as RequestWithDiagnostics;
    typed.__diagnosticsStartMs = Date.now();
    typed.__traceId = headerToString(request.headers[TRACE_HEADER_NAME]) ?? request.id;
    reply.header(TRACE_HEADER_NAME, typed.__traceId);

    if (request.url === "/health") return;
    diagnostics.ingest({
      severity: "INFO",
      category: "SYSTEM",
      component: "api.request",
      eventName: "request.received",
      message: "HTTP request received",
      workspaceId: requestWorkspaceId(request),
      requestId: request.id,
      traceId: typed.__traceId,
      context: {
        method: request.method,
        route: routeLabel(request)
      }
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    if (request.url === "/health") return;
    const typed = request as RequestWithDiagnostics;
    const startMs = typed.__diagnosticsStartMs ?? Date.now();
    const latencyMs = Math.max(0, Date.now() - startMs);
    const statusCode = reply.statusCode;
    if (statusCode < 500 && latencyMs < 5_000) return;

    diagnostics.ingest({
      severity: statusCode >= 500 ? "HIGH" : "WARN",
      category: "SYSTEM",
      component: "api.request",
      eventName: statusCode >= 500 ? "request.response.server_error" : "request.response.slow",
      message: statusCode >= 500
        ? "Request completed with server error"
        : "Request latency exceeded threshold",
      workspaceId: requestWorkspaceId(request),
      requestId: request.id,
      traceId: requestTraceId(request),
      context: {
        method: request.method,
        route: routeLabel(request),
        statusCode,
        latencyMs
      }
    });
  });

  let persistenceTimer: ReturnType<typeof setInterval> | null = null;
  let persistStore: (() => Promise<void>) | null = null;
  let persistenceConsecutiveFailures = 0;
  let persistenceSuccessCount = 0;

  if (!persistenceDisabled) {
    let persistInFlight = false;
    let persistQueued = false;
    persistStore = async (): Promise<void> => {
      if (persistInFlight) {
        persistQueued = true;
        return;
      }
      persistInFlight = true;
      try {
        const savedPath = await savePersistedStoreAsync(ctx.store);
        app.log.debug(`Persisted store to ${savedPath}`);
        persistenceSuccessCount += 1;
        if (persistenceConsecutiveFailures > 0) {
          diagnostics.emit({
            severity: "WARN",
            category: "PERSISTENCE",
            component: "api.persistence",
            eventName: "persistence.save.recovered",
            message: "Persisted store save recovered after failures",
            context: {
              consecutiveFailures: persistenceConsecutiveFailures,
              totalSuccesses: persistenceSuccessCount,
              savedPath
            }
          });
        }
        persistenceConsecutiveFailures = 0;
      } catch (error) {
        persistenceConsecutiveFailures += 1;
        app.log.error(error);
        diagnostics.emit({
          severity: persistenceConsecutiveFailures >= 3 ? "HIGH" : "WARN",
          category: "PERSISTENCE",
          component: "api.persistence",
          eventName: "persistence.save.failure",
          message: "Persisted store save failed",
          context: {
            consecutiveFailures: persistenceConsecutiveFailures,
            persistQueued,
            error: errorMessage(error)
          }
        });
      } finally {
        persistInFlight = false;
      }
      if (persistQueued) {
        persistQueued = false;
        if (persistStore) {
          await persistStore();
        }
      }
    };

    persistenceTimer = setInterval(() => {
      if (persistStore) {
        void persistStore();
      }
    }, 10_000);
    persistenceTimer.unref();
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      reply.status(error.statusCode).send({ error: error.message });
      return;
    }
    if ((error as { name?: string }).name === "ZodError") {
      reply.status(400).send({ error: "Invalid request", details: (error as { issues?: unknown }).issues });
      return;
    }
    const knownStatusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof knownStatusCode === "number" && knownStatusCode >= 400 && knownStatusCode < 500) {
      if ((error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        diagnostics.ingest({
          severity: "WARN",
          category: "CLIENT",
          component: "api.error_handler",
          eventName: "request.body_too_large",
          message: "Request payload exceeded API body limit",
          workspaceId: requestWorkspaceId(request),
          requestId: request.id,
          traceId: requestTraceId(request),
          context: {
            method: request.method,
            route: routeLabel(request),
            statusCode: 413,
            errorCode: "FST_ERR_CTP_BODY_TOO_LARGE"
          }
        });
        reply.status(413).send({
          error: "Request payload too large",
          details: "Reference images are too large. Reduce count or image dimensions and retry."
        });
        return;
      }
      const message = error instanceof Error ? error.message : "Request failed";
      reply.status(knownStatusCode).send({ error: message || "Request failed" });
      return;
    }

    diagnostics.ingest({
      severity: "CRITICAL",
      category: "SYSTEM",
      component: "api.error_handler",
      eventName: "request.unhandled_error",
      message: "Unhandled server error reached Fastify error handler",
      workspaceId: requestWorkspaceId(request),
      requestId: request.id,
      traceId: requestTraceId(request),
      context: {
        method: request.method,
        route: routeLabel(request),
        statusCode: 500,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: errorMessage(error)
      }
    });

    app.log.error(error);
    reply.status(500).send({ error: "Internal server error" });
  });

  app.addHook("onClose", async () => {
    if (persistenceTimer) {
      clearInterval(persistenceTimer);
      persistenceTimer = null;
    }
    if (!persistenceDisabled) {
      try {
        if (persistStore) {
          await persistStore();
        } else {
          savePersistedStore(ctx.store);
        }
      } catch (error) {
        app.log.error(error);
        diagnostics.emit({
          severity: "HIGH",
          category: "PERSISTENCE",
          component: "api.persistence",
          eventName: "persistence.shutdown_save.failure",
          message: "Persisted store save failed during shutdown",
          context: {
            error: errorMessage(error)
          }
        });
      }
    }

    configureProviderDiagnostics(null);
    setPersistenceDiagnosticsHook(null);
    setMediaPreviewDiagnosticsHook(null);
  });

  app.get("/health", async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerWorkspaceRoutes(app);
  await registerDriveRoutes(app);
  await registerVersionRoutes(app);
  await registerGenerationRoutes(app);
  await registerSharingRoutes(app);
  await registerPermissionRoutes(app);
  await registerBillingRoutes(app);
  await registerModerationRoutes(app);
  await registerAuditRoutes(app);
  await registerRealtimeRoutes(app);
  await registerDiagnosticsRoutes(app);
  await registerAdminRoutes(app);
  await registerUiRoutes(app);

  return app;
}
