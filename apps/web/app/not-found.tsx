import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="page">
      <header className="page-head">
        <h2>Page not found</h2>
        <p>The app hit a missing route while navigating.</p>
      </header>

      <section className="panel">
        <p className="muted">Use one of these links to recover:</p>
        <div className="action-row">
          <Link className="btn" href="/">Dashboard</Link>
          <Link className="btn" href="/drive">All Images</Link>
        </div>
      </section>
    </main>
  );
}
