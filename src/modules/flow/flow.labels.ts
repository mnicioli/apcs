import type {
  FlowChannel,
  FlowConversationStatus,
  FlowNodeType,
  FlowRunStatus,
  FlowStatus,
  FlowVersionStatus,
} from "./flow.types";

/**
 * Os textos PT-BR dos Fluxos de Atendimento.
 *
 * ⚠️ ARQUIVO PRÓPRIO, e não um `switch` dentro de cada tela. É a mesma decisão
 * de `survey.labels.ts` e `knowledge.labels.ts`: a grid, o formulário, o
 * diálogo de publicação e o histórico mostram os mesmos estados, e três cópias
 * de "Aguardando aprovação" divergem na primeira vez que alguém encurta uma.
 */

export const FLOWS_PAGE_TITLE = "Fluxos de Atendimento";
export const FLOWS_PAGE_DESCRIPTION =
  "O caminho que uma conversa percorre antes de chegar a alguém. Desenhe, teste, aprove e publique — a versão no ar continua atendendo até a nova entrar.";

export const FLOWS_EMPTY = "Nenhum fluxo cadastrado ainda.";
export const FLOWS_EMPTY_FILTERED = "Nenhum fluxo corresponde aos filtros.";

export const FLOW_CHANNEL_LABELS: Record<FlowChannel, string> = {
  whatsapp: "WhatsApp",
  web: "Site",
};

export const FLOW_STATUS_LABELS: Record<FlowStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
};

/**
 * ⚠️ "PUBLICADA" E "NO AR" SÃO A MESMA COISA, e o rótulo diz a segunda porque é
 * a pergunta que se faz olhando a lista. "Publicada" descreve o que aconteceu
 * com o registro; "no ar" responde se aquilo está atendendo gente.
 */
export const FLOW_VERSION_STATUS_LABELS: Record<FlowVersionStatus, string> = {
  draft: "Rascunho",
  testing: "Em teste",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovada",
  published: "No ar",
  superseded: "Substituída",
};

export const FLOW_NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
  message: "Mensagem",
  question: "Pergunta",
  condition: "Condição",
  action: "Ação",
  attendant: "Atendente",
  end: "Encerramento",
};

/** O que cada tipo de nó faz, em uma frase — ajuda do seletor do desenhador. */
export const FLOW_NODE_TYPE_HINTS: Record<FlowNodeType, string> = {
  message: "Envia um texto e segue adiante sem esperar resposta.",
  question: "Faz uma pergunta com alternativas e espera a pessoa responder.",
  condition: "Escolhe o caminho a partir do que já foi respondido.",
  action: "Consulta ou registra algo no CRM (Bolsa, normativa, palestra…).",
  attendant: "Entrega a conversa para um time. O robô sai de cena.",
  end: "Encerra o atendimento.",
};

export const FLOW_RUN_STATUS_LABELS: Record<FlowRunStatus, string> = {
  running: "Executando",
  waiting_reply: "Aguardando resposta",
  handed_off: "Com o time",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export const FLOW_CONVERSATION_STATUS_LABELS: Record<FlowConversationStatus, string> = {
  new: "Nova",
  triage: "Em triagem",
  waiting_reply: "Aguardando resposta",
  in_service: "Em atendimento",
  waiting_customer: "Aguardando o cliente",
  resolved: "Resolvida",
  closed: "Encerrada",
};

/**
 * A cobertura mostrada acima da grid.
 *
 * ⚠️ ELA CONTA FLUXOS NO AR, E NÃO FLUXOS CADASTRADOS. A pergunta de quem abre
 * esta tela é "o que está atendendo agora?" — e um número que somasse rascunhos
 * responderia outra coisa, para cima, que é a direção errada de errar.
 */
export function flowCoverage(active: number, total: number): string {
  if (total === 0) return "Nenhum fluxo cadastrado.";
  if (active === 0) return `${total} ${total === 1 ? "fluxo" : "fluxos"} — nenhum no ar.`;
  return `${active} de ${total} ${total === 1 ? "fluxo" : "fluxos"} no ar.`;
}

/** "v3" — o jeito curto de dizer qual desenho está atendendo. */
export function flowVersionTag(version: number): string {
  return `v${version}`;
}

/**
 * A frase que explica por que um fluxo não pode ser ligado.
 *
 * Existe porque um botão desabilitado sem explicação é um beco sem saída: a
 * pessoa clica, nada acontece, e não há o que ler.
 */
export const FLOW_CANNOT_ACTIVATE = "Publique uma versão antes de ligar o fluxo.";
export const FLOW_CANNOT_EDIT_PUBLISHED =
  "Esta versão está no ar e não pode ser alterada. Crie uma nova versão a partir dela.";
