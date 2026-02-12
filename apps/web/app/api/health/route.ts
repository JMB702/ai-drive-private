export async function GET() {
  return Response.json({
    ok: true,
    service: "web",
    deployMarker: "a2e-ratio-fix-2026-02-12",
    gitCommit: process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null
  });
}
