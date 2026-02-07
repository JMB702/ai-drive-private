export interface ProviderHttpClient {
  post<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T>;
}

export class FetchProviderHttpClient implements ProviderHttpClient {
  async post<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Provider request failed: ${response.status} ${text}`);
    }

    return (await response.json()) as T;
  }
}
