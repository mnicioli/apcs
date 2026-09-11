import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getResultsExport } from "@/lib/services/event-results";
import { createClient } from "@/lib/supabase/server";
import { formatCalendarDate, formatDateTime } from "@/lib/utils";
import { parseResultsFilters } from "@/modules/event/event.results.routes";

/**
 * A EXPORTAÇÃO DOS RESULTADOS (§25, §27, §41, §42).
 *
 * ============================================================================
 * ⚠️ CSV, E NÃO XLSX — a convenção que este projeto já tem, em dois lugares.
 * ============================================================================
 * `surveys/[id]/results/export` e `registrations/[eventId]/export` exportam CSV
 * com BOM UTF-8 e separador `;`, e o comentário de lá explica: este projeto não
 * tem biblioteca de planilha, e acrescentar uma (SheetJS pesa centenas de KB e
 * tem histórico de CVE) para gerar um arquivo que o Excel abre igual seria pagar
 * caro por nada.
 *
 * O arquivo abre no Excel com dois cliques, uma linha por resposta, acentos
 * corretos e colunas separadas — que é o que o §25 descreve. O que muda é a
 * extensão.
 *
 * ============================================================================
 * ⚠️ A PERMISSÃO É CONFERIDA AQUI, E É O PONTO MAIS IMPORTANTE DO ARQUIVO.
 * ============================================================================
 * Este endpoint é uma URL: alguém pode chamá-la direto, colada num navegador,
 * sem passar por tela nenhuma. Sem a checagem, a exportação seria a PORTA DOS
 * FUNDOS de uma tela protegida — e o que sai por ela é nome, e-mail, telefone e
 * o COMENTÁRIO IDENTIFICADO de centenas de pessoas (§41).
 *
 * São três camadas: `results.export` aqui, `results_is_exporter()` dentro de
 * `log_evaluation_export` (que é DEFINER e confere por dentro), e a RLS das
 * tabelas de avaliação dentro de `event_results_export`, que devolve zero linhas
 * para quem não é `evaluations_is_reader()`.
 *
 * ⚠️ E `results.export` É MAIS ESTREITA QUE `results.read` — só Administrador.
 * Ver a matriz: ler o painel deixa o dado dentro do sistema; baixar o arquivo o
 * tira de lá para sempre.
 */

/**
 * Teto de linhas no arquivo.
 *
 * ⚠️ ELE EXISTE E É GENEROSO — o mesmo número da exportação de Inscrições. O §27
 * pede o recorte inteiro, e não a página; o teto está aqui para uma consulta
 * acidental não virar um arquivo de gigabytes, não para limitar uso legítimo.
 * O maior evento da APCS tem centenas de participantes.
 */
