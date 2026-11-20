import { describe, expect, it } from "vitest";
import { decideAuthCheck, EXPIRED_AFTER_FAILURES } from "./keepalive";

describe("decideAuthCheck", () => {
  it("healthy resets failures", () => {
    expect(decideAuthCheck({ ok: true }, 1)).toEqual({ kind: "healthy", failures: 0 });
  });
  it("first login_required is only suspect", () => {
    expect(decideAuthCheck({ ok: false, code: "login_required" }, 0)).toEqual({ kind: "suspect", failures: 1 });
  });
  it("second login_required in a row expires the session", () => {
    expect(EXPIRED_AFTER_FAILURES).toBe(2);
    expect(decideAuthCheck({ ok: false, code: "login_required" }, 1)).toEqual({ kind: "expired", failures: 2 });
  });
  it.each(["blocked", "captcha", "rate_limited"])("%s pauses without counting", (code) => {
    expect(decideAuthCheck({ ok: false, code }, 1)).toEqual({ kind: "blocked", failures: 1, code });
  });
  it.each(["busy", "browser_unavailable", "unknown", undefined])("%s is skipped and never counts", (code) => {
    expect(decideAuthCheck({ ok: false, code }, 1)).toMatchObject({ kind: "skipped", failures: 1 });
  });
});
