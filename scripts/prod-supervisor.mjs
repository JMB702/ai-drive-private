#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const API_PORT = process.env.API_PORT ?? "4100";
const WEB_PORT = process.env.WEB_PORT ?? process.env.PORT ?? "3000";

const SHUTTING_DOWN_EXIT_CODES = new Set([0, 130, 143]);
const HEALTH_INTERVAL_MS = 15_000;
const MAX_RESTART_DELAY_MS = 8_000;
const HEALTH_FAILURE_THRESHOLD = 3;
const HEALTH_TIMEOUT_MS = 10_000;

let stopping = false;

const services = [
  {
    key: "api",
    label: "@aidrive/api",
    command: "npm",
    args: ["run", "-w", "@aidrive/api", "start"],
    env: { PORT: API_PORT },
    child: null,
    restartCount: 0
  },
  {
    key: "web",
    label: "@aidrive/web",
    command: "npm",
    args: ["run", "-w", "@aidrive/web", "start"],
    env: { PORT: WEB_PORT },
    child: null,
    restartCount: 0
  }
];

const serviceByKey = new Map(services.map((service) => [service.key, service]));
const healthMissByService = {
  api: 0,
  web: 0
};

function log(message) {
  const stamp = new Date().toISOString();
  process.stdout.write(`[prod-supervisor ${stamp}] ${message}\n`);
}

function fail(message, error) {
  const details = error instanceof Error ? `${message}: ${error.message}` : message;
  process.stderr.write(`[prod-supervisor] ${details}\n`);
}

function startService(service) {
  if (stopping) return;
  const child = spawn(service.command, service.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, ...service.env },
    detached: true
  });
  service.child = child;
  log(`started ${service.label} (pid=${child.pid ?? "unknown"})`);

  child.on("exit", (code, signal) => {
    const expected = stopping || SHUTTING_DOWN_EXIT_CODES.has(code ?? -1);
    const reason = signal ? `signal=${signal}` : `code=${String(code)}`;
    log(`${service.label} exited (${reason})`);
    service.child = null;
    if (expected || stopping) return;

    service.restartCount += 1;
    const delayMs = Math.min(1000 + (service.restartCount - 1) * 800, MAX_RESTART_DELAY_MS);
    log(`restarting ${service.label} in ${delayMs}ms (restart #${service.restartCount})`);
    setTimeout(() => startService(service), delayMs);
  });

  child.on("error", (error) => {
    fail(`${service.label} process error`, error);
  });
}

function stopAll(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  log(`shutting down services with ${signal}`);
  for (const service of services) {
    if (!service.child || service.child.killed) continue;
    try {
      if (service.child.pid) {
        process.kill(-service.child.pid, signal);
      } else {
        service.child.kill(signal);
      }
    } catch (error) {
      fail(`failed to stop ${service.label}`, error);
    }
  }
}

function restartService(serviceKey, reason) {
  const service = serviceByKey.get(serviceKey);
  if (!service || !service.child || service.child.killed) return;
  log(`forcing restart for ${service.label} (${reason})`);
  try {
    if (service.child.pid) {
      process.kill(-service.child.pid, "SIGTERM");
    } else {
      service.child.kill("SIGTERM");
    }
  } catch (error) {
    fail(`failed to restart ${service.label}`, error);
  }
}

async function fetchResponse(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

let lastHealthSummary = "";
setInterval(async () => {
  if (stopping) return;
  const [apiResponse, webResponse] = await Promise.all([
    fetchResponse(`http://127.0.0.1:${API_PORT}/health`),
    fetchResponse(`http://127.0.0.1:${WEB_PORT}/api/health`)
  ]);
  const apiUp = Boolean(apiResponse?.ok);
  const webUp = Boolean(webResponse?.ok);

  healthMissByService.api = apiUp ? 0 : healthMissByService.api + 1;
  healthMissByService.web = webUp ? 0 : healthMissByService.web + 1;
  if (healthMissByService.api >= HEALTH_FAILURE_THRESHOLD) {
    healthMissByService.api = 0;
    restartService("api", `health check failed ${HEALTH_FAILURE_THRESHOLD}x`);
  }
  if (healthMissByService.web >= HEALTH_FAILURE_THRESHOLD) {
    healthMissByService.web = 0;
    restartService("web", `health check failed ${HEALTH_FAILURE_THRESHOLD}x`);
  }

  const summary = `health api=${apiUp ? "up" : "down"} web=${webUp ? "up" : "down"} url=http://0.0.0.0:${WEB_PORT}`;
  if (summary !== lastHealthSummary) {
    log(summary);
    lastHealthSummary = summary;
  }
}, HEALTH_INTERVAL_MS).unref();

process.on("SIGINT", () => {
  stopAll("SIGTERM");
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAll("SIGTERM");
  process.exit(0);
});
process.on("uncaughtException", (error) => {
  fail("uncaught exception in supervisor", error);
  stopAll("SIGTERM");
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  fail("unhandled rejection in supervisor", error);
  stopAll("SIGTERM");
  process.exit(1);
});

log(`booting production services (api:${API_PORT}, web:${WEB_PORT})`);
for (const service of services) {
  startService(service);
}
