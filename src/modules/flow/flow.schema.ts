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

/**
 * ⚠️ SEM MÍNIMO, E ISSO FOI UMA CORREÇÃO — NÃO UM DESCUIDO.
 *
 * A versão anterior exigia `min(1)`, e o Builder do Prompt 2 mostrou por que
 * isso estava errado: arrastar uma caixinha de mensagem para o canvas CRIA o nó
 * no banco na hora, e a configuração inicial dele é um texto vazio (a pessoa
 * ainda não escreveu nada). Com o mínimo, a criação era recusada com "dados
 * inválidos" antes de a caixinha aparecer — o primeiro clique do desenhador
 * falhava.
 *
 * A divisão certa é outra, e é a mesma do módulo inteiro:
 *
 *   Zod          confere a FORMA — campo certo, tipo certo, teto de tamanho,
 *                chave no formato, alternativa sem chave repetida.
 *   Publicação   confere se está COMPLETO — texto escrito, time ativo, duas
 *                alternativas de verdade.
 *
 * Rascunho é trabalho em andamento; a barreira é publicar. Cobrar conteúdo na
 * gravação transformaria cada tecla numa recusa.
 */
const messageTextSchema = z
  .string()
  .trim()
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
/**
 * A MENSAGEM (Prompt 2, §7).
 *
 * ⚠️ `enabled` É A LEITURA DE "STATUS" NAQUELA LISTA DE CAMPOS, e vale dizer o
 * que ela significa, porque a palavra sozinha não diz: um nó de mensagem
 * DESLIGADO não é apagado nem interrompe o fluxo — ele é ATRAVESSADO. O motor
 * segue a saída dele sem mandar nada.
 *
 * Serve para calar um aviso temporário ("estamos em recesso") sem desmontar o
 * desenho em volta e sem ter de lembrar como era para religar depois. Só existe
 * na MENSAGEM porque só nela "pular" tem um significado óbvio — pular uma
 * pergunta deixaria a variável seguinte vazia, e pular uma transferência
 * abandonaria a pessoa.
 */
export const messageNodeConfigSchema = z.object({
  text: messageTextSchema,

  // Anexos. URL, e não upload: a Bolsa, as normativas e os eventos já têm
  // bucket próprio com vigência e permissão — copiar um PDF para cá criaria uma
  // segunda cópia com outro ciclo de vida. O que se cola aqui é o endereço do
  // arquivo que aqueles módulos publicaram.
  imageUrl: z.string().trim().url("Informe um endereço válido.").optional().or(z.literal("")),
  pdfUrl: z.string().trim().url("Informe um endereço válido.").optional().or(z.literal("")),

  /** Modelo de mensagem aprovado no provedor, quando houver. */
  templateKey: z.string().trim().max(80).optional().or(z.literal("")),

  /**
   * Pausa antes de enviar. Existe para uma sequência de mensagens não chegar
   * como um bloco só — e o teto de 60s é para ninguém desenhar uma espera que
   * estoura o tempo de um webhook.
   */
  delaySeconds: z.number().int().min(0).max(60).default(0),

  enabled: z.boolean().default(true),
});

/**
 * OS CINCO TIPOS DE PERGUNTA (Prompt 2, §8).
 *
 * ⚠️ A DIVISÃO QUE IMPORTA NÃO É ENTRE OS CINCO — É ENTRE OS QUE TÊM
 * ALTERNATIVA E OS QUE NÃO TÊM.
 *
 *   `buttons`, `list`, `yes_no`   a resposta é uma CHAVE de um conjunto fechado
 *   `free_text`, `number`         a resposta é o que a pessoa escreveu
 *
 * O primeiro grupo escolhe o caminho pela chave (§9); o segundo apenas GRAVA a
 * variável e segue pela única saída. Tratar os dois do mesmo jeito faria uma
 * pergunta de texto livre exigir alternativas que ela não tem — e é exatamente
 * essa a mudança que `validate_flow_version()` recebeu na migration do Builder.
 */
