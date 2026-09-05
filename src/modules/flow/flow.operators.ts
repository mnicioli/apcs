import { normalizeForSearch } from "@/lib/utils";

/**
 * OS OPERADORES DE CONDIÇÃO — o registro do §14 do Prompt 3.
 *
 * ⚠️ POR QUE UM REGISTRO, E NÃO UM `switch` DENTRO DO MOTOR.
 *
 * O `switch` existia, tinha cinco braços e funcionava. O que ele não tinha era
 * um lugar para as OUTRAS coisas que um operador precisa dizer além de "casa ou
 * não casa": se ele pede um valor escrito à mão (`existe` não pede), se ele só
 * fala de número (`>` só fala), e como se chama em português na tela do
 * desenhador. Sem esse lugar, cada uma dessas três perguntas virava um `if` por
 * NOME de operador espalhado pelo inspetor, pelo validador e pelo motor — e
 * acrescentar o sexto operador significaria achar os três.
 *
 * Com a tabela, um operador novo é UMA entrada. É o mesmo desenho de
 * `flow.actions.registry.ts` e de `intent.registry.ts`, pela mesma razão.
 *
 * ⚠️ AS CHAVES SÃO CURTAS (`gte`) E NÃO O NOME DO ESCOPO (`GREATER_OR_EQUAL`).
 * Cinco delas já estão gravadas em jsonb de versões publicadas desde a
 * fundação, e retrato congelado não se reescreve (§22 do Prompt 1). Renomear
 * `eq` para `EQUALS` faria toda condição já publicada deixar de casar — em
 * silêncio, porque um operador desconhecido não casa com nada.
 */

/* -------------------------------------------------------------------------- */
/* A lista                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Os doze do §14, na ordem em que aparecem para quem desenha: as comparações de
 * igualdade, as de texto, as de número e por fim as que não pedem valor.
 *
 * ⚠️ OS CINCO PRIMEIROS SÃO OS DA FUNDAÇÃO, E A ORDEM DELES NÃO IMPORTA — o que
 * importa é que as CHAVES não mudem. Ver o aviso do topo.
 */
