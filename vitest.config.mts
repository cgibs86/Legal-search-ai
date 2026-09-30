import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside React Server Components; tests run modules directly.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
      "next/headers": path.resolve(import.meta.dirname, "tests/support/next-headers.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    setupFiles: ["tests/support/setup.ts"],
    testTimeout: 20000,
  },
});
