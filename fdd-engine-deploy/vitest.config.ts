import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Minimal vitest config — it exists for exactly one reason.
 *
 * Every test used to live in lib/ and import by relative path, so no config was
 * needed. components/CashLadder.test.tsx tests a COMPONENT, and components
 * import through the "@/..." alias that Next resolves from tsconfig paths.
 * Vitest does not read tsconfig paths, so the alias is declared here.
 *
 * Nothing else is overridden on purpose: the default include pattern already
 * picks up lib/*.test.ts exactly as before.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
