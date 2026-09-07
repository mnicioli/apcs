"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { failFromPostgres, fail, ok, type ActionResult } from "@/lib/actions/errors";
import { assertPermission } from "@/lib/auth/assert-permission";
import { clientIpHashFromHeaders } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import {
  discardOrphan,
  discardReplacedImage,
  inspectUploadedImage,
} from "@/lib/events/image-upload";
import {
  buildLandingImagePath,
  buildLandingSuccessImagePath,
  EVENTS_BUCKET,
} from "@/lib/events/storage";
import { validateImageCandidate } from "@/lib/files/image";
import {
  createLandingPageSchema,
  createRegistrationSchema,
  landingCommandSchema,
  landingImageSchema,
  landingImageTicketSchema,
  landingImageRemovalSchema,
  participantConfirmationSchema,
  updateLandingPageSchema,
  updateCompanySchema,
  updateParticipantSchema,
  updateRegistrationSchema,
  type CreateLandingPageInput,
  type CreateRegistrationInput,
  type LandingCommandInput,
  type LandingImageInput,
  type LandingImageTicketInput,
  type LandingImageRemovalInput,
  type LandingImageSlot,
  type ParticipantConfirmationInput,
  type UpdateLandingPageInput,
  type UpdateCompanyInput,
  type UpdateParticipantInput,
  type UpdateRegistrationInput,
} from "@/modules/event/event.landing.schema";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * ⚠️ O QUE FICA NO BANCO, E POR QUÊ. Praticamente tudo. Criar uma inscrição são
 * três escritas que precisam acontecer juntas (a inscrição, os participantes e
 * a trilha), e a conferência de capacidade precisa acontecer SOB LOCK, na mesma
 * transação — o supabase-js não faz transação de várias chamadas, e um
 * "consulta, e se couber insere" escrito aqui em cima perderia a corrida entre
 * duas inscrições simultâneas. O §15 é explícito sobre isso.
 *
 * O que sobra para este arquivo é o que o banco não tem como fazer: a
 * autorização precoce (mensagem clara em vez de "permission denied"), o formato
 * da entrada, o hash do IP e a montagem da chave de idempotência.
 *
 * ⚠️ AS DUAS PERMISSÕES DO MÓDULO. Landing Page é `events.write` — ela é a
 * fachada do evento. Inscrição é `registrations.write` — ali são dados pessoais
 * de terceiros. Ver o comentário em `rbac.config.ts`.
 */

/**
 * Invalida o cache das telas afetadas.
 *
 * Usa o PADRÃO das rotas de detalhe, e não os endereços concretos: qualquer
 * escrita muda o que a grid, o detalhe do evento e a tela de inscrições
 * mostram, e invalidar os quatro custa nada num backoffice.
 */
function revalidateLanding(): void {
  revalidatePath("/events", "page");
  revalidatePath("/events/[id]", "page");
  revalidatePath("/events/landing-pages", "page");
  // ⚠️ AS DUAS TELAS DO PROMPT 4. A lista de eventos mostra as contagens de
  // confirmados, então trocar UM toggle muda o que a tela ANTERIOR mostra —
  // invalidar só a grid deixaria a lista com números velhos até alguém recarregar.
  revalidatePath("/events/registrations", "page");
  revalidatePath("/events/registrations/[eventId]", "page");
}

/** O que as funções transacionais de Landing Page devolvem. */
interface LandingRpcResult {
  id: string;
  slug: string;
  status: string;
}

/** Texto vazio vira `null`: é o que o banco guarda para "não informado". */
function orNull(value: string | undefined): string | null {
  const limpo = (value ?? "").trim();
  return limpo === "" ? null : limpo;
}

/** Número em texto vira inteiro; vazio vira `null` (= sem limite). */
function orNullNumber(value: string | undefined): number | null {
  const limpo = (value ?? "").trim();
  return limpo === "" ? null : Number(limpo);
}

/* -------------------------------------------------------------------------- */
/* 1. Landing Page — exige `events.write`                                     */
/* -------------------------------------------------------------------------- */

