import { normalizeForSearch } from "@/lib/utils";
import {
  DEFAULT_QUESTION_MAX_ATTEMPTS,
  MAX_ACTION_ATTEMPTS,
  type QuestionFallback,
} from "./flow.schema";
import type { CompiledFlowNode, FlowQuestionOption, FlowVariables } from "./flow.types";

/**
 * A LEITURA DEFENSIVA DO RETRATO CONGELADO.
 *
 * ⚠️ TUDO AQUI RECEBE `Record<string, unknown>` E DEVOLVE ALGO USÁVEL, e a
 * razão é que a configuração de um nó foi gravada por uma versão ANTERIOR do
 * sistema. Um retrato de agosto é lido para sempre (§22 do Prompt 1) — inclusive
 * depois de o formato mudar. Um campo que não existe é `undefined`, e decidir o
 * caminho de um atendimento a partir de um buraco é o defeito que este arquivo
 * existe para tornar impossível: cada função abaixo tem um padrão explícito e
 * documentado para a ausência.
 *
 * ⚠️ E É POR ISSO QUE ELE ESTÁ SEPARADO DO MOTOR. Os executores (§6 do Prompt
 * 3) precisam das mesmas leituras, e um executor novo não pode ter de importar
 * o motor para ler o texto de um nó — seria a dependência ao contrário, e ela
 * fecharia um ciclo.
 */

/* -------------------------------------------------------------------------- */
/* Os tijolos                                                                 */
/* -------------------------------------------------------------------------- */

