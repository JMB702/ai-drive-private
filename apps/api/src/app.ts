import Fastify from "fastify";
import cors from "@fastify/cors";
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
import { createAdapters } from "./providers/adapters.js";
import { createContext } from "./lib/context.js";
import { seedData } from "./lib/seed.js";
import { DomainError } from "./lib/errors.js";
import { loadEnv } from "./config/env.js";
import { loadPersistedStore, savePersistedStore } from "./lib/persistence.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const env = loadEnv();
  const ctx = createContext(createAdapters(env));
  const persisted = loadPersistedStore();
  if (persisted) {
    Object.assign(ctx.store, persisted.store);
    app.log.info(`Loaded persisted store from ${persisted.sourcePath}`);
  } else {
    seedData(ctx);
  }

  const persistenceTimer = setInterval(() => {
    try {
      const savedPath = savePersistedStore(ctx.store);
      app.log.debug(`Persisted store to ${savedPath}`);
    } catch (error) {
      app.log.error(error);
    }
  }, 1500);
  persistenceTimer.unref();

  app.addHook("onClose", async () => {
    clearInterval(persistenceTimer);
    try {
      savePersistedStore(ctx.store);
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

  return app;
}
