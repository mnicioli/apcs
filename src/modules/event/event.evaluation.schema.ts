import { z } from "zod";
import { EVALUATION_QUESTION_TYPES, OPTION_BEARING_TYPES } from "./event.evaluation.types";

/**
 * Os schemas da Avaliação de Evento.
 *
 * ⚠️ O MESMO SCHEMA NO CLIENTE E NA ACTION — é a regra do projeto (ver
 * docs/SERVICE-ACTION-PATTERN.md), e aqui ela tem um segundo dono: o BANCO.
 * Cada regra abaixo existe uma segunda vez em SQL, dentro de
 * `save_event_evaluation_structure` e de `submit_event_evaluation`.
 *
 * A duplicação é deliberada e as duas cópias fazem coisas diferentes:
 *
 *   • o Zod existe para a MENSAGEM ser boa — apontar o campo, no formulário,
 *     antes de a pessoa perder o que digitou;
 *   • o SQL existe para a REGRA VALER — inclusive para quem chamar o PostgREST
 *     direto, sem passar por tela nenhuma.
 *
 * Uma delas não substitui a outra. O §25 é explícito: "Nunca confiar somente no
 * frontend."
 */

/* -------------------------------------------------------------------------- */
/* Configuração de envio (§9)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ O ATRASO É GUARDADO EM MINUTOS E ESCOLHIDO EM MINUTOS OU HORAS. O §9 fala
 * nas duas unidades; o schema recebe só minutos e a tela faz a conta, porque
 * guardar a unidade ao lado do número obrigaria toda consulta do banco a
 * multiplicar condicionalmente — inclusive a que decide quem recebe agora.
 *
 * O teto de 10080 (sete dias) é o mesmo CHECK do banco. Acima disso não é "logo
 * após o evento": é outra coisa, e quase sempre um erro de digitação.
 */
export const evaluationSettingsSchema = z.object({
  eventId: z.string().uuid("Evento inválido."),
  enabled: z.boolean(),
  delayMinutes: z
    .number()
    .int("O atraso precisa ser um número inteiro de minutos.")
    .min(0, "O atraso não pode ser negativo.")
    .max(10080, "O atraso não pode passar de sete dias."),
  responseWindowDays: z
    .number()
    .int("O prazo precisa ser um número inteiro de dias.")
    .min(1, "O prazo precisa ser de pelo menos um dia.")
    .max(365, "O prazo não pode passar de um ano.")
    .nullable(),
  /**
   * ⚠️ SÓ É CONSULTADO NA PRIMEIRA VEZ. O banco (`ensure_event_evaluation`) só
   * olha este campo quando o evento ainda não tem avaliação própria; depois
   * disso, trocar de modelo é `applyEvaluationTemplateAction`, que é uma ação
   * separada porque DESTRÓI as perguntas que alguém escreveu.
   */
  templateId: z.string().uuid("Modelo inválido.").nullable().optional(),
});

export type EvaluationSettingsInput = z.infer<typeof evaluationSettingsSchema>;

export const applyTemplateSchema = z.object({
  eventId: z.string().uuid("Evento inválido."),
  templateId: z.string().uuid("Modelo inválido."),
});

export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>;

/* -------------------------------------------------------------------------- */
/* O construtor de perguntas (§24, §25)                                        */
/* -------------------------------------------------------------------------- */

export const evaluationOptionSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Toda alternativa precisa de um texto.")
    .max(200, "O texto da alternativa é longo demais."),
  /**
   * ⚠️ NULO É PERMITIDO AQUI E RECUSADO PARA `rating` LOGO ABAIXO. A alternativa
   * de uma escolha única não vale número nenhum ("Palestra da manhã"), e obrigar
   * um valor faria quem monta o formulário inventar um — que a apuração do
   * Prompt 3 depois somaria como se significasse alguma coisa.
   */
  value: z.number().int().min(0).max(100).nullable(),
});

export const evaluationQuestionSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1, "Toda pergunta precisa de um enunciado.")
      .max(500, "O enunciado é longo demais."),
    type: z.enum(EVALUATION_QUESTION_TYPES),
    required: z.boolean(),
    /**
     * ⚠️ A AVALIAÇÃO GERAL (Prompt 3, §34). `default(false)` porque os
     * formulários salvos antes do Prompt 3 não mandam este campo — sem o padrão,
     * reabrir e salvar uma avaliação antiga viraria erro de validação numa
     * estrutura que não mudou.
     */
    isOverall: z.boolean().default(false),
    options: z.array(evaluationOptionSchema).max(20, "São no máximo 20 alternativas."),
  })
  .superRefine((pergunta, ctx) => {
    const precisaDeOpcoes = (OPTION_BEARING_TYPES as readonly string[]).includes(pergunta.type);

    // ⚠️ SÓ `rating` PODE SER A GERAL (§34, §35). Uma pergunta de texto marcada
    // como avaliação geral produziria uma média de nada — e o CHECK do banco
    // recusaria de qualquer jeito, mas com uma mensagem que não aponta o campo.
    if (pergunta.isOverall && pergunta.type !== "rating") {
      ctx.addIssue({
        code: "custom",
        path: ["isOverall"],
        message: "A pergunta de avaliação geral precisa ser do tipo Nota.",
      });
    }

    if (precisaDeOpcoes && pergunta.options.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Esta pergunta precisa de pelo menos duas alternativas.",
      });
    }

    // ⚠️ `yes_no` NÃO ENTRA NA CONTA ACIMA porque as alternativas dele são
    // GERADAS pelo banco (Sim = 1, Não = 0). Se cada avaliação escrevesse as
    // suas, a apuração teria de adivinhar que "Sim", "sim" e "SIM" são a mesma
    // resposta.
    if (!precisaDeOpcoes && pergunta.options.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message:
          pergunta.type === "yes_no"
            ? "As alternativas de Sim/Não são geradas pelo sistema."
            : "Pergunta de texto livre não tem alternativas.",
      });
    }

    if (pergunta.type === "rating") {
      for (const [indice, opcao] of pergunta.options.entries()) {
        if (opcao.value === null) {
          ctx.addIssue({
            code: "custom",
            path: ["options", indice, "value"],
            message: "Toda alternativa de uma pergunta de nota precisa de um valor.",
          });
        }
      }
    }
  });

