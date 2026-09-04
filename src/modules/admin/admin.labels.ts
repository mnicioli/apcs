import type { AdminAuditAction } from "./admin.types";

/**
 * Rótulos PT-BR da Administração. Todo texto que a pessoa lê sai daqui.
 */

export const USERS_TITLE = "Usuários";
export const USERS_SUBTITLE = "Quem tem acesso ao sistema e o que cada um pode fazer.";

export const SETTINGS_TITLE = "Configurações";
export const SETTINGS_SUBTITLE = "O que a plataforma usa para se comunicar e se organizar.";

/**
 * ⚠️ ESTE `Record` É UMA BARREIRA, e não uma tabela de conveniência.
 *
 * `AdminAuditAction` vem do enum do banco. Um `Record` completo obriga o
 * type-check a reprovar o dia em que uma migration acrescentar um verbo e
 * ninguém escrever o rótulo — que é exatamente o que tinha acontecido: as três
 * ações de cargo entraram em 20260903000100_custom_roles.sql e a trilha as
 * mostrava como `undefined`. O erro só apareceu quando `pnpm db:types` rodou de
 * novo, meses depois.
 *
 * A lição não é "rodar db:types": é que a barreira já existia e estava
 * desarmada, porque o tipo que ela guarda vinha de um arquivo desatualizado.
 */
export const ADMIN_AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  user_role_changed: "Papel alterado",
  user_invited: "Usuário convidado",
  segment_updated: "Público-alvo alterado",
  consent_text_published: "Texto de consentimento publicado",
  setting_updated: "Configuração alterada",
  notification_block_revoked: "Bloqueio de notificação desfeito",
  user_updated: "Cadastro de usuário editado",
  user_deactivated: "Conta inativada",
  user_reactivated: "Conta reativada",
  user_password_reset: "Recuperação de senha enviada",
  role_created: "Cargo criado",
  role_updated: "Cargo alterado",
  role_deleted: "Cargo excluído",
  // ⚠️ ATIVAR E DESATIVAR TÊM RÓTULO PRÓPRIO, e não são "Conhecimento
  // alterado". A pergunta que se faz à trilha é "desde quando o chatbot passou
  // a dizer isso?" — e ela só é respondível filtrando a lista se o verbo
  // aparecer nela.
  knowledge_created: "Item de conhecimento criado",
  knowledge_updated: "Item de conhecimento editado",
  knowledge_activated: "Item de conhecimento ativado",
  knowledge_deactivated: "Item de conhecimento inativado",
  // ⚠️ E A BARREIRA FUNCIONOU: os quinze verbos abaixo entraram em
  // 20260917000000_flow_enums.sql e o type-check reprovou este arquivo assim
  // que `pnpm db:types` rodou. É exatamente o que o comentário do topo diz que
  // deveria acontecer — e não aconteceu com os cargos, em 20260903000100,
  // porque o tipo vinha de um `database.ts` velho.
  //
  // Os rótulos separam CICLO DE VIDA de EDIÇÃO de propósito: "quem publicou a
  // versão que está no ar?" e "quem mexeu no fluxo ontem?" são perguntas
  // diferentes, feitas com pressa, e um "Fluxo alterado" genérico
  // transformaria as duas numa varredura do jsonb de cada linha.
  flow_created: "Fluxo criado",
  flow_updated: "Fluxo editado",
  flow_deleted: "Fluxo excluído",
  flow_activated: "Fluxo ligado",
  flow_deactivated: "Fluxo desligado",
  flow_version_created: "Versão de fluxo criada",
  flow_version_updated: "Versão de fluxo editada",
  flow_version_tested: "Versão de fluxo enviada para teste",
  flow_version_submitted: "Versão de fluxo enviada para aprovação",
  flow_version_approved: "Versão de fluxo aprovada",
  flow_version_published: "Versão de fluxo publicada",
  flow_version_rolled_back: "Versão de fluxo restaurada",
  flow_node_changed: "Etapa do fluxo alterada",
  flow_transition_changed: "Ligação do fluxo alterada",
  flow_team_changed: "Time de atendimento alterado",
};