export const QUESTION_KINDS = ["buttons", "list", "free_text", "number", "yes_no"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** As alternativas de SIM/NÃO são fixas — chave estável, como todas as outras. */
export const YES_NO_OPTIONS = [
  { key: "SIM", label: "Sim" },
  { key: "NAO", label: "Não" },
] as const;

/** O tipo de pergunta espera uma lista de alternativas escrita à mão? */
export function questionNeedsOptions(kind: QuestionKind): boolean {
  return kind === "buttons" || kind === "list";
}

const questionOptionsSchema = z
  .array(
    z.object({
      key: stableKeySchema,
      // Vazio é aceito na gravação — uma alternativa recém-adicionada ainda não
      // tem texto. Quem cobra é a publicação, contando só as preenchidas.
      label: z.string().trim().max(120, "A alternativa não pode passar de 120 caracteres."),
    }),
  )
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
  });

export const questionNodeConfigSchema = z
  .object({
    text: messageTextSchema,
    kind: z.enum(QUESTION_KINDS).default("buttons"),
    options: questionOptionsSchema.default([]),
    /** Onde a resposta é guardada (§15). Sem isto, o que a pessoa disse se perde. */
    variable: variableNameSchema,
  })
  .superRefine((config, ctx) => {
    // ⚠️ ZERO ALTERNATIVAS É RECUSADO; UMA, NÃO. A diferença é entre FORMA e
    // CONTEÚDO: uma pergunta de botões sem lista nenhuma é um objeto malformado;
    // uma pergunta com uma alternativa é um desenho pela metade — a pessoa
    // acabou de apagar a segunda e vai digitar outra.
    //
    // Quem cobra as duas é `validate_flow_version`, na publicação. Cobrar aqui
    // faria o auto save recusar a gravação no meio da edição, e o trabalho se
    // perderia justamente no momento em que ele é mais frágil.
    if (questionNeedsOptions(config.kind) && config.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Uma pergunta de botões ou lista precisa de alternativas.",
      });
    }
  });

/**
 * A CONDIÇÃO (Prompt 2, §10). Os quatro operadores do escopo.
 *
 * ⚠️ `gt`/`lt` COMPARAM NÚMERO, e é por isso que existe o tipo de pergunta
 * `number`. Comparar texto com `>` daria uma resposta — a ordem alfabética — e
 * ela estaria errada de um jeito plausível: "10" é MENOR que "9" em texto.
 * O motor converte os dois lados e recusa a comparação quando algum não é
 * número, em vez de decidir o caminho por uma ordenação que ninguém pediu.
 */
export const CONDITION_OPERATORS = ["eq", "neq", "contains", "gt", "lt"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

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

/** As três prioridades da fila (Prompt 2, §12). */
export const HANDOFF_PRIORITIES = ["low", "normal", "high"] as const;
export type HandoffPriority = (typeof HANDOFF_PRIORITIES)[number];

export const attendantNodeConfigSchema = z.object({
  /**
   * A chave do TIME, nunca o id de uma pessoa (§11).
   *
   * ⚠️ VAZIO É ACEITO NA GRAVAÇÃO, pelo mesmo motivo do texto da mensagem: um nó
   * de transferência recém-arrastado ainda não tem time escolhido. Quem recusa
   * publicar sem time ativo é `validate_flow_version` — e ela recusa também o
   * caso que o Zod jamais veria, que é o time ter sido DESATIVADO depois.
   */
  teamKey: z.union([stableKeySchema, z.literal("")]),
  /** O que a pessoa lê ao ser transferida. Opcional: há um texto padrão. */
  message: messageTextSchema.optional(),
  /**
   * Em quantos minutos alguém deveria assumir. É um COMPROMISSO, não um
   * despertador: nesta etapa ele é gravado e mostrado na fila — quem cobra o
   * prazo é a tela de atendimento, não o motor.
   */
  slaMinutes: z.number().int().min(1).max(10_080).optional(),
  priority: z.enum(HANDOFF_PRIORITIES).default("normal"),
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
  // Os quatro operadores do §10 do Prompt 2, mais o "diferente" — que sai de
  // graça e evita desenhar a negação com duas setas.
  z.object({
    type: z.literal("variable"),
    name: variableNameSchema,
    operator: z.enum(CONDITION_OPERATORS).default("eq"),
    value: z.string().trim().min(1).max(200),
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
