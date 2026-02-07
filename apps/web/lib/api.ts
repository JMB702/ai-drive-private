export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4100";
const API_TIMEOUT_MS = 8000;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    signal: controller.signal,
    headers: {
      "content-type": "application/json",
      "x-user-id": "user_demo",
      ...(init?.headers ?? {})
    }
  }).catch((error) => {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${API_TIMEOUT_MS}ms`);
    }
    throw error;
  }).finally(() => {
    clearTimeout(timeout);
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}
