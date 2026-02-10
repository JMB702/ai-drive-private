import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`API listening on ${env.PORT}`);
  app.ctx.diagnostics.emit({
    severity: "INFO",
    category: "SYSTEM",
    component: "api.server",
    eventName: "server.listen.started",
    message: "API server is listening",
    context: {
      host: "0.0.0.0",
      port: env.PORT
    }
  });
} catch (error) {
  app.ctx.diagnostics.emit({
    severity: "CRITICAL",
    category: "SYSTEM",
    component: "api.server",
    eventName: "server.listen.failed",
    message: "API server failed to listen",
    context: {
      host: "0.0.0.0",
      port: env.PORT,
      error: error instanceof Error ? error.message : String(error)
    }
  });
  app.log.error(error);
  process.exit(1);
}