export async function createLandingPageAction(
  input: CreateLandingPageInput,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const parsed = createLandingPageSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string; slug: string }>("events.write");
  if (negado) return negado;

  const supabase = await createClient();

  // `as never` como em todo `rpc` com argumento feito pelo cliente do USUÁRIO
  // neste projeto. O cliente do servidor tipa `args` de um jeito que não aceita
  // o objeto literal. Ver CONVENTIONS.md.
  const { data, error } = await supabase.rpc("create_event_landing_page", {
    p_event_id: parsed.data.eventId,
    // Vazio significa "gera a partir do nome do evento" (§6) — quem decide é o
    // banco, que é o único que consegue conferir a unicidade.
    p_slug: orNull(parsed.data.slug),
    p_form_fields: parsed.data.formFields,
    p_closes_at: orNull(parsed.data.closesAt),
    p_max_participants: orNullNumber(parsed.data.maxParticipants),
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("landing.create", error, { eventId: parsed.data.eventId })
      : fail("unexpected");
  }

  const linha = data as LandingRpcResult;
  revalidateLanding();
  return ok({ id: linha.id, slug: linha.slug });
}

export async function updateLandingPageAction(
  input: UpdateLandingPageInput,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const parsed = updateLandingPageSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string; slug: string }>("events.write");
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_event_landing_page", {
    p_landing_page_id: parsed.data.landingPageId,
    p_slug: orNull(parsed.data.slug),
    p_form_fields: parsed.data.formFields,
    p_closes_at: orNull(parsed.data.closesAt),
    p_max_participants: orNullNumber(parsed.data.maxParticipants),
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("landing.update", error, { landingPageId: parsed.data.landingPageId })
      : fail("unexpected");
  }

  const linha = data as LandingRpcResult;
  revalidateLanding();
  return ok({ id: linha.id, slug: linha.slug });
}

/**
 * Publica, encerra ou tira do ar (§5).
 *
 * ⚠️ AÇÃO SEPARADA DA EDIÇÃO, de propósito. Se `status` fosse mais um campo do
 * formulário, salvar uma correção de texto poderia tirar a página do ar por
 * descuido de quem montou a tela — e a pessoa só descobriria quando alguém
 * reclamasse que o link não abre.
 */
export async function setLandingPageStatusAction(
  input: LandingCommandInput,
): Promise<ActionResult<{ id: string; status: string }>> {
  const parsed = landingCommandSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string; status: string }>("events.write");
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_event_landing_page_status", {
    p_landing_page_id: parsed.data.landingPageId,
    p_command: parsed.data.command,
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("landing.status", error, {
          landingPageId: parsed.data.landingPageId,
          command: parsed.data.command,
        })
      : fail("unexpected");
  }

  const linha = data as LandingRpcResult;
  revalidateLanding();
  return ok({ id: linha.id, status: linha.status });
}

/* -------------------------------------------------------------------------- */
/* 2. Inscrições — exige `registrations.write`                                */
/* -------------------------------------------------------------------------- */

/**
 * Janela da chave de deduplicação.
 *
 * Cinco minutos, o mesmo de Associados: longo o bastante para cobrir duplo
 * clique, F5 e rede ruim; curto o bastante para não impedir alguém de corrigir
 * um erro de digitação e reenviar. Fora da janela, a mesma granja cria uma
 * inscrição nova — que é o comportamento certo, porque a segunda pode ser
 * justamente a correta.
 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/**
 * A chave de idempotência (§27).
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

export interface RegistrationCreated {
  registrationId: string;
  participantCount: number;
  /**
   * `true` quando o envio caiu na janela de deduplicação. A tela do backoffice
   * não precisa contar isso a ninguém — quem clicou uma vez recebeu uma
   * inscrição —, mas o Prompt 3 vai usar para não mostrar "inscrição criada"
   * duas vezes num F5.
   */
  duplicate: boolean;
}

/**
 * Cria uma inscrição com todos os participantes dela, numa transação (§26).
 *
 * ⚠️ TODAS AS REGRAS DO §17 ESTÃO NA FUNÇÃO POSTGRES, e não aqui. Página
 * publicada, prazo, capacidade, e-mail repetido dentro e fora da requisição,
 * telefone ou WhatsApp — as sete. Aqui em cima só rodam as que o Zod consegue
 * responder sem o banco, e elas existem para a mensagem ser boa, não para a
 * regra valer.
 *
 * ⚠️ ESTA ACTION É A PORTA DO BACKOFFICE. A porta pública é o Prompt 3, e ela
 * vai chamar a MESMA função Postgres com o cliente `service_role` — que é como
 * as duas continuam obedecendo às mesmas regras. O que muda entre elas é só
 * quem chama; `origin` é derivado disso dentro do banco, e não recebido.
 */
