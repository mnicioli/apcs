import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FUNÇÃO QUE O SISTEMA CHAMA E NÃO PODE EXECUTAR — a armadilha, perseguida pela
 * cadeia inteira de chamadas.
 *
 * ⚠️ NASCEU DE UM DEFEITO EM PRODUÇÃO. `20260828205853_event_dispatch.sql`
 * revogou `profile_for_event_segment` e `notification_phone_key` de
 * `authenticated`, com um comentário que era verdade na época: "usada dentro das
 * funções acima, que rodam como dono. Ninguém a chama de fora."
 *
 * Duas semanas depois, `20260909000000_survey_audience_members.sql` fez
 * `resolve_audience_criteria` — que é SECURITY **INVOKER**, de propósito — usar
 * as duas. A partir daí, cinco funções de Enquetes passaram a esbarrar em
 * `permission denied for function` no navegador de quem usa o sistema.
 *
 * ⚠️ E O SINTOMA NÃO APONTAVA PARA LÁ. O 42501 derrubava `set_survey_audience`
 * inteira, então o público-alvo nunca era gravado; o agendamento seguinte
 * encontrava a enquete sem público e dizia "a segmentação não alcança ninguém".
 * A tela mandava revisar um público-alvo que estava certo.
 *
 * ⚠️ POR QUE NENHUMA OUTRA BARREIRA PEGA ISSO: a função existe, compila, é
 * chamável, e a migration que a criou passou — porque migration roda como DONO,
 * que pode executar tudo. É o mesmo formato do grant de coluna de
 * `events.description` (ver `sql-column-grants.test.ts`): privilégio só falha
 * para quem NÃO é dono.
 *
 * O QUE ESTE TESTE FAZ: monta o grafo de chamadas das funções `public.*` das
 * migrations, parte de toda função SECURITY INVOKER que `authenticated` pode
 * executar, e segue as chamadas. Toda função alcançada precisa ser executável
 * por `authenticated`. A travessia PARA numa função SECURITY DEFINER — dali para
 * baixo quem manda é o dono —, mas a própria DEFINER precisa ser executável,
 * porque chamar uma função exige EXECUTE nela mesma.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

interface Funcao {
  nome: string;
  arquivo: string;
  definer: boolean;
  trigger: boolean;
  corpo: string;
}

/**
 * As funções, pelo NOME e não pela assinatura.
 *
 * Sobrecarga intencional não existe neste projeto — `20260905000000` documenta
 * por que ela é um defeito (42725 numa chamada por nome de argumento). Chavear
 * por nome evita ter que casar tipos de parâmetro, que é onde uma varredura de
 * texto erraria.
 */
const funcoes = new Map<string, Funcao>();

/** `true` = pode executar; `false` = revogado. A ÚLTIMA menção vence. */
const podeExecutar = new Map<string, boolean>();

const CABECALHO = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi;

for (const arquivo of arquivos) {
  const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8");

  for (const achado of sql.matchAll(CABECALHO)) {
    const nome = achado[1] ?? "";
    const inicio = achado.index ?? 0;

    // O corpo vai do cabeçalho até o fim do dólar-quote que o abre. Sem casar o
    // rótulo do dólar-quote, um `$$` interno terminaria a leitura cedo demais.
    const resto = sql.slice(inicio);
    const abertura = /\bas\s+(\$\w*\$)/i.exec(resto);
    if (!abertura?.[1]) continue;

    const marcador = abertura[1];
    const depoisDaAbertura = (abertura.index ?? 0) + abertura[0].length;
    const fim = resto.indexOf(marcador, depoisDaAbertura);
    if (fim < 0) continue;

    const preambulo = resto.slice(0, depoisDaAbertura);
    const corpo = resto.slice(depoisDaAbertura, fim);

    funcoes.set(nome, {
      nome,
      arquivo,
      definer: /security\s+definer/i.test(preambulo),
      trigger: /returns\s+trigger/i.test(preambulo),
      corpo,
    });
  }

  // ⚠️ SEM OS COMENTÁRIOS, e isto não é detalhe: toda migration deste projeto
  // termina com um bloco ROLLBACK que escreve o `revoke` inverso em linhas
  // comentadas. Lendo o texto cru, o último `revoke` de um arquivo é sempre o
  // comentário — e o teste concluiria que TODO grant foi desfeito.
  const semComentarios = sql.replace(/--[^\n]*/g, "");

  // grant / revoke execute on function public.X(...) to|from ...
  for (const comando of semComentarios.split(";")) {
    const alvo = /\b(grant|revoke)\s+execute\s+on\s+function\s+public\.(\w+)/i.exec(comando);
    if (!alvo) continue;
    if (!/\bauthenticated\b/i.test(comando)) continue;

    podeExecutar.set(alvo[2] ?? "", alvo[1]?.toLowerCase() === "grant");
  }
}

