import type { EvaluationStage } from "./event.evaluation.labels";
import type { EvaluationSummary } from "./event.evaluation.types";

/**
 * As regras DERIVADAS da avaliação — as que se calculam e nunca se gravam.
 *
 * ⚠️ É A MESMA DISCIPLINA DE `event.landing.rules.ts`, e o cabeçalho de lá vale
 * inteiro aqui: existem dois conceitos de situação, e confundi-los é o erro
 * fácil do módulo.
 *
 *   `status`  o que uma PESSOA decidiu     (enum do banco, por participante)
 *   `stage`   o que VALE agora, no evento  (derivado de quatro fatos)
 *
 * Só o primeiro é gravado. "Está enviando", "falta o término", "aguardando o
 * evento" não são escritos em lugar nenhum — porque uma coluna com esse valor
 * seria uma cópia dos quatro fatos que a produzem, e cópias saem de sincronia.
 *
 * ⚠️ E ESTE ARQUIVO NÃO IMPORTA NADA DO SERVIDOR. Ele roda no Server Component
 * que desenha a grid e nos testes, sem Supabase e sem `server-only` — é o que
 * permite testá-lo com objetos literais, que é como as asserções de
 * `src/test/event-evaluation.test.ts` o exercitam.
 */

/**
 * Em que pé está a avaliação de um evento (§21).
 *
 * A ordem das perguntas importa e não é arbitrária:
 *
 *   1. desligada?              nada mais interessa
 *   2. sem término?            está habilitada e NÃO VAI SAIR — é o alerta
 *   3. a hora ainda não veio?  aguardando
 *   4. sobrou alguém na fila?  enviando
 *   5. senão                   concluído
 *
 * ⚠️ O PASSO 2 É O QUE EXISTE POR CAUSA DO §10. `events.end_time` é opcional
 * neste sistema, e sem ele não há "término + atraso" a calcular. A tela precisa
 * gritar isso ANTES do evento, não depois — e é por isso que este caso tem selo
 * próprio em vez de cair em "aguardando", onde ficaria para sempre sem que
 * ninguém entendesse por quê.
 */
export function evaluationStage(
  summary: Pick<
    EvaluationSummary,
    "enabled" | "endTime" | "sendAt" | "present" | "queued" | "sent" | "answered"
  >,
  agora: Date = new Date(),
): EvaluationStage {
  if (!summary.enabled) return "disabled";
  if (summary.endTime === null || summary.sendAt === null) return "blocked_no_end_time";

  if (new Date(summary.sendAt).getTime() > agora.getTime()) return "waiting";

  // ⚠️ "SOBROU ALGUÉM NA FILA" INCLUI QUEM AINDA NEM FOI CRIADO. Um evento com
  // 40 presentes e 0 avaliações geradas está ENVIANDO (a rotina vai passar), e
  // não concluído. Sem a segunda condição, a tela diria "envio concluído" para
  // um evento em que ninguém recebeu nada — que é a mentira mais cara possível
  // nesta coluna.
  if (summary.queued > 0) return "sending";
  if (summary.present > 0 && summary.sent === 0 && summary.answered === 0) return "sending";

  return "done";
}

/**
 * A taxa de resposta (§21).
 *
 * ⚠️ O DENOMINADOR É QUEM RECEBEU, E NÃO QUEM ESTEVE PRESENTE. Os dois números
 * são diferentes enquanto a fila não esvazia, e usar `present` faria a taxa
 * subir sozinha ao longo do dia sem ninguém ter respondido nada — um indicador
 * que se move sem causa é um indicador em que ninguém confia.
 *
 * Devolve `null`, e não zero, quando ninguém recebeu: "0%" afirma que as pessoas
 * não responderam; `null` (a tela mostra "—") diz que não há o que medir ainda.
 */
export function responseRate(sent: number, answered: number): number | null {
  if (sent <= 0) return null;
  return Math.round((answered / sent) * 100);
}

/**
 * O convite, com as variáveis trocadas (§13).
 *
 * ⚠️ SUBSTITUIÇÃO LITERAL, e não um motor de template. As quatro variáveis são
 * fixas e conhecidas, e trazer uma dependência (ou escrever um interpretador)
 * para trocar quatro pedaços de texto seria complexidade sem cliente.
 *
 * ⚠️ E UMA VARIÁVEL DESCONHECIDA SAI COMO ESTÁ, de propósito. Quem escrever
 * `{{nome_completo}}` na tela de Textos vai ver `{{nome_completo}}` chegar no
 * WhatsApp — feio, óbvio e corrigível em trinta segundos. A alternativa
 * (apagar o que não reconhece) produziria uma frase com um buraco no meio, que
 * parece certa e não é.
 */
export function renderEvaluationInvite(
  template: string,
  dados: { nome: string; evento: string; dataEvento: string; link: string },
): string {
  return template
    .replaceAll("{{nome}}", dados.nome)
    .replaceAll("{{evento}}", dados.evento)
    .replaceAll("{{data_evento}}", dados.dataEvento)
    .replaceAll("{{link_avaliacao}}", dados.link);
}

/**
 * O endereço público da avaliação (§7, §27).
 *
 * ⚠️ `/avaliacoes/` EM PORTUGUÊS, e é a exceção combinada deste projeto: rota
 * interna é inglês, rota PÚBLICA é o que a pessoa lê no WhatsApp. `/eventos/` e
 * `/associe-se` já são assim, e um `/evaluations/` no meio delas seria a única
 * palavra em inglês num link mandado para uma granja.
 */
export function publicEvaluationPath(token: string): string {
  return `/avaliacoes/${token}`;
}
