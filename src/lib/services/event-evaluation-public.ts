import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicEvaluation } from "@/modules/event/event.evaluation.types";

/**
 * A LEITURA PÚBLICA DA AVALIAÇÃO — `/avaliacoes/[token]`.
 *
 * ============================================================================
 * ⚠️ `createAdminClient()` NUMA LEITURA PÚBLICA, E ISSO NÃO É UM ATALHO.
 * ============================================================================
 * É o mesmo desenho de `resolvePublicLandingPageId` em
 * `event-landing-public.ts`, e a razão é a mesma: `get_public_event_evaluation`
 * é liberada SÓ para `service_role` — `anon` não pode executá-la.
 *
 * O que isso compra é a superfície pública do banco continuar sendo zero função.
 * Não há como apontar um cliente PostgREST para o projeto e varrer tokens,
 * porque a chave anônima não alcança nada disto. Quem fala com o Postgres é este
 * arquivo, no servidor.
 *
 * O que substitui a permissão são três coisas:
 *
 *   1. A ESTREITEZA DA FUNÇÃO. `get_public_event_evaluation` recebe um token e
 *      devolve um formulário. Não há parâmetro capaz de listar, de procurar por
 *      evento, nem de alcançar qualquer linha que o token não aponte.
 *   2. A ENTROPIA DO TOKEN (§7). 122 bits de um gerador criptográfico. Não há
 *      id sequencial exposto, e o token não é derivado de nada da pessoa.
 *   3. A RESPOSTA NEUTRA (§33). Token desconhecido devolve `not_found` — a mesma
 *      forma de uma avaliação cancelada —, e não um erro que confirme o acerto
 *      parcial de quem estiver adivinhando.
 *
 * ⚠️ E NADA PESSOAL SAI ANTES DA VALIDAÇÃO (§34). Nome e evento só entram no
 * retorno depois de a linha ter sido encontrada PELO TOKEN.
 */

const VAZIA: PublicEvaluation = {
  state: "not_found",
  eventName: null,
  eventDate: null,
  eventLocation: null,
  firstName: null,
  expiresAt: null,
  sections: [],
};

/**
 * O FORMATO DO TOKEN, conferido ANTES de falar com o banco.
 *
 * ============================================================================
 * ⚠️ ISTO NÃO É SEGURANÇA — É ECONOMIA, E A DIFERENÇA IMPORTA.
 * ============================================================================
 * Adivinhar um token de 122 bits não é uma ameaça real: são 5×10³⁶
 * possibilidades, e nenhum limite de taxa muda essa conta. Quem protege contra
 * descoberta é a entropia, e ela já está lá.
 *
 * O que este teste evita é outra coisa: esta página é PÚBLICA e sem sessão, e
 * cada requisição vira uma ida ao Postgres com a chave de serviço. Sem um
 * filtro de formato, `/avaliacoes/qualquer-coisa` — um rastreador, um scanner,
 * alguém repetindo — custa uma consulta cada. Com ele, custa uma expressão
 * regular.
 *
 * ⚠️ E É O MESMO FORMATO QUE `publicEvaluationSubmissionSchema` JÁ EXIGE no
 * envio: 24 a 128 caracteres hexadecimais. Os dois lados da porta pública
 * recusam a mesma coisa, e a recusa é a MESMA de um token inexistente —
 * `not_found` —, para não contar a quem estiver tentando que o formato acertou.
 */
const FORMATO_DE_TOKEN = /^[0-9a-f]{24,128}$/i;

export async function getPublicEvaluation(token: string): Promise<PublicEvaluation> {
  const limpo = token.trim();
  if (!FORMATO_DE_TOKEN.test(limpo)) return VAZIA;

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("get_public_event_evaluation", {
    p_token: limpo,
  });

  if (error) {
    /**
     * ⚠️ O TOKEN NUNCA ENTRA NO LOG (§34). Ele é a credencial de acesso àquela
     * avaliação: escrito aqui, ele ficaria guardado em texto puro num lugar que
     * ninguém audita e que costuma ser encaminhado para fora (um painel de
     * observabilidade, um print num chamado).
     *
     * O que sobra para investigar é o código do erro — e ele é o que basta:
     * "falhou" aqui significa banco fora do ar ou migration não aplicada, e
     * nenhum dos dois se investiga sabendo qual token era.
     */
    console.error(`[event-evaluation-public] leitura falhou: ${error.code}`);
    return VAZIA;
  }

  if (!data || typeof data !== "object") return VAZIA;

  const bruto = data as unknown as PublicEvaluation;
  return {
    ...VAZIA,
    ...bruto,
    sections: Array.isArray(bruto.sections) ? bruto.sections : [],
  };
}
