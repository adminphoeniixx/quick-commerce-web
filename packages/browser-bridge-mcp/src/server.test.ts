import { describe, expect, it } from "vitest";
import { isBlinkitBrandsMagicLink } from "./server.js";

describe("Blinkit Brands magic link validation", () => {
  it("accepts secure Blinkit portal links", () => {
    expect(isBlinkitBrandsMagicLink("https://brands.blinkit.com/login?token=secret")).toBe(true);
    expect(isBlinkitBrandsMagicLink("https://auth.blinkit.com/magic/callback?code=secret")).toBe(true);
  });
  it("rejects lookalikes, non-HTTPS links, and invalid input", () => {
    expect(isBlinkitBrandsMagicLink("https://blinkit.com.evil.example/login?token=secret")).toBe(false);
    expect(isBlinkitBrandsMagicLink("http://brands.blinkit.com/login?token=secret")).toBe(false);
    expect(isBlinkitBrandsMagicLink("not-a-url")).toBe(false);
  });
});
