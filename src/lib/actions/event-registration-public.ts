"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { clientIpHashFromHeaders } from "@/lib/security/client-ip";
import { resolvePublicLandingPageId } from "@/lib/services/event-landing-public";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  publicRegistrationSchema,
  type PublicRegistrationInput,
} from "@/modules/event/event.landing.schema";

/**
 * A PORTA PÚBLICA DAS INSCRIÇÕES — a inscrição vinda de `/eventos/[slug]`.
 *
 * ============================================================================
 * ⚠️ ELA NÃO TEM `assertPermission`, E ISSO NÃO É UM ESQUECIMENTO.
 * ============================================================================
 * Não há usuário para autorizar: quem chama é uma granja, sem sessão nenhuma. O
 * que substitui a permissão são quatro coisas, e nenhuma delas está nesta tela:
 *
 *   1. A ESTREITEZA DA FUNÇÃO. `create_event_registration` não tem parâmetro
 *      capaz de mexer em qualquer coisa que não seja criar uma inscrição nova.
 *      Não dá para publicar página, mudar capacidade, ler participante.
 *   2. O SLUG NO LUGAR DO ID. O navegador nunca recebe `landingPageId` — ele
 *      manda o endereço que está na barra, e o servidor deriva a página. Não há
 *      como apontar para a página de outro evento.
 *   3. O LIMITE DE TAXA por hash de IP, dentro da própria função (RG007).
 *   4. A CHAVE DE DEDUPLICAÇÃO, montada AQUI e nunca recebida de fora.
 *
 * É o mesmo desenho de `submitMembershipApplicationAction`, e de propósito: são
 * as duas únicas portas do sistema que escrevem sem sessão, e elas têm de ser
 * reconhecíveis uma na outra.
 *
 * ⚠️ TODAS AS REGRAS DE NEGÓCIO ESTÃO NO BANCO (§29 do Prompt 3: "O backend é a
 * fonte definitiva"). Página publicada, prazo, capacidade sob lock, e-mail
 * repetido dentro e fora da requisição, telefone ou WhatsApp, consentimento.
 * O Zod aqui em cima roda para a mensagem ser boa, não para a regra valer — e
 * é a MESMA peça (`registrationBaseSchema`) que a action do backoffice usa.
 */

/**
 * Janela da chave de deduplicação — cinco minutos, o mesmo de Associados e do
 * backoffice.
 *
 * Longo o bastante para cobrir duplo clique, F5, retry e rede ruim; curto o
 * bastante para não impedir alguém de corrigir um erro de digitação e reenviar.
 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/**
 * A chave de idempotência (§23, §26).
 *
 * ⚠️ MONTADA NO SERVIDOR, NUNCA RECEBIDA DO CLIENTE. Aceitá-la de fora deixaria
 * qualquer um mandar a chave de OUTRA inscrição e receber os dados dela de
 * volta como "duplicada" — que é um vazamento, não uma otimização.
 *
 * ⚠️ E ELA É O E-MAIL DO PRIMEIRO PARTICIPANTE, não a granja. Duas inscrições
 * legítimas da mesma granja para o mesmo evento existem (dois grupos, dois
 * momentos); duas com a mesma primeira pessoa, nos mesmos cinco minutos, são o
 * mesmo envio chegando duas vezes.
 */
function buildDedupeKey(landingPageId: string, firstEmail: string): string {
  const janela = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  return `${landingPageId}|${firstEmail.trim().toLowerCase()}|${janela}`;
}

export interface PublicRegistrationResult {
  participantCount: number;
  /**
   * `true` quando o envio caiu na janela de deduplicação.
   *
   * ⚠️ A TELA NÃO CONTA ISSO A NINGUÉM, pelo mesmo motivo de Associados: quem
   * clicou duas vezes fez UMA inscrição e vê UMA confirmação. Contar o detalhe
   * técnico só criaria dúvida sobre um envio que deu certo. O campo existe para
   * a página não somar o número de participantes duas vezes.
   */
  duplicate: boolean;
}

