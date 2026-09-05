/**
 * O CHECKLIST DE HOMOLOGAÇÃO — §21 do Prompt 5.
 *
 * ============================================================================
 * ⚠️ ELE NÃO BLOQUEIA A PUBLICAÇÃO, E ISSO É UMA DECISÃO — NÃO UM DESCUIDO.
 * ============================================================================
 *
 * A tentação óbvia era: "publicar exige os onze itens marcados". Ela está
 * errada, e a razão é o que acontece com uma trava que não pode ser satisfeita
 * honestamente.
 *
 * Os itens deste checklist são AFIRMAÇÕES DE UMA PESSOA — "as mensagens foram
 * revisadas", "o teste com o Time Interno foi feito". Nenhuma delas é
 * verificável pelo sistema. Uma trava sobre elas não impede publicar sem
 * revisar; impede publicar sem CLICAR, e a distância entre as duas coisas é
 * onde nasce o hábito de marcar tudo antes de ler. A partir daí o checklist
 * deixa de registrar o que foi conferido e passa a registrar que alguém queria
 * publicar — que é pior que não existir, porque parece uma garantia.
 *
 * O que o sistema PODE verificar já é obrigatório: `validate_flow_version()`
 * recusa publicar um fluxo sem nó inicial, com beco sem saída, com ação sem
 * handler ou com time inativo. Essas são as travas de verdade, e elas não
 * dependem de ninguém marcar nada.
 *
 * O checklist responde outra pergunta, e ela é de PESSOAS: "quem disse que
 * conferiu o quê, e quando". É material de conversa quando algo dá errado —
 * não de porta.
 *
 * ⚠️ POR ISSO ELE GRAVA `by` E `at`. Um booleano responderia "foi conferido?";
 * o registro responde "por quem, e antes ou depois daquela alteração?" — que é
 * a pergunta que se faz de verdade três semanas depois.
 */

/** Um item do checklist, do jeito que ele fica gravado no jsonb. */
export interface ChecklistEntry {
  checked: boolean;
  /** Nome de quem marcou, para a tela não precisar resolver o id. */
  by: string | null;
  /** ISO. Quando foi marcado. */
  at: string | null;
}

export type FlowChecklist = Record<string, ChecklistEntry>;

export interface ChecklistItemDefinition {
  key: string;
  label: string;
  /** Por que este item existe. Vira o texto de ajuda na tela. */
  help: string;
}

/**
 * Os onze itens do §21.
 *
 * ⚠️ AS CHAVES SÃO ESTÁVEIS E EM INGLÊS, como toda chave do projeto. O rótulo
 * pode ser reescrito numa quinta-feira sem invalidar o que já foi marcado —
 * que é o mesmo motivo de as alternativas de uma pergunta terem chave própria.
 *
 * ⚠️ E A LISTA É FECHADA NO CÓDIGO, e não configurável. Um checklist que cada
 * fluxo define do seu jeito não é um processo de homologação: é um campo de
 * texto com caixinhas. O valor dele está em ser o MESMO para todo fluxo, para
 * que "foi homologado" signifique a mesma coisa em todos.
 */
