import { CONTEXT_TTL_MINUTES } from "./intelligence.types";
import type { IntentName } from "./intent.types";

/**
 * §46. O MENU DE EMERGÊNCIA — o que o robô oferece quando a IA está fora do ar.
 *
 * ⚠️ A LEITURA DA ESCOLHA É DETERMINÍSTICA, e é o ponto inteiro. Um menu cuja
 * resposta precisasse do classificador seria inútil exatamente quando ele
 * existe para servir: quando o classificador é o que caiu.
 *
 * É a mesma decisão de `affirmation.ts` — "sim" e "não" também são lidos sem
 * modelo, porque decidem se uma ação acontece.
 *
 * ⚠️ ESTE ARQUIVO É PURO. Ele não sabe o que é banco, fornecedor ou mensagem; a
 * frase do menu mora em `app_settings` (`chatbot.menu`) e é editável na tela. O
 * que está aqui é só o MAPA número → intenção, que precisa estar em código
 * porque é ele que o roteador executa.
 */

/**
 * As opções, na ordem em que aparecem na frase configurada.
 *
 * ⚠️ A ORDEM AQUI E A FRASE EM `app_settings` PRECISAM CASAR, e nada no sistema
 * garante isso — é a fraqueza conhecida deste desenho. A alternativa era gerar
 * a frase a partir desta lista, o que tiraria da APCS a liberdade de escrever o
 * texto do próprio menu (§50: mensagens de negócio não se hardcodam).
 *
 * O teste `menu.test.ts` fixa o mapa; a frase-semente da migration foi escrita
 * para casar com ele. Mudar um sem o outro é o erro a evitar.
 */
export const MENU_OPTIONS: readonly { choice: string; intent: IntentName }[] = [
  { choice: "1", intent: "consultar_bolsa" },
  { choice: "2", intent: "consultar_normativa" },
  { choice: "3", intent: "consultar_comunicacao" },
  { choice: "4", intent: "consultar_evento" },
  { choice: "5", intent: "falar_com_atendente" },
];

/**
 * O menu vale enquanto o contexto vale.
 *
 * Um número digitado meia hora depois não é escolha de menu: é a pessoa
 * respondendo outra coisa, e naquele intervalo a IA provavelmente já voltou.
 */
const MENU_TTL_MINUTES = CONTEXT_TTL_MINUTES;

/**
 * Lê a escolha, se e somente se um menu estiver de pé.
 *
 * ⚠️ OS DOIS "SE" SÃO OBRIGATÓRIOS, e o segundo é o que evita o pior caso.
 *
 *   1. a mensagem é SÓ um número da lista — "2", " 2 ", "2." e nada mais;
 *   2. um menu foi mostrado há pouco (`menuShownAt` dentro da validade).
 *
 * Sem o segundo, todo "2" da conversa viraria escolha: alguém escrevendo "2"
 * para dizer quantos caminhões vai mandar receberia uma normativa do nada. O
 * engano é ruim; a conclusão que a pessoa tira dele — que o robô é aleatório —
 * é pior, porque ela para de escrever.
 *
 * ⚠️ E SÓ O NÚMERO SOZINHO CONTA. "2 caixas" não é escolha de menu, e aceitar
 * qualquer mensagem que CONTENHA um dígito transformaria "chegou dia 2" em
 * consulta de normativa.
 */
export function readMenuChoice(
  message: string,
  menuShownAt: string | null,
  agora: Date = new Date(),
): IntentName | null {
  if (!menuShownAt) return null;

  const mostrado = new Date(menuShownAt).getTime();
  if (!Number.isFinite(mostrado)) return null;
  if (agora.getTime() - mostrado > MENU_TTL_MINUTES * 60_000) return null;

  // Um número, com espaço ou pontuação final tolerados. Nada mais.
  const limpo = message
    .trim()
    .replace(/[.)\]]+$/, "")
    .trim();

  return MENU_OPTIONS.find((opcao) => opcao.choice === limpo)?.intent ?? null;
}
