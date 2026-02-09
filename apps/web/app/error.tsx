"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
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
