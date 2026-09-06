import "server-only";
import { EVENTS_BUCKET, IMAGE_SIGNED_URL_TTL_SECONDS } from "@/lib/events/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { readLandingFields } from "@/modules/event/event.landing.rules";
import type {
  LandingPageStatus,
  LandingSuccessMessage,
  PublicLandingPage,
} from "@/modules/event/event.landing.types";

/**
 * A LEITURA DA PÁGINA PÚBLICA — a única porta de `event_landing_pages` que não
 * exige sessão.
 *
 * ============================================================================
 * ⚠️ POR QUE ELA NÃO MORA EM `event-landing.ts`.
 * ============================================================================
 * Aquele arquivo diz, no cabeçalho, que a leitura anônima não estaria lá — e o
 * motivo continua valendo. Todas as funções de lá passam pelo cliente
 * AUTENTICADO, ou seja, pela RLS: quem não tem papel não vê linha nenhuma,
 * mesmo que a checagem de permissão da aplicação falhe. Este arquivo faz o
 * oposto: usa `service_role`, que IGNORA a RLS.
 *
 * Misturar os dois num arquivo só significaria que uma função nova, escrita
 * distraidamente ao lado das outras, herdaria o cliente errado — e a diferença
 * entre os dois clientes, aqui, é a diferença entre "o mundo vê o cartaz do
 * evento" e "o mundo vê a lista de quem se inscreveu".
 *
 * ⚠️ O QUE PROTEGE ESTE CAMINHO NÃO É A RLS, É A ASSINATURA DA FUNÇÃO.
 * `get_public_event_landing_page` recebe um slug e devolve um jsonb com os
 * campos da página e mais nada. Não há parâmetro capaz de pedir outra coluna,
 * de listar, de paginar ou de chegar em `event_participants`. É o mesmo desenho
 * de `submit_membership_application` e de `register_survey_response`.
 *
 * ⚠️ UMA IDA AO BANCO, e é o que o §33 pede. A função já devolve o evento, os
 * textos padrão da plataforma e o consentimento vigente na mesma resposta.
 */

