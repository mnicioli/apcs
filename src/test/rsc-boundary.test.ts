import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FUNÇÃO ATRAVESSANDO A FRONTEIRA RSC — a armadilha, conferida em todas as
 * páginas.
 *
 * ============================================================================
 * ⚠️ NASCEU DE UM DEFEITO QUE FOI PARA PRODUÇÃO E QUEBROU QUATRO TELAS.
 * ============================================================================
 * `EventSearchBox` é um Client Component. A primeira versão dele recebia a
 * função que monta o endereço como PROPRIEDADE, e as quatro telas de seleção de
 * evento escreviam:
 *
 *     <EventSearchBox href={(termo) => presenceHref(1, termo)} ... />
 *
 * Aquelas páginas são SERVER COMPONENTS. O Next recusa isso em runtime —
 * "Functions cannot be passed directly to Client Components" — porque a
 * propriedade precisa ser serializada para chegar ao navegador, e função não é
 * serializável.
 *
 * Inscrições, Lista de Presença, Avaliações e Resultados quebraram ao mesmo
 * tempo, já no ar.
 *
 * ⚠️ POR QUE NENHUMA OUTRA BARREIRA PEGOU:
 *
 *   • `next build` COMPILA — o erro é de execução, não de compilação;
 *   • o `tsc` não modela a fronteira: para ele `(t: string) => string` é um tipo
 *     perfeitamente válido dos dois lados;
 *   • o ESLint não tem regra para isso;
 *   • nenhum teste renderiza aquelas páginas (elas são `async` e batem no
 *     Supabase).
 *
 * Foi preciso alguém abrir a tela.
 *
 * ⚠️ E A ARMADILHA É TRAIÇOEIRA PORQUE O MESMO FORMATO É CERTO DO OUTRO LADO.
 * `Pagination` recebe `href: (page: number) => string` e sempre funcionou — ele
 * é Server Component, e a função é chamada no servidor. A diferença não está na
 * forma da propriedade: está no lado em que o componente roda.
 *
 * ============================================================================
 * ⚠️ O QUE ESTE TESTE PEGA, E O QUE ELE NÃO PEGA.
 * ============================================================================
 * PEGA: função ESCRITA NA PROPRIEDADE — `prop={(x) => ...}` e
 * `prop={function ...}` — num componente `"use client"` usado por um arquivo
 * que não é `"use client"`. É exatamente a forma do defeito que aconteceu.
 *
 * NÃO PEGA: `prop={minhaFuncao}`, onde o valor é um identificador. Distinguir
 * uma função de um objeto ali exigiria resolver o tipo, e um analisador de
 * tipos é outro programa. Fica registrado como limite conhecido — quem passar
 * uma função por identificador ainda vai descobrir na tela.
 *
 * NÃO PEGA TAMBÉM: Server Action passada de propósito (marcada com
 * `"use server"`), que é legítima. Na prática ela chega por identificador, então
 * cai no limite acima — o teste não a acusa, e está certo assim.
 */

const APP = join(process.cwd(), "src", "app");

/** Todo `.tsx` sob `src/app`. */
function arquivosTsx(pasta: string): string[] {
  const achados: string[] = [];

  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosTsx(caminho));
    } else if (nome.endsWith(".tsx") && !nome.includes(".test.")) {
      achados.push(caminho);
    }
  }

  return achados;
}

const arquivos = arquivosTsx(APP);

/**
 * ⚠️ A DIRETIVA TEM DE SER A PRIMEIRA COISA DO ARQUIVO. É assim que o bundler a
 * enxerga — `"use client"` no meio do arquivo não vale nada, e um teste que
 * aceitasse isso classificaria como cliente um arquivo que roda no servidor.
 */
function ehCliente(conteudo: string): boolean {
  const primeira = conteudo
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  return primeira === '"use client";' || primeira === "'use client';";
}

const cliente = new Set(arquivos.filter((f) => ehCliente(readFileSync(f, "utf8"))));

/**
 * A tag de abertura de `<Nome ...>`, contando chaves.
 *
 * ⚠️ CONTAR CHAVES É O QUE TORNA ISTO EXATO. Um `>` dentro de
 * `prop={a > b ? x : y}` não fecha a tag, e um regex ingênuo cortaria a tag no
 * meio — deixando de ver justamente a propriedade seguinte.
 */
function tagsDe(conteudo: string, nome: string): string[] {
  const tags: string[] = [];
  const abertura = new RegExp(`<${nome}[\\s/>]`, "g");

  for (const achado of conteudo.matchAll(abertura)) {
    let profundidade = 0;
    let i = achado.index + nome.length;

    for (; i < conteudo.length; i += 1) {
      const c = conteudo[i];
      if (c === "{") profundidade += 1;
      else if (c === "}") profundidade -= 1;
      else if (c === ">" && profundidade === 0) break;
    }

    tags.push(conteudo.slice(achado.index, i + 1));
  }

  return tags;
}

