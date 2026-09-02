import { formatCalendarDate } from "@/lib/utils";
import type { IntentName } from "./intent.types";

/**
 * O CATÁLOGO DE TEXTO DA CAMADA DE INTELIGÊNCIA.
 *
 * ⚠️ TODA FRASE QUE O ASSOCIADO LÊ SAI DAQUI OU DE `app_settings`, e nunca de
 * uma interpolação escrita no meio de uma ferramenta. Se o texto pudesse nascer
 * em qualquer lugar, "a IA nunca escreve para o usuário" viraria uma promessa
 * que ninguém consegue verificar.
 *
 * O que existe aqui são MOLDES: uma frase fixa mais dados oficiais do CRM (o
 * nome da publicação, a data de vigência, o título do evento). Nenhum molde
 * recebe texto vindo do modelo.
 */

/* -------------------------------------------------------------------------- */
/* As legendas dos anexos                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ A LEGENDA DIZ QUAL VERSÃO É, e isso não é enfeite. Um boletim de preços
 * reencaminhado semanas depois é indistinguível do atual se a mensagem não
 * disser a data — e é assim que um preço velho volta a circular como se fosse o
 * de hoje.
 */
export function bolsaCaption(name: string, versionName: string, effectiveDate: string): string {
  return `${name} — ${versionName}\nVigente desde ${formatCalendarDate(effectiveDate)}.`;
}

export function documentCaption(name: string, version: number, effectiveDate: string): string {
  return `${name} — versão ${version}\nEm vigor desde ${formatCalendarDate(effectiveDate)}.`;
}

/* -------------------------------------------------------------------------- */
/* Eventos                                                                    */
/* -------------------------------------------------------------------------- */

export interface EventLine {
  name: string;
  eventDate: string;
  startTime: string;
  location: string;
}

/**
 * A agenda em texto.
 *
 * ⚠️ SEM LINK PARA O CRM. Quem recebe isto no WhatsApp não tem login — um
 * endereço de tela autenticada seria um beco sem saída. Quando o evento tem
 * inscrição, o link público dela é responsabilidade de outra mensagem.
 */
export function eventsBody(events: readonly EventLine[]): string {
  const linhas = events.map(
    (evento) =>
      `• ${evento.name}\n  ${formatCalendarDate(evento.eventDate)} às ${evento.startTime} — ${evento.location}`,
  );

  const cabecalho =
    events.length === 1
      ? "A APCS tem este evento marcado:"
      : `A APCS tem ${events.length} eventos marcados:`;

  return `${cabecalho}\n\n${linhas.join("\n\n")}`;
}

/* -------------------------------------------------------------------------- */
/* Escolha entre várias publicações                                           */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ QUANDO HÁ MAIS DE UMA, O ROBÔ PERGUNTA — não escolhe.
 *
 * "Me manda a normativa" com três normativas publicadas não tem resposta certa,
 * e mandar a primeira da lista alfabética seria inventar uma preferência que a
 * pessoa não expressou. Listar os nomes devolve a decisão a quem perguntou, e
 * de quebra ensina o vocabulário do catálogo.
 */
export function chooseAmong(names: readonly string[], tipo: string): string {
  return (
    `A APCS tem ${names.length} ${tipo} disponíveis. Qual você quer?\n\n` +
    names.map((nome) => `• ${nome}`).join("\n")
  );
}

/** Plural PT-BR de cada tipo, para o molde acima. */
export const CHOICE_NOUNS = {
  bolsa: "boletins",
  normative: "normativas",
  communication: "materiais",
} as const;

/* -------------------------------------------------------------------------- */
/* A confirmação                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A pergunta da faixa média, com a instrução de como responder.
 *
 * ⚠️ O "responda SIM ou NÃO" NÃO É REDUNDANTE. A leitura da resposta é
 * determinística, sem modelo (ver `affirmation.ts`) — então uma resposta
 * criativa ("por favor") cai em "não entendi" e a pessoa reformula sem saber
 * por quê. Dizer o formato esperado é o que faz o determinismo ser justo.
 */
export function confirmationBody(question: string): string {
  return `${question}\n\nResponda *sim* ou *não*.`;
}

/* -------------------------------------------------------------------------- */
/* Trilha e logs (PT-BR, para quem lê a tela de administração)                */
/* -------------------------------------------------------------------------- */

export const INTELLIGENCE_OUTCOME_LABELS = {
  tool_ok: "Respondeu com conteúdo",
  tool_empty: "Não havia publicação vigente",
  tool_error: "Falhou ao consultar",
  confirmed: "Pediu confirmação",
  message: "Respondeu com mensagem padrão",
  handoff: "Encaminhou para atendimento",
} as const;

/** O rótulo de uma intenção, para a trilha. */
export function intentLabel(intent: IntentName, registry: Record<IntentName, { label: string }>) {
  return registry[intent].label;
}

/**
 * O nome de arquivo que aparece quando não há nome.
 *
 * ⚠️ NÃO DEVERIA ACONTECER — as portas de chatbot sempre trazem o nome
 * original do arquivo. Existe porque `fileName` é opcional no anexo (a imagem
 * da Bolsa não tem nome), e um documento chegando aqui sem nome não pode virar
 * legenda vazia: `whatsapp_start_bot_message` recusa corpo em branco, e o envio
 * inteiro pararia por causa de um rótulo.
 */
export const BOT_UNNAMED_FILE = "Documento da APCS";