export async function createRegistrationAction(
  input: CreateRegistrationInput,
): Promise<ActionResult<RegistrationCreated>> {
  const parsed = createRegistrationSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<RegistrationCreated>("registrations.write");
  if (negado) return negado;

  const dados = parsed.data;
  const primeiro = dados.participants[0];
  // O schema já exige ao menos um; isto é o que convence o TypeScript com
  // `noUncheckedIndexedAccess` ligado, e cobre a entrada que passasse por fora.
  if (!primeiro) return fail("registrationNeedsParticipant");

  const cabecalhos = await headers();

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_event_registration", {
    p_landing_page_id: dados.landingPageId,
    p_company_name: dados.companyName,
    p_participants: dados.participants.map((pessoa) => ({
      fullName: pessoa.fullName,
      email: pessoa.email,
      phone: pessoa.phone || null,
      whatsapp: pessoa.whatsapp || null,
    })),
    p_dedupe_key: buildDedupeKey(dados.landingPageId, primeiro.email),
    // Hash, nunca o IP (§29). Serve ao limite de taxa do formulário público e a
    // mais nada — o mesmo que em Associados.
    p_source_ip_hash: clientIpHashFromHeaders(cabecalhos) ?? undefined,
    p_user_agent: cabecalhos.get("user-agent") ?? undefined,
  } as never);

  if (error) {
    // ⚠️ O CONTEXTO DO LOG NÃO TEM DADO PESSOAL (§29). Ids e uma contagem; nome,
    // e-mail e telefone ficam de fora. Um erro que despeje a lista de
    // participantes no log de produção é um vazamento silencioso.
    return failFromPostgres("registration.create", error, {
      landingPageId: dados.landingPageId,
      participants: dados.participants.length,
    });
  }

  const linha = (Array.isArray(data) ? data[0] : data) as
    | { registration_id: string; participant_count: number; duplicate: boolean }
    | undefined;

  if (!linha) return fail("unexpected");

  revalidateLanding();
  return ok({
    registrationId: linha.registration_id,
    participantCount: linha.participant_count,
    duplicate: linha.duplicate,
  });
}

/**
 * Edita a granja/empresa e/ou cancela e reativa a inscrição (§13).
 *
 * ⚠️ CANCELAR NÃO APAGA. É o que substitui a exclusão neste projeto, que não
 * tem soft delete em módulo nenhum — e o cancelamento DEVOLVE as vagas ao
 * evento, porque a contagem de capacidade só considera inscrição ativa.
 */
export async function updateRegistrationAction(
  input: UpdateRegistrationInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateRegistrationSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("registrations.write");
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_event_registration", {
    // O evento vai junto: a função recusa quando a inscrição é de outro (§26).
    p_event_id: parsed.data.eventId,
    p_registration_id: parsed.data.registrationId,
    p_company_name: parsed.data.companyName ?? null,
    p_status: parsed.data.status ?? null,
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("registration.update", error, {
          registrationId: parsed.data.registrationId,
        })
      : fail("unexpected");
  }

  revalidateLanding();
  return ok({ id: (data as { id: string }).id });
}

/** Troca a confirmação de um participante (§11). */
export async function setParticipantConfirmationAction(
  input: ParticipantConfirmationInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = participantConfirmationSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("registrations.write");
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_participant_confirmation", {
    // Ver o §26: sem o evento, um id de participante de outro evento passaria.
    p_event_id: parsed.data.eventId,
    p_participant_id: parsed.data.participantId,
    p_confirmation: parsed.data.confirmation,
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("participant.confirmation", error, {
          participantId: parsed.data.participantId,
        })
      : fail("unexpected");
  }

  revalidateLanding();
  return ok({ id: (data as { id: string }).id });
}

/* -------------------------------------------------------------------------- */
/* 3. As DUAS imagens da página — exige `events.write`                        */
/* -------------------------------------------------------------------------- */

