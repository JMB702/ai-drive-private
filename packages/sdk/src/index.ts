import type {
  DiagnosticCategory,
  DiagnosticEvent,
  DiagnosticIncident,
  DiagnosticIncidentPrompts,
  DiagnosticSeverity,
  GenerationJob,
  GenerationRequest,
  IncidentStatus,
  Workspace
} from "@aidrive/shared";

export interface ApiClientOptions {
  baseUrl: string;
  userId?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly userId: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.userId = options.userId ?? "user_demo";
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId,
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  listWorkspaces(): Promise<{ workspaces: Workspace[] }> {
    return this.request("/v1/workspaces", { method: "GET" });
  }

  listGenerationJobs(workspaceId: string): Promise<{ jobs: GenerationJob[] }> {
    return this.request(`/v1/generation/jobs/${workspaceId}`, { method: "GET" });
  }

  createGenerationJob(payload: GenerationRequest): Promise<{ job: GenerationJob }> {
    return this.request("/v1/generation/jobs", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  createFolder(payload: { workspaceId: string; name: string; parentId?: string | null }): Promise<{ folder: { id: string; name: string } }> {
    return this.request("/v1/drive/folders", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  listDiagnosticIncidents(params?: {
    status?: IncidentStatus;
    severity?: DiagnosticSeverity;
    since?: string;
    limit?: number;
  }): Promise<{ incidents: DiagnosticIncident[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.severity) query.set("severity", params.severity);
    if (params?.since) query.set("since", params.since);
    if (typeof params?.limit === "number") query.set("limit", String(params.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request(`/v1/diagnostics/incidents${suffix}`, { method: "GET" });
  }

  getDiagnosticIncident(incidentId: string): Promise<{ incident: DiagnosticIncident }> {
    return this.request(`/v1/diagnostics/incidents/${encodeURIComponent(incidentId)}`, { method: "GET" });
  }

  ackDiagnosticIncident(incidentId: string): Promise<{ incident: DiagnosticIncident }> {
    return this.request(`/v1/diagnostics/incidents/${encodeURIComponent(incidentId)}/ack`, { method: "POST" });
  }

  resolveDiagnosticIncident(incidentId: string): Promise<{ incident: DiagnosticIncident }> {
    return this.request(`/v1/diagnostics/incidents/${encodeURIComponent(incidentId)}/resolve`, { method: "POST" });
  }

  listDiagnosticEvents(params?: {
    severity?: DiagnosticSeverity;
    category?: DiagnosticCategory;
    eventName?: string;
    incidentId?: string;
    since?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ events: DiagnosticEvent[]; nextCursor: string | null }> {
    const query = new URLSearchParams();
    if (params?.severity) query.set("severity", params.severity);
    if (params?.category) query.set("category", params.category);
    if (params?.eventName) query.set("eventName", params.eventName);
    if (params?.incidentId) query.set("incidentId", params.incidentId);
    if (params?.since) query.set("since", params.since);
    if (typeof params?.limit === "number") query.set("limit", String(params.limit));
    if (params?.cursor) query.set("cursor", params.cursor);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request(`/v1/diagnostics/events${suffix}`, { method: "GET" });
  }

  getIncidentPacket(incidentId: string): Promise<{ packet: string }> {
    return this.request(`/v1/diagnostics/incidents/${encodeURIComponent(incidentId)}/packet`, { method: "GET" });
  }

  getDiagnosticIncidentPacket(incidentId: string): Promise<{ packet: string }> {
    return this.getIncidentPacket(incidentId);
  }

  getIncidentPrompts(incidentId: string): Promise<{ prompts: DiagnosticIncidentPrompts }> {
    return this.request(`/v1/diagnostics/incidents/${encodeURIComponent(incidentId)}/prompts`, { method: "GET" });
  }

  getDiagnosticIncidentPrompts(incidentId: string): Promise<{ prompts: DiagnosticIncidentPrompts }> {
    return this.getIncidentPrompts(incidentId);
  }

  submitDiagnosticAgentReport(
    incidentId: string,
    payload: {
      agentId?: string | null;
      reportText?: string;
      tools?: Array<{
        tool: string;
        endpoint?: string;
        purpose?: string;
        outcome: string;
        helpfulnessScore?: number;
        improvementSuggestion?: string;
        autoImproved?: boolean;
        deferred?: boolean;
        deferNote?: string;
      }>;
      diagnosticsEvidenceComplete?: boolean;
    }
  ): Promise<{
    accepted: boolean;
    incidentId: string;
    toolCount: number;
    usedEvents: number;
    feedbackEvents: number;
    diagnosticsEvidenceComplete: boolean | null;
  }> {
    return this.request(`/v1/diagnostics/incidents/${encodeURIComponent(incidentId)}/agent-report`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
}
