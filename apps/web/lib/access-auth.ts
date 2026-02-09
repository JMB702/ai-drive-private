const encoder = new TextEncoder();

export const ACCESS_COOKIE_NAME = "aidrive_access";
export const ACCESS_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type AccessSessionPayload = {
  v: 1;
  u: string;
  exp: number;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    const binary = atob(normalized + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function timingSafeEqual(left: string, right: string): boolean {
  const maxLen = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < maxLen; i += 1) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

async function hmacSha256Base64Url(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

function decodePayload(payloadToken: string): AccessSessionPayload | null {
  const payloadBytes = fromBase64Url(payloadToken);
  if (!payloadBytes) return null;
  try {
    const raw = new TextDecoder().decode(payloadBytes);
    const parsed = JSON.parse(raw) as Partial<AccessSessionPayload>;
    if (!parsed || parsed.v !== 1) return null;
    if (typeof parsed.u !== "string" || parsed.u.length === 0) return null;
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
    return { v: 1, u: parsed.u, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function normalizeReturnTo(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/sign-in")) return "/";
  if (value.startsWith("/api/auth/")) return "/";
  return value;
}

export async function createAccessSession(username: string, secret: string, ttlSeconds = ACCESS_SESSION_TTL_SECONDS): Promise<string> {
  const payload: AccessSessionPayload = {
    v: 1,
    u: username,
    exp: Date.now() + Math.max(1, ttlSeconds) * 1000
  };
  const payloadToken = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await hmacSha256Base64Url(payloadToken, secret);
  return `${payloadToken}.${signature}`;
}

export async function verifyAccessSession(token: string, username: string, secret: string): Promise<boolean> {
  const [payloadToken, providedSignature] = token.split(".");
  if (!payloadToken || !providedSignature) return false;

  const payload = decodePayload(payloadToken);
  if (!payload) return false;
  if (payload.u !== username) return false;
  if (payload.exp <= Date.now()) return false;

  const expectedSignature = await hmacSha256Base64Url(payloadToken, secret);
  return timingSafeEqual(providedSignature, expectedSignature);
}