/**
 * O QUE MUDA ENTRE A ARTE DA PÁGINA E O BANNER DE CONFIRMAÇÃO.
 *
 * ============================================================================
 * ⚠️ TRÊS DIFERENÇAS, E TUDO O MAIS É IDÊNTICO — POR ISSO É UMA TABELA.
 * ============================================================================
 * As duas artes sobem pelo mesmo bucket, com o mesmo teto de 5 MB, a mesma
 * inspeção de bytes, a mesma ordem (validar antes de gravar, descartar a antiga
 * depois) e a mesma permissão. O que difere é a PASTA, a FUNÇÃO POSTGRES e a
 * COLUNA que guarda o caminho.
 *
 * Duplicar as três actions para trocar isso é como uma das cópias deixa de
 * receber a próxima correção — e a correção que importa aqui é de segurança: a
 * conferência de que o caminho devolvido pelo cliente aponta para a pasta do
 * próprio evento.
 *
 * ⚠️ E A PASTA DO `success` É FILHA DA DO `page`. `<id>/landing/success/x.png`
 * também começa com `<id>/landing/`, então um `startsWith` sozinho deixaria uma
 * arte de confirmação ser gravada como arte da página. É por isso que
 * `dentroDaPasta` exige que o resto do caminho seja um NOME DE ARQUIVO — sem
 * mais nenhuma barra.
 */
const IMAGEM_DA_PAGINA = {
  page: {
    pasta: (eventId: string) => `${eventId}/landing/`,
    caminho: buildLandingImagePath,
    rpc: "set_event_landing_page_image",
    coluna: "image_path",
    argumentos: (path: string | null, mime: string | null, bytes: number | null) => ({
      p_image_path: path,
      p_image_mime: mime,
      p_image_size_bytes: bytes,
    }),
  },
  success: {
    pasta: (eventId: string) => `${eventId}/landing/success/`,
    caminho: buildLandingSuccessImagePath,
    rpc: "set_event_landing_page_success_image",
    coluna: "success_image_path",
    argumentos: (path: string | null, mime: string | null, bytes: number | null) => ({
      p_success_image_path: path,
      p_success_image_mime: mime,
      p_success_image_size_bytes: bytes,
    }),
  },
} as const satisfies Record<LandingImageSlot, unknown>;

/**
 * O caminho está DENTRO da pasta, e não numa subpasta dela.
 *
 * Ver o aviso acima: é esta segunda metade que separa as duas artes, já que a
 * pasta de uma é filha da pasta da outra.
 */
function dentroDaPasta(storagePath: string, pasta: string): boolean {
  if (!storagePath.startsWith(pasta)) return false;
  return !storagePath.slice(pasta.length).includes("/");
}

/**
 * Passo 1: autoriza e devolve um endereço para o navegador enviar a arte DIRETO
 * ao Supabase Storage.
 *
 * ⚠️ MESMO DESENHO DE `requestEventImageUploadAction`, E PELO MESMO MOTIVO
 * MECÂNICO: a Vercel corta o corpo de requisições serverless em 4,5 MB e o
 * limite é 5 MB. Uma imagem grande não passa por Server Action. O que trafega
 * aqui são algumas centenas de bytes.
 *
 * ⚠️ O `eventId` VEM DO BANCO, NUNCA DO CLIENTE. O caminho no bucket é
 * `<event_id>/landing/<uuid>.<ext>`; aceitar o id de fora deixaria alguém
 * escrever na pasta de outro evento. A página é lida aqui exatamente para
 * descobrir a qual evento ela pertence.
 */
export async function requestLandingImageUploadAction(
  input: LandingImageTicketInput,
): Promise<ActionResult<{ bucket: string; path: string; token: string }>> {
  type Ticket = { bucket: string; path: string; token: string };

  const parsed = landingImageTicketSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<Ticket>("events.write");
  if (negado) return negado;

  // `type: ""` porque o servidor não vê o MIME que o navegador declarou — aqui
  // só dá para conferir extensão e tamanho. O que o arquivo REALMENTE é fica
  // para o passo 2, depois de ele existir.
  const problema = validateImageCandidate({
    name: parsed.data.filename,
    size: parsed.data.sizeBytes,
    type: "",
  });
  if (problema) return fail(problema);

  const supabase = await createClient();

  const { data: pagina, error: erroLeitura } = await supabase
    .from("event_landing_pages")
    .select("id, event_id")
    .eq("id", parsed.data.landingPageId)
    .returns<{ id: string; event_id: string }[]>()
    .maybeSingle();

  if (erroLeitura) {
    console.error(`[landing] leitura da página falhou: ${erroLeitura.message}`);
    return failFromPostgres("landing.image.ticket", erroLeitura, {
      landingPageId: parsed.data.landingPageId,
    });
  }
  if (!pagina) return fail("notFound");

  const path = IMAGEM_DA_PAGINA[parsed.data.slot].caminho(pagina.event_id, parsed.data.filename);

  const { data, error } = await supabase.storage.from(EVENTS_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error(`[landing] URL de upload falhou: ${error?.message ?? "sem dados"}`);
    return fail("unexpected");
  }

  return ok({ bucket: EVENTS_BUCKET, path: data.path, token: data.token });
}

