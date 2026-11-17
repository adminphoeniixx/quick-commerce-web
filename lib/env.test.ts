import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./env";
const valid = { DATABASE_URL:"postgresql://user:pass@localhost:5432/db", JWT_ACCESS_SECRET:"access-secret-123456", JWT_REFRESH_SECRET:"refresh-secret-123456", NODE_ENV:"test" } as NodeJS.ProcessEnv;
describe("environment validation", () => {
  it("applies safe numeric defaults", () => { expect(validateEnvironment(valid)).toMatchObject({ IMPORT_CONCURRENCY:4, JOB_MAX_ATTEMPTS:3 }); });
  it("rejects unsafe production queue configuration", () => { expect(()=>validateEnvironment({...valid,NODE_ENV:"production"})).toThrow(/REDIS_URL/); });
  it("rejects non-PostgreSQL database URLs", () => { expect(()=>validateEnvironment({...valid,DATABASE_URL:"mysql://localhost/db"})).toThrow(/PostgreSQL/); });
});
