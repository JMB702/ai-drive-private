import { createTraceId, postClientDiagnostic } from "./diagnostics-client";

const PROXY_BASE = "/api/proxy";
const envBase = process.env.NEXT_PUBLIC_API_URL?.trim();
export const API_BASE = process.env.NODE_ENV === "development"
  ? PROXY_BASE
  : (envBase && envBase.length > 0 ? envBase : PROXY_BASE);
const API_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 20000);
const API_TIMEOUT_MEDIA_LIST_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MEDIA_LIST_MS ?? 90000);

function joinApiUrl(base: string, path: string): string {
  if (base.endsWith("/") && path.startsWith("/")) return `${base.slice(0, -1)}${path}`;
  if (!base.endsWith("/") && !path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const traceId = createTraceId();

  function resolveTimeoutMs(): number {
    const method = (init?.method ?? "GET").toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    const isHeavyMediaList = path.startsWith("/v1/drive/assets/") || path.startsWith("/v1/generation/jobs/");
    if (isRead && isHeavyMediaList) return API_TIMEOUT_MEDIA_LIST_MS;
    return API_TIMEOUT_MS;
  }

  function buildHeaders(): HeadersInit {
    const headers = new Headers(init?.headers ?? {});
    const hasBody = init?.body !== undefined && init?.body !== null;
    headers.set("x-user-id", "user_demo");
    headers.set("x-aidrive-trace-id", traceId);
    if (hasBody) {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    } else {
      headers.delete("content-type");
    }
    return headers;
  }

  function emitApiDiagnostic(eventName: string, severity: "WARN" | "HIGH", message: string, context: Record<string, unknown>): void {
    void postClientDiagnostic({
      severity,
      category: "CLIENT",
      component: "web.api_request",
      eventName,
      message,
      workspaceId: "ws_demo",
      traceId,
      context: {
        path,
        method: (init?.method ?? "GET").toUpperCase(),
        ...context
      }
    });
  }

  async function request(base: string): Promise<Response> {
    const timeoutMs = resolveTimeoutMs();
    const controller = new AbortController();
    const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    return fetch(joinApiUrl(base, path), {
      ...init,
      signal: controller.signal,
      headers: buildHeaders()
    }).catch((error) => {
      const timedOut = error instanceof Error && error.name === "AbortError";
      emitApiDiagnostic(
        timedOut ? "client.api.timeout" : "client.api.network_error",
        "WARN",
        timedOut ? "Client API request timed out" : "Client API request failed",
        {
          base,
          timeoutMs,
          error: error instanceof Error ? error.message : String(error)
        }
      );
      if (timedOut) {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }

  const shouldRetryViaProxy = API_BASE !== PROXY_BASE;
  let response: Response;
  try {
    response = await request(API_BASE);
  } catch (error) {
    // First retry on transient timeouts/network hiccups against the same base.
    if (error instanceof Error && (error.message.includes("timed out") || error.name === "TypeError")) {
      try {
        response = await request(API_BASE);
      } catch (retryError) {
        if (!shouldRetryViaProxy) throw retryError;
        response = await request(PROXY_BASE);
      }
      if (!response.ok && shouldRetryViaProxy && response.status >= 500) {
        response = await request(PROXY_BASE);
      }
      if (!response.ok) {
        const text = await response.text();
        emitApiDiagnostic("client.api.http_error", response.status >= 500 ? "HIGH" : "WARN", "Client API request returned error", {
          statusCode: response.status,
          body: text.slice(0, 280),
          base: shouldRetryViaProxy ? PROXY_BASE : API_BASE
        });
        throw new Error(text || `Request failed (${response.status})`);
      }
      return (await response.json()) as T;
    }
    if (!shouldRetryViaProxy) throw error;
    response = await request(PROXY_BASE);
  }

  if (!response.ok && shouldRetryViaProxy && response.status >= 500) {
    response = await request(PROXY_BASE);
  }

  if (!response.ok) {
    const text = await response.text();
    emitApiDiagnostic("client.api.http_error", response.status >= 500 ? "HIGH" : "WARN", "Client API request returned error", {
      statusCode: response.status,
      body: text.slice(0, 280),
      base: shouldRetryViaProxy ? PROXY_BASE : API_BASE
    });
    throw new Error(text || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}
