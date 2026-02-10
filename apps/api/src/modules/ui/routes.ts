import type { FastifyInstance } from "fastify";
import { z } from "zod";

const uiProfileQuerySchema = z.object({
  surface: z.enum(["mobile", "desktop"]).optional()
});

type UiSurface = "mobile" | "desktop";

const VIEWPORT_BREAKPOINT_PX = 980;

const UI_PROFILES = {
  mobile: {
    surface: "mobile" as UiSurface,
    viewportBreakpointPx: VIEWPORT_BREAKPOINT_PX,
    generatePanel: {
      toolsDefaultCollapsed: true
    },
    referenceImages: {
      maxPerImageDataUrlBytes: 1_300_000,
      maxTotalDataUrlBytes: 3_800_000,
      safeGenerationBodyBytes: 5_300_000
    }
  },
  desktop: {
    surface: "desktop" as UiSurface,
    viewportBreakpointPx: VIEWPORT_BREAKPOINT_PX,
    generatePanel: {
      toolsDefaultCollapsed: false
    },
    referenceImages: {
      maxPerImageDataUrlBytes: 1_900_000,
      maxTotalDataUrlBytes: 5_200_000,
      safeGenerationBodyBytes: 7 * 1024 * 1024
    }
  }
} as const;

function inferSurfaceFromUserAgent(userAgent: string | undefined): UiSurface {
  if (!userAgent) return "desktop";
  const normalized = userAgent.toLowerCase();
  if (/(android|iphone|ipod|iemobile|opera mini|blackberry|mobile)/.test(normalized)) {
    return "mobile";
  }
  if (/(ipad|tablet)/.test(normalized)) {
    return "mobile";
  }
  return "desktop";
}

export async function registerUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/ui/profile", async (request) => {
    const query = uiProfileQuerySchema.parse(request.query ?? {});
    const userAgentHeader = request.headers["user-agent"];
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader.join(" ") : userAgentHeader;
    const surface = query.surface ?? inferSurfaceFromUserAgent(userAgent);
    const profile = surface === "mobile" ? UI_PROFILES.mobile : UI_PROFILES.desktop;
    return { profile };
  });
}
