import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "./secrets";

beforeAll(() => {
  process.env.CONNECTION_ENC_KEY ??= randomBytes(32).toString("base64");
});

describe("connector secret encryption", () => {
  it("round-trips a secret", () => {
    const secret = "platform-portal-password-123!";
    const blob = encryptSecret(secret);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain(secret);
    expect(decryptSecret(blob)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("rejects a tampered blob", () => {
    const blob = encryptSecret("abc");
    const tampered = blob.slice(0, -2) + (blob.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