/**
 * Passo 2: confere os BYTES do que subiu e grava o caminho na página.
 *
 * ⚠️ A ORDEM IMPORTA. A imagem nova é validada ANTES de a linha ser alterada.
 * Se for recusada, o objeto novo é apagado e a página continua exatamente como
 * estava, apontando para a arte que sempre funcionou. A antiga só é descartada
 * DEPOIS que a troca já está gravada — nunca há um instante em que o banco
 * aponte para um arquivo que não existe. É a mesma coreografia de
 * `updateEventAction`.
 */
export async function setLandingPageImageAction(
  input: LandingImageInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = landingImageSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("events.write");
  if (negado) return negado;

  const { landingPageId, storagePath, slot } = parsed.data;
  const destino = IMAGEM_DA_PAGINA[slot];

  const supabase = await createClient();

  const { data: pagina, error: erroLeitura } = await supabase
    .from("event_landing_pages")
    .select("id, event_id, image_path, success_image_path")
    .eq("id", landingPageId)
    .returns<
      {
        id: string;
        event_id: string;
        image_path: string | null;
        success_image_path: string | null;
      }[]
    >()
    .maybeSingle();

  if (erroLeitura) {
    return failFromPostgres("landing.image", erroLeitura, { landingPageId });
  }
  if (!pagina) return fail("notFound");

  // ⚠️ O CAMINHO VOLTA PELO CLIENTE, ENTÃO NÃO É CONFIÁVEL. Confiná-lo à pasta
  // do próprio evento impede uma página de apontar para a arte de outra — ou
  // pior, para o cartaz de um evento alheio. E confiná-lo à pasta do SLOT
  // impede o banner de confirmação de ser gravado como arte da página.
  if (!dentroDaPasta(storagePath, destino.pasta(pagina.event_id))) return fail("invalidInput");

  const imagem = await inspectUploadedImage(storagePath);
  if ("issue" in imagem) {
    await discardOrphan(storagePath);
    return fail(imagem.issue);
  }

  const { data, error } = await supabase.rpc(destino.rpc, {
    p_landing_page_id: landingPageId,
    ...destino.argumentos(storagePath, imagem.mime, imagem.sizeBytes),
  } as never);

  if (error || !data) {
    await discardOrphan(storagePath);
    return error ? failFromPostgres("landing.image", error, { landingPageId }) : fail("unexpected");
  }

  const anterior = pagina[destino.coluna];
  if (anterior && anterior !== storagePath) {
    await discardReplacedImage(anterior, "event_landing_pages", destino.coluna);
  }

  revalidateLanding();
  return ok({ id: (data as LandingRpcResult).id });
}

/**
 * Remove uma das duas artes.
 *
 * ⚠️ AS DUAS REMOÇÕES SÃO SEGURAS, POR MOTIVOS DIFERENTES. Sem arte própria, a
 * página de inscrição usa o CARTAZ DO EVENTO, que é obrigatório e sempre existe
 * — é por isso que remover é seguro aqui e não seria em Eventos, onde a imagem é
 * o único cartaz. Sem banner de confirmação, a tela de confirmação volta ao
 * TEXTO padrão da plataforma, que também sempre existe.
 *
 * Em nenhum dos dois casos a página fica sem nada para mostrar, e é isso que
 * torna o botão "Remover" uma operação sem susto.
 */