/**
 * Cria a inscrição da granja com todos os participantes dela, numa transação.
 *
 * ⚠️ NÃO DEVOLVE O `registrationId`. A action do backoffice devolve; esta não.
 * Um identificador na resposta de uma página aberta na internet é uma coisa que
 * pode ser colada, adivinhada por vizinhança ou usada num endpoint futuro — e a
 * página de confirmação não precisa dele para nada. O que ela mostra é a
 * mensagem configurada no Builder e a contagem.
 */
export async function submitEventRegistrationAction(
  input: PublicRegistrationInput,
): Promise<ActionResult<PublicRegistrationResult>> {
  const parsed = publicRegistrationSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const dados = parsed.data;
  const primeiro = dados.participants[0];
  // O schema já exige ao menos um; isto é o que convence o TypeScript com
  // `noUncheckedIndexedAccess` ligado, e cobre a entrada que passasse por fora.
  if (!primeiro) return fail("registrationNeedsParticipant");

  // ⚠️ O SLUG VIRA A PÁGINA AQUI, no servidor. Ver o cabeçalho.
  const landingPageId = await resolvePublicLandingPageId(dados.slug);
  if (!landingPageId) return fail("notFound");

  const cabecalhos = await headers();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("create_event_registration", {
      p_landing_page_id: landingPageId,
      p_company_name: dados.companyName,
      p_participants: dados.participants.map((pessoa) => ({
        fullName: pessoa.fullName,
        email: pessoa.email,
        phone: pessoa.phone || null,
        whatsapp: pessoa.whatsapp || null,
      })),
      p_dedupe_key: buildDedupeKey(landingPageId, primeiro.email),
      // Hash, nunca o IP (§35). Serve ao limite de taxa e a mais nada.
      p_source_ip_hash: clientIpHashFromHeaders(cabecalhos) ?? undefined,
      p_user_agent: cabecalhos.get("user-agent") ?? undefined,
      // A versão que ESTAVA NA TELA — ver `publicRegistrationSchema`.
      p_consent_policy_version: dados.consentVersion,
    } as never);

    if (error) {
      // ⚠️ NENHUM DADO PESSOAL NO LOG (§35). Nem nome, nem e-mail, nem telefone,
      // nem a granja. O código do Postgres e a contagem são o que se precisa
      // para depurar; um erro que despeje a lista de participantes no log de
      // produção é um vazamento silencioso — e este é o formulário que mais
      // gente de fora vai preencher.
      console.error(
        `[registration.public] falha ao inscrever: ${error.code} (${dados.participants.length} participantes)`,
      );
      return fail(mapPostgresError(error).code);
    }

    const linha = (Array.isArray(data) ? data[0] : data) as
      | { registration_id: string; participant_count: number; duplicate: boolean }
      | undefined;

    if (!linha) return fail("unexpected");

    // A grid do backoffice mostra "Inscritos": sem isto, quem está com a tela
    // aberta não vê a inscrição nova chegar. O padrão da rota de detalhe, e não
    // o endereço concreto, porque não sabemos qual página está aberta.
    revalidatePath("/events/landing-pages", "page");
    revalidatePath("/events/landing-pages/[id]", "page");

    return ok({ participantCount: linha.participant_count, duplicate: linha.duplicate });
  } catch (erro) {
    // ⚠️ SÓ O TIPO DO ERRO, NUNCA O OBJETO. As outras actions do projeto logam
    // `erro` inteiro, e ali isso é seguro porque quem as chama está logado. Aqui
    // não: uma falha de rede do `fetch` do supabase-js pode trazer o CORPO DA
    // REQUISIÇÃO junto — e o corpo desta requisição é a lista de participantes,
    // com nome, e-mail e telefone de gente que não trabalha na APCS. O nome da
    // exceção é o que se precisa para saber se foi rede, timeout ou bug.
    const tipo = erro instanceof Error ? erro.name : typeof erro;
    console.error(`[registration.public] erro inesperado ao inscrever: ${tipo}`);
    return fail("unexpected");
  }
}
