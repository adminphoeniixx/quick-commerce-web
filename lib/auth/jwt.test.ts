import { describe, it, expect } from "vitest";
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashToken } from "./jwt";

describe("access tokens", () => {
  it("signs and verifies a valid token with claims", async () => {
    const t = await signAccessToken({ sub: "42", email: "a@b.com", sa: false });
    const claims = await verifyAccessToken(t);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("42");
    expect(claims!.email).toBe("a@b.com");
    expect(claims!.sa).toBe(false);
  });

  it("rejects a tampered token", async () => {
    const t = await signAccessToken({ sub: "1", email: "x@y.com", sa: true });
    expect(await verifyAccessToken(t + "x")).toBeNull();
  });
});

describe("refresh tokens", () => {
  it("generates a random token whose hash is stable and matches", () => {
    const { token, hash } = generateRefreshToken();
    expect(token.length).toBeGreaterThan(20);
    expect(hashToken(token)).toBe(hash);
  });

  it("different tokens produce different hashes", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.hash).not.toBe(b.hash);
  });
});
