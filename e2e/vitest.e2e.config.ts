import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Config do E2E do PROMPT 3/3 (§77, §78).
 *
 * ⚠️ O arquivo de teste chama-se `*.e2e.ts`, e NÃO `*.test.ts`, de propósito: o
 * `include` do vitest.config.ts principal é `src/**\/*.test.ts`, então este
 * arquivo nunca entra no `pnpm test` nem no CI. Ele escreve no banco de
 * PRODUÇÃO — uma bateria que cria e apaga campanha não pode rodar sozinha a
 * cada commit.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["e2e/*.e2e.ts"],
    setupFiles: ["./e2e/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../src/test/server-only.ts", import.meta.url)),
    },
  },
});