export const evaluationSectionSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Todo bloco precisa de um título.")
    .max(200, "O título do bloco é longo demais."),
  description: z.string().trim().max(500, "A descrição é longa demais.").nullable(),
  questions: z
    .array(evaluationQuestionSchema)
    .min(1, "O bloco está sem perguntas.")
    .max(50, "São no máximo 50 perguntas por bloco."),
});

export const evaluationStructureSchema = z
  .object({
    eventId: z.string().uuid("Evento inválido."),
    sections: z
      .array(evaluationSectionSchema)
      .min(1, "A avaliação precisa de pelo menos um bloco.")
      .max(20, "São no máximo 20 blocos."),
  })
  .superRefine((estrutura, ctx) => {
    /**
     * ⚠️ NO MÁXIMO UMA AVALIAÇÃO GERAL EM TODO O FORMULÁRIO (Prompt 3, §34).
     *
     * A checagem mora aqui — no nível da ESTRUTURA — e não na pergunta, porque é
     * a única camada que enxerga os blocos todos: duas perguntas marcadas em
     * blocos diferentes passariam por qualquer validação por pergunta.
     *
     * O banco impõe o mesmo (`save_event_evaluation_structure`), e é lá que a
     * regra vale. Esta cópia existe para a mensagem apontar o problema antes de
     * a pessoa perder o que digitou.
     *
     * ⚠️ NENHUMA marcada é PERMITIDO. O §34 prevê o caso e manda mostrar "N/A" em
     * vez de inventar uma média — obrigar uma aqui quebraria todo formulário que
     * não tenha uma pergunta de nota geral, como uma pesquisa só de texto.
     */
    const marcadas = estrutura.sections.flatMap((bloco, indiceBloco) =>
      bloco.questions
        .map((pergunta, indicePergunta) => ({ pergunta, indiceBloco, indicePergunta }))
        .filter((item) => item.pergunta.isOverall),
    );

    if (marcadas.length > 1) {
      for (const item of marcadas.slice(1)) {
        ctx.addIssue({
          code: "custom",
          path: ["sections", item.indiceBloco, "questions", item.indicePergunta, "isOverall"],
          message: "Só uma pergunta pode ser a avaliação geral do formulário.",
        });
      }
    }
  });

export type EvaluationStructureInput = z.infer<typeof evaluationStructureSchema>;
export type EvaluationSectionInput = z.infer<typeof evaluationSectionSchema>;
export type EvaluationQuestionInput = z.infer<typeof evaluationQuestionSchema>;

/* -------------------------------------------------------------------------- */
/* As ações por participante (§17, §19)                                        */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ `eventId` É OBRIGATÓRIO, E ELE É O §28 (IDOR). O banco confere que a
 * avaliação pertence AO EVENTO antes de qualquer coisa; um schema que aceitasse
 * só `participantEvaluationId` deixaria essa conferência sem os dois lados.
 *
 * É a mesma forma de `participantPresenceSchema`, e de propósito: as duas
 * escrevem numa linha identificada por um id vindo do navegador.
 */
export const evaluationParticipantActionSchema = z.object({
  eventId: z.string().uuid("Evento inválido."),
  participantEvaluationId: z.string().uuid("Avaliação inválida."),
});

export type EvaluationParticipantActionInput = z.infer<typeof evaluationParticipantActionSchema>;

/* -------------------------------------------------------------------------- */
/* A resposta pública (§30)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ NÃO EXISTE `value` NO PAYLOAD, e a ausência é o §32.
 *
 * O navegador manda QUAL alternativa foi marcada; quanto ela vale é o banco quem
 * diz, copiando de `event_evaluation_options.numeric_value`. Aceitar o número de
 * fora deixaria qualquer pessoa mandar "10" numa escala de 5 e envenenar a média
 * do Prompt 3 sem precisar de permissão nenhuma — e essa página é pública.
 *
 * ⚠️ E TAMBÉM NÃO EXISTE `participantId`. Quem responde é definido pelo TOKEN, e
 * só por ele. Um id de participante no corpo seria um convite para responder no
 * lugar de outra pessoa (§29).
 */
export const publicAnswerSchema = z.object({
  questionId: z.string().uuid(),
  optionIds: z.array(z.string().uuid()).max(20),
  text: z.string().max(4000, "O comentário é longo demais.").nullable(),
});

export const publicEvaluationSubmissionSchema = z.object({
  token: z
    .string()
    .trim()
    .min(24, "Link inválido.")
    .max(128, "Link inválido.")
    // O token é hexadecimal (um uuid sem os hifens). Recusar o resto aqui evita
    // que qualquer coisa colada da barra de endereço vire uma consulta.
    .regex(/^[0-9a-f]+$/i, "Link inválido."),
  answers: z.array(publicAnswerSchema).max(500),
});

export type PublicEvaluationSubmissionInput = z.infer<typeof publicEvaluationSubmissionSchema>;
