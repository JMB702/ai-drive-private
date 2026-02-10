import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, normalizeReturnTo, verifyAccessSession } from "./lib/access-auth";

function authRequiredJsonResponse(): NextResponse {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const requiredUsername = process.env.APP_ACCESS_USERNAME;
  const requiredPassword = process.env.APP_ACCESS_PASSWORD;
  if (!requiredUsername || !requiredPassword) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (
    pathname === "/sign-in" ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (token && await verifyAccessSession(token, requiredUsername, requiredPassword)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return authRequiredJsonResponse();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/sign-in";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("returnTo", normalizeReturnTo(`${pathname}${search}`));
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
