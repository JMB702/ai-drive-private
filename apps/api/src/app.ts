import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "path";
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
import { createAdapters } from "./providers/adapters.js";
import { createContext } from "./lib/context.js";
import { seedData } from "./lib/seed.js";
import { DomainError } from "./lib/errors.js";
import { loadEnv } from "./config/env.js";
import { loadPersistedStore, persistedStorePrimaryPath, savePersistedStore, savePersistedStoreAsync } from "./lib/persistence.js";

export async function buildApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: true,
    bodyLimit: env.API_BODY_LIMIT_MB * 1024 * 1024
  });
  await app.register(cors, { origin: true });

  const ctx = createContext(createAdapters(env));
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
        } catch (error) {
          app.log.error(error);
        }
      }
    } else {
      seedData(ctx, { sampleProjectCount: seedProjectCount });
    }
  }

  let persistenceTimer: ReturnType<typeof setInterval> | null = null;
  let persistStore: (() => Promise<void>) | null = null;
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
      } catch (error) {
        app.log.error(error);
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

  app.addHook("onClose", async () => {
    if (persistenceTimer) {
      clearInterval(persistenceTimer);
      persistenceTimer = null;
    }
    if (persistenceDisabled) return;
    try {
      if (persistStore) {
        await persistStore();
      } else {
        savePersistedStore(ctx.store);
      }
    } catch (error) {
      app.log.error(error);
    }
  });

  app.decorate("ctx", ctx);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      reply.status(error.statusCode).send({ error: error.message });
      return;
    }
    if ((error as any).name === "ZodError") {
      reply.status(400).send({ error: "Invalid request", details: (error as any).issues });
      return;
    }
    const knownStatusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof knownStatusCode === "number" && knownStatusCode >= 400 && knownStatusCode < 500) {
      if ((error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
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
    app.log.error(error);
    reply.status(500).send({ error: "Internal server error" });
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
  await registerAdminRoutes(app);

  return app;
}
