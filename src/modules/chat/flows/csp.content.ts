/**
 * CATÁLOGO DE CONTEÚDO APROVADO — fluxo CSP (compras coletivas).
 *
 * ⚠️ ESTE ARQUIVO É O ÚNICO LUGAR DE ONDE SAI TEXTO DO BOT.
 *
 * O LLM nunca escreve para o usuário: ele só interpreta o que a pessoa disse e
 * extrai os dados da triagem. Quem escolhe a mensagem é o motor
 * (`src/lib/chat/engine.ts`), e a mensagem sempre vem daqui. Consequência: o
 * bot é literalmente incapaz de dizer algo que não passou por revisão.
 *
 * Toda mudança de texto passa por commit — é a trilha de auditoria do que a
 * APCS falou com o público.
 *
 * 🚧 OS TEXTOS ABAIXO SÃO RASCUNHOS. Não publique antes de o time da APCS
 * revisar e aprovar cada `TODO(APCS)`.
 */

/**
 * Placeholders permitidos nos textos. A substituição é estrita: qualquer chave
 * fora desta lista fica no texto como está (e aparece na revisão).
 */
export interface CspContentVars {
  policyUrl: string;
  materialUrl: string;
  summary: string;
}

export const CSP_CONTENT = {
  // --- Abertura -------------------------------------------------------------
  welcome:
    "Olá! Sou o assistente virtual da APCS. " +
    "Posso te explicar como funciona o CSP, o programa de compras coletivas da associação, " +
    "e encaminhar seu contato para o nosso time.",

  // --- Consentimento (LGPD) -------------------------------------------------
  consentRequest:
    "Antes de começarmos: para te atender, preciso registrar alguns dados seus " +
    "(nome, cidade, perfil e contato). Eles serão usados apenas para a APCS " +
    "retornar sobre o CSP. Você pode consultar nossa política de privacidade em " +
    "{{policyUrl}}.\n\nPodemos seguir?",
  consentDeclined:
    "Tudo bem, não vou registrar nenhum dado. " +
    "Se mudar de ideia, é só voltar aqui quando quiser. Obrigado pelo contato!",
  consentReminder:
    "Só para eu ter certeza: você autoriza a APCS a registrar e usar esses dados " +
    "para entrar em contato sobre o CSP? Responda com sim ou não, por favor.",

  // --- Conteúdo institucional ----------------------------------------------
  // TODO(APCS): substituir pelo texto institucional OFICIAL aprovado do CSP.
  cspIntro:
    "O CSP é o programa de compras coletivas da APCS. " +
    "A ideia é simples: reunir a demanda de vários produtores associados para negociar " +
    "insumos, ração e logística em melhores condições do que cada um conseguiria sozinho. " +
    "Quanto maior o volume reunido, melhor a condição para todo mundo.",
  // TODO(APCS): substituir pelo link oficial e pelo material aprovado.
  cspMaterial:
    "Preparei um material com os detalhes do programa: {{materialUrl}}\n" +
    "Ele explica como funciona a adesão, os prazos e como as compras são organizadas.",

  // --- Perguntas de triagem -------------------------------------------------
  askFullName: "Para começar, como você se chama?",
  askLocation: "Certo. De qual cidade e estado você fala? (por exemplo: Piracicaba, SP)",
  askContactProfile: "E hoje você fala com a gente como produtor, associado ou fornecedor?",
  askInterest:
    "O que te traz ao CSP: insumo, ração, logística, ou você quer só entender melhor o programa?",
  askVolumeRange: "Para eu dimensionar melhor: qual o porte aproximado da sua granja?",
  askContactChannel: "Qual o melhor canal para o time da APCS te procurar?",
  askContactValue: "Perfeito. Qual o número ou e-mail para contato?",
  askPreferredTime: "E qual o melhor horário para falar com você?",

  // --- Fechamento -----------------------------------------------------------
  completed:
    "Prontinho, registrei suas informações:\n\n{{summary}}\n\n" +
    "O time do CSP vai receber esse contato e retorna pelo canal que você indicou. " +
    "Obrigado por falar com a APCS!",

  // --- Limites do bot -------------------------------------------------------
  // TODO(APCS): validar a frase padrão de recusa com o time.
  outOfScope:
    "Essa informação eu não tenho aqui — só posso falar sobre o CSP com o conteúdo " +
    "oficial da APCS. Posso registrar seu contato para alguém do time te responder direito?",
  handoff:
    "Combinado, vou encaminhar você para o time da APCS. " +
    "Eles retornam pelo canal que você indicar.",
  handoffCompleted: "Registrei seu pedido de atendimento e o time da APCS vai retornar. Obrigado!",
  unclear: "Desculpe, não entendi. Pode reescrever de outro jeito?",

  // --- Estados operacionais -------------------------------------------------
  rateLimited: "Recebi várias mensagens seguidas. Pode aguardar um instante antes de continuar?",
  unavailable:
    "Tive um problema técnico agora. Pode tentar de novo em instantes? " +
    "Se preferir, o time da APCS também atende pelos canais oficiais.",
  conversationClosed:
    "Esta conversa já foi encerrada. Se precisar de algo novo, é só recarregar a página " +
    "para começar de novo.",
} as const;

export type CspContentKey = keyof typeof CSP_CONTENT;

export const CSP_CONTENT_KEYS = Object.keys(CSP_CONTENT) as CspContentKey[];

export function isCspContentKey(value: string): value is CspContentKey {
  return value in CSP_CONTENT;
}

/**
 * Renderiza uma mensagem aprovada, substituindo apenas os placeholders
 * conhecidos. Nada além do catálogo entra no texto.
 *
 * A substituição é uma PASSADA ÚNICA (`String.replace` com regex global nunca
 * reprocessa o que acabou de inserir). Isso importa: um dos valores é o resumo
 * da triagem, montado com texto que a pessoa digitou. Substituindo em loop, um
 * nome como "{{policyUrl}}" seria expandido na volta seguinte — aqui ele fica
 * literal, e a proteção não depende da ordem em que o caller passou as chaves.
 *
 * Placeholder sem valor fica visível no texto de propósito: aparece na revisão
 * em vez de sumir silenciosamente.
 */
export function renderCspContent(key: CspContentKey, vars: Partial<CspContentVars> = {}): string {
  return CSP_CONTENT[key].replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = Object.hasOwn(vars, name) ? vars[name as keyof CspContentVars] : undefined;
    return value ?? placeholder;
  });
}
