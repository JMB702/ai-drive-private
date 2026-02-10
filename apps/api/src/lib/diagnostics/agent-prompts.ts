import type {
  DiagnosticCategory,
  DiagnosticEvent,
  DiagnosticIncident,
  DiagnosticIncidentPrompts
} from "@aidrive/shared";

type IncidentSignalSummary = {
  primaryCategory: DiagnosticCategory;
  components: string[];
  eventNames: string[];
  routes: string[];
  models: string[];
  traceIds: string[];
};

const CATEGORY_HOTSPOTS: Record<DiagnosticCategory, readonly string[]> = {
  GENERATION: [
    "apps/api/src/queue/generation-queue.ts",
    "apps/api/src/modules/generation/routes.ts"
  ],
  PROVIDER: [
    "apps/api/src/providers/adapters.ts",
    "apps/api/src/modules/generation/routes.ts"
  ],
  PROXY: [
    "apps/web/app/api/proxy/[...path]/route.ts",
    "apps/web/lib/api.ts"
  ],
  PERSISTENCE: [
    "apps/api/src/app.ts",
    "apps/api/src/lib/persistence.ts"
  ],
  REALTIME: [
    "apps/api/src/modules/realtime/routes.ts",
    "apps/api/src/modules/generation/routes.ts"
  ],
  CLIENT: [
    "apps/web/lib/api.ts",
    "apps/web/components/ClientErrorBoundary.tsx",
    "apps/web/app/error.tsx",
    "apps/web/components/GlobalGeneratePanel.tsx",
    "apps/web/components/ProjectsProvider.tsx"
  ],
  SUPERVISOR: [
    "scripts/dev-supervisor.mjs",
    "scripts/prod-supervisor.mjs"
  ],
  IMAGE_PROXY: [
    "apps/web/app/api/image/route.ts",
    "apps/web/app/api/proxy/[...path]/route.ts"
  ],
  SYSTEM: [
    "apps/api/src/app.ts",
    "apps/api/src/server.ts"
  ]
};

const COMPONENT_HOTSPOTS: ReadonlyArray<{
  pattern: RegExp;
  paths: readonly string[];
}> = [
  {
    pattern: /generation\.queue|notifyJobSubscribers|jobSubscribers/i,
    paths: ["apps/api/src/queue/generation-queue.ts"]
  },
  {
    pattern: /generation\.routes|generation\./i,
    paths: ["apps/api/src/modules/generation/routes.ts"]
  },
  {
    pattern: /realtime|sse/i,
    paths: ["apps/api/src/modules/realtime/routes.ts"]
  },
  {
    pattern: /provider|gemini|openai|adapter/i,
    paths: ["apps/api/src/providers/adapters.ts"]
  },
  {
    pattern: /proxy|api_proxy|forward/i,
    paths: ["apps/web/app/api/proxy/[...path]/route.ts"]
  },
  {
    pattern: /image_proxy|image\.route|image_proxy/i,
    paths: ["apps/web/app/api/image/route.ts"]
  },
  {
    pattern: /client|error_boundary|global_generate|projects_provider/i,
    paths: [
      "apps/web/components/ClientErrorBoundary.tsx",
      "apps/web/app/error.tsx",
      "apps/web/components/GlobalGeneratePanel.tsx",
      "apps/web/components/ProjectsProvider.tsx"
    ]
  },
  {
    pattern: /supervisor|health_check|restart/i,
    paths: ["scripts/dev-supervisor.mjs", "scripts/prod-supervisor.mjs"]
  },
  {
    pattern: /persistence|store|save|load/i,
    paths: ["apps/api/src/lib/persistence.ts", "apps/api/src/app.ts"]
  }
];

function topValues(values: readonly string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (value.length === 0) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([value]) => value);
}

