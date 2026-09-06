import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EMBEDS AMBÍGUOS DO PostgREST, conferidos em todos os services.
 *
 * ============================================================================
 * ⚠️ NASCEU DE UM DEFEITO QUE ATRAVESSOU QUATRO ETAPAS SEM NINGUÉM VER.
 * ============================================================================
 * `event_participants` tem DUAS chaves estrangeiras para `event_registrations`:
 * a da coluna (`registration_id`) e a COMPOSTA que guarda a cópia de `event_id`.
 * O PostgREST vê as duas, não sabe qual seguir, e recusa o embed inteiro com
 * "more than one relationship was found".
 *
 * O modo de falhar foi o pior possível:
 *
 *   1. a consulta falhava SEMPRE;
 *   2. o tratamento de erro devolvia mapa vazio ("melhor que derrubar a tela");
 *   3. a grid mostrava "0 inscritos" para todo mundo;
 *   4. zero é um número PLAUSÍVEL, então ninguém desconfiou.
 *
 * E os testes não pegaram porque mockam o Supabase — que é justamente quem
 * recusava. Só apareceu quando uma Landing Page de verdade foi criada e alguém
 * leu o console do servidor.
 *
 * ⚠️ POR QUE UM TESTE DE TEXTO. É o mesmo raciocínio de `sql-column-grants` e
 * `sql-returns-table`: type-check, lint e build não falam com o PostgREST, e um
 * teste que mocka o cliente não pode descobrir o que o cliente REAL recusa. Ler
 * a string da consulta é grosseiro e responde uma pergunta só — que é o que o
 * mantém sem falso positivo.
 */

const SERVICES = join(process.cwd(), "src", "lib", "services");

/**
 * As tabelas que têm MAIS DE UMA chave estrangeira para a mesma vizinha, e por
 * isso exigem a constraint nomeada em todo embed.
 *
 * ⚠️ A LISTA É CURTA DE PROPÓSITO. Ela não tenta adivinhar o esquema: cada
 * entrada foi conferida na migration e traz o motivo. Uma lista gerada
 * automaticamente daria falso positivo em toda tabela com duas FKs para
 * `profiles` que o código já desambigua.
 */
const AMBIGUAS: { tabela: string; motivo: string }[] = [
  {
    tabela: "event_participants",
    motivo:
      "duas FKs para event_registrations: registration_id e a composta " +
      "(registration_id, event_id) da decisão 3 do Prompt 1",
  },
];

const arquivos = readdirSync(SERVICES)
  .filter((nome) => nome.endsWith(".ts") && !nome.endsWith(".test.ts"))
  .map((nome) => [nome, readFileSync(join(SERVICES, nome), "utf8")] as const);

describe("a bateria está lendo os services", () => {
  it("encontra os arquivos", () => {
    expect(arquivos.length).toBeGreaterThan(5);
    expect(arquivos.map(([nome]) => nome)).toContain("event-landing.ts");
  });
});

/**
 * O código sem comentários.
 *
 * ⚠️ A PRIMEIRA VERSÃO DESTE TESTE NÃO FAZIA ISSO, E SE ACUSOU SOZINHA. Ela
 * procurava o nome da tabela em qualquer lugar do arquivo e batia em duas coisas
 * que não são consulta: o texto dentro de um comentário e — pior — o PRÓPRIO
 * NOME DA CONSTRAINT (`event_participants_registration_id_fkey` começa com
 * `event_participants`). Um teste que falha sobre código correto é um teste que
 * alguém desliga.
 */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("todo embed de tabela ambígua nomeia a constraint", () => {
  for (const { tabela, motivo } of AMBIGUAS) {
    it(`${tabela} — ${motivo}`, () => {
      // A forma de um embed SEM constraint: o nome da tabela seguido direto da
      // lista de colunas. Com a constraint, há um `!` no meio, e o padrão não
      // casa — que é exatamente a distinção que interessa.
      const ruim = new RegExp(`${tabela}\\s*\\(`, "g");

      for (const [nome, conteudo] of arquivos) {
        const achados = semComentarios(conteudo).match(ruim) ?? [];

        expect(
          achados,
          `${nome}: o embed de ${tabela} precisa nomear a constraint ` +
            `(ex.: ${tabela}!${tabela}_registration_id_fkey). Sem isso o PostgREST ` +
            `recusa a consulta inteira — e o erro vira um número plausível na tela.`,
        ).toEqual([]);
      }
    });
  }

  /**
   * ⚠️ E O CASO CONHECIDO, ESCRITO À MÃO. O laço acima é genérico e pode se
   * enganar; este caso responde a pergunta exata que custou o defeito: as duas
   * consultas de `event-landing.ts` nomeiam a constraint?
   */
  it("as duas consultas de event-landing nomeiam a FK de participantes", () => {
    const conteudo = arquivos.find(([nome]) => nome === "event-landing.ts")?.[1] ?? "";

    const embeds = conteudo.match(/participants:event_participants[^\s(]*/g) ?? [];
    expect(embeds.length).toBe(2);
    for (const embed of embeds) {
      expect(embed).toBe("participants:event_participants!event_participants_registration_id_fkey");
    }
  });
});
