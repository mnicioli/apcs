import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Preparo do E2E de Enquetes (§77, §78).
 *
 * ⚠️ ESTA BATERIA ESCREVE NO BANCO APONTADO PELO `.env.local` — que neste
 * projeto é o de PRODUÇÃO. Ela cria doze contatos e uma campanha, roda o ciclo
 * inteiro e apaga tudo no fim (o `afterAll` roda mesmo com teste vermelho).
 *
 * Por isso ela exige um "sim" explícito. Sem a variável abaixo, ela recusa —
 * a mesma lógica do §60: nada roda contra dado de verdade por acidente.
 *
 *   APCS_E2E=1 npx vitest run --config e2e/vitest.e2e.config.ts
 */
if (process.env.APCS_E2E !== "1") {
  throw new Error(
    "E2E de Enquetes recusado: defina APCS_E2E=1 para confirmar que pode escrever no banco do .env.local.",
  );
}

const envLocal = fileURLToPath(new URL("../.env.local", import.meta.url));
const texto = readFileSync(envLocal, "utf8");

// Carrega sem imprimir nada — segredo não vai para o terminal.
for (const linha of texto.split(/\r?\n/)) {
  if (!linha.includes("=") || linha.trimStart().startsWith("#")) continue;
  const i = linha.indexOf("=");
  const chave = linha.slice(0, i).trim();
  const valor = linha
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (chave && valor) process.env[chave] = valor;
}

// ⚠️ O fornecedor é o FALSO (§60): nenhuma mensagem real sai daqui. E
// `NODE_ENV` não é produção — é o que o registry exige para aceitar o falso.
// `NODE_ENV` é somente-leitura nos tipos do Node; o valor em si é gravável.
Object.assign(process.env, { NODE_ENV: "test" });
process.env.APCS_WHATSAPP_PROVIDER = "fake";
process.env.APCS_WHATSAPP_APP_SECRET = "segredo-e2e";
process.env.APCS_JOB_SECRET = "segredo-de-job-e2e";