/** O campo de texto, ou `null`. Vazio conta como ausente — e quase sempre é. */
export function textField(node: CompiledFlowNode, campo: string): string | null {
  const valor = node.configuration[campo];
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

export function numberField(node: CompiledFlowNode, campo: string): number | null {
  const valor = node.configuration[campo];
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/**
 * Um inteiro dentro de uma faixa, com padrão.
 *
 * ⚠️ FORA DA FAIXA VIRA O PADRÃO, e não o extremo mais próximo. Um
 * `maxAttempts: 900` gravado por engano é um defeito de configuração; grampeá-lo
 * em 10 esconderia o defeito por trás de um comportamento plausível, e ninguém
 * descobriria que o número que está no jsonb não é o que está valendo.
 */
function inteiro(
  node: CompiledFlowNode,
  campo: string,
  padrao: number,
  min: number,
  max: number,
): number {
  const valor = numberField(node, campo);
  if (valor === null || !Number.isInteger(valor) || valor < min || valor > max) return padrao;
  return valor;
}

/**
 * Ausente conta como LIGADO.
 *
 * Um retrato congelado antes de o campo existir não tem `enabled`, e tratá-lo
 * como desligado calaria em silêncio todas as mensagens de todos os fluxos
 * publicados antes daquela data.
 */
export function isEnabled(node: CompiledFlowNode): boolean {
  return node.configuration.enabled !== false;
}

/* -------------------------------------------------------------------------- */
/* O texto                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * O texto do nó com as variáveis substituídas (§32 do Prompt 3).
 *
 * ⚠️ ISTO NÃO É UM MOTOR DE TEMPLATE, E NÃO DEVE VIRAR UM. Ele troca
 * `{{nome}}` pelo que a conversa coletou, e nada mais — sem condicional, sem
 * laço, sem chamada. O texto que sai daqui foi ESCRITO por alguém na
 * configuração do nó; o que muda é só o buraco preenchido. Um dia alguém vai
 * querer `{{#se associado}}`, e a resposta é um nó de condição no desenho, onde
 * a bifurcação fica visível.
 *
 * ⚠️ UMA VARIÁVEL QUE NÃO EXISTE VIRA STRING VAZIA, e não fica como
 * `{{nome}}` na tela da pessoa — que é o §32 com todas as letras. Mostrar a
 * chave crua num WhatsApp é o tipo de vazamento que faz a associação parecer
 * quebrada: "Olá !" é feio, "Olá {{nome}}!" é constrangedor.
 *
 * ⚠️ O PONTO É ACEITO (`{{user.phone}}`) porque o §32 o cita. Ele não navega em
 * objeto nenhum: a variável se chama literalmente `user.phone` no contexto, e
 * quem a grava é a camada que conhece a conversa. Deixar o motor "resolver
 * caminhos" seria dar-lhe conhecimento sobre a forma dos dados de fora.
 */
export function interpolate(texto: string, variables: FlowVariables): string {
  return texto.replace(/\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/gi, (_, nome: string) => {
    return variables[nome] ?? "";
  });
}

/** O texto do nó, ou o nome dele. Nunca uma frase inventada aqui. */
export function nodeText(node: CompiledFlowNode, variables: FlowVariables): string {
  return interpolate(textField(node, "text") ?? node.name, variables);
}

/**
 * O endereço de um anexo do nó de mensagem, JÁ INTERPOLADO (§19 do Prompt 4).
 *
 * ⚠️ ESTE `interpolate` É O QUE FAZ A BOLSA CHEGAR INTEIRA, e a ausência dele
 * era o buraco entre o §17 e o §19: a Action `consultar_bolsa` grava
 * `bolsa_imagem_url` e `bolsa_pdf_url` no contexto, e sem interpolação o nó de
 * mensagem seguinte só conseguiria anexar um endereço FIXO — digitado à mão no
 * Builder, apontando para um boletim que vence na semana seguinte. Seria o §51
 * ("não copiar conteúdo para o chatbot") violado pelo campo de anexo.
 *
 * Com ele, o desenhador escreve `{{bolsa_imagem_url}}` e o arquivo que sai é
 * sempre o da versão ativa, resolvida no instante do envio.
 *
 * ⚠️ VAZIO VIRA `null`, E NÃO STRING VAZIA. Uma variável ausente interpola para
 * "" (ver `interpolate`), e um `imageUrl: ""` faria a camada de entrega tentar
 * mandar um arquivo sem endereço. `null` é o que `deliver.ts` já entende como
 * "não há anexo" — que é a verdade quando a Action não achou nada.
 */
export function mediaField(
  node: CompiledFlowNode,
  campo: string,
  variables: FlowVariables,
): string | null {
  const bruto = textField(node, campo);
  if (bruto === null) return null;

  const resolvido = interpolate(bruto, variables).trim();
  return resolvido === "" ? null : resolvido;
}

/** §12/§16 do Prompt 4. A pergunta aceita texto livre além das alternativas? */
export function questionInterpretsIntent(node: CompiledFlowNode): boolean {
  return node.configuration["interpretIntent"] === true;
}

/* -------------------------------------------------------------------------- */
/* A pergunta                                                                 */
/* -------------------------------------------------------------------------- */

/** O tipo da pergunta (Prompt 2, §8). Ausente = botões, como o schema. */
export function questionKind(node: CompiledFlowNode): string {
  return textField(node, "kind") ?? "buttons";
}

/** Texto livre e número não têm alternativa a casar — a resposta É o valor. */
export function isOpenQuestion(node: CompiledFlowNode): boolean {
  const tipo = questionKind(node);
  return tipo === "free_text" || tipo === "number";
}

export function isNumericText(texto: string): boolean {
  const limpo = texto.trim();
  if (limpo === "") return false;
  return Number.isFinite(Number(limpo.replace(",", ".")));
}

export function questionOptions(node: CompiledFlowNode): FlowQuestionOption[] {
  // SIM/NÃO não guarda alternativa no desenho: as duas são fixas, com chave
  // estável, para que todo fluxo do sistema use as MESMAS — e uma condição
  // escrita como `SIM` continue valendo em qualquer lugar.
  if (questionKind(node) === "yes_no") {
    return [
      { key: "SIM", label: "Sim" },
      { key: "NAO", label: "Não" },
    ];
  }

  const bruto = node.configuration.options;
  if (!Array.isArray(bruto)) return [];

  return bruto.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { key, label } = item as { key?: unknown; label?: unknown };
    if (typeof key !== "string" || typeof label !== "string") return [];
    return [{ key, label }];
  });
}

/* -------------------------------------------------------------------------- */
/* As tentativas e o desfecho (§11 e §26 do Prompt 3)                         */
/* -------------------------------------------------------------------------- */

export interface QuestionRetryPolicy {
  maxAttempts: number;
  /** A frase de "não entendi". `null` = repetir a pergunta como está escrita. */
  invalidText: string | null;
  onExhausted: QuestionFallback;
  fallbackTeamKey: string | null;
  exhaustedText: string | null;
}