/** O formato cru do jsonb. Tudo `unknown` porque o que volta é jsonb. */
interface RespostaCrua {
  landingPageId?: unknown;
  slug?: unknown;
  status?: unknown;
  description?: unknown;
  imagePath?: unknown;
  formFields?: unknown;
  successTitle?: unknown;
  successMessage?: unknown;
  successFooter?: unknown;
  closesAt?: unknown;
  maxParticipants?: unknown;
  participantCount?: unknown;
  event?: unknown;
  successDefaults?: unknown;
  consent?: unknown;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/**
 * Os padrões da plataforma, com rede de segurança.
 *
 * ⚠️ O FALLBACK NÃO É DECORAÇÃO. `app_settings` pode não ter as três chaves (um
 * banco restaurado de antes da migration que as semeou), e uma página pública
 * que mostra "undefined" depois da inscrição é pior que qualquer texto.
 * Repetem os mesmos valores de `getRegistrationSuccessDefaults`.
 */
function lerPadroes(valor: unknown): LandingSuccessMessage {
  const bruto = (valor ?? {}) as Record<string, unknown>;
  return {
    title: texto(bruto["title"]) ?? "INSCRIÇÃO CONFIRMADA!",
    message:
      texto(bruto["message"]) ?? "Seu cadastro para o {{event_name}} foi realizado com sucesso.",
    footer: texto(bruto["footer"]) ?? "Esperamos você! Nos vemos no evento.",
  };
}

/**
 * Assina a imagem para o navegador.
 *
 * O bucket é PRIVADO, inclusive para esta página: o que vai para fora é uma URL
 * de vida curta, emitida aqui. Falhar devolve `null` — uma página de evento sem
 * a arte ainda diz quando e onde é; uma página que não abre não diz nada.
 */
async function assinar(path: string | null): Promise<string | null> {
  if (!path) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(EVENTS_BUCKET)
    .createSignedUrl(path, IMAGE_SIGNED_URL_TTL_SECONDS);

  if (error) {
    // Sem o caminho no log: ele identifica o evento, mas não é dado pessoal —
    // o que se omite aqui é ruído, não sigilo.
    console.error(`[event-landing-public] URL assinada falhou: ${error.message}`);
    return null;
  }

  return data?.signedUrl ?? null;
}

/**
 * A Landing Page de um slug, ou `null` quando não há o que mostrar.
 *
 * `null` cobre TRÊS casos que a página trata igual (§5): o slug não existe, a
 * página está em rascunho, a página foi inativada. A função Postgres não
 * distingue os três de propósito — uma resposta que diferenciasse "não existe"
 * de "existe mas está oculta" confirmaria a existência de um evento que ninguém
 * deveria saber que está sendo preparado.
 */
export async function getPublicLandingPage(slug: string): Promise<PublicLandingPage | null> {
  const limpo = slug.trim().toLowerCase();
  if (limpo === "") return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_public_event_landing_page", {
    p_slug: limpo,
  } as never);

  if (error) {
    // ⚠️ SÓ O CÓDIGO, e o slug. Nada de dado pessoal (§35) — esta leitura nem
    // toca em participante, mas o hábito é o que impede o descuido no dia em
    // que alguém acrescentar um campo aqui.
    console.error(`[event-landing-public] leitura do slug "${limpo}" falhou: ${error.code}`);
    return null;
  }

  const bruto = data as RespostaCrua | null;
  if (!bruto || typeof bruto !== "object") return null;

  const evento = (bruto.event ?? null) as Record<string, unknown> | null;
  const nome = texto(evento?.["name"]);
  const dataEvento = texto(evento?.["eventDate"]);
  const inicio = texto(evento?.["startTime"]);

  // Sem nome, data ou horário não há página de evento para mostrar. É defesa
  // contra o improvável (a FK garante que o evento existe), mas um `notFound()`
  // é uma resposta; um `undefined` na tela não é.
  if (!nome || !dataEvento || !inicio) return null;

  const status = texto(bruto.status);
  if (status !== "published" && status !== "closed") return null;

  const consentBruto = (bruto.consent ?? null) as Record<string, unknown> | null;
  const consentVersao = texto(consentBruto?.["version"]);
  const consentTexto = texto(consentBruto?.["body"]);

  return {
    // ⚠️ SEM `landingPageId`. Ver o aviso em `PublicLandingPage`: este objeto
    // desce inteiro para um Client Component, e o id da página não tem por que
    // chegar ao navegador. Quem precisa dele usa `resolvePublicLandingPageId`.
    slug: texto(bruto.slug) ?? limpo,
    status: status as LandingPageStatus,
    description: texto(bruto.description),
    imageUrl: await assinar(texto(bruto.imagePath)),
    // A MESMA leitura defensiva do backoffice: configuração irreconhecível cai
    // na ordem padrão do §7 em vez de derrubar a página.
    formFields: readLandingFields(bruto.formFields),
    successTitle: texto(bruto.successTitle),
    successMessage: texto(bruto.successMessage),
    successFooter: texto(bruto.successFooter),
    closesAt: texto(bruto.closesAt),
    maxParticipants: numero(bruto.maxParticipants),
    participantCount: numero(bruto.participantCount) ?? 0,
    event: {
      name: nome,
      eventDate: dataEvento,
      startTime: inicio,
      endTime: texto(evento?.["endTime"]),
      location: texto(evento?.["location"]) ?? "",
    },
    successDefaults: lerPadroes(bruto.successDefaults),
    consent: consentVersao && consentTexto ? { version: consentVersao, body: consentTexto } : null,
  };
}

/**
 * SÓ O IDENTIFICADOR DA PÁGINA, para a action de envio.
 *
 * ⚠️ ELA EXISTE PARA O NAVEGADOR NUNCA PRECISAR CONHECER O ID. O formulário
 * manda o SLUG — que já está na barra de endereços —, e é aqui que ele vira a
 * página. Ver o cabeçalho de `publicRegistrationSchema`.
 *
 * Chama a MESMA função Postgres de `getPublicLandingPage`, então a regra sobre
 * quais páginas existem para o mundo (§4) continua escrita num lugar só. O que
 * ela não faz é assinar a imagem: um envio de formulário não precisa da arte, e
 * uma ida ao Storage a cada submissão seria latência paga por nada.
 *
 * Devolve o id inclusive de página ENCERRADA. É deliberado: quem recusa o envio
 * é `create_event_registration`, com LP001, e é ela que tem a palavra final
 * (§29). Filtrar aqui daria a mesma resposta por um caminho que a tela e o
 * banco poderiam passar a discordar.
 */
export async function resolvePublicLandingPageId(slug: string): Promise<string | null> {
  const limpo = slug.trim().toLowerCase();
  if (limpo === "") return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_public_event_landing_page", {
    p_slug: limpo,
  } as never);

  if (error) {
    console.error(`[event-landing-public] slug "${limpo}" não resolveu: ${error.code}`);
    return null;
  }

  const id = (data as RespostaCrua | null)?.landingPageId;
  return typeof id === "string" && id !== "" ? id : null;
}
