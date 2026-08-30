import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AudienceLookup, EventAudienceSource } from "@/modules/event/event.audience";

/**
 * A ORIGEM REAL DA AUDIÊNCIA — o cadastro de associados.
 *
 * `event.audience.ts` foi escrito em agosto com um aviso no topo ("não existe
 * cadastro de associados neste sistema") e uma promessa no fim:
 *
 *     "No dia em que o cadastro existir, escreve-se uma implementação de
 *      EventAudienceSource e nada mais neste módulo muda."
 *
 * Este arquivo é essa implementação. O módulo puro não mudou: continua com toda
 * a lógica de elegibilidade (união, OU, deduplicação) e a porta declarada.
 *
 * ⚠️ A TRADUÇÃO "PÚBLICO → PERFIL" NÃO ESTÁ AQUI, e não deve estar. Ela é
 * `profile_for_event_segment(slug)`, no banco, desde a divulgação de eventos.
 * As duas funções que este arquivo chama são finas de propósito — elas existem
 * para que a regra continue morando num lugar só. Ver
 * `20260914000000_event_audience_members.sql`.
 *
 * ⚠️ CLIENTE `service_role` porque quem consome é o robô, que é anônimo. As
 * funções do banco são `security definer` pelo mesmo motivo, e o que elas
 * devolvem é estreito: slugs e ids, nunca nome, telefone ou e-mail.
 */
export const MEMBERS_REGISTRY: EventAudienceSource = {
  id: "members-registry",

  /**
   * ⚠️ `null` DO BANCO VIRA `available: false`, E ISSO É O CONTRATO INTEIRO.
   *
   * A função devolve `null` para associado desconhecido ou inativo, e `'{}'`
   * para associado conhecido que não está em público nenhum. Traduzir os dois
   * para lista vazia faria o bot dizer "não há eventos para você" a quem ele
   * simplesmente não identificou — e a pessoa concluiria que a APCS não tem
   * agenda, em vez de descobrir que precisa se identificar.
   */
  async segmentsForAssociate(associateId: string): Promise<AudienceLookup<string[]>> {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc("event_segments_for_member", {
      p_member_id: associateId,
    });

    if (error) {
      console.error(`[event-audience] segmentsForAssociate falhou: ${error.message}`);
      // Falha de consulta NÃO é "não conheço esta pessoa". É o sistema sem
      // fonte agora — e a mensagem que o bot dá nos dois casos é diferente.
      return { available: false, reason: "no-associate-registry" };
    }

    // ⚠️ O TIPO GERADO MENTE AQUI, e a mentira é silenciosa. `database.ts`
    // declara `Returns: string[]`, porque o gerador lê a assinatura SQL
    // (`returns text[]`) e não tem como saber que o corpo faz `return null` para
    // associado desconhecido ou inativo. Sem esta anotação, o TypeScript trata a
    // comparação abaixo como impossível — e o caso que o contrato inteiro existe
    // para distinguir viraria uma lista vazia sem ninguém perceber.
    const segments: string[] | null = data;

    if (segments === null) return { available: false, reason: "unknown-member" };

    return { available: true, value: segments };
  },

  async associatesInSegments(segmentSlugs: string[]): Promise<AudienceLookup<string[]>> {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc("members_in_event_segments", {
      p_slugs: segmentSlugs,
    });

    if (error) {
      console.error(`[event-audience] associatesInSegments falhou: ${error.message}`);
      return { available: false, reason: "no-associate-registry" };
    }

    // Aqui `'{}'` é resposta: "nenhum associado nestes públicos". Diferente do
    // caso acima, não há "pessoa desconhecida" a distinguir — a pergunta é
    // sobre públicos, e públicos ou existem ou não têm ninguém.
    return { available: true, value: data ?? [] };
  },
};
