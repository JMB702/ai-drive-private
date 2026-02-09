import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isAllowedUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDimensionsFromUrl(url: string): { width: number; height: number } {
  try {
    const parsed = new URL(url);
    const widthRaw = Number(parsed.searchParams.get("width"));
    const heightRaw = Number(parsed.searchParams.get("height"));
    const width = Number.isFinite(widthRaw) && widthRaw > 0 ? clamp(Math.round(widthRaw), 256, 3072) : 1024;
    const height = Number.isFinite(heightRaw) && heightRaw > 0 ? clamp(Math.round(heightRaw), 256, 3072) : 1024;
    return { width, height };
  } catch {
    return { width: 1024, height: 1024 };
  }
}

function promptFromSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("pollinations.ai")) {
      const prefixes = ["/prompt/", "/p/"];
      for (const prefix of prefixes) {
        if (!parsed.pathname.startsWith(prefix)) continue;
        return decodeURIComponent(parsed.pathname.slice(prefix.length)).replace(/\s+/g, " ").trim();
      }
    }
  } catch {
    // Ignore prompt parse errors.
  }
  return "Preview could not be loaded";
}

function fallbackSvg(source: string, reason: string): string {
  const { width, height } = parseDimensionsFromUrl(source);
  const prompt = promptFromSourceUrl(source).slice(0, 84).replace(/[<>&"]/g, "");
  const detail = reason.replace(/\s+/g, " ").trim().slice(0, 72).replace(/[<>&"]/g, "");
  const titleSize = Math.max(22, Math.round(Math.min(width, height) * 0.04));
  const detailSize = Math.max(14, Math.round(Math.min(width, height) * 0.025));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#131d33"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.14)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.72)}" rx="${Math.max(18, Math.round(Math.min(width, height) * 0.04))}" fill="rgba(9, 14, 27, 0.56)" stroke="rgba(219, 229, 255, 0.2)" stroke-width="2"/><text x="50%" y="42%" text-anchor="middle" fill="#f1f6ff" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700">Preview Source Unavailable</text><text x="50%" y="54%" text-anchor="middle" fill="#c7d4ec" font-family="Arial, sans-serif" font-size="${detailSize}">${prompt || "Generated image"}</text><text x="50%" y="66%" text-anchor="middle" fill="#9db0d1" font-family="Arial, sans-serif" font-size="${detailSize}">${detail || "Upstream unavailable"}</text></svg>`;
}

function fallbackResponse(source: string, reason: string): NextResponse {
  const svg = fallbackSvg(source, reason);
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=600"
    }
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const source = request.nextUrl.searchParams.get("url");
  if (!source || !isAllowedUrl(source)) {
    return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
  }

  try {
    const upstream = await fetch(source, {
      headers: {
        "user-agent": "AI-Drive-Image-Proxy/1.0",
        accept: "image/*,*/*;q=0.8"
      },
      redirect: "follow"
    });
    if (!upstream.ok) {
      return fallbackResponse(source, `Upstream ${upstream.status}`);
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const normalized = contentType.toLowerCase();
    if (!normalized.startsWith("image/") && !normalized.startsWith("video/")) {
      return fallbackResponse(source, `Unsupported type: ${contentType}`);
    }
    const headers = new Headers();
    headers.set("content-type", contentType);
    headers.set("cache-control", "public, max-age=600");
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    return fallbackResponse(source, error instanceof Error ? error.message : "Image proxy failed");
  }
}
