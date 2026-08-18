import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  getSurvey,
  getSurveyMetrics,
  getSurveyResults,
  listSurveyParticipants,
} from "@/lib/services/surveys";
import { SURVEY_STATUS_LABELS } from "@/modules/survey/survey.labels";
import { isSurveyId } from "@/modules/survey/survey.routes";

/**
 * EXPORTAÇÃO DOS RESULTADOS (§49).
 *
 * ⚠️ CSV, e não XLSX. O §49 diz "formatos conforme infraestrutura existente", e
 * este projeto não tem biblioteca de planilha — acrescentar uma dependência para
 * gerar um arquivo que o Excel abre igual seria pagar caro por nada. O CSV sai
 * com BOM UTF-8 e separador `;`, que é o que o Excel em português espera: sem o
 * BOM, "Suíno" vira "SuÃ­no" ao abrir com dois cliques.
 *
 * ⚠️ O ANONIMATO É IMPOSTO AQUI TAMBÉM, e não só na tela (§48). Este endpoint é
 * uma URL: alguém pode chamá-la direto, sem passar por tela nenhuma. Ele reusa
 * `listSurveyParticipants`, que devolve `null` quando o banco recusa a consulta
 * — então a seção individual simplesmente não existe no arquivo de uma enquete
 * anônima. Não há um `if` de tela que alguém possa contornar.
 *
 * Rota (e não Server Action) porque o resultado é um DOWNLOAD: precisa de
 * `Content-Disposition`, e uma action não tem como definir cabeçalho de resposta.
 */

/** Teto de linhas individuais no arquivo. */
const MAX_PARTICIPANTS = 5000;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  // A mesma permissão da tela de resultados. Sem isto, a exportação seria a
  // porta dos fundos de um dado que a tela protege.
  if (!hasPermission(role, "surveys.read")) {
    return new NextResponse("Sem permissão para exportar resultados.", { status: 403 });
  }

  const { id } = await params;
  if (!isSurveyId(id)) {
    return new NextResponse("Enquete não encontrada.", { status: 404 });
  }

  try {
    const survey = await getSurvey(id);
    if (!survey) {
      return new NextResponse("Enquete não encontrada.", { status: 404 });
    }

    const [results, metrics, participants] = await Promise.all([
      getSurveyResults(id),
      getSurveyMetrics(id),
      listSurveyParticipants(id, { page: 1, pageSize: MAX_PARTICIPANTS }),
    ]);

    const linhas: string[][] = [];

    linhas.push(["Enquete", survey.title]);
    linhas.push(["Pergunta", survey.question?.text ?? ""]);
    linhas.push(["Situação", SURVEY_STATUS_LABELS[survey.status]]);
    linhas.push(["Respostas anônimas", survey.isAnonymous ? "Sim" : "Não"]);
    linhas.push(["Início", survey.startsAt ?? ""]);
    linhas.push(["Encerramento", survey.endsAt ?? ""]);
    linhas.push([]);

    linhas.push(["Público", String(metrics.totalAudience)]);
    linhas.push(["Enviados", String(metrics.totalSent)]);
    linhas.push(["Entregues", String(metrics.totalDelivered)]);
    linhas.push(["Lidos", String(metrics.totalRead)]);
    linhas.push(["Respostas", String(metrics.totalResponses)]);
    linhas.push(["Erros", String(metrics.totalErrors)]);
    linhas.push(["Taxa de participação (%)", formatarNumero(metrics.participationRate)]);
    linhas.push([]);

    linhas.push(["Alternativa", "Respostas", "Percentual (%)"]);
    for (const row of results) {
      linhas.push([row.text, String(row.total), formatarNumero(row.percentage)]);
    }

    if (participants !== null && participants.items.length > 0) {
      linhas.push([]);
      linhas.push(["Associado", "Resposta", "Data e hora"]);
      for (const p of participants.items) {
        linhas.push([p.contactName ?? "Contato sem nome", p.optionText, p.answeredAt]);
      }
    } else if (participants === null) {
      linhas.push([]);
      linhas.push(["Esta enquete é anônima: os resultados individuais não são exportados."]);
    }

    // BOM + CRLF: é o par que faz o Excel em português abrir o arquivo com
    // acentos corretos e uma linha por registro.
    const csv = "﻿" + linhas.map((linha) => linha.map(escapar).join(";")).join("\r\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeArquivo(survey.title)}"`,
        // Um resultado muda a cada resposta nova; um CSV cacheado entregaria
        // números velhos como se fossem os de agora.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[surveys] exportação falhou: ${error instanceof Error ? error.message : error}`);
    return new NextResponse("Não foi possível gerar a exportação. Tente novamente.", {
      status: 500,
    });
  }
}

/**
 * O escape do CSV.
 *
 * ⚠️ O `'` na frente de `=`, `+`, `-` e `@` NÃO é capricho: sem ele, uma
 * alternativa chamada `=1+1` vira FÓRMULA quando o arquivo abre no Excel. É a
 * injeção de fórmula em CSV — e o texto das alternativas vem de quem cria a
 * enquete, que é dado de entrada como qualquer outro.
 */
function escapar(valor: string): string {
  const texto = valor ?? "";
  const perigoso = /^[=+\-@\t\r]/.test(texto);
  const base = perigoso ? `'${texto}` : texto;

  return /[";\r\n]/.test(base) ? `"${base.replace(/"/g, '""')}"` : base;
}

/** Vírgula decimal, como se escreve número em português. */
function formatarNumero(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/**
 * O nome do arquivo, a partir do título.
 *
 * Só ASCII e sem pontuação: o cabeçalho `Content-Disposition` não é lugar para
 * acento nem para aspas, e um título com `"` quebraria o cabeçalho inteiro.
 */
function nomeArquivo(titulo: string): string {
  const limpo = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();

  return `enquete-${limpo || "resultados"}.csv`;
}
