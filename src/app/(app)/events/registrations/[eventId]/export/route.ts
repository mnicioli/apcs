import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getLandingPageByEvent, getRegistrationBoard } from "@/lib/services/event-landing";
import { formatDateTime } from "@/lib/utils";
import { parseRegistrationFilters } from "@/modules/event/event.registrations.routes";

/**
 * EXPORTAÇÃO DAS INSCRIÇÕES (§18, §19, §20, §21).
 *
 * ============================================================================
 * ⚠️ CSV, E NÃO XLSX — E É O QUE O §20 MANDA FAZER.
 * ============================================================================
 * "Se o projeto já possuir convenção própria, seguir a convenção existente." Ele
 * possui: `surveys/[id]/results/export/route.ts` exporta CSV com BOM UTF-8 e
 * separador `;`, e o comentário de lá explica o porquê — este projeto não tem
 * biblioteca de planilha, e acrescentar uma (SheetJS pesa centenas de KB e tem
 * histórico de CVE) para gerar um arquivo que o Excel abre igual seria pagar
 * caro por nada.
 *
 * O arquivo abre no Excel com dois cliques, uma linha por participante, acentos
 * corretos e colunas separadas. É o que o §18 descreve. O que muda é a extensão.
 *
 * ⚠️ ROTA, E NÃO SERVER ACTION. O resultado é um DOWNLOAD: precisa de
 * `Content-Disposition`, e uma action não define cabeçalho de resposta.
 *
 * ============================================================================
 * ⚠️ A PERMISSÃO É CONFERIDA AQUI TAMBÉM, E É O PONTO MAIS IMPORTANTE DO ARQUIVO.
 * ============================================================================
 * Este endpoint é uma URL: alguém pode chamá-la direto, colada num navegador,
 * sem passar por tela nenhuma. Sem a checagem, a exportação seria a PORTA DOS
 * FUNDOS de uma tela protegida — e o que sai por ela é nome, e-mail e telefone
 * de centenas de terceiros (§25).
 *
 * São duas camadas, como no resto do módulo: `hasPermission` aqui, e a RLS de
 * `event_registrations`/`event_participants` dentro de `getRegistrationBoard`,
 * que devolve zero linhas para quem não é `registrations_is_reader()`.
 */

/**
 * Teto de linhas no arquivo.
 *
 * ⚠️ ELE EXISTE E É GENEROSO. O §21 pede para não carregar grandes volumes; o
 * §19 pede o recorte inteiro, e não a página. Cinco mil participantes num evento
 * único é muito além da realidade da APCS (o maior tem centenas), e o teto está
 * aqui para uma consulta acidental não virar um arquivo de gigabytes — não para
 * limitar uso legítimo. Se um dia encostar, o caminho é exportar por período.
 */
const MAX_LINHAS = 5000;

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "registrations.read")) {
    return new NextResponse("Sem permissão para exportar inscrições.", { status: 403 });
  }

  const { eventId } = await params;

  try {
    const landing = await getLandingPageByEvent(eventId);
    if (!landing) {
      return new NextResponse("Evento não encontrado.", { status: 404 });
    }

    // ⚠️ OS MESMOS FILTROS DA TELA (§19), lidos pela MESMA função que a página
    // usa. É isso que faz "exportar somente os participantes correspondentes ao
    // resultado atual" ser uma consequência do desenho, e não uma regra a
    // lembrar: o botão é um link montado por `registrationsExportHref`, e os
    // dois lados leem os mesmos parâmetros.
    const url = new URL(request.url);
    const filters = parseRegistrationFilters(Object.fromEntries(url.searchParams));

    const board = await getRegistrationBoard(
      eventId,
      // `page: 1` porque a exportação leva o recorte inteiro, não a página que
      // está na tela.
      { ...filters, page: 1 },
      MAX_LINHAS,
    );

    const linhas: string[][] = [
      [
        "Evento",
        "Granja/Empresa",
        "Participante",
        "E-mail",
        "Telefone",
        "WhatsApp",
        "Confirmado",
        "Data da inscrição",
      ],
    ];

    for (const row of board.rows) {
      linhas.push([
        landing.event.name,
        row.companyName,
        row.fullName,
        row.email,
        // ⚠️ DÍGITOS, SEM MÁSCARA. É o que o exemplo do §18 mostra, e é o que
        // serve para quem vai importar a lista num disparo de WhatsApp. A
        // máscara é da TELA.
        row.phone ?? "",
        row.whatsapp ?? "",
        // "Sim"/"Não", como no exemplo do §18 — e não o rótulo da interface.
        row.confirmation === "confirmed" ? "Sim" : "Não",
        formatDateTime(row.registeredAt),
      ]);
    }

    // BOM + CRLF: é o par que faz o Excel em português abrir o arquivo com
    // acentos corretos e uma linha por registro. Sem o BOM, "João" vira "JoÃ£o".
    const csv = "﻿" + linhas.map((linha) => linha.map(escapar).join(";")).join("\r\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeArquivo(landing.slug)}"`,
        // Uma inscrição nova entra a qualquer momento; um arquivo cacheado
        // entregaria a lista de ontem como se fosse a de agora.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // ⚠️ SEM DADO PESSOAL NO LOG (§25). Nem o termo buscado — ele pode ser o
    // e-mail ou o telefone de alguém.
    console.error(
      `[registrations] exportação falhou (${eventId}): ${error instanceof Error ? error.name : "desconhecido"}`,
    );
    return new NextResponse("Não foi possível gerar a exportação. Tente novamente.", {
      status: 500,
    });
  }
}

/**
 * O escape do CSV.
 *
 * ⚠️ O `'` NA FRENTE DE `=`, `+`, `-` E `@` NÃO É CAPRICHO: sem ele, uma granja
 * chamada `=1+1` vira FÓRMULA quando o arquivo abre no Excel. É a injeção de
 * fórmula em CSV — e aqui o risco é REAL e vem de fora: o nome da granja e o
 * nome do participante são digitados por quem se inscreve numa página ABERTA na
 * internet (Prompt 3). Alguém pode cadastrar uma "granja" chamada
 * `=HYPERLINK(...)` e esperar que a APCS abra a planilha.
 *
 * Idêntico ao de `surveys/[id]/results/export` — mesma armadilha, mesma defesa.
 */
function escapar(valor: string): string {
  const texto = valor ?? "";
  const perigoso = /^[=+\-@\t\r]/.test(texto);
  const base = perigoso ? `'${texto}` : texto;

  return /[";\r\n]/.test(base) ? `"${base.replace(/"/g, '""')}"` : base;
}

/**
 * `inscricoes_<slug>_<AAAAMMDD>.csv` — o formato que o §20 pede, com a extensão
 * que o projeto usa.
 *
 * ⚠️ O SLUG JÁ É SEGURO POR CONSTRUÇÃO: o CHECK `event_landing_pages_slug_format`
 * só aceita minúsculas, dígitos e hífen. A limpeza abaixo é defesa em
 * profundidade — `Content-Disposition` não é lugar para aspas nem acento, e um
 * nome com `"` quebraria o cabeçalho inteiro.
 */
function nomeArquivo(slug: string): string {
  const limpo = slug.replace(/[^a-z0-9-]+/gi, "-").slice(0, 60) || "evento";
  const hoje = new Date();
  const carimbo =
    `${hoje.getFullYear()}` +
    `${String(hoje.getMonth() + 1).padStart(2, "0")}` +
    `${String(hoje.getDate()).padStart(2, "0")}`;

  return `inscricoes_${limpo}_${carimbo}.csv`;
}
