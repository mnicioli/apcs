import { z } from "zod";
import { FLOW_ACTION_KEYS } from "./flow.actions.registry";
import { FLOW_CHANNELS, FLOW_NODE_TYPES } from "./flow.types";

/**
 * Validação dos Fluxos de Atendimento — o MESMO schema no cliente e na action.
 *
 * ⚠️ ELE É A PRIMEIRA CAMADA, NÃO A ÚNICA. As formas que este arquivo impõe
 * (chave estável em maiúsculas, no mínimo duas alternativas, configuração
 * compatível com o tipo do nó) também estão nos CHECKs de
 * 20260917000100_flows.sql e em `validate_flow_version()`. Quando as duas
 * discordarem, quem está certo é o banco — é ele que vale para o psql, para o
 * script e para a segunda tela.
 *
 * O que existe aqui é o que dá uma frase à pessoa ANTES de a viagem acontecer.
 */

/* -------------------------------------------------------------------------- */
/* Os tijolos                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A CHAVE ESTÁVEL DO §10 — e o formato é o mesmo do CHECK do banco.
 *
 * ⚠️ MAIÚSCULAS NÃO É ESTILO: é o que torna impossível confundir a chave com o
 * rótulo numa leitura rápida do jsonb congelado. `EVENTOS` é regra de negócio;
 * "Eventos e inscrições" é texto de tela, e ele pode mudar numa quinta-feira
 * sem que nada quebre — que é exatamente o que o §10 pede.
 */
const stableKeySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Z][A-Z0-9_]{2,39}$/,
    "Use letras MAIÚSCULAS, números e sublinhado — de 3 a 40 caracteres, começando por letra.",
  );

/** O nome de uma variável de contexto (§15). Minúsculas, para não virar chave. */
const variableNameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_]{1,39}$/,
    "Use letras minúsculas, números e sublinhado — de 2 a 40 caracteres, começando por letra.",
  );

const messageTextSchema = z
  .string()
  .trim()
  .min(1, "Escreva a mensagem.")
  .max(1000, "A mensagem não pode passar de 1000 caracteres.");

/* -------------------------------------------------------------------------- */
/* A configuração de cada tipo de nó (§8)                                     */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ UMA UNIÃO DISCRIMINADA, E NÃO UM OBJETO COM TUDO OPCIONAL.
 *
 * A alternativa preguiçosa — `{ text?, options?, teamKey?, actionKey? }` — deixa
 * salvar um nó ATTENDANT sem time e um QUESTION sem alternativas. Os dois
 * passam na tela, passam no banco (a coluna é jsonb livre, de propósito) e só
 * aparecem na publicação, quando `validate_flow_version()` recusa. A pessoa
 * descobre no fim que o desenho de quarenta nós tem três buracos.
 *
 * Com a união, o TypeScript e o Zod cobram na hora de salvar o nó.
 */
export const messageNodeConfigSchema = z.object({
  text: messageTextSchema,
});

export const questionNodeConfigSchema = z.object({
  text: messageTextSchema,
  /**
   * ⚠️ DUAS ALTERNATIVAS É O MÍNIMO QUE FAZ SENTIDO. Com uma só, não há
   * pergunta: há uma mensagem com um botão. E o §19 do escopo pede que o
   * backend recuse "Node sem configuração obrigatória" — esta é a forma dessa
   * regra para o nó QUESTION.
   */
  options: z
    .array(
      z.object({
        key: stableKeySchema,
        label: z
          .string()
          .trim()
          .min(1, "Escreva o texto da alternativa.")
          .max(120, "A alternativa não pode passar de 120 caracteres."),
      }),
    )
    .min(2, "Uma pergunta precisa de ao menos duas alternativas.")
    .max(10, "Mais de dez alternativas não cabem numa mensagem de WhatsApp.")
    .superRefine((options, ctx) => {
      // ⚠️ CHAVE REPETIDA É O DEFEITO SILENCIOSO DESTE MÓDULO. Duas alternativas
      // com a chave `EVENTOS` fazem a transição casar sempre com a primeira, e a
      // segunda vira um caminho que nunca executa. Nada quebra; o fluxo só
      // atende errado.
      const vistas = new Set<string>();
      options.forEach((opcao, indice) => {
        if (vistas.has(opcao.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [indice, "key"],
            message: "Esta chave já foi usada em outra alternativa.",
          });
        }
        vistas.add(opcao.key);
      });
    }),
  /** Onde a resposta é guardada (§15). Sem isto, o que a pessoa disse se perde. */
  variable: variableNameSchema,
});

export const conditionNodeConfigSchema = z.object({
  /** A variável avaliada. As comparações moram nas transições que saem daqui. */
  variable: variableNameSchema,
});

export const actionNodeConfigSchema = z.object({
  actionKey: z.enum(FLOW_ACTION_KEYS),
  /**
   * De qual variável sai cada parâmetro da ação. Chave = nome do parâmetro no
   * registro; valor = nome da variável do contexto.
   */
  arguments: z.record(variableNameSchema).default({}),
});

export const attendantNodeConfigSchema = z.object({
  /** A chave do TIME, nunca o id de uma pessoa (§11). */
  teamKey: stableKeySchema,
  /** O que a pessoa lê ao ser transferida. Opcional: há um texto padrão. */
  message: messageTextSchema.optional(),
});