/** `prop={(x) => ...}` e `prop={function ...}` — a função escrita na propriedade. */
const FUNCAO_NA_PROPRIEDADE =
  /(\w+)\s*=\s*\{\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function\b|\w+\s*=>)/g;

describe("a bateria está lendo o que acha que está lendo", () => {
  it("encontrou arquivos dos dois lados da fronteira", () => {
    expect(arquivos.length).toBeGreaterThan(50);
    expect(cliente.size).toBeGreaterThan(10);
    // E sobra bastante coisa do lado do servidor.
    expect(arquivos.length - cliente.size).toBeGreaterThan(20);
  });

  it("classifica `EventSearchBox` como cliente e a página de presença como servidor", () => {
    const busca = join(APP, "(app)", "events", "event-search-box.tsx");
    const pagina = join(APP, "(app)", "events", "presence", "page.tsx");

    expect(cliente.has(busca), "EventSearchBox deveria ser cliente").toBe(true);
    expect(cliente.has(pagina), "a página de presença deveria ser servidor").toBe(false);
  });
});

describe("nenhum Server Component passa função para um Client Component", () => {
  /**
   * ⚠️ O CASO QUE DEFENDE AS QUATRO TELAS. Ele varre o app inteiro, e não só o
   * módulo de Eventos: a armadilha não é do domínio, é da arquitetura.
   */
  it("nenhuma propriedade de componente cliente recebe função escrita na tag", () => {
    const problemas: string[] = [];

    for (const arquivo of arquivos) {
      if (cliente.has(arquivo)) continue; // cliente → cliente é permitido.

      const conteudo = readFileSync(arquivo, "utf8");

      // Os componentes CLIENTE que este arquivo de servidor importa.
      const importados = new Map<string, string>();

      for (const imp of conteudo.matchAll(/import\s+\{([^}]+)\}\s+from\s+["'](\.[^"']+)["']/g)) {
        const alvo = resolve(dirname(arquivo), imp[2] ?? "");
        const resolvido = [`${alvo}.tsx`, join(alvo, "index.tsx")].find((c) => cliente.has(c));
        if (!resolvido) continue;

        for (const bruto of (imp[1] ?? "").split(",")) {
          const nome = bruto
            .trim()
            .split(/\s+as\s+/)
            .pop()
            ?.trim();
          if (nome && /^[A-Z]/.test(nome)) importados.set(nome, resolvido);
        }
      }

      for (const [nome] of importados) {
        for (const tag of tagsDe(conteudo, nome)) {
          for (const achado of tag.matchAll(FUNCAO_NA_PROPRIEDADE)) {
            problemas.push(`${arquivo.replace(process.cwd(), "")} → <${nome} ${achado[1]}={...}>`);
          }
        }
      }
    }

    expect(
      problemas,
      `função passada para Client Component (não é serializável):\n  ${problemas.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("o guard pega de verdade o defeito que aconteceu", () => {
  /**
   * ⚠️ UM TESTE SOBRE O TESTE, e ele não é cerimônia: um guard que varre o
   * projeto inteiro e nunca acha nada é indistinguível de um guard quebrado. Se
   * o regex ou a contagem de chaves parar de funcionar, o caso acima fica verde
   * para sempre — e este aqui cai.
   *
   * O trecho abaixo é LITERALMENTE o código que quebrou as quatro telas.
   */
  it("reconhece `href={(termo) => presenceHref(1, termo)}` como problema", () => {
    const comoEra = `
      <EventSearchBox
        query={busca}
        href={(termo) => presenceHref(1, termo)}
        label="Evento"
      />
    `;

    const tags = tagsDe(comoEra, "EventSearchBox");
    expect(tags).toHaveLength(1);
    expect([...tags[0]!.matchAll(FUNCAO_NA_PROPRIEDADE)].map((m) => m[1])).toEqual(["href"]);
  });

  it("e NÃO acusa a versão corrigida, que passa uma string", () => {
    const comoEstaAgora = `
      <EventSearchBox
        query={busca}
        basePath="/events/presence"
        label="Evento"
      />
    `;

    const tags = tagsDe(comoEstaAgora, "EventSearchBox");
    expect([...tags[0]!.matchAll(FUNCAO_NA_PROPRIEDADE)]).toEqual([]);
  });

  /** A contagem de chaves — um `>` dentro de uma propriedade não fecha a tag. */
  it("um `>` dentro de chaves não corta a tag no meio", () => {
    const complicado = `<Coisa a={x > 1} b={(y) => y} />`;
    const tags = tagsDe(complicado, "Coisa");

    expect(tags[0]).toContain("b={");
    expect([...tags[0]!.matchAll(FUNCAO_NA_PROPRIEDADE)].map((m) => m[1])).toEqual(["b"]);
  });
});
