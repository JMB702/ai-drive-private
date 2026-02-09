import { normalizeReturnTo } from "../../lib/access-auth";

type SearchParams = {
  returnTo?: string | string[];
  error?: string | string[];
};

function readSearchValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") return value[0];
  return undefined;
}

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const returnTo = normalizeReturnTo(readSearchValue(resolvedSearchParams?.returnTo));
  const error = readSearchValue(resolvedSearchParams?.error);
  const hasError = error === "invalid_credentials" || error === "invalid_request";

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="auth-brand-badge" aria-hidden="true" />
          <div>
            <h1 id="auth-title">AI Drive</h1>
            <p>Private access required</p>
          </div>
        </div>

        <form className="auth-form" action="/api/auth/login" method="post">
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="auth-label" htmlFor="username">
            Username
          </label>
          <input
            className="auth-input"
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
          />

          <label className="auth-label" htmlFor="password">
            Password
          </label>
          <input
            className="auth-input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />

          {hasError ? <p className="auth-error">Sign-in failed. Check your username and password.</p> : null}

          <button className="auth-submit" type="submit">
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
