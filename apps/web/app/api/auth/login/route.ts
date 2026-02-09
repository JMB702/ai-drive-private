import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_SESSION_TTL_SECONDS,
  createAccessSession,
  normalizeReturnTo
} from "../../../../lib/access-auth";

function redirectTo(path: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: {
      location: path
    }
  });
}

function credentialMatches(input: string, expected: string): boolean {
  const maxLen = Math.max(input.length, expected.length);
  let mismatch = input.length ^ expected.length;
  for (let i = 0; i < maxLen; i += 1) {
    mismatch |= (input.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requiredUsername = process.env.APP_ACCESS_USERNAME;
  const requiredPassword = process.env.APP_ACCESS_PASSWORD;
  if (!requiredUsername || !requiredPassword) {
    return redirectTo("/");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectTo("/sign-in?error=invalid_request");
  }

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const returnTo = normalizeReturnTo(String(formData.get("returnTo") ?? "/"));

  const usernameOk = credentialMatches(username, requiredUsername);
  const passwordOk = credentialMatches(password, requiredPassword);
  if (!usernameOk || !passwordOk) {
    const query = new URLSearchParams({
      error: "invalid_credentials",
      returnTo
    });
    return redirectTo(`/sign-in?${query.toString()}`);
  }

  const token = await createAccessSession(requiredUsername, requiredPassword);
  // Product requirement: after sign-in always land on the dashboard.
  const response = redirectTo("/");
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ACCESS_SESSION_TTL_SECONDS
  });
  return response;
}
