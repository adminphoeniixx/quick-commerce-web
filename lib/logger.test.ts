import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";
describe("structured logger", () => {
  afterEach(()=>vi.restoreAllMocks());
  it("writes JSON and redacts secret-shaped keys", () => { const spy=vi.spyOn(console,"log").mockImplementation(()=>{}); logger.info("test.event",{userId:12n,password:"never",nested:{accessToken:"never",safe:"yes"}}); const record=JSON.parse(String(spy.mock.calls[0][0])); expect(record).toMatchObject({level:"info",message:"test.event",userId:"12",nested:{safe:"yes"}}); expect(JSON.stringify(record)).not.toContain("never"); });
});
