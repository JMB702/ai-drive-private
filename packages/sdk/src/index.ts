import type { GenerationJob, GenerationRequest, Workspace } from "@aidrive/shared";

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
}
