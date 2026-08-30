import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      // Regras do Next (boas práticas de App Router, head, scripts, imagens).
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Regras de Hooks do React — pegam bugs reais de dependências/ordem.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    // Scripts de manutenção rodam no Node, fora do Next — `process` e `console`
    // existem ali. Declarados explicitamente (em vez de puxar o pacote
    // `globals`) porque são exatamente dois, e uma dependência a mais para duas
    // linhas é dependência a mais para sempre.
    files: ["scripts/**/*.{mjs,js}"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  },
  eslintConfigPrettier,
  {
    // `ToDo/` é material de referência recebido do cliente (outro framework,
    // outras dependências) — não faz parte do build e não é versionado.
    ignores: [
      "node_modules/",
      ".next/",
      "dist/",
      "ToDo/",
      "next-env.d.ts",
      "src/types/database.ts",
    ],
  },
];