export const FLOW_CHECKLIST_ITEMS: readonly ChecklistItemDefinition[] = [
  {
    key: "validated",
    label: "Fluxo validado",
    help: "O painel de problemas está vazio. O sistema confere isto sozinho na publicação — aqui é você confirmando que olhou.",
  },
  {
    key: "messages",
    label: "Mensagens revisadas",
    help: "Cada texto que o associado vai ler, lido em voz alta. É o que mais custa corrigir depois: a mensagem já saiu.",
  },
  {
    key: "questions",
    label: "Perguntas revisadas",
    help: "As alternativas cobrem o que as pessoas realmente pedem? Uma opção faltando vira “não entendi” em série.",
  },
  {
    key: "teams",
    label: "Times revisados",
    help: "Cada transferência aponta para o time certo, e o time tem gente dentro. Transferir para uma fila vazia é pior que não transferir.",
  },
  {
    key: "actions",
    label: "Actions revisadas",
    help: "As consultas trazem o conteúdo esperado, e o que elas devolvem é usado por algum nó adiante.",
  },
  {
    key: "fallback",
    label: "Fallback validado",
    help: "O que acontece quando a pessoa responde qualquer coisa três vezes. Todo fluxo precisa de uma saída que termine em alguém.",
  },
  {
    key: "timeout",
    label: "Timeout validado",
    help: "O que acontece quando a pessoa some no meio. Sem isso a conversa fica aberta para sempre, ocupando a fila.",
  },
  {
    key: "simulated",
    label: "Teste no simulador",
    help: "Todos os caminhos percorridos no “Testar fluxo”, inclusive os de erro.",
  },
  {
    key: "internal_test",
    label: "Teste com o Time Interno APCS",
    help: "Alguém do time conversou com o fluxo pelo WhatsApp de verdade. O simulador não pega problema de entrega, de anexo nem de formatação.",
  },
  {
    key: "integrations",
    label: "Integrações validadas",
    help: "Bolsa, normativas, comunicação e eventos responderam com conteúdo vigente — e não com “não encontrei”.",
  },
  {
    key: "lgpd",
    label: "LGPD validada",
    help: "O fluxo não pede dado pessoal que a APCS não precise guardar, e respeita quem já pediu para sair.",
  },
] as const;

export const FLOW_CHECKLIST_KEYS: readonly string[] = FLOW_CHECKLIST_ITEMS.map((i) => i.key);

/**
 * Lê o jsonb do banco defensivamente.
 *
 * ⚠️ ITEM DESCONHECIDO É DESCARTADO, e item ausente vira desmarcado. O jsonb
 * pode ter sido gravado por uma versão anterior desta lista — um item removido
 * do código continuaria lá, e mostrá-lo faria a tela exibir uma exigência que
 * não existe mais.
 */
export function readFlowChecklist(bruto: unknown): FlowChecklist {
  const resultado: FlowChecklist = {};
  const objeto =
    bruto !== null && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};

  for (const item of FLOW_CHECKLIST_ITEMS) {
    const linha = objeto[item.key];
    const registro =
      linha !== null && typeof linha === "object" ? (linha as Record<string, unknown>) : {};

    resultado[item.key] = {
      checked: registro["checked"] === true,
      by: typeof registro["by"] === "string" ? registro["by"] : null,
      at: typeof registro["at"] === "string" ? registro["at"] : null,
    };
  }

  return resultado;
}

/**
 * Marca ou desmarca um item, carimbando quem e quando.
 *
 * ⚠️ DESMARCAR APAGA O CARIMBO. Manter "conferido por Maria em 03/09" ao lado de
 * uma caixa vazia seria contar duas histórias na mesma linha — e a que a tela
 * mostra em negrito é a errada.
 */
export function toggleChecklistItem(
  atual: FlowChecklist,
  key: string,
  checked: boolean,
  by: string | null,
  agora: Date = new Date(),
): FlowChecklist {
  if (!FLOW_CHECKLIST_KEYS.includes(key)) return atual;

  return {
    ...atual,
    [key]: checked
      ? { checked: true, by, at: agora.toISOString() }
      : { checked: false, by: null, at: null },
  };
}

/** Quantos itens estão marcados. Para o "7 de 11" da tela. */
export function checklistProgress(checklist: FlowChecklist): { done: number; total: number } {
  const done = FLOW_CHECKLIST_ITEMS.filter((item) => checklist[item.key]?.checked === true).length;
  return { done, total: FLOW_CHECKLIST_ITEMS.length };
}

/**
 * O checklist está completo?
 *
 * ⚠️ QUEM CHAMA ISTO É A TELA, PARA AVISAR — e nunca a publicação, para
 * recusar. Ver o aviso no topo do arquivo: uma trava sobre afirmações não
 * verificáveis produz o hábito de marcar sem ler.
 */
export function isChecklistComplete(checklist: FlowChecklist): boolean {
  const { done, total } = checklistProgress(checklist);
  return done === total;
}
