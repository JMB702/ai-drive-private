import { describe, expect, it } from "vitest";
import {
  createAccessSession,
  normalizeReturnTo,
  verifyAccessSession
} from "../lib/access-auth";

describe("access auth", () => {
  it("creates a valid session token that can be verified", async () => {
    const token = await createAccessSession("jeff", "secret", 60);
    await expect(verifyAccessSession(token, "jeff", "secret")).resolves.toBe(true);
  });

  it("rejects tokens when signature is tampered", async () => {
    const token = await createAccessSession("jeff", "secret", 60);
    const [payload, signature] = token.split(".");
    const tampered = `${payload}.${signature.slice(0, -1)}x`;
    await expect(verifyAccessSession(tampered, "jeff", "secret")).resolves.toBe(false);
  });

  it("rejects tokens when username or secret changes", async () => {
    const token = await createAccessSession("jeff", "secret", 60);
    await expect(verifyAccessSession(token, "other-user", "secret")).resolves.toBe(false);
    await expect(verifyAccessSession(token, "jeff", "wrong-secret")).resolves.toBe(false);
  });

  it("normalizes unsafe return paths", () => {
    expect(normalizeReturnTo(undefined)).toBe("/");
    expect(normalizeReturnTo("https://evil.test")).toBe("/");
    expect(normalizeReturnTo("//evil.test/path")).toBe("/");
    expect(normalizeReturnTo("/sign-in")).toBe("/");
    expect(normalizeReturnTo("/api/auth/login")).toBe("/");
    expect(normalizeReturnTo("/drive?project=dogs")).toBe("/drive?project=dogs");
  });
});