export const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
  "is_true",
  "is_false",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export function isConditionOperator(value: string): value is ConditionOperator {
  return (CONDITION_OPERATORS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* O contrato                                                                 */
/* -------------------------------------------------------------------------- */

export interface ConditionOperatorDefinition {
  key: ConditionOperator;
  /** Como o operador aparece no inspetor. PT-BR, e escrito como frase. */
  label: string;
  /**
   * O operador pede um valor escrito à mão?
   *
   * ⚠️ É ISTO QUE O INSPETOR CONSULTA para esconder o campo "Valor" em
   * `existe`. Sem o campo, `flowTransitionConditionSchema` também não pode
   * exigir conteúdo no valor — ver o `superRefine` de lá.
   */
  needsValue: boolean;
  /** Compara número, e recusa o resto. Ver o aviso de `compararNumero`. */
  numeric: boolean;
  /**
   * Casa?
   *
   * `actual` é `undefined` quando a variável nunca foi gravada — o que é
   * diferente de estar vazia, e os dois casos importam a `exists`.
   */
  evaluate(actual: string | undefined, expected: string): boolean;
}

/* -------------------------------------------------------------------------- */
/* As comparações                                                             */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ `>` E `<` SÓ COMPARAM NÚMERO, E RECUSAM O RESTO.
 *
 * Deixar a comparação cair no texto daria SEMPRE uma resposta — a ordem
 * alfabética — e ela estaria errada de um jeito plausível: em texto, "10" é
 * MENOR que "9". Um fluxo que mandasse pedidos acima de 9 unidades para outro
 * time atenderia errado sem nunca falhar, e ninguém acharia o defeito olhando o
 * desenho.
 *
 * Diante de um valor não numérico a condição simplesmente não casa, e o desenho
 * segue para a saída padrão — que é previsível e visível.
 */
function compararNumero(
  actual: string | undefined,
  expected: string,
  comparar: (a: number, b: number) => boolean,
): boolean {
  if (actual === undefined) return false;

  // A vírgula decimal é como um associado escreve "12,5" no WhatsApp. Trocá-la
  // pelo ponto aqui é o mínimo para o número dele significar o que ele quis.
  const a = Number(actual.replace(",", "."));
  const b = Number(expected.replace(",", "."));

  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return comparar(a, b);
}

/**
 * O conjunto FECHADO do que conta como sim e do que conta como não.
 *
 * ⚠️ E O QUE NÃO ESTÁ EM NENHUM DOS DOIS NÃO CASA COM NENHUM DOS DOIS. É
 * tentador dizer que "qualquer coisa que não seja não, é sim" — mas isso faria
 * um "talvez" digitado por alguém escolher o caminho do sim, e a pessoa
 * seguiria por um ramo que não pediu.
 *
 * As duas listas vêm de onde os valores nascem: `SIM`/`NAO` são as chaves fixas
 * da pergunta de sim/não (`YES_NO_OPTIONS`), e `true`/`false` é o que o motor
 * grava em `<acao>_ok` depois de uma ação.
 */
const VALORES_VERDADEIROS = new Set(["true", "1", "sim", "s", "yes", "y"]);
const VALORES_FALSOS = new Set(["false", "0", "nao", "n", "no"]);

function booleano(actual: string | undefined): boolean | null {
  if (actual === undefined) return null;
  const limpo = normalizeForSearch(actual.trim());
  if (VALORES_VERDADEIROS.has(limpo)) return true;
  if (VALORES_FALSOS.has(limpo)) return false;
  return null;
}

/* -------------------------------------------------------------------------- */
/* O registro                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ `Record` COMPLETO, E NÃO `Partial`. Quando alguém acrescentar uma chave em
 * `CONDITION_OPERATORS`, o TypeScript aponta ESTA linha — e não um caminho que
 * só quebraria em produção quando um fluxo usasse o operador novo.
 */
export const CONDITION_OPERATOR_REGISTRY: Record<ConditionOperator, ConditionOperatorDefinition> = {
  eq: {
    key: "eq",
    label: "é igual a",
    needsValue: true,
    numeric: false,
    evaluate: (actual, expected) => actual !== undefined && actual === expected,
  },

  neq: {
    key: "neq",
    label: "é diferente de",
    needsValue: true,
    numeric: false,
    // ⚠️ VARIÁVEL AUSENTE NÃO CASA, NEM AQUI. É tentador dizer que "não definido
    // é diferente de X" — mas isso faria uma pergunta que a pessoa AINDA NÃO
    // RESPONDEU escolher um caminho, o que é adivinhação com cara de regra.
    // Quem quer perguntar sobre a ausência tem `not_exists`, que diz isso.
    evaluate: (actual, expected) => actual !== undefined && actual !== expected,
  },

  contains: {
    key: "contains",
    label: "contém",
    needsValue: true,
    numeric: false,
    // `normalizeForSearch` tira acento e caixa: quem escreve "filiacao" no
    // WhatsApp está falando de "Filiação", e o fluxo não pode discordar disso.
    evaluate: (actual, expected) =>
      actual !== undefined && normalizeForSearch(actual).includes(normalizeForSearch(expected)),
  },

  not_contains: {
    key: "not_contains",
    label: "não contém",
    needsValue: true,
    numeric: false,
    evaluate: (actual, expected) =>
      actual !== undefined && !normalizeForSearch(actual).includes(normalizeForSearch(expected)),
  },

  gt: {
    key: "gt",
    label: "é maior que",
    needsValue: true,
    numeric: true,
    evaluate: (actual, expected) => compararNumero(actual, expected, (a, b) => a > b),
  },

  gte: {
    key: "gte",
    label: "é maior ou igual a",
    needsValue: true,
    numeric: true,
    evaluate: (actual, expected) => compararNumero(actual, expected, (a, b) => a >= b),
  },

  lt: {
    key: "lt",
    label: "é menor que",
    needsValue: true,
    numeric: true,
    evaluate: (actual, expected) => compararNumero(actual, expected, (a, b) => a < b),
  },

  lte: {
    key: "lte",
    label: "é menor ou igual a",
    needsValue: true,
    numeric: true,
    evaluate: (actual, expected) => compararNumero(actual, expected, (a, b) => a <= b),
  },

  exists: {
    key: "exists",
    label: "foi respondida",
    needsValue: false,
    numeric: false,
    // ⚠️ VAZIO NÃO É PRESENTE. Uma variável gravada com string vazia veio de uma
    // resposta em branco, e dizer que ela "foi respondida" mandaria o fluxo
    // adiante com um buraco no lugar do dado.
    evaluate: (actual) => actual !== undefined && actual.trim() !== "",
  },

  not_exists: {
    key: "not_exists",
    label: "não foi respondida",
    needsValue: false,
    numeric: false,
    evaluate: (actual) => actual === undefined || actual.trim() === "",
  },

  is_true: {
    key: "is_true",
    label: "é sim / verdadeiro",
    needsValue: false,
    numeric: false,
    evaluate: (actual) => booleano(actual) === true,
  },

  is_false: {
    key: "is_false",
    label: "é não / falso",
    needsValue: false,
    numeric: false,
    evaluate: (actual) => booleano(actual) === false,
  },
};

export function conditionOperatorDefinition(key: ConditionOperator): ConditionOperatorDefinition {
  return CONDITION_OPERATOR_REGISTRY[key];
}

/** O operador pede um valor escrito à mão? Usado pelo inspetor e pelo Zod. */
export function operatorNeedsValue(key: string): boolean {
  return isConditionOperator(key) ? CONDITION_OPERATOR_REGISTRY[key].needsValue : true;
}

/**
 * A comparação, e a única porta para ela.
 *
 * ⚠️ UM OPERADOR QUE ESTE BUILD NÃO CONHECE NÃO ESCOLHE CAMINHO NENHUM. É a
 * mesma postura do retrato congelado: um documento gravado por uma versão
 * futura pode citar algo que o código de hoje não entende, e a resposta certa é
 * NÃO DECIDIR — não é chutar o caminho mais provável.
 */
export function evaluateCondition(
  actual: string | undefined,
  operator: string,
  expected: string,
): boolean {
  if (!isConditionOperator(operator)) return false;
  return CONDITION_OPERATOR_REGISTRY[operator].evaluate(actual, expected);
}
