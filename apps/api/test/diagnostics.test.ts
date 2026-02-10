import { mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { GenerationJob } from "@aidrive/shared";
import { buildApp } from "../src/app.js";
import { DiagnosticsEmitter } from "../src/lib/diagnostics/emit.js";
import { redactDiagnosticContext } from "../src/lib/diagnostics/redact.js";
import { listDiagnosticEvents, listDiagnosticIncidents, pruneDiagnosticEventFiles } from "../src/lib/diagnostics/store.js";

type EnvSnapshot = Record<string, string | undefined>;

function tempDiagnosticsDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "aidrive-diagnostics-"));
}

function isoDateOffset(daysFromNow: number): string {
  const value = new Date(Date.now() + (daysFromNow * 24 * 60 * 60 * 1000));
  return value.toISOString().slice(0, 10);
}

describe("diagnostics core", () => {
  let dataDir = "";
  let env: EnvSnapshot = {};

  beforeEach(() => {
    env = {
      AIDRIVE_DATA_DIR: process.env.AIDRIVE_DATA_DIR,
      AIDRIVE_DISABLE_PERSISTENCE: process.env.AIDRIVE_DISABLE_PERSISTENCE
    };
    dataDir = tempDiagnosticsDir();
    process.env.AIDRIVE_DATA_DIR = dataDir;
    process.env.AIDRIVE_DISABLE_PERSISTENCE = "1";
  });

  afterEach(() => {
    if (typeof env.AIDRIVE_DATA_DIR === "undefined") {
      delete process.env.AIDRIVE_DATA_DIR;
    } else {
      process.env.AIDRIVE_DATA_DIR = env.AIDRIVE_DATA_DIR;
    }
    if (typeof env.AIDRIVE_DISABLE_PERSISTENCE === "undefined") {
      delete process.env.AIDRIVE_DISABLE_PERSISTENCE;
    } else {
      process.env.AIDRIVE_DISABLE_PERSISTENCE = env.AIDRIVE_DISABLE_PERSISTENCE;
    }
    if (dataDir && existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("redacts prompt/reference/secret values while preserving safe diagnostics fields", () => {
    const output = redactDiagnosticContext({
      prompt: "A cinematic city skyline at dawn",
      negativePrompt: "grainy, noisy",
      apiKey: "sk-secret-value",
      authorization: "Bearer abcdef1234567890",
      settings: {
        model: "nano banana pro",
        type: "IMAGE",
        aspectRatio: "16:9",
        resolution: "2K",
        quality: "2K",
        clientRequestId: "cli-1",
        ignored: "should-not-appear",
        referenceImageDataUrl1: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
      },
      referenceImageDataUrl2: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      upstreamMessage: "Bearer qwertyuiop1234567890"
    });

    expect(output.promptHash).toBeTypeOf("string");
    expect(output.promptLength).toBe(32);
    expect(output.negativePromptLength).toBe(13);
    expect(output.referenceImageCount).toBe(2);
    expect(Number(output.referenceImageTotalBytes)).toBeGreaterThan(0);
    expect(output.model).toBe("nano banana pro");
    expect(output.aspectRatio).toBe("16:9");
    expect(output.resolution).toBe("2K");
    expect(output.quality).toBe("2K");
    expect(output.clientRequestId).toBe("cli-1");
    expect(output.apiKey).toBeUndefined();
    expect(output.authorization).toBeUndefined();
    expect(String(output.upstreamMessage)).not.toContain("Bearer qwertyuiop1234567890");
  });

  it("opens immediate incidents for high severity and merges repeated fingerprints", () => {
    const emitter = new DiagnosticsEmitter();
    const first = emitter.emit({
      severity: "HIGH",
      category: "PROVIDER",
      component: "provider.gemini",
      eventName: "provider.http_error",
      message: "Provider returned 500",
      workspaceId: "ws_demo",
      context: {
        route: "/v1/generation/jobs",
        model: "nano banana pro",
        statusCode: 500
      }
    });
    expect(first?.incident).toBeTruthy();
    const incidentId = first?.incident?.id;

    const second = emitter.emit({
      severity: "HIGH",
      category: "PROVIDER",
      component: "provider.gemini",
      eventName: "provider.http_error",
      message: "Provider returned 500 again",
      workspaceId: "ws_demo",
      context: {
        route: "/v1/generation/jobs",
        model: "nano banana pro",
        statusCode: 500
      }
    });

    expect(second?.incident?.id).toBe(incidentId);
    expect(second?.incident?.count).toBeGreaterThanOrEqual(2);
  });

  it("requires repeated warn timeout events before opening an incident", () => {
    const emitter = new DiagnosticsEmitter();
    const input = {
      severity: "WARN" as const,
      category: "PROVIDER" as const,
      component: "provider.gemini",
      eventName: "provider.timeout",
      message: "Provider timed out",
      workspaceId: "ws_demo",
      context: {
        route: "/v1/generation/jobs",
        model: "nano banana pro",
        statusCode: 504
      }
    };

    const one = emitter.emit(input);
    const two = emitter.emit(input);
    const three = emitter.emit(input);
    const four = emitter.emit(input);

    expect(one?.incident).toBeNull();
    expect(two?.incident).toBeNull();
    expect(three?.incident).toBeTruthy();
    expect(four?.incident?.id).toBe(three?.incident?.id);
  });

  it("prunes event files older than 30 days and keeps recent files", () => {
    const diagnosticsDir = path.join(dataDir, "diagnostics");
    mkdirSync(diagnosticsDir, { recursive: true });
    const oldFile = path.join(diagnosticsDir, "events-2000-01-01.ndjson");
    const recentFile = path.join(diagnosticsDir, `events-${isoDateOffset(0)}.ndjson`);
    writeFileSync(oldFile, "{\"id\":\"old\"}\n", "utf8");
    writeFileSync(recentFile, "{\"id\":\"new\"}\n", "utf8");

    pruneDiagnosticEventFiles(Date.now());

    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(recentFile)).toBe(true);
  });
});

describe("diagnostics integration", () => {
  let dataDir = "";
  let env: EnvSnapshot = {};
  let app: FastifyInstance;

  beforeEach(async () => {
    env = {
      AIDRIVE_DATA_DIR: process.env.AIDRIVE_DATA_DIR,
      AIDRIVE_DISABLE_PERSISTENCE: process.env.AIDRIVE_DISABLE_PERSISTENCE
    };
    dataDir = tempDiagnosticsDir();
    process.env.AIDRIVE_DATA_DIR = dataDir;
    process.env.AIDRIVE_DISABLE_PERSISTENCE = "1";
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    if (typeof env.AIDRIVE_DATA_DIR === "undefined") {
      delete process.env.AIDRIVE_DATA_DIR;
    } else {
      process.env.AIDRIVE_DATA_DIR = env.AIDRIVE_DATA_DIR;
    }
    if (typeof env.AIDRIVE_DISABLE_PERSISTENCE === "undefined") {
      delete process.env.AIDRIVE_DISABLE_PERSISTENCE;
    } else {
      process.env.AIDRIVE_DISABLE_PERSISTENCE = env.AIDRIVE_DISABLE_PERSISTENCE;
    }
    if (dataDir && existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps runtime subscriber fanout alive when one subscriber throws", () => {
    let healthySubscriberCalls = 0;
    const throwing = () => {
      throw new Error("subscriber exploded");
    };
    const healthy = () => {
      healthySubscriberCalls += 1;
    };
    app.ctx.runtime.jobSubscribers.add(throwing as (job: GenerationJob) => void);
    app.ctx.runtime.jobSubscribers.add(healthy as (job: GenerationJob) => void);

    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: "job_diag_subscriber",
      workspaceId: "ws_demo",
      createdBy: "user_demo",
      status: "RUNNING",
      request: {
        workspaceId: "ws_demo",
        prompt: "test",
        model: "Gemini 2.0 flash",
        type: "IMAGE",
        settings: {
          __traceId: "trace-subscriber"
        }
      },
      result: null,
      error: null,
      failure: null,
      reservedCredits: 0,
      createdAt: now,
      updatedAt: now
    };

    app.ctx.runtime.notifyJobSubscribers(job, "diagnostics.test");

    expect(healthySubscriberCalls).toBe(1);
    const { events } = listDiagnosticEvents({ eventName: "generation.subscriber.error", limit: 20 });
    expect(events.some((event) => event.requestId === "job_diag_subscriber")).toBe(true);
  });

  it("enforces owner/admin access for diagnostics endpoints", async () => {
    app.ctx.store.workspaceMembers.push(
      { workspaceId: "ws_demo", userId: "owner_1", role: "OWNER", joinedAt: new Date().toISOString() },
      { workspaceId: "ws_demo", userId: "viewer_1", role: "VIEWER", joinedAt: new Date().toISOString() }
    );
    app.ctx.diagnostics.emit({
      severity: "HIGH",
      category: "SYSTEM",
      component: "api.test",
      eventName: "diagnostics.access.seed",
      message: "seed incident for access test",
      workspaceId: "ws_demo",
      context: {
        route: "/v1/test",
        statusCode: 500
      }
    });

    const forbidden = await app.inject({
      method: "GET",
      url: "/v1/diagnostics/incidents",
      headers: { "x-user-id": "viewer_1" }
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "GET",
      url: "/v1/diagnostics/incidents",
      headers: { "x-user-id": "owner_1" }
    });
    expect(allowed.statusCode).toBe(200);
    expect(Array.isArray(allowed.json().incidents)).toBe(true);
  });

  it("returns codex-ready incident packet with UNKNOWN cause status", async () => {
    app.ctx.store.workspaceMembers.push(
      { workspaceId: "ws_demo", userId: "owner_2", role: "OWNER", joinedAt: new Date().toISOString() }
    );
    app.ctx.diagnostics.emit({
      severity: "HIGH",
      category: "PROVIDER",
      component: "provider.gemini",
      eventName: "provider.network_error",
      message: "Provider network error",
      workspaceId: "ws_demo",
      context: {
        route: "/v1/generation/jobs",
        statusCode: null,
        errorCode: null,
        provider: "unknown",
        failureCategory: "UNKNOWN"
      }
    });

    const incidents = listDiagnosticIncidents({ status: "OPEN", limit: 10 });
    const incident = incidents[0];
    expect(incident).toBeTruthy();

    const packetRes = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/incidents/${incident.id}/packet`,
      headers: { "x-user-id": "owner_2" }
    });
    expect(packetRes.statusCode).toBe(200);
    const packet = String(packetRes.json().packet ?? "");
    expect(packet).toContain("AI Drive Incident Packet");
    expect(packet).toContain(`incidentId: ${incident.id}`);
    expect(packet).toContain("causeStatus: UNKNOWN");
    expect(packet).toContain("PROMPT_TRIAGE_START");
    expect(packet).toContain("PROMPT_FIX_START");
    expect(packet).toContain("PROMPT_VERIFY_START");
    expect(packet).toContain("suggestedHotspots:");
    expect(packet).toContain("timeline:");
  });

  it("returns structured agent prompts for diagnostics automation", async () => {
    app.ctx.store.workspaceMembers.push(
      { workspaceId: "ws_demo", userId: "owner_prompts", role: "OWNER", joinedAt: new Date().toISOString() }
    );
    app.ctx.diagnostics.emit({
      severity: "HIGH",
      category: "PROXY",
      component: "web.api_proxy",
      eventName: "proxy.forward.timeout",
      message: "Proxy timed out contacting API",
      workspaceId: "ws_demo",
      context: {
        route: "/api/proxy/v1/generation/jobs",
        statusCode: 504
      }
    });

    const incidents = listDiagnosticIncidents({ status: "OPEN", limit: 10 });
    const incident = incidents[0];
    expect(incident).toBeTruthy();

    const promptsRes = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/incidents/${incident.id}/prompts`,
      headers: { "x-user-id": "owner_prompts" }
    });
    expect(promptsRes.statusCode).toBe(200);
    const prompts = promptsRes.json().prompts as {
      hotspots: string[];
      triage: string;
      fix: string;
      verify: string;
    };
    expect(Array.isArray(prompts.hotspots)).toBe(true);
    expect(prompts.hotspots.length).toBeGreaterThan(0);
    expect(prompts.triage).toContain("GET /v1/diagnostics/events?fingerprint=");
    expect(prompts.fix).toContain("redaction-by-default diagnostics");
    expect(prompts.verify).toContain("incident packet still includes timeline and agent prompts");
    expect(prompts.triage).toContain("DIAGNOSTICS_TOOL_USAGE");
    expect(prompts.triage).toContain("helpfulness score: 1-5");
    expect(prompts.fix).toContain("diagnosticsEvidenceComplete=true|false");
    expect(prompts.verify).toContain("outcome=NOT_USED");
  });

  it("includes incident tool usage and helpfulness summary in packet", async () => {
    app.ctx.store.workspaceMembers.push(
      { workspaceId: "ws_demo", userId: "owner_feedback", role: "OWNER", joinedAt: new Date().toISOString() }
    );
    app.ctx.diagnostics.emit({
      severity: "HIGH",
      category: "PROXY",
      component: "web.api_proxy",
      eventName: "proxy.forward.timeout",
      message: "Proxy timed out contacting API",
      workspaceId: "ws_demo",
      context: {
        route: "/api/proxy/v1/generation/jobs",
        statusCode: 504
      }
    });

    const incident = listDiagnosticIncidents({ status: "OPEN", limit: 10 })[0];
    expect(incident).toBeTruthy();

    app.ctx.diagnostics.emit({
      severity: "INFO",
      category: "CLIENT",
      component: "web.notification_center",
      eventName: "diagnostics.tool.used",
      message: "Operator copied triage prompt",
      workspaceId: "ws_demo",
      context: {
        incidentId: incident.id,
        tool: "triage_prompt",
        outcome: "success"
      }
    });
    app.ctx.diagnostics.emit({
      severity: "INFO",
      category: "CLIENT",
      component: "web.notification_center",
      eventName: "diagnostics.tool.feedback",
      message: "Operator said prompt needs improvement",
      workspaceId: "ws_demo",
      context: {
        incidentId: incident.id,
        tool: "triage_prompt",
        helpful: false,
        improvementSuggestion: "Add faster root-cause hint."
      }
    });

    const toolEventsRes = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/events?incidentId=${encodeURIComponent(incident.id)}&eventName=diagnostics.tool.feedback&limit=10`,
      headers: { "x-user-id": "owner_feedback" }
    });
    expect(toolEventsRes.statusCode).toBe(200);
    expect(Array.isArray(toolEventsRes.json().events)).toBe(true);
    expect(toolEventsRes.json().events.length).toBeGreaterThanOrEqual(1);

    const packetRes = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/incidents/${incident.id}/packet`,
      headers: { "x-user-id": "owner_feedback" }
    });
    expect(packetRes.statusCode).toBe(200);
    const packet = String(packetRes.json().packet ?? "");
    expect(packet).toContain("toolUsageFeedback:");
    expect(packet).toContain("tool=triage_prompt used=1 success=1");
    expect(packet).toContain("needsImprovement=1");
    expect(packet).toContain("latestImprovement=Add faster root-cause hint.");
  });

  it("acknowledges and resolves incidents through diagnostics routes", async () => {
    app.ctx.store.workspaceMembers.push(
      { workspaceId: "ws_demo", userId: "owner_3", role: "OWNER", joinedAt: new Date().toISOString() }
    );
    app.ctx.diagnostics.emit({
      severity: "CRITICAL",
      category: "SYSTEM",
      component: "api.test",
      eventName: "diagnostics.lifecycle.seed",
      message: "seed lifecycle incident",
      workspaceId: "ws_demo",
      context: {
        route: "/v1/test",
        statusCode: 500
      }
    });

    const openRes = await app.inject({
      method: "GET",
      url: "/v1/diagnostics/incidents?status=OPEN",
      headers: { "x-user-id": "owner_3" }
    });
    expect(openRes.statusCode).toBe(200);
    const incidentId = String(openRes.json().incidents?.[0]?.id ?? "");
    expect(incidentId.length).toBeGreaterThan(0);

    const ackRes = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/incidents/${incidentId}/ack`,
      headers: { "x-user-id": "owner_3" }
    });
    expect(ackRes.statusCode).toBe(200);
    expect(ackRes.json().incident?.status).toBe("ACKED");

    const resolveRes = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/incidents/${incidentId}/resolve`,
      headers: { "x-user-id": "owner_3" }
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().incident?.status).toBe("RESOLVED");
  });

  it("ingests diagnostics with trace header propagation", async () => {
    app.ctx.store.workspaceMembers.push(
      { workspaceId: "ws_demo", userId: "owner_4", role: "OWNER", joinedAt: new Date().toISOString() }
    );
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/diagnostics/ingest",
      headers: {
        "x-user-id": "owner_4",
        "x-aidrive-trace-id": "trace-from-header"
      },
      payload: {
        severity: "WARN",
        category: "PROXY",
        component: "web.api_proxy",
        eventName: "proxy.test_ingest",
        message: "test ingest event",
        workspaceId: "ws_demo",
        context: {
          route: "/api/proxy"
        }
      }
    });
    expect(ingest.statusCode).toBe(202);
    expect(typeof ingest.json().eventId).toBe("string");

    const eventsRes = await app.inject({
      method: "GET",
      url: "/v1/diagnostics/events?eventName=proxy.test_ingest&limit=5",
      headers: { "x-user-id": "owner_4" }
    });
    expect(eventsRes.statusCode).toBe(200);
    const events = eventsRes.json().events as Array<{ traceId?: string }>;
    expect(events.some((event) => event.traceId === "trace-from-header")).toBe(true);
  });
});
