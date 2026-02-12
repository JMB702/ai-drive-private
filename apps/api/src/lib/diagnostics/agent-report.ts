import type { DiagnosticContext } from "./types.js";

export type ParsedAgentToolUsage = {
  tool: string;
  endpoint?: string;
  purpose?: string;
  outcome: string;
  helpfulnessScore?: number;
  improvementSuggestion?: string;
  autoImproved?: boolean;
  deferred?: boolean;
  deferNote?: string;
};

export type ParsedAgentUsageReport = {
  tools: ParsedAgentToolUsage[];
  diagnosticsEvidenceComplete: boolean | null;
};

function compact(value: string, max = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max);
}

function parseHelpfulnessScore(text: string): number | null {
  const match = text.match(/helpfulness(?:\s*score)?\s*[:=]\s*([1-5])/i);
  if (!match) return null;
  const score = Number.parseInt(match[1], 10);
  if (!Number.isFinite(score)) return null;
  return Math.max(1, Math.min(5, score));
}

function parseEvidenceComplete(text: string): boolean | null {
  const match = text.match(/diagnosticsEvidenceComplete\s*=\s*(true|false)/i);
  if (!match) return null;
  return match[1].toLowerCase() === "true";
}

function parseOutcome(line: string): string {
  const match = line.match(/outcome\s*[:=]\s*([A-Za-z0-9_-]+)/i);
  if (!match) return "unknown";
  return compact(match[1], 40).toLowerCase();
}

function parseField(line: string, field: string): string | undefined {
  const regex = new RegExp(`${field}\\s*[:=]\\s*([^|,;]+)`, "i");
  const match = line.match(regex);
  if (!match) return undefined;
  const value = compact(match[1]);
  return value.length > 0 ? value : undefined;
}

function parseBooleanField(line: string, field: string): boolean | undefined {
  const regex = new RegExp(`${field}\\s*[:=]\\s*(true|false)`, "i");
  const match = line.match(regex);
  if (!match) return undefined;
  return match[1].toLowerCase() === "true";
}

function parseToolLine(line: string): ParsedAgentToolUsage | null {
  if (!/tool\s*[:=]/i.test(line) || !/outcome\s*[:=]/i.test(line)) return null;
  const tool = parseField(line, "tool");
  if (!tool) return null;
  const endpoint = parseField(line, "endpoint");
  const purpose = parseField(line, "purpose");
  const outcome = parseOutcome(line);
  const helpfulnessScore = parseHelpfulnessScore(line) ?? undefined;
  const improvementSuggestion = parseField(line, "improvement");
  const autoImproved = parseBooleanField(line, "autoImproved");
  const deferred = parseBooleanField(line, "deferred");
  const deferNote = parseField(line, "deferNote") ?? parseField(line, "deferredNote");
  return {
    tool: compact(tool, 80),
    endpoint: endpoint ? compact(endpoint, 200) : undefined,
    purpose: purpose ? compact(purpose, 200) : undefined,
    outcome,
    helpfulnessScore,
    improvementSuggestion: improvementSuggestion ? compact(improvementSuggestion, 280) : undefined,
    autoImproved,
    deferred,
    deferNote: deferNote ? compact(deferNote, 280) : undefined
  };
}

export function parseAgentUsageReport(text: string): ParsedAgentUsageReport {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const tools: ParsedAgentToolUsage[] = [];
  for (const line of lines) {
    const parsed = parseToolLine(line);
    if (!parsed) continue;
    tools.push(parsed);
  }

  const diagnosticsEvidenceComplete = parseEvidenceComplete(text);
  return {
    tools,
    diagnosticsEvidenceComplete
  };
}

export function toolUsageContext(
  incidentId: string,
  tool: ParsedAgentToolUsage,
  agentId: string | null
): DiagnosticContext {
  return {
    incidentId,
    tool: tool.tool,
    endpoint: tool.endpoint ?? null,
    purpose: tool.purpose ?? null,
    outcome: tool.outcome,
    autoImproved: tool.autoImproved ?? null,
    deferred: tool.deferred ?? null,
    deferNote: tool.deferNote ?? null,
    source: "agent_report",
    agentId
  };
}

export function toolFeedbackContext(
  incidentId: string,
  tool: ParsedAgentToolUsage,
  agentId: string | null
): DiagnosticContext {
  const helpfulness = typeof tool.helpfulnessScore === "number" ? tool.helpfulnessScore >= 4 : null;
  return {
    incidentId,
    tool: tool.tool,
    helpful: helpfulness,
    helpfulnessScore: tool.helpfulnessScore ?? null,
    improvementSuggestion: tool.improvementSuggestion ?? null,
    autoImproved: tool.autoImproved ?? null,
    deferred: tool.deferred ?? null,
    deferNote: tool.deferNote ?? null,
    source: "agent_report",
    agentId
  };
}
