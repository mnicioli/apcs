import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AS PORTAS DO CHATBOT USAM O CLIENTE CERTO?
 *
 * ⚠️ NASCEU DE UM DEFEITO QUE NÃO DAVA ERRO NENHUM. Três das cinco portas
 * (`market-chatbot`, `documents` e `event-chatbot`) foram escritas com
 * `@/lib/supabase/server` — o cliente do USUÁRIO, que passa pela RLS.
 *
 * Quem chama uma porta de chatbot é o robô, que é ANÔNIMO: sem `auth.uid()`,
 * sem papel. E a RLS de `market_bulletins`, `document_versions` e `events` exige
 * papel autenticado. Ligadas como estavam, as três devolveriam vazio SEMPRE.
 *
 * ⚠️ E O SINTOMA APONTARIA PARA O LUGAR ERRADO. Não há exceção, não há 42501 no
 * log, não há nada: a consulta volta com zero linhas, e o bot responde "não há
 * boletim disponível" com o boletim publicado e ativo na tela ao lado. Quem
 * investigasse iria olhar a publicação, não o cliente.
 *
 * Foi encontrado por leitura, não por teste — os próprios arquivos avisavam
 * ("quando essa etapa existir, precisará de um cliente `service_role`") e a
 * etapa chegou. Este teste é para a próxima porta não repetir.
 */

const SERVICES = join(process.cwd(), "src", "lib", "services");

/**
 * ⚠️ O CRITÉRIO É O NOME DO ARQUIVO, e isso é de propósito. `*-chatbot.ts` é a
 * convenção do projeto para "porta de consumo anônimo" desde Palestras, e uma
 * lista de exceções aqui seria o lugar exato onde alguém acrescentaria a
 * próxima porta esquecendo de conferir o cliente.
 */
const portas = readdirSync(SERVICES)
  .filter((nome) => nome.endsWith("-chatbot.ts") && !nome.endsWith(".test.ts"))
  .sort();

function conteudo(arquivo: string): string {
  // Sem os comentários: todos estes arquivos EXPLICAM, no cabeçalho, por que não
  // usam `@/lib/supabase/server` — e a explicação cita o caminho. Lendo o texto
  // cru, o teste reprovaria justamente os arquivos que estão certos.
  return readFileSync(join(SERVICES, arquivo), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}

describe("portas do chatbot", () => {
  it("o teste está de fato lendo os arquivos", () => {
    // Sem isto, um filtro quebrado transformaria a bateria num teste que passa
    // sobre uma lista vazia — o pior tipo de guarda.
    expect(portas).toEqual(
      expect.arrayContaining([
        "document-chatbot.ts",
        "event-chatbot.ts",
        "lecture-chatbot.ts",
        "market-chatbot.ts",
        "survey-chatbot.ts",
      ]),
    );
  });

  it.each(portas)("%s não importa o cliente do usuário", (arquivo) => {
    const sql = conteudo(arquivo);

    expect(
      sql.includes("@/lib/supabase/server"),
      `\n\n${arquivo} importa @/lib/supabase/server.\n\n` +
        `Esse é o cliente do USUÁRIO, e ele passa pela RLS. Quem chama uma porta de\n` +
        `chatbot é o robô, que é ANÔNIMO — a consulta volta VAZIA, sem erro nenhum, e\n` +
        `o bot responde "não encontrei" com o conteúdo publicado na tela ao lado.\n\n` +
        `Use @/lib/supabase/admin. O que autoriza isso é a porta só conseguir LER, e\n` +
        `só linhas que passam pelas condições de publicação.\n`,
    ).toBe(false);
  });

  it.each(portas)("%s usa o cliente service_role", (arquivo) => {
    const sql = conteudo(arquivo);

    expect(
      sql.includes("createAdminClient"),
      `\n\n${arquivo} não usa createAdminClient.\n\n` +
        `Uma porta de chatbot que não abre o cliente service_role em algum lugar ou\n` +
        `está delegando para outra porta (tudo bem, mas então não precisa do sufixo\n` +
        `-chatbot no nome) ou vai devolver vazio em produção.\n`,
    ).toBe(true);
  });
});
