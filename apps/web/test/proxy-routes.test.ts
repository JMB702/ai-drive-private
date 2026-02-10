import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, existsSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { GET as proxyGet } from "../app/api/proxy/[...path]/route";
import { GET as imageProxyGet } from "../app/api/image/route";

describe("proxy diagnostics routes", () => {
  let dataDir = "";
  let previousDataDir: string | undefined;
  let previousFallback: string | undefined;

  beforeEach(() => {
    previousDataDir = process.env.AIDRIVE_DATA_DIR;
    previousFallback = process.env.AIDRIVE_ENABLE_PROXY_FALLBACK;
    dataDir = mkdtempSync(path.join(os.tmpdir(), "aidrive-web-proxy-"));
    process.env.AIDRIVE_DATA_DIR = dataDir;
    process.env.AIDRIVE_ENABLE_PROXY_FALLBACK = "1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof previousDataDir === "undefined") {
      delete process.env.AIDRIVE_DATA_DIR;
    } else {
      process.env.AIDRIVE_DATA_DIR = previousDataDir;
    }
    if (typeof previousFallback === "undefined") {
      delete process.env.AIDRIVE_ENABLE_PROXY_FALLBACK;
    } else {
      process.env.AIDRIVE_ENABLE_PROXY_FALLBACK = previousFallback;
    }
    if (dataDir && existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("returns proxy fallback marker when upstream attempts fail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/v1/diagnostics/ingest")) {
        return new Response("{}", { status: 202 });
      }
      throw new Error("simulated upstream outage");
    });

    const request = new NextRequest("http://localhost/api/proxy/v1/drive/folders/ws_demo", {
      method: "GET",
      headers: {
        "x-user-id": "user_demo",
        "x-aidrive-trace-id": "trace-proxy-test"
      }
    });
    const response = await proxyGet(request, {
      params: Promise.resolve({
        path: ["v1", "drive", "folders", "ws_demo"]
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-aidrive-proxy-fallback")).toBe("1");
    expect(response.headers.get("x-aidrive-trace-id")).toBe("trace-proxy-test");
  });

  it("returns image fallback marker when upstream image fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/v1/diagnostics/ingest")) {
        return new Response("{}", { status: 202 });
      }
      return new Response("upstream failure", {
        status: 502,
        headers: {
          "content-type": "text/plain"
        }
      });
    });

    const source = encodeURIComponent("https://example.com/image.png?width=1024&height=1024");
    const request = new NextRequest(`http://localhost/api/image?url=${source}`, {
      method: "GET",
      headers: {
        "x-aidrive-trace-id": "trace-image-test"
      }
    });
    const response = await imageProxyGet(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-aidrive-image-fallback")).toBe("1");
    expect(response.headers.get("x-aidrive-trace-id")).toBe("trace-image-test");
    expect(String(response.headers.get("content-type") ?? "")).toContain("image/svg+xml");
    expect(body).toContain("Preview Source Unavailable");
  });
});