/**
 * A política de tentativas de uma pergunta.
 *
 * ⚠️ UM RETRATO ANTIGO NÃO TEM NADA DISTO, e o padrão precisa ser o
 * comportamento de antes acrescido de um teto — nunca uma mudança de rumo. Por
 * isso `invalidText` nulo (repete a pergunta, como sempre fez) e `end` como
 * desfecho: encerrar é o único desfecho que não depende de configuração
 * nenhuma. `transfer` sem time escolhido mandaria a pessoa para lugar nenhum.
 */
export function questionRetryPolicy(node: CompiledFlowNode): QuestionRetryPolicy {
  const desfecho = textField(node, "onExhausted");

  return {
    maxAttempts: inteiro(node, "maxAttempts", DEFAULT_QUESTION_MAX_ATTEMPTS, 1, 10),
    invalidText: textField(node, "invalidText"),
    onExhausted: desfecho === "transfer" ? "transfer" : "end",
    fallbackTeamKey: textField(node, "fallbackTeamKey"),
    exhaustedText: textField(node, "exhaustedText"),
  };
}

/* -------------------------------------------------------------------------- */
/* A ação                                                                     */
/* -------------------------------------------------------------------------- */

export function actionKey(node: CompiledFlowNode): string {
  return textField(node, "actionKey") ?? "";
}

/**
 * §25. O teto de tentativas de uma falha temporária.
 *
 * A faixa é a mesma do `actionNodeConfigSchema` — 1 a 5, com 1 de padrão. Ver
 * lá o porquê de o padrão ser "não insistir".
 */
export function actionMaxAttempts(node: CompiledFlowNode): number {
  return inteiro(node, "maxAttempts", 1, 1, MAX_ACTION_ATTEMPTS);
}

/**
 * Os parâmetros da ação, resolvidos a partir das variáveis do contexto.
 *
 * ⚠️ UMA VARIÁVEL AUSENTE NÃO VIRA STRING VAZIA AQUI — ela simplesmente NÃO
 * ENTRA no mapa, e a diferença importa. Um parâmetro obrigatório que chega
 * vazio faz o handler consultar "assunto = ''" e devolver a primeira normativa
 * da lista; um parâmetro ausente faz o handler recusar, que é a resposta certa.
 */
export function actionArguments(
  node: CompiledFlowNode,
  variables: FlowVariables,
): Record<string, string> {
  const mapa = node.configuration.arguments;
  if (typeof mapa !== "object" || mapa === null || Array.isArray(mapa)) return {};

  const resolvidos: Record<string, string> = {};
  for (const [parametro, variavel] of Object.entries(mapa as Record<string, unknown>)) {
    if (typeof variavel !== "string") continue;
    const valor = variables[variavel];
    if (valor !== undefined) resolvidos[parametro] = valor;
  }
  return resolvidos;
}

/* -------------------------------------------------------------------------- */
/* A leitura da resposta                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Traduz o que a pessoa escreveu para a CHAVE de uma alternativa.
 *
 * ⚠️ O NÚMERO É ACEITO, E ISSO NÃO CONTRARIA O §41. Uma lista numerada é como
 * uma mensagem de WhatsApp apresenta opções — a pessoa responde "2" porque foi
 * isso que ela leu. O que o §41 proíbe é o número virar REGRA: aqui ele é
 * traduzido para `EVENTOS` na primeira linha em que é lido, e nada além desta
 * função sabe que existiu um número. Reordenar as alternativas na tela muda o
 * número e não muda a chave — que é a garantia que o escopo pede.
 *
 * A ordem das tentativas vai do mais específico ao mais tolerante: a chave
 * exata, o rótulo, e por fim a posição.
 */
export function matchOption(
  texto: string,
  options: readonly FlowQuestionOption[],
): FlowQuestionOption | null {
  const limpo = texto.trim();
  if (limpo === "" || options.length === 0) return null;

  const porChave = options.find((o) => o.key === limpo.toUpperCase());
  if (porChave) return porChave;

  const normalizado = normalizeForSearch(limpo);
  const porRotulo = options.find((o) => normalizeForSearch(o.label) === normalizado);
  if (porRotulo) return porRotulo;

  // Só um número inteiro puro conta. "2 eventos" não é uma escolha de posição —
  // é uma frase, e tratá-la como "2" mandaria a pessoa para um caminho que ela
  // não pediu.
  if (/^\d{1,2}$/.test(limpo)) {
    const posicao = Number.parseInt(limpo, 10);
    if (posicao >= 1 && posicao <= options.length) return options[posicao - 1] ?? null;
  }

  return null;
}