function unique(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function summarizeSignals(events: DiagnosticEvent[]): IncidentSignalSummary {
  const categories = topValues(events.map((event) => event.category), 1);
  const components = topValues(events.map((event) => event.component), 3);
  const eventNames = topValues(events.map((event) => event.eventName), 4);
  const routes = topValues(
    events.flatMap((event) => {
      const route = event.context.route;
      return typeof route === "string" ? [route] : [];
    }),
    3
  );
  const models = topValues(
    events.flatMap((event) => {
      const model = event.context.model;
      return typeof model === "string" ? [model] : [];
    }),
    3
  );
  const traceIds = unique(
    events
      .map((event) => event.traceId)
      .filter((traceId): traceId is string => typeof traceId === "string" && traceId.trim().length > 0)
      .slice(0, 5)
  );

  return {
    primaryCategory: (categories[0] as DiagnosticCategory | undefined) ?? "SYSTEM",
    components,
    eventNames,
    routes,
    models,
    traceIds
  };
}

function detectComponentHotspots(signals: IncidentSignalSummary): string[] {
  const probes = [...signals.components, ...signals.eventNames];
  const matched: string[] = [];
  for (const probe of probes) {
    for (const candidate of COMPONENT_HOTSPOTS) {
      if (!candidate.pattern.test(probe)) continue;
      matched.push(...candidate.paths);
    }
  }
  return unique(matched);
}

function buildHotspotList(signals: IncidentSignalSummary): string[] {
  const categoryDefaults = CATEGORY_HOTSPOTS[signals.primaryCategory] ?? [];
  const fromComponents = detectComponentHotspots(signals);
  return unique([...fromComponents, ...categoryDefaults]).slice(0, 8);
}

function listOrUnknown(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "unknown";
}

function threadCloseUsageBlock(incident: DiagnosticIncident): string[] {
  return [
    "Thread-close requirement (mandatory):",
    "- End your final reply with a section titled: DIAGNOSTICS_TOOL_USAGE",
    "- For each diagnostic tool used, list: tool, exact endpoint/command, purpose, and outcome.",
    "- For each tool used, include helpfulness score: 1-5.",
    "- For any tool scored 3 or below, include one concrete improvement suggestion.",
    "- If a required tool was not used, include it with outcome=NOT_USED and explain why.",
    "- Include this exact line at the end: diagnosticsEvidenceComplete=true|false",
    `- Required minimum tools for this incident: /v1/diagnostics/incidents/${incident.id}, /v1/diagnostics/events?fingerprint=${incident.fingerprint}&limit=500, /v1/diagnostics/incidents/${incident.id}/packet`
  ];
}

function buildTriagePrompt(
  incident: DiagnosticIncident,
  signals: IncidentSignalSummary,
  hotspots: readonly string[]
): string {
  const causeHint = incident.causeStatus === "UNKNOWN"
    ? "Cause is currently UNKNOWN. Prioritize proving root cause or naming the missing evidence."
    : "Cause is currently KNOWN. Validate that classification with timeline evidence.";
  return [
    "You are the AI Drive diagnostics triage agent.",
    "",
    "Goal: explain why this incident failed and what remains unknown.",
    `incidentId=${incident.id}`,
    `fingerprint=${incident.fingerprint}`,
    `severity=${incident.severity}`,
    `causeStatus=${incident.causeStatus}`,
    `title=${incident.title}`,
    `primaryCategory=${signals.primaryCategory}`,
    `topComponents=${listOrUnknown(signals.components)}`,
    `topEventNames=${listOrUnknown(signals.eventNames)}`,
    `topRoutes=${listOrUnknown(signals.routes)}`,
    `topModels=${listOrUnknown(signals.models)}`,
    `traceHints=${listOrUnknown(signals.traceIds)}`,
    `suggestedHotspots=${listOrUnknown(hotspots)}`,
    "",
    "Use these diagnostics tools before proposing changes:",
    `1) GET /v1/diagnostics/incidents/${incident.id}`,
    `2) GET /v1/diagnostics/events?fingerprint=${incident.fingerprint}&limit=500`,
    `3) GET /v1/diagnostics/incidents/${incident.id}/packet`,
    "",
    "Required output format:",
    "- Root-cause hypothesis (1 short paragraph).",
    "- Confidence: HIGH | MEDIUM | LOW.",
    "- Evidence: 3 timestamped facts from events.",
    "- Unknowns: explicit data still missing.",
    "- Next instrumentation: exact event/context fields to add if still uncertain.",
    "",
    ...threadCloseUsageBlock(incident),
    "",
    causeHint
  ].join("\n");
}

function buildFixPrompt(
  incident: DiagnosticIncident,
  signals: IncidentSignalSummary,
  hotspots: readonly string[]
): string {
  const category = signals.primaryCategory;
  return [
    "You are the AI Drive incident fix agent.",
    "",
    "Goal: implement a minimal, safe fix for this incident and preserve diagnostics quality.",
    `incidentId=${incident.id}`,
    `fingerprint=${incident.fingerprint}`,
    `targetCategory=${category}`,
    `hotspots=${listOrUnknown(hotspots)}`,
    "",
    "Implementation requirements:",
    "- Patch the smallest set of files that can stop recurrence.",
    "- Keep redaction-by-default diagnostics; do not log prompts/secrets/raw auth.",
    "- Emit structured diagnostics for failure path and recovery path.",
    "- Preserve traceId/requestId propagation.",
    "- If no deterministic fix is available, add guardrails and richer diagnostics instead.",
    "",
    "Deliverables:",
    "- Code changes with file paths.",
    "- Why this fix matches event evidence.",
    "- Regression risks and rollback trigger.",
    "- Tests added/updated.",
    "",
    ...threadCloseUsageBlock(incident)
  ].join("\n");
}

function buildVerifyPrompt(
  incident: DiagnosticIncident,
  signals: IncidentSignalSummary,
  hotspots: readonly string[]
): string {
  return [
    "You are the AI Drive incident verification agent.",
    "",
    "Goal: prove the incident is fixed and diagnostics still produce actionable packets.",
    `incidentId=${incident.id}`,
    `fingerprint=${incident.fingerprint}`,
    `primaryCategory=${signals.primaryCategory}`,
    `hotspots=${listOrUnknown(hotspots)}`,
    "",
    "Verification checklist:",
    "- Reproduce original failure path (or closest deterministic proxy).",
    "- Confirm failure no longer occurs after the patch.",
    "- Confirm diagnostics still emit eventName, severity, fingerprint, traceId, and redacted context.",
    "- Confirm incident packet still includes timeline and agent prompts.",
    "- Confirm no sensitive values appear in diagnostics event context.",
    "",
    "Report format:",
    "- Test evidence (commands + pass/fail).",
    "- Before/after behavior summary.",
    "- Residual risk and follow-up monitoring steps.",
    "",
    ...threadCloseUsageBlock(incident)
  ].join("\n");
}

export function buildIncidentPrompts(
  incident: DiagnosticIncident,
  events: DiagnosticEvent[]
): DiagnosticIncidentPrompts {
  const signals = summarizeSignals(events);
  const hotspots = buildHotspotList(signals);
  return {
    hotspots,
    triage: buildTriagePrompt(incident, signals, hotspots),
    fix: buildFixPrompt(incident, signals, hotspots),
    verify: buildVerifyPrompt(incident, signals, hotspots)
  };
}
