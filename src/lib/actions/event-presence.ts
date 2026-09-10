"use server";

import { revalidatePath } from "next/cache";
import { failFromPostgres, fail, ok, type ActionResult } from "@/lib/actions/errors";
import { assertPermission } from "@/lib/auth/assert-permission";
import { createClient } from "@/lib/supabase/server";
import {
  participantPresenceSchema,
  type ParticipantPresenceInput,
} from "@/modules/event/event.landing.schema";

/**
 * A ESCRITA DA LISTA DE PRESENÇA.
 *
 * ============================================================================
 * ⚠️ ARQUIVO PRÓPRIO, E NÃO MAIS UMA FUNÇÃO EM `event-landing.ts`.
 * ============================================================================
 * A leitura da lista REUSA o que já existe (`getRegistrationBoard`), e é o
 * certo: é a mesma consulta, do mesmo evento, com o mesmo filtro. A ESCRITA não
 * é a mesma coisa — ela responde a outra permissão (`presence.write`, que o
 * Atendente tem, contra `registrations.write`, que ele não tem) e a outra regra
 * de negócio.
 *
 * Enfiá-la entre as actions de Landing Page seria esconder essa diferença
 * justamente onde ela importa: no arquivo em que alguém confere quem pode o quê.
 *
 * ⚠️ E É AQUI QUE O §22 SE PAGA. A regra de presença mora em UMA função de
 * domínio no banco (`set_participant_presence`), e este arquivo apenas a
 * consome. O check-in por QR Code, quando existir, entra pela mesma função — e
 * herda inteiras a validação da cadeia, a idempotência e a trilha, sem que nada
 * disso precise ser reescrito ou lembrado.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md: escrita retorna `ActionResult`, nunca
 * lança.
 */

/**
 * Marca ou desmarca a presença de um participante (§12, §13, §20).
 *
 * ⚠️ UMA ACTION PARA OS DOIS SENTIDOS. Ligar e desligar são a mesma operação
 * sobre o mesmo campo, com a mesma permissão, a mesma cadeia a conferir e a
 * mesma trilha a escrever. Duas actions seriam duas cópias — e a de desligar,
 * usada dez vezes menos, seria a que deixaria de receber a próxima correção.
 *
 * ⚠️ NÃO EXISTE `checkedInAt` NO PAYLOAD, e a ausência é o §21. O carimbo é
 * `now()` DENTRO da função Postgres. O relógio do navegador de quem opera nunca
 * decide a que horas alguém chegou — nem por engano (máquina com a hora
 * errada), nem de propósito.
 *
 * ⚠️ A CONFIRMAÇÃO NÃO É TOCADA (§3). Esta action escreve presença e nada mais;
 * `setParticipantConfirmationAction` escreve confirmação e nada mais. Nenhuma
 * das duas lê o campo da outra, e não há regra automática ligando as duas.
 *
 * ⚠️ REPETIR O MESMO VALOR É SUCESSO, E NÃO ERRO (§20). O compare-and-set do
 * banco não grava quando o estado já é o pedido, e não escreve trilha dizendo
 * que houve uma mudança que não houve. A action devolve o participante do mesmo
 * jeito — devolver erro faria a tela reverter um toggle que está certo.
 */
export async function setParticipantPresenceAction(
  input: ParticipantPresenceInput,
): Promise<ActionResult<{ id: string; present: boolean; checkedInAt: string | null }>> {
  const parsed = participantPresenceSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // 1ª camada. A 2ª é `presence_is_writer()` DENTRO da função Postgres — ela é
  // SECURITY DEFINER (precisa ser, porque grava na trilha, que é fechada), e
  // DEFINER desliga a RLS. Sem a checagem lá dentro, esta aqui seria a única.
  const negado = await assertPermission<{
    id: string;
    present: boolean;
    checkedInAt: string | null;
  }>("presence.write");
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_participant_presence", {
    // ⚠️ §18 — SEM O EVENTO, UM ID DE PARTICIPANTE DE OUTRO EVENTO PASSARIA.
    // `participantId` vem do navegador; é o banco que confere se ele pertence a
    // este evento, e recusa sem distinguir "não existe" de "é de outro".
    p_event_id: parsed.data.eventId,
    p_participant_id: parsed.data.participantId,
    p_present: parsed.data.present,
    // A origem, para a trilha (§5). Hoje só o backoffice aciona; o QR Code do
    // §22 passará 'qr_code' pela mesma porta.
    p_source: "backoffice",
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("participant.presence", error, {
          // ⚠️ IDS, NUNCA NOME OU E-MAIL. O log de erro é um caminho que ninguém
          // audita, e dado pessoal que entra nele não sai.
          eventId: parsed.data.eventId,
          participantId: parsed.data.participantId,
        })
      : fail("unexpected");
  }

  const linha = data as { id: string; present: boolean; checked_in_at: string | null };

  /**
   * ⚠️ O PADRÃO DE ROTA, E NÃO O ENDEREÇO CONCRETO — é a forma que
   * `revalidateLanding` já usa neste módulo. `revalidatePath("/events/presence")`
   * NÃO alcança `/events/presence/<id>`: a tela que acabou de mudar continuaria
   * servindo o cache antigo para o próximo acesso.
   *
   * ⚠️ E SÓ A LISTA. A tela de seleção de evento mostra inscrições,
   * participantes e confirmados — nenhum deles muda quando alguém entra pela
   * porta. A grid de Inscrições, idem: ela não tem coluna de presença.
   * Invalidar as duas seria pedir duas leituras ao banco para redesenhar
   * números idênticos.
   */
  revalidatePath("/events/presence/[eventId]", "page");

  return ok({ id: linha.id, present: linha.present, checkedInAt: linha.checked_in_at });
}