const MAX_LINHAS = 5000;

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "results.export")) {
    return new NextResponse("Sem permissão para exportar os resultados.", { status: 403 });
  }

  const { eventId } = await params;

  try {
    // ⚠️ OS MESMOS FILTROS DA TELA (§27), lidos pela MESMA função que a página
    // usa. É isso que faz "a exportação respeita os filtros" ser uma
    // consequência do desenho, e não uma regra a lembrar: o botão é um link
    // montado por `resultsExportHref`, e os dois lados leem os mesmos
    // parâmetros.
    const url = new URL(request.url);
    const filtros = parseResultsFilters(Object.fromEntries(url.searchParams));

    const dados = await getResultsExport(eventId, filtros, MAX_LINHAS);
    if (!dados) {
      return new NextResponse("Evento não encontrado.", { status: 404 });
    }

    /**
     * ⚠️ AS COLUNAS FIXAS VÊM PRIMEIRO, AS DINÂMICAS DEPOIS (§25).
     *
     * As perguntas são configuráveis, então o cabeçalho é montado a partir do
     * que o banco devolveu — não de uma lista escrita aqui. Um evento com sete
     * perguntas e outro com vinte geram arquivos diferentes, e os dois estão
     * certos.
     *
     * ⚠️ O TOKEN NÃO ESTÁ AQUI, E NÃO TEM COMO ESTAR (§41: "não incluir tokens
     * de avaliação no Excel"). A função do banco não o seleciona, e o
     * `revoke select (token)` do Prompt 2 impediria mesmo se selecionasse.
     */
    const cabecalho = [
      "Evento",
      "Data do evento",
      "Participante",
      "Granja/Empresa",
      "E-mail",
      "Telefone",
      "WhatsApp",
      "Data/Hora da resposta",
      "Nota geral",
      ...dados.questions.map((q) => q.label),
      "Comentário",
    ];

    const linhas: string[][] = [cabecalho];

    for (const row of dados.rows) {
      linhas.push([
        dados.eventName,
        formatCalendarDate(dados.eventDate),
        row.fullName,
        row.companyName,
        row.email,
        // ⚠️ DÍGITOS, SEM MÁSCARA — é o que serve para quem vai importar a lista
        // em outra ferramenta. A máscara é da TELA.
        row.phone ?? "",
        row.whatsapp ?? "",
        formatDateTime(row.answeredAt),
        row.overallValue === null ? "" : String(row.overallValue),
        // ⚠️ A BUSCA É PELA CHAVE, e não pela posição (ver `ResultsExportRow`).
        // Um array na ordem das colunas dependeria de esta iteração bater com a
        // do banco — e o dia em que divergissem, cada valor entraria na coluna
        // do vizinho, em silêncio.
        ...dados.questions.map((q) => row.answers[q.questionId] ?? ""),
        row.comment ?? "",
      ]);
    }

    // BOM + CRLF: é o par que faz o Excel em português abrir o arquivo com
    // acentos corretos e uma linha por registro. Sem o BOM, "João" vira "JoÃ£o".
    const csv = "﻿" + linhas.map((linha) => linha.map(escapar).join(";")).join("\r\n");

    /**
     * ⚠️ A TRILHA É ESCRITA DEPOIS DE O ARQUIVO ESTAR PRONTO (§42), e antes de
     * ele sair. Registrar antes marcaria como exportada uma consulta que talvez
     * falhasse; registrar depois do `return` não aconteceria.
     *
     * ⚠️ E A FALHA DA TRILHA NÃO DERRUBA O DOWNLOAD. É uma escolha: um erro de
     * auditoria transformaria um relatório numa tela de erro para quem tem todo
     * o direito de baixá-lo. O caso fica no log do servidor, onde alguém age
     * sobre ele.
     */
    const supabase = await createClient();
    const { error: erroTrilha } = await supabase.rpc("log_evaluation_export", {
      p_event_id: eventId,
      p_rows: dados.rows.length,
      p_filter: filtros.filter,
      // ⚠️ SE HOUVE BUSCA, E NUNCA O TERMO. Ele pode ser o e-mail, o telefone ou
      // o nome de uma pessoa — e a trilha é a tabela que ninguém pensa em varrer
      // quando alguém pede exclusão de dados.
      p_searched: filtros.query.trim() !== "",
    } as never);

    if (erroTrilha) {
      console.error(`[results] a trilha da exportação falhou: ${erroTrilha.code}`);
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeArquivo(dados.eventName)}"`,
        // Uma resposta nova entra a qualquer momento; um arquivo cacheado
        // entregaria os resultados de ontem como se fossem os de agora.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // ⚠️ SEM DADO PESSOAL NO LOG (§41). Nem o termo buscado — ele pode ser o
    // e-mail ou o telefone de alguém.
    console.error(
      `[results] exportação falhou (${eventId}): ${
        error instanceof Error ? error.name : "desconhecido"
      }`,
    );
    return new NextResponse("Não foi possível gerar a exportação. Tente novamente.", {
      status: 500,
    });
  }
}

/**
 * O escape do CSV.
 *
 * ⚠️ O `'` NA FRENTE DE `=`, `+`, `-` E `@` NÃO É CAPRICHO: sem ele, um
 * comentário que comece com `=1+1` vira FÓRMULA quando o arquivo abre no Excel.
 * É a injeção de fórmula em CSV — e aqui o risco é REAL e vem de fora: o
 * comentário é digitado por quem responde a avaliação numa página ABERTA na
 * internet, alcançada por um link. Alguém pode escrever `=HYPERLINK(...)` e
 * esperar que a APCS abra a planilha.
 *
 * Idêntico ao de `registrations/[eventId]/export` e ao de
 * `surveys/[id]/results/export` — mesma armadilha, mesma defesa.
 */
function escapar(valor: string): string {
  const texto = valor ?? "";
  const perigoso = /^[=+\-@\t\r]/.test(texto);
  const base = perigoso ? `'${texto}` : texto;

  return /[";\r\n]/.test(base) ? `"${base.replace(/"/g, '""')}"` : base;
}

/**
 * `resultados_<evento>_<AAAAMMDD>.csv`.
 *
 * ⚠️ O NOME DO EVENTO É LIMPO ANTES DE ENTRAR NO CABEÇALHO. Diferente do slug
 * da landing page (que tem CHECK de formato no banco), `events.name` é texto
 * livre digitado por alguém — e `Content-Disposition` não é lugar para aspas nem
 * quebra de linha: um nome com `"` quebraria o cabeçalho inteiro.
 */
function nomeArquivo(eventName: string): string {
  const limpo =
    eventName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "evento";

  const hoje = new Date();
  const carimbo =
    `${hoje.getFullYear()}` +
    `${String(hoje.getMonth() + 1).padStart(2, "0")}` +
    `${String(hoje.getDate()).padStart(2, "0")}`;

  return `resultados_${limpo}_${carimbo}.csv`;
}
