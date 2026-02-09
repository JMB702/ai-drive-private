import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, normalizeReturnTo } from "../../../../lib/access-auth";

function redirectTo(path: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: {
      location: path
    }
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let returnTo = "/";
  try {
    const formData = await request.formData();
    returnTo = normalizeReturnTo(String(formData.get("returnTo") ?? "/sign-in"));
  } catch {
    returnTo = "/sign-in";
  }

  const response = redirectTo(returnTo);
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 0
  });
  return response;
}
