import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts", "packages/**/*.test.ts"],
    pool: "forks", // argon2 native addon is happier without worker threads
    fileParallelism: false, // integration suites share one PostgreSQL schema
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