/*
 * ⚠️ `ROLE_DESCRIPTIONS` SAIU DAQUI em 20260903000100_custom_roles.sql.
 *
 * A frase que explica um cargo passou a morar com o cargo, em
 * `app_roles.description` — inclusive a dos cargos que a APCS cria, que este
 * arquivo nunca poderia conhecer. As quatro frases originais foram levadas
 * para o seed daquela migration; mantê-las aqui também criaria duas verdades
 * sobre a mesma coisa, e a do código envelheceria em silêncio.
 */
/* -------------------------------------------------------------------------- */
/* Chaves de configuração                                                     */
/* -------------------------------------------------------------------------- */

/**
 * As chaves de `app_settings` que a tela conhece.
 *
 * ⚠️ LISTA FECHADA, e não um editor de chave livre. Um campo "chave" aberto
 * deixaria alguém criar `whatsapp.optout_confirmed` (sem o underscore certo) e
 * passar semanas achando que editou a mensagem que sai — enquanto o código
 * continua lendo a chave antiga. O CHECK do banco valida o FORMATO; esta lista
 * valida o SIGNIFICADO.
 */
export const SETTING_KEYS = {
  optOutConfirmed: "whatsapp.opt_out_confirmed",
  // ⚠️ AS CINCO FRASES DO CHATBOT, e nenhuma delas é constante no código.
  //
  // O §8 do escopo pede isso e a razão é prática: são os textos que mudam com
  // mais frequência de todo o sistema — muda o horário, muda o tom, muda quem
  // atende — e cada mudança viraria deploy. Ficam em `app_settings`, que já tem
  // RLS, já tem `set_app_setting` com auditoria e já tem tela.
  //
  // A cópia de emergência está em `SETTING_FALLBACKS` (src/lib/services/admin.ts):
  // se a linha sumir do banco, o bot continua tendo o que dizer.
  chatbotWelcome: "chatbot.welcome",
  chatbotFallback: "chatbot.fallback",
  chatbotNoResult: "chatbot.no_result",
  chatbotError: "chatbot.error",
  chatbotHumanHandoff: "chatbot.human_handoff",
  // ⚠️ SEXTA FRASE, acrescentada com a camada de roteamento. Ela existe porque a
  // agenda de eventos é SEGMENTADA: sem reconhecer o telefone, o robô não sabe
  // o que aquela pessoa pode ver. Responder "não há eventos" ali seria uma
  // afirmação falsa sobre a agenda — e é por isso que não dá para reaproveitar
  // `chatbot.no_result`.
  chatbotUnidentified: "chatbot.unidentified",
  // ⚠️ O MENU DE EMERGÊNCIA (§46). A ordem das opções aqui TEM de casar com
  // `MENU_OPTIONS` (src/modules/intelligence/menu.ts), que é o mapa número →
  // intenção. Nada no sistema garante isso: quem editar esta frase precisa
  // olhar aquele arquivo. É a fraqueza conhecida do desenho, aceita para a
  // APCS poder escrever o próprio texto (§50).
  chatbotMenu: "chatbot.menu",
  // §51. A despedida.
  chatbotClosing: "chatbot.closing",
  // ⚠️ NÃO É UMA FRASE — é a CHAVE GERAL do robô (§83). Fica junto das outras
  // porque `app_settings` é o mecanismo de configuração deste projeto, e um
  // segundo lugar para guardar um interruptor seria um lugar a mais onde
  // procurar no dia em que ele precisar ser desligado às pressas.
  chatbotEnabled: "chatbot.enabled",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const SETTING_LABELS: Record<SettingKey, { title: string; help: string }> = {
  [SETTING_KEYS.optOutConfirmed]: {
    title: "Confirmação de saída",
    help: "A resposta automática de quem manda SAIR. É a ÚLTIMA mensagem que essa pessoa recebe — sem ela, ninguém sabe se funcionou, e a saída restante seria bloquear o número da APCS.",
  },
  [SETTING_KEYS.chatbotWelcome]: {
    title: "Boas-vindas",
    help: "A primeira coisa que o associado lê ao mandar “oi”. É onde ele descobre o que dá para pedir — uma saudação que não lista os assuntos deixa a pessoa adivinhando.",
  },
  [SETTING_KEYS.chatbotFallback]: {
    title: "Não entendi",
    help: "Quando o robô não identifica o pedido. Diga o que ELE sabe fazer e ofereça um atendente: “não entendi” sozinho encerra a conversa sem saída.",
  },
  [SETTING_KEYS.chatbotNoResult]: {
    title: "Nada publicado",
    help: "Quando o pedido foi entendido e não há publicação vigente — Bolsa sem boletim ativo, normativa sem versão liberada. NÃO é erro: é a APCS não tendo o que enviar agora.",
  },
  [SETTING_KEYS.chatbotError]: {
    title: "Falha na consulta",
    help: "Quando a consulta falha de verdade. Existe separada da anterior porque o robô nunca deve inventar resposta no lugar de uma falha — e porque as duas pedem coisas diferentes de quem atende depois.",
  },
  [SETTING_KEYS.chatbotHumanHandoff]: {
    title: "Encaminhado para atendente",
    help: "O que o associado lê ao pedir uma pessoa. É a mensagem que define a expectativa de quando alguém vai responder — vale citar o horário de atendimento.",
  },
  [SETTING_KEYS.chatbotUnidentified]: {
    title: "Telefone não reconhecido",
    help: "Quando a resposta depende de saber quem está perguntando (a agenda de eventos é por público) e o telefone não está no cadastro. Diga como se identificar ou como se associar — “não há eventos” seria mentira sobre a agenda.",
  },
  [SETTING_KEYS.chatbotMenu]: {
    title: "Menu de emergência",
    help: "O que o robô oferece quando a interpretação de linguagem está fora do ar. ⚠️ A ORDEM DAS OPÇÕES É FIXA — 1 Bolsa, 2 Normativas, 3 Comunicação, 4 Eventos, 5 Atendente. Você pode reescrever o texto; trocar a ordem faria o número levar ao lugar errado.",
  },
  [SETTING_KEYS.chatbotClosing]: {
    title: "Despedida",
    help: "A resposta a “obrigado”, “era isso”, “pode encerrar”. Ela não encerra nada — a conversa continua aberta e a pessoa pode voltar a perguntar na mesma hora.",
  },
  [SETTING_KEYS.chatbotEnabled]: {
    title: "Robô ligado",
    help: "Escreva “off” para o robô parar de responder no WhatsApp AGORA, sem deploy. Qualquer outro valor mantém ligado. As mensagens que chegarem continuam sendo gravadas na caixa de entrada — só não recebem resposta automática.",
  },
};

/* -------------------------------------------------------------------------- */
/* Abas de Configurações                                                      */
/* -------------------------------------------------------------------------- */

export const SETTINGS_TABS = [
  { href: "/settings", label: "Integração" },
  { href: "/settings/segments", label: "Públicos-alvo" },
  { href: "/settings/notifications", label: "Bloqueios" },
  { href: "/settings/texts", label: "Textos e LGPD" },
  // Aba própria, e não mais campos em "Textos e LGPD". Aquela tela guarda duas
  // coisas com regras opostas — uma configuração que se sobrescreve e um
  // histórico de consentimento que não se sobrescreve —, e o comentário no topo
  // dela existe justamente para explicar a diferença. Cinco frases de robô no
  // meio disso apagariam a explicação.
  { href: "/settings/chatbot", label: "Chatbot" },
] as const;
