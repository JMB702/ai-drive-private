"use client";

import { useEffect } from "react";
import Link from "next/link";
import { createTraceId, postClientDiagnostic } from "../lib/diagnostics-client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    const traceId = createTraceId();
    void postClientDiagnostic({
      severity: "HIGH",
      category: "CLIENT",
      component: "web.global_error_boundary",
      eventName: "client.global_error",
      message: error.message || "Unhandled app error",
      workspaceId: "ws_demo",
      traceId,
      context: {
        digest: error.digest ?? null,
        route: typeof window !== "undefined" ? window.location.pathname : null,
        stack: error.stack ?? null
      }
    });
  }, [error]);

  return (
    <main className="page">
      <header className="page-head">
        <h2>Something went wrong</h2>
        <p>Generation or image loading failed unexpectedly.</p>
      </header>

      <section className="panel">
        <p className="muted mono">{error.message || "Unexpected application error"}</p>
        <div className="action-row">
          <button className="btn" type="button" onClick={() => reset()}>Try again</button>
          <Link className="btn" href="/">Dashboard</Link>
          <Link className="btn" href="/drive">All Images</Link>
        </div>
      </section>
    </main>
  );
}
