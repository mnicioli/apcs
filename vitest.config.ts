import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,

    /**
     * ⚠️ ACIMA DOS 5 s PADRÃO, E ISSO NÃO É ESCONDER LENTIDÃO.
     *
     * Os testes de formulário de várias etapas (`membership-form`,
     * `registration-form`) digitam dezenas de campos em happy-dom. Sozinhos,
     * cada um leva 1–2 s; com a bateria inteira rodando em paralelo, os mais
     * pesados encostavam nos 5 s e falhavam por TEMPO — sobre código correto,
     * e de forma diferente a cada execução.
     *
     * Um teste que falha por contenção de CPU não está dizendo nada sobre o
     * sistema: ele só ensina o time a reexecutar a bateria até passar, que é
     * como uma falha de verdade acaba ignorada. O teto novo é folgado o
     * bastante para o ruído sumir e curto o bastante para uma promessa
     * esquecida ainda travar a bateria em vez de pendurá-la.
     */
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` é injetado pelo Next em tempo de build e não resolve fora
      // dele. Sem este alias, nenhum service ou action seria testável — a
      // marcação que protege a produção barraria os testes que a validam. O
      // build real continua usando o pacote de verdade.
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
});