export async function removeLandingPageImageAction(
  input: LandingImageRemovalInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = landingImageRemovalSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("events.write");
  if (negado) return negado;

  const { landingPageId, slot } = parsed.data;
  const destino = IMAGEM_DA_PAGINA[slot];

  const supabase = await createClient();

  const { data: pagina, error: erroLeitura } = await supabase
    .from("event_landing_pages")
    .select("id, image_path, success_image_path")
    .eq("id", landingPageId)
    .returns<{ id: string; image_path: string | null; success_image_path: string | null }[]>()
    .maybeSingle();

  if (erroLeitura) {
    return failFromPostgres("landing.image.remove", erroLeitura, { landingPageId });
  }
  if (!pagina) return fail("notFound");

  const { data, error } = await supabase.rpc(destino.rpc, {
    p_landing_page_id: landingPageId,
    ...destino.argumentos(null, null, null),
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("landing.image.remove", error, { landingPageId })
      : fail("unexpected");
  }

  // Só DEPOIS de a linha já não apontar mais para o arquivo.
  const anterior = pagina[destino.coluna];
  if (anterior) {
    await discardReplacedImage(anterior, "event_landing_pages", destino.coluna);
  }

  revalidateLanding();
  return ok({ id: (data as LandingRpcResult).id });
}

/* -------------------------------------------------------------------------- */
/* 4. A ficha do participante (§13, §14, §15 do Prompt 4)                     */
/* -------------------------------------------------------------------------- */

/**
 * EDITA OS DADOS DE UM PARTICIPANTE.
 *
 * ⚠️ MANDA A FICHA INTEIRA, sempre — não só o que mudou. `update_event_participant`
 * trata string vazia em telefone/WhatsApp como APAGAR, e é isso que permite
 * limpar um campo pela tela. A consequência é que esta action NÃO serve para
 * atualização parcial: quem a chamar com metade dos campos apaga a outra
 * metade. O formulário mostra todos eles justamente por isso — mesmo contrato
 * de `updateMemberAction`.
 *
 * ⚠️ O `eventId` NÃO É DECORAÇÃO (§25, §26). Ele é conferido no banco contra o
 * `event_id` do participante: um id de participante de OUTRO evento colado na
 * requisição recebe "não encontrado", e não a ficha de terceiro. A tela sabe
 * qual evento está aberto porque ele está na rota; o que a action não faz é
 * confiar que o participante enviado pertence a ele.
 */
export async function updateParticipantAction(
  input: UpdateParticipantInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateParticipantSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("registrations.write");
  if (negado) return negado;

  const dados = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_event_participant", {
    p_event_id: dados.eventId,
    p_participant_id: dados.participantId,
    p_full_name: dados.fullName,
    p_email: dados.email,
    // Vazio significa APAGAR — ver o aviso acima. Por isso não vira `undefined`.
    p_phone: dados.phone ?? "",
    p_whatsapp: dados.whatsapp ?? "",
    p_confirmation: dados.confirmation,
  } as never);

  if (error || !data) {
    return error
      ? // ⚠️ SÓ IDS NO CONTEXTO (§25). Nome, e-mail e telefone do participante
        // ficam de fora: um erro que os despeje no log de produção é um
        // vazamento silencioso de dado de terceiro.
        failFromPostgres("participant.update", error, {
          eventId: dados.eventId,
          participantId: dados.participantId,
        })
      : fail("unexpected");
  }

  revalidateLanding();
  return ok({ id: (data as { id: string }).id });
}

/**
 * Renomeia a granja/empresa de uma inscrição (§13).
 *
 * ⚠️ VALE PARA TODOS OS PARTICIPANTES DELA, e é o modelo de dados aparecendo:
 * a granja é da INSCRIÇÃO. A tela diz isso antes de salvar — sem o aviso,
 * alguém corrigiria o nome achando que estava mexendo só na linha do João.
 *
 * Existe separada de `updateRegistrationAction` porque aquela também cancela e
 * reativa, e o §16 é explícito em não expor exclusão nesta tela. Uma action
 * estreita não tem como cancelar uma inscrição por engano.
 */
export async function updateCompanyAction(
  input: UpdateCompanyInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateCompanySchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("registrations.write");
  if (negado) return negado;

  const dados = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_event_registration", {
    p_event_id: dados.eventId,
    p_registration_id: dados.registrationId,
    p_company_name: dados.companyName,
    // ⚠️ `undefined` MANTÉM A SITUAÇÃO. É o que impede esta action de cancelar
    // uma inscrição: ela não tem por onde.
    p_status: undefined,
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("registration.company", error, {
          eventId: dados.eventId,
          registrationId: dados.registrationId,
        })
      : fail("unexpected");
  }

  revalidateLanding();
  return ok({ id: (data as { id: string }).id });
}
