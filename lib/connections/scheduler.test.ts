import { describe, expect, it } from "vitest";
import { validCron } from "./scheduler";

describe("connection schedules", () => {
  it("accepts standard five-field cron expressions", () => {
    expect(validCron("0 */6 * * *")).toBe(true);
    expect(validCron("15 2 * * 1-5")).toBe(true);
  });
  it("rejects malformed expressions", () => {
    expect(validCron("every hour")).toBe(false);
    expect(validCron("0 0 * * * unexpected")).toBe(false);
    expect(validCron("0 0 * * $bad")).toBe(false);
  });
});
