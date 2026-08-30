import { z } from "zod";
import { parseKeywords } from "./knowledge.rules";
import { KNOWLEDGE_STATUSES } from "./knowledge.types";

/**
 * Contratos de entrada da Base de Conhecimento. Os mesmos schemas rodam no
 * cliente (React Hook Form) e dentro das actions — defesa em profundidade.
 *
 * Os limites batem com os CHECKs de `knowledge_entries`. Quando um mudar, mude
 * os dois: o banco é quem impede, este arquivo é quem explica.
 */

/**
 * Data pura AAAA-MM-DD — o formato que o `<input type="date">` produz e que o
 * Postgres aceita em coluna `date`.
 *
 * O `refine` existe porque a regex sozinha aprova "2026-02-31". Reconstruir a
 * string a partir da data interpretada é o que separa uma data possível de uma
 * data que só parece uma data. (Mesmo raciocínio de `effectiveDateSchema` em
 * Documentos — e não reaproveitado de lá porque aqui a data é OPCIONAL, e uma
 * exportação compartilhada acabaria com um `.optional()` pendurado dos dois
 * lados dizendo coisas diferentes.)
 */
const dataOpcional = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)),
    "Data inválida.",
  )
  .optional()
  .default("");

/**
 * ⚠️ `keywords` É TEXTO CRU AQUI, E NÃO `string[]`.
 *
 * O campo do formulário é uma linha de texto ("horas, horário, funcionamento"),
 * e é ela que precisa ser validada enquanto a pessoa digita. Um schema que
 * exigisse array obrigaria a tela a converter antes de validar — e aí a
 * mensagem de erro chegaria depois do envio, não durante o preenchimento.
 *
 * `parseKeywords` é a mesma função dos dois lados: quem converte é a action,
 * com o texto que este schema aprovou.
 */
export const knowledgeEntryFormSchema = z
  .object({
    /** Uuid do catálogo, ou vazio quando a pessoa escolheu "Nova categoria". */
    categoryId: z.string().trim().default(""),
    /** Nome digitado quando a categoria não existe ainda. */
    categoryName: z
      .string()
      .trim()
      .max(60, "Nome de categoria muito longo (máximo de 60 caracteres).")
      .default(""),

    title: z
      .string()
      .trim()
      .min(3, "Informe um título com pelo menos 3 caracteres.")
      .max(160, "Título muito longo (máximo de 160 caracteres)."),

    content: z
      .string()
      .trim()
      .min(10, "Escreva a resposta que o associado vai ler.")
      .max(4000, "Resposta muito longa (máximo de 4000 caracteres)."),

    keywords: z.string().max(600, "Lista de palavras-chave muito longa.").default(""),

    status: z.enum(KNOWLEDGE_STATUSES),
    availableForChatbot: z.boolean().default(false),

    startsAt: dataOpcional,
    endsAt: dataOpcional,
  })
  .superRefine((valores, ctx) => {
    // Uma categoria, e exatamente uma. O seletor manda `categoryId`; a opção
    // "Nova categoria…" manda `categoryName`.
    const temId = valores.categoryId.length > 0;
    const temNome = valores.categoryName.length > 0;

    if (!temId && !temNome) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryId"],
        message: "Escolha uma categoria.",
      });
    }

    if (temNome && valores.categoryName.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryName"],
        message: "Informe um nome com pelo menos 2 caracteres.",
      });
    }

    const palavras = parseKeywords(valores.keywords);

    if (palavras.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keywords"],
        message: "No máximo 20 palavras-chave.",
      });
    }

    // ⚠️ ESTA É A REGRA QUE EVITA O DEFEITO MUDO, e ela também é um CHECK no
    // banco (`knowledge_entries_chatbot_needs_keywords`). Sem palavra-chave, o
    // item aparece na tela como disponível para o chatbot e o bot responde "não
    // encontrei" — porque não há nada com o que casar a mensagem da pessoa.
    if (valores.availableForChatbot && palavras.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keywords"],
        message:
          "Informe ao menos uma palavra-chave: é por elas que o chatbot encontra esta resposta.",
      });
    }

    if (valores.startsAt && valores.endsAt && valores.endsAt < valores.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "A data final não pode ser anterior à inicial.",
      });
    }
  });

/**
 * ⚠️ DOIS TIPOS PARA UM SCHEMA, e a diferença são os `.default()`.
 *
 * `KnowledgeEntryFormData` é a ENTRADA: o que o formulário segura enquanto a
 * pessoa digita, com os campos que têm padrão marcados como opcionais.
 *
 * `KnowledgeEntryFormValues` é a SAÍDA: o que o schema devolve depois de
 * validar, com todo padrão já aplicado — e é isso que o `handleSubmit` do React
 * Hook Form entrega ao envio. Usar um no lugar do outro é o erro que o
 * TypeScript pega no `useForm`, e ele está certo: `availableForChatbot` pode
 * ser `undefined` na digitação e nunca é depois da validação.
 */
export type KnowledgeEntryFormData = z.input<typeof knowledgeEntryFormSchema>;
export type KnowledgeEntryFormValues = z.output<typeof knowledgeEntryFormSchema>;

/** Edição: o mesmo formulário, mais o id do que está sendo editado. */
export const updateKnowledgeEntrySchema = z.object({
  id: z.string().uuid(),
  data: knowledgeEntryFormSchema,
});

export type UpdateKnowledgeEntryInput = z.infer<typeof updateKnowledgeEntrySchema>;

/**
 * Ativar e inativar são COMANDOS, não um estado a escolher no formulário.
 *
 * Mesmo raciocínio de `VERSION_COMMANDS` em Documentos: quem decide o carimbo
 * de quem/quando é o servidor. Aqui isso vale duas vezes, porque a trilha da
 * Administração distingue `knowledge_activated` de `knowledge_updated` — e um
 * formulário que mandasse o estado pronto apagaria essa distinção.
 */
export const KNOWLEDGE_COMMANDS = ["activate", "deactivate"] as const;
export type KnowledgeCommand = (typeof KNOWLEDGE_COMMANDS)[number];

export const knowledgeCommandSchema = z.object({
  id: z.string().uuid(),
  command: z.enum(KNOWLEDGE_COMMANDS),
});

export type KnowledgeCommandInput = z.infer<typeof knowledgeCommandSchema>;

/** A busca de teste da tela ("o que o bot encontraria com esta mensagem?"). */
export const knowledgeSearchSchema = z.object({
  query: z.string().trim().min(2, "Escreva a mensagem que o associado mandaria.").max(1000),
});

export type KnowledgeSearchInput = z.infer<typeof knowledgeSearchSchema>;
