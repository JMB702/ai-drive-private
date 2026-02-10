import fs from "fs";
import path from "path";
import type { DiagnosticEvent, DiagnosticIncident } from "@aidrive/shared";
import { resolveApiDataPath } from "../data-paths.js";
import {
  type DiagnosticEventQuery,
  type DiagnosticIncidentQuery,
  type DiagnosticsIndexFile,
  DIAGNOSTICS_RETENTION_DAYS
} from "./types.js";

const DIAGNOSTICS_DIR_NAME = "diagnostics";
const INCIDENTS_FILE_NAME = "incidents.json";
const EVENT_FILE_PREFIX = "events-";
const EVENT_FILE_SUFFIX = ".ndjson";

function diagnosticsDirectory(): string {
  return resolveApiDataPath(DIAGNOSTICS_DIR_NAME);
}

function incidentsFilePath(): string {
  return path.join(diagnosticsDirectory(), INCIDENTS_FILE_NAME);
}

function eventFilePathForDate(dateIso: string): string {
  const day = dateIso.slice(0, 10);
  return path.join(diagnosticsDirectory(), `${EVENT_FILE_PREFIX}${day}${EVENT_FILE_SUFFIX}`);
}

function ensureDiagnosticsDirectory(): void {
  fs.mkdirSync(diagnosticsDirectory(), { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureDiagnosticsDirectory();
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
}

function parseEventFileDate(fileName: string): Date | null {
  if (!fileName.startsWith(EVENT_FILE_PREFIX) || !fileName.endsWith(EVENT_FILE_SUFFIX)) return null;
  const day = fileName.slice(EVENT_FILE_PREFIX.length, -EVENT_FILE_SUFFIX.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function diagnosticsRetentionCutoff(now = Date.now()): number {
  return now - (DIAGNOSTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function pruneDiagnosticEventFiles(now = Date.now()): void {
  const directory = diagnosticsDirectory();
  if (!fs.existsSync(directory)) return;
  const cutoff = diagnosticsRetentionCutoff(now);
  const names = fs.readdirSync(directory);
  for (const name of names) {
    const date = parseEventFileDate(name);
    if (!date) continue;
    if (date.getTime() < cutoff) {
      try {
        fs.unlinkSync(path.join(directory, name));
      } catch {
        // Best-effort pruning.
      }
    }
  }
}

function readEventsFromFile(filePath: string): DiagnosticEvent[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const out: DiagnosticEvent[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as DiagnosticEvent;
        if (!parsed || typeof parsed.id !== "string" || typeof parsed.ts !== "string") continue;
        out.push(parsed);
      } catch {
        // Skip malformed event lines.
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function appendDiagnosticEvent(event: DiagnosticEvent): void {
  ensureDiagnosticsDirectory();
  const filePath = eventFilePathForDate(event.ts);
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

export function readDiagnosticsIndex(): DiagnosticsIndexFile {
  const fallback: DiagnosticsIndexFile = {
    version: 1,
    incidents: [],
    recentWarnByFingerprint: {}
  };
  const loaded = readJsonFile<DiagnosticsIndexFile>(incidentsFilePath(), fallback);
  if (!loaded || typeof loaded !== "object") return fallback;
  const incidents = Array.isArray(loaded.incidents) ? loaded.incidents : [];
  const recentWarnByFingerprint = (loaded.recentWarnByFingerprint && typeof loaded.recentWarnByFingerprint === "object")
    ? loaded.recentWarnByFingerprint
    : {};
  return {
    version: 1,
    incidents,
    recentWarnByFingerprint
  };
}

export function writeDiagnosticsIndex(index: DiagnosticsIndexFile): void {
  writeJsonFile(incidentsFilePath(), index);
}

export function listDiagnosticEvents(query: DiagnosticEventQuery = {}): {
  events: DiagnosticEvent[];
  nextCursor: string | null;
} {
  pruneDiagnosticEventFiles();
  ensureDiagnosticsDirectory();
  const directory = diagnosticsDirectory();
  const files = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  const allEvents: DiagnosticEvent[] = [];
  for (const name of files) {
    const date = parseEventFileDate(name);
    if (!date) continue;
    allEvents.push(...readEventsFromFile(path.join(directory, name)));
  }
  allEvents.sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts));

  const sinceMs = query.since ? Date.parse(query.since) : Number.NaN;
  const filtered = allEvents.filter((event) => {
    if (query.severity && event.severity !== query.severity) return false;
    if (query.category && event.category !== query.category) return false;
    if (query.eventName && event.eventName !== query.eventName) return false;
    if (query.incidentId) {
      const fromContext = event.context.incidentId;
      if (typeof fromContext !== "string" || fromContext !== query.incidentId) return false;
    }
    if (query.fingerprint && event.fingerprint !== query.fingerprint) return false;
    if (Number.isFinite(sinceMs) && Date.parse(event.ts) < sinceMs) return false;
    return true;
  });

  const cursor = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
  const start = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));
  const page = filtered.slice(start, start + limit);
  const nextCursor = start + limit < filtered.length ? String(start + limit) : null;

  return { events: page, nextCursor };
}

export function listDiagnosticIncidents(query: DiagnosticIncidentQuery = {}): DiagnosticIncident[] {
  const index = readDiagnosticsIndex();
  const sinceMs = query.since ? Date.parse(query.since) : Number.NaN;
  const filtered = index.incidents.filter((incident) => {
    if (query.status && incident.status !== query.status) return false;
    if (query.severity && incident.severity !== query.severity) return false;
    if (Number.isFinite(sinceMs) && Date.parse(incident.lastSeen) < sinceMs) return false;
    return true;
  });
  filtered.sort((left, right) => Date.parse(right.lastSeen) - Date.parse(left.lastSeen));
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));
  return filtered.slice(0, limit);
}

export function getDiagnosticIncidentById(incidentId: string): DiagnosticIncident | null {
  const index = readDiagnosticsIndex();
  return index.incidents.find((incident) => incident.id === incidentId) ?? null;
}
