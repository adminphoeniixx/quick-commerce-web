import { describe, expect, it } from "vitest";
import { connectSyncMode } from "./sync";

describe("connectSyncMode", () => {
  it("uses full sync only before the first successful report", () => {
    expect(connectSyncMode(false)).toBe("full");
    expect(connectSyncMode(true)).toBe("recent");
  });
});