/** As funções `public.*` que o corpo desta chama. */
function chamadas(corpo: string): string[] {
  const nomes = new Set<string>();
  for (const uso of corpo.matchAll(/public\.(\w+)\s*\(/g)) {
    const nome = uso[1] ?? "";
    if (funcoes.has(nome)) nomes.add(nome);
  }
  return [...nomes];
}

interface Problema {
  alcancada: string;
  porQuem: string;
  raiz: string;
}

/**
 * ⚠️ AS RAÍZES SÃO AS FUNÇÕES INVOKER QUE `authenticated` PODE CHAMAR. É por elas
 * que uma requisição do navegador entra no banco — e é o privilégio DELA que vale
 * do começo ao fim da cadeia, até esbarrar numa SECURITY DEFINER.
 */
function varrer(): Problema[] {
  const problemas: Problema[] = [];

  for (const raiz of funcoes.values()) {
    if (raiz.definer || raiz.trigger) continue;
    if (podeExecutar.get(raiz.nome) !== true) continue;

    const vistas = new Set<string>([raiz.nome]);
    const fila: { nome: string; porQuem: string }[] = chamadas(raiz.corpo).map((nome) => ({
      nome,
      porQuem: raiz.nome,
    }));

    while (fila.length > 0) {
      const atual = fila.shift();
      if (!atual || vistas.has(atual.nome)) continue;
      vistas.add(atual.nome);

      const alvo = funcoes.get(atual.nome);
      if (!alvo) continue;

      // Chamar exige EXECUTE na função chamada, seja ela INVOKER ou DEFINER.
      // `returns trigger` fica de fora: gatilho é disparado pelo sistema, não
      // chamado por ninguém.
      if (!alvo.trigger && podeExecutar.get(alvo.nome) === false) {
        problemas.push({ alcancada: alvo.nome, porQuem: atual.porQuem, raiz: raiz.nome });
      }

      // ⚠️ A TRAVESSIA PARA NUMA DEFINER: dali para baixo quem executa é o dono
      // da função, e o privilégio de quem clicou deixa de valer.
      if (!alvo.definer) {
        for (const seguinte of chamadas(alvo.corpo)) {
          fila.push({ nome: seguinte, porQuem: alvo.nome });
        }
      }
    }
  }

  return problemas;
}

const problemas = varrer();

describe("privilégio de execução ao longo da cadeia de chamadas", () => {
  it("o teste está de fato lendo as migrations", () => {
    // Sem isto, uma expressão regular quebrada transformaria a bateria num teste
    // que passa sobre listas vazias — o pior tipo de guarda.
    expect(arquivos.length).toBeGreaterThan(10);
    expect(funcoes.size).toBeGreaterThan(50);
    expect(funcoes.get("resolve_audience_criteria")?.definer).toBe(false);
    expect(podeExecutar.get("resolve_audience_criteria")).toBe(true);

    // As duas do defeito, pregadas aqui: se um `revoke` futuro as tirar de
    // `authenticated`, é o teste abaixo que reprova — e este garante que ele
    // está mesmo olhando para elas, e não passando por não as conhecer.
    expect(podeExecutar.get("profile_for_event_segment")).toBe(true);
    expect(podeExecutar.get("notification_phone_key")).toBe(true);
    expect(chamadas(funcoes.get("resolve_audience_criteria")?.corpo ?? "")).toEqual(
      expect.arrayContaining(["profile_for_event_segment", "notification_phone_key"]),
    );
  });

  it("nenhuma função alcançável por authenticated esbarra em permission denied", () => {
    const relato = problemas
      .map(
        (p) =>
          `public.${p.alcancada} é chamada por public.${p.porQuem} (alcançável a partir de ` +
          `public.${p.raiz}, que é SECURITY INVOKER e está liberada para authenticated), ` +
          `mas authenticated NÃO pode executá-la.\n` +
          `      → conserto: grant execute on function public.${p.alcancada}(...) to authenticated;\n` +
          `      → ou torne public.${p.porQuem} SECURITY DEFINER, se ela puder rodar como dono.`,
      )
      .join("\n\n");

    expect(
      problemas,
      relato &&
        `\n\nCadeia de chamadas com privilégio faltando — isto vira 42501 ` +
          `("permission denied for function") no navegador, e NUNCA no psql de quem ` +
          `roda a migration:\n\n${relato}\n`,
    ).toEqual([]);
  });
});
