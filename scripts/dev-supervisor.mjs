#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseDotenvFile(filePath) {
  const parsed = {};
  if (!fs.existsSync(filePath)) {
    return parsed;
  }
  const source = fs.readFileSync(filePath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2] ?? "";
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

function buildBaseEnv(cwd) {
  const merged = { ...process.env };
  for (const relativePath of [".env", ".env.local"]) {
    const envPath = path.join(cwd, relativePath);
    const parsed = parseDotenvFile(envPath);
    for (const [key, value] of Object.entries(parsed)) {
      if (merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

const baseEnv = buildBaseEnv(process.cwd());
const API_PORT = baseEnv.API_PORT ?? "4100";
const WEB_PORT = baseEnv.WEB_PORT ?? "3000";
const API_BASE_URL = baseEnv.NEXT_PUBLIC_API_URL ?? `http://127.0.0.1:${API_PORT}`;

const SHUTTING_DOWN_EXIT_CODES = new Set([0, 130, 143]);
const HEALTH_INTERVAL_MS = 12000;
const MAX_RESTART_DELAY_MS = 5000;
const HEALTH_FAILURE_THRESHOLD = 3;
const HEALTH_TIMEOUT_MS = 8000;
const SUPERVISOR_DIAGNOSTIC_TIMEOUT_MS = 1500;

let stopping = false;

function diagnosticsDataDirectory() {
  const configured = process.env.AIDRIVE_DATA_DIR;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return path.resolve(configured.trim());
  }
  return path.join(process.cwd(), "apps", "api", ".data");
}

function diagnosticsEventFilePath(dateIso) {
  const day = dateIso.slice(0, 10);
  return path.join(diagnosticsDataDirectory(), "diagnostics", `events-${day}.ndjson`);
}

function hashFingerprint(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `diag_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compactValue(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length <= 280 ? compact : `${compact.slice(0, 279)}…`;
  }
  try {
    const encoded = JSON.stringify(value);
    if (!encoded) return null;
    return encoded.length <= 280 ? encoded : `${encoded.slice(0, 279)}…`;
  } catch {
    return null;
  }
}

function compactContext(input) {
  const context = {};
  if (!input || typeof input !== "object") return context;
  for (const [key, value] of Object.entries(input)) {
    const compact = compactValue(value);
    if (compact !== undefined) {
      context[key] = compact;
    }
  }
  return context;
}

function diagnosticApiTargets() {
  const fromEnv = [
    process.env.AIDRIVE_DIAGNOSTICS_API_URL,
    process.env.API_BASE_URL,
    process.env.NEXT_PUBLIC_API_URL
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)
    .map((value) => value.endsWith("/") ? value.slice(0, -1) : value);
  const fallback = [`http://127.0.0.1:${API_PORT}`, "http://127.0.0.1:4100", "http://127.0.0.1:4000"];
  return [...new Set([...fromEnv, ...fallback])];
}

function buildSupervisorEvent(input) {
  const ts = new Date().toISOString();
  const context = compactContext(input.context);
  const errorCode = typeof context.errorCode === "string"
    ? context.errorCode.toLowerCase()
    : (typeof context.statusCode === "number" ? `http_${context.statusCode}` : "none");
  const route = typeof context.route === "string" ? context.route.toLowerCase().replace(/\s+/g, "_") : "none";
  const model = typeof context.model === "string" ? context.model.toLowerCase().replace(/\s+/g, "_") : "none";
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ts,
    severity: input.severity,
    category: "SUPERVISOR",
    component: "supervisor.dev",
    eventName: input.eventName,
    message: input.message,
    workspaceId: null,
    requestId: null,
    traceId: null,
    fingerprint: hashFingerprint(`supervisor.dev|supervisor|${errorCode}|${route}|${model}`),
    context
  };
}

function appendLocalSupervisorEvent(event) {
  try {
    const filePath = diagnosticsEventFilePath(event.ts);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Best-effort diagnostic fallback.
  }
}

async function postSupervisorDiagnostic(targetBaseUrl, event) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPERVISOR_DIAGNOSTIC_TIMEOUT_MS);
  try {
    const response = await fetch(`${targetBaseUrl}/v1/diagnostics/ingest`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-user-id": "user_demo"
      },
      body: JSON.stringify({
        severity: event.severity,
        category: event.category,
        component: event.component,
        eventName: event.eventName,
        message: event.message,
        workspaceId: event.workspaceId,
        requestId: event.requestId,
        traceId: event.traceId,
        context: event.context
      })
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function emitSupervisorDiagnostic(input) {
  const event = buildSupervisorEvent(input);
  void (async () => {
    const targets = diagnosticApiTargets();
    for (const target of targets) {
      const ok = await postSupervisorDiagnostic(target, event);
      if (ok) return;
    }
    appendLocalSupervisorEvent(event);
  })();
}

const services = [
  {
    key: "api",
    label: "@aidrive/api",
    command: "npm",
    args: ["run", "-w", "@aidrive/api", "dev"],
    env: { PORT: API_PORT },
    child: null,
    restartCount: 0
  },
  {
    key: "web",
    label: "@aidrive/web",
    command: "npm",
    args: ["run", "-w", "@aidrive/web", "dev"],
    env: { NEXT_PUBLIC_API_URL: API_BASE_URL },
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
  process.stdout.write(`[dev-supervisor ${stamp}] ${message}\n`);
}

function fail(message, error) {
  const details = error instanceof Error ? `${message}: ${error.message}` : message;
  process.stderr.write(`[dev-supervisor] ${details}\n`);
}

function startService(service) {
  if (stopping) return;
  const child = spawn(service.command, service.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...baseEnv, ...service.env },
    detached: true
  });
  service.child = child;
  log(`started ${service.label} (pid=${child.pid ?? "unknown"})`);
  emitSupervisorDiagnostic({
    severity: "INFO",
    eventName: "supervisor.service.started",
    message: "Service started",
    context: {
      service: service.key,
      label: service.label,
      pid: child.pid ?? null,
      restartCount: service.restartCount
    }
  });

  child.on("exit", (code, signal) => {
    const expected = stopping || SHUTTING_DOWN_EXIT_CODES.has(code ?? -1);
    const reason = signal ? `signal=${signal}` : `code=${String(code)}`;
    log(`${service.label} exited (${reason})`);
    emitSupervisorDiagnostic({
      severity: expected ? "INFO" : "WARN",
      eventName: expected ? "supervisor.service.exited_expected" : "supervisor.service.exited_unexpected",
      message: expected ? "Service exited" : "Service exited unexpectedly",
      context: {
        service: service.key,
        label: service.label,
        signal: signal ?? null,
        code: typeof code === "number" ? code : null,
        expected
      }
    });
    service.child = null;
    if (expected || stopping) return;

    service.restartCount += 1;
    const delayMs = Math.min(1000 + (service.restartCount - 1) * 600, MAX_RESTART_DELAY_MS);
    log(`restarting ${service.label} in ${delayMs}ms (restart #${service.restartCount})`);
    emitSupervisorDiagnostic({
      severity: "HIGH",
      eventName: "supervisor.service.restart_scheduled",
      message: "Service restart scheduled after unexpected exit",
      context: {
        service: service.key,
        label: service.label,
        restartCount: service.restartCount,
        delayMs
      }
    });
    setTimeout(() => startService(service), delayMs);
  });

  child.on("error", (error) => {
    fail(`${service.label} process error`, error);
    emitSupervisorDiagnostic({
      severity: "HIGH",
      eventName: "supervisor.service.process_error",
      message: "Child process emitted error event",
      context: {
        service: service.key,
        label: service.label,
        error: error instanceof Error ? error.message : String(error)
      }
    });
  });
}

function stopAll(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  log(`shutting down services with ${signal}`);
  emitSupervisorDiagnostic({
    severity: "INFO",
    eventName: "supervisor.shutdown",
    message: "Supervisor is shutting down services",
    context: {
      signal
    }
  });
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
  emitSupervisorDiagnostic({
    severity: "HIGH",
    eventName: "supervisor.service.restart_forced",
    message: "Supervisor forced service restart",
    context: {
      service: service.key,
      label: service.label,
      reason
    }
  });
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
    fetchResponse(`http://127.0.0.1:${WEB_PORT}/`)
  ]);
  const apiUp = Boolean(apiResponse?.ok);
  const webUp = Boolean(webResponse);

  healthMissByService.api = apiUp ? 0 : healthMissByService.api + 1;
  healthMissByService.web = webUp ? 0 : healthMissByService.web + 1;
  if (healthMissByService.api >= HEALTH_FAILURE_THRESHOLD) {
    healthMissByService.api = 0;
    emitSupervisorDiagnostic({
      severity: "WARN",
      eventName: "supervisor.health.failure_threshold",
      message: "API health check failed repeatedly",
      context: {
        service: "api",
        threshold: HEALTH_FAILURE_THRESHOLD,
        healthIntervalMs: HEALTH_INTERVAL_MS
      }
    });
    restartService("api", `health check failed ${HEALTH_FAILURE_THRESHOLD}x`);
  }
  if (healthMissByService.web >= HEALTH_FAILURE_THRESHOLD) {
    healthMissByService.web = 0;
    emitSupervisorDiagnostic({
      severity: "WARN",
      eventName: "supervisor.health.failure_threshold",
      message: "Web health check failed repeatedly",
      context: {
        service: "web",
        threshold: HEALTH_FAILURE_THRESHOLD,
        healthIntervalMs: HEALTH_INTERVAL_MS
      }
    });
    restartService("web", `health check failed ${HEALTH_FAILURE_THRESHOLD}x`);
  }

  const summary = `health api=${apiUp ? "up" : "down"} web=${webUp ? "up" : "down"} url=http://localhost:${WEB_PORT}`;
  if (summary !== lastHealthSummary) {
    log(summary);
    if (!webUp) {
      log(`web is unavailable; waiting for auto-restart. If this persists, inspect logs above.`);
    }
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
  emitSupervisorDiagnostic({
    severity: "CRITICAL",
    eventName: "supervisor.uncaught_exception",
    message: "Supervisor crashed with uncaught exception",
    context: {
      error: error instanceof Error ? error.message : String(error)
    }
  });
  stopAll("SIGTERM");
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  fail("unhandled rejection in supervisor", error);
  emitSupervisorDiagnostic({
    severity: "CRITICAL",
    eventName: "supervisor.unhandled_rejection",
    message: "Supervisor crashed with unhandled rejection",
    context: {
      error: error instanceof Error ? error.message : String(error)
    }
  });
  stopAll("SIGTERM");
  process.exit(1);
});

log(`booting dev environment (api:${API_PORT}, web:${WEB_PORT})`);
emitSupervisorDiagnostic({
  severity: "INFO",
  eventName: "supervisor.boot",
  message: "Dev supervisor booted",
  context: {
    apiPort: API_PORT,
    webPort: WEB_PORT
  }
});
for (const service of services) {
  startService(service);
}