export const endNodeConfigSchema = z.object({
  message: messageTextSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* O nó                                                                       */
/* -------------------------------------------------------------------------- */

const nodeBaseSchema = {
  key: stableKeySchema,
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome ao nó.")
    .max(120, "O nome não pode passar de 120 caracteres."),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 }),
  isStart: z.boolean().default(false),
};

export const flowNodeFormSchema = z.discriminatedUnion("type", [
  z.object({
    ...nodeBaseSchema,
    type: z.literal("message"),
    configuration: messageNodeConfigSchema,
  }),
  z.object({
    ...nodeBaseSchema,
    type: z.literal("question"),
    configuration: questionNodeConfigSchema,
  }),
  z.object({
    ...nodeBaseSchema,
    type: z.literal("condition"),
    configuration: conditionNodeConfigSchema,
  }),
  z.object({ ...nodeBaseSchema, type: z.literal("action"), configuration: actionNodeConfigSchema }),
  z.object({
    ...nodeBaseSchema,
    type: z.literal("attendant"),
    configuration: attendantNodeConfigSchema,
  }),
  z.object({ ...nodeBaseSchema, type: z.literal("end"), configuration: endNodeConfigSchema }),
]);

export type FlowNodeFormData = z.infer<typeof flowNodeFormSchema>;

/* -------------------------------------------------------------------------- */
/* A transição                                                                */
/* -------------------------------------------------------------------------- */

export const flowTransitionConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  // ⚠️ `optionKey`, e NUNCA um índice. Ver o comentário do tipo
  // `FlowTransitionCondition` e o §9 do escopo.
  z.object({ type: z.literal("answer"), optionKey: stableKeySchema }),
  z.object({
    type: z.literal("variable"),
    name: variableNameSchema,
    equals: z.string().trim().min(1).max(200),
  }),
]);

export const flowTransitionFormSchema = z.object({
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  condition: flowTransitionConditionSchema,
  label: z.string().trim().max(120).optional().or(z.literal("")),
  priority: z.number().int().min(0).max(999).default(0),
});

export type FlowTransitionFormData = z.infer<typeof flowTransitionFormSchema>;

/* -------------------------------------------------------------------------- */
/* Fluxo, versão e time                                                       */
/* -------------------------------------------------------------------------- */

export const flowFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Dê um nome ao fluxo.")
    .max(120, "O nome não pode passar de 120 caracteres."),
  description: z.string().trim().max(1000, "A descrição não pode passar de 1000 caracteres."),
  channel: z.enum(FLOW_CHANNELS),
  isEntry: z.boolean().default(false),
});

export type FlowFormData = z.infer<typeof flowFormSchema>;

export const flowVersionNotesSchema = z.object({
  notes: z.string().trim().max(1000, "A observação não pode passar de 1000 caracteres."),
});

export type FlowVersionNotesData = z.infer<typeof flowVersionNotesSchema>;

export const attendanceTeamFormSchema = z.object({
  key: stableKeySchema,
  name: z
    .string()
    .trim()
    .min(2, "Dê um nome ao time.")
    .max(80, "O nome não pode passar de 80 caracteres."),
  description: z.string().trim().max(500, "A descrição não pode passar de 500 caracteres."),
  status: z.enum(["active", "inactive"]),
});

export type AttendanceTeamFormData = z.infer<typeof attendanceTeamFormSchema>;

/* -------------------------------------------------------------------------- */
/* O retrato congelado, lido de volta                                         */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ POR QUE VALIDAR UM JSONB QUE O PRÓPRIO BANCO ESCREVEU.
 *
 * Porque ele foi escrito por uma versão ANTERIOR do sistema. Um retrato
 * congelado em agosto é lido para sempre (§22) — inclusive depois de o formato
 * mudar. Sem este parse, o motor receberia `unknown` e trataria um campo que não
 * existe como `undefined`, decidindo o caminho a partir de um buraco.
 *
 * Com ele, um documento de formato desconhecido falha ALTO, no lugar certo, com
 * a versão identificada. É a mesma razão de `schema: 1` existir.
 *
 * `passthrough` nos objetos internos: um campo NOVO num retrato antigo não é
 * erro — é o futuro sendo tolerante com o passado, que é a direção certa.
 */
export const flowDefinitionSchema = z.object({
  schema: z.literal(1),
  startNodeId: z.string().uuid().nullable(),
  nodes: z.array(
    z
      .object({
        id: z.string().uuid(),
        key: z.string(),
        type: z.enum(FLOW_NODE_TYPES),
        name: z.string(),
        isStart: z.boolean(),
        configuration: z.record(z.unknown()).default({}),
        position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
        metadata: z.record(z.unknown()).default({}),
      })
      .passthrough(),
  ),
  transitions: z.array(
    z
      .object({
        id: z.string().uuid(),
        sourceNodeId: z.string().uuid(),
        targetNodeId: z.string().uuid(),
        condition: flowTransitionConditionSchema,
        label: z.string().nullable(),
        priority: z.number(),
      })
      .passthrough(),
  ),
});
