"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { createKnowledgeEntryAction, updateKnowledgeEntryAction } from "@/lib/actions/knowledge";
import {
  KNOWLEDGE_CHATBOT_HELP,
  KNOWLEDGE_CONTENT_WARNING,
  KNOWLEDGE_KEYWORDS_HELP,
  KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_WINDOW_HELP,
} from "@/modules/intelligence/knowledge.labels";
import { formatKeywords } from "@/modules/intelligence/knowledge.rules";
import {
  knowledgeEntryFormSchema,
  type KnowledgeEntryFormData,
  type KnowledgeEntryFormValues,
} from "@/modules/intelligence/knowledge.schema";
import {
  KNOWLEDGE_STATUSES,
  type KnowledgeCategory,
  type KnowledgeEntry,
} from "@/modules/intelligence/knowledge.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * ⚠️ VALOR SENTINELA DO SELETOR DE CATEGORIA, no mesmo desenho do palestrante e
 * da cidade em Palestras: um `<option>` "Nova categoria…" que revela um campo de
 * texto. É a alternativa a mandar a pessoa sair da tela, cadastrar a categoria
 * em outro lugar e voltar — o caminho que na prática faz todo mundo escolher
 * uma categoria errada que já existe.
 */
const NOVA_CATEGORIA = "nova";

export function KnowledgeForm({
  categories,
  entry,
}: {
  categories: readonly KnowledgeCategory[];
  /** Ausente = cadastro novo. */
  entry?: KnowledgeEntry;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const categoriaId = useId();
  const novaCategoriaId = useId();
  const tituloId = useId();
  const conteudoId = useId();
  const palavrasId = useId();
  const statusId = useId();
  const chatbotId = useId();
  const inicioId = useId();
  const fimId = useId();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    // ⚠️ TRÊS PARÂMETROS, E O TERCEIRO É O QUE IMPORTA. O formulário SEGURA a
    // entrada (com os `.default()` ainda opcionais) e o `handleSubmit` ENTREGA
    // a saída, já validada e completa. Sem declarar o terceiro, o envio
    // receberia `availableForChatbot: boolean | undefined` — e o `undefined`
    // chegaria ao banco como "não liberado", silenciosamente.
  } = useForm<KnowledgeEntryFormData, unknown, KnowledgeEntryFormValues>({
    resolver: zodResolver(knowledgeEntryFormSchema),
    defaultValues: {
      categoryId: entry?.categoryId ?? "",
      categoryName: "",
      title: entry?.title ?? "",
      content: entry?.content ?? "",
      keywords: entry ? formatKeywords(entry.keywords) : "",
      status: entry?.status ?? "inactive",
      availableForChatbot: entry?.availableForChatbot ?? false,
      startsAt: entry?.startsAt ?? "",
      endsAt: entry?.endsAt ?? "",
    },
  });

  /**
   * ⚠️ A CATEGORIA SALVA APARECE MESMO SE FOI DESATIVADA. Sem esta opção extra,
   * abrir para editar um item antigo mostraria o seletor vazio — e salvar
   * exigiria escolher outra categoria, mudando um dado que ninguém pediu para
   * mudar.
   */
  const catalogo = categories.filter((c) => c.active || c.id === entry?.categoryId);

  const escolhaCategoria = watch("categoryId");
  const criandoCategoria = escolhaCategoria === NOVA_CATEGORIA;

  function enviar(valores: KnowledgeEntryFormValues) {
    setErro(null);

    // O sentinela nunca chega ao servidor: ele significa "use `categoryName`".
    const dados: KnowledgeEntryFormValues = {
      ...valores,
      categoryId: criandoCategoria ? "" : valores.categoryId,
      categoryName: criandoCategoria ? valores.categoryName : "",
    };

    startTransition(async () => {
      const resultado = entry
        ? await updateKnowledgeEntryAction({ id: entry.id, data: dados })
        : await createKnowledgeEntryAction(dados);

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      router.push("/knowledge");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit(enviar)} className="space-y-6">
      <Card>
        <CardContent className="grid gap-5 p-6 sm:grid-cols-2">
          <Field id={categoriaId} label="Categoria" required error={errors.categoryId?.message}>
            <Select
              id={categoriaId}
              value={escolhaCategoria}
              onChange={(evento) =>
                setValue("categoryId", evento.target.value, { shouldDirty: true })
              }
            >
              <option value="">Selecione…</option>
              {catalogo.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              <option value={NOVA_CATEGORIA}>Nova categoria (digitar)…</option>
            </Select>
          </Field>

          <Field id={statusId} label="Status" error={errors.status?.message}>
            <Select id={statusId} {...register("status")}>
              {KNOWLEDGE_STATUSES.map((valor) => (
                <option key={valor} value={valor}>
                  {KNOWLEDGE_STATUS_LABELS[valor]}
                </option>
              ))}
            </Select>
          </Field>

          {criandoCategoria && (
            <Field
              id={novaCategoriaId}
              label="Nome da nova categoria"
              required
              wide
              hint="Ela passa a aparecer no seletor para todos os itens seguintes."
              error={errors.categoryName?.message}
            >
              <Input id={novaCategoriaId} maxLength={60} {...register("categoryName")} />
            </Field>
          )}

          <Field
            id={tituloId}
            label="Título"
            required
            wide
            hint="Como a equipe encontra este item na lista. Não é o que o associado lê."
            error={errors.title?.message}
          >
            <Input id={tituloId} maxLength={160} {...register("title")} />
          </Field>

          <Field
            id={conteudoId}
            label="Resposta"
            required
            wide
            hint={KNOWLEDGE_CONTENT_WARNING}
            error={errors.content?.message}
          >
            <Textarea id={conteudoId} rows={6} maxLength={4000} {...register("content")} />
          </Field>

          <Field
            id={palavrasId}
            label="Palavras-chave"
            wide
            hint={KNOWLEDGE_KEYWORDS_HELP}
            error={errors.keywords?.message}
          >
            <Input
              id={palavrasId}
              maxLength={600}
              placeholder="horas, horário, aberto, funcionamento"
              {...register("keywords")}
            />
          </Field>

          <div className="sm:col-span-2">
            <div className="flex items-start gap-3">
              {/* Caixa de seleção nativa: o design system não tem componente de
                  interruptor, e inventar um só para este campo criaria um padrão
                  visual que nenhuma outra tela do CRM usa. */}
              <input
                id={chatbotId}
                type="checkbox"
                className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                aria-describedby={`${chatbotId}-ajuda`}
                {...register("availableForChatbot")}
              />
              <div className="space-y-1">
                <Label htmlFor={chatbotId} className="cursor-pointer">
                  Disponível para o chatbot
                </Label>
                <p id={`${chatbotId}-ajuda`} className="text-muted-foreground text-xs">
                  {KNOWLEDGE_CHATBOT_HELP}
                </p>
              </div>
            </div>
          </div>

          <Field
            id={inicioId}
            label="Começa a valer em"
            hint={KNOWLEDGE_WINDOW_HELP}
            error={errors.startsAt?.message}
          >
            <Input id={inicioId} type="date" {...register("startsAt")} />
          </Field>

          <Field id={fimId} label="Vale até" error={errors.endsAt?.message}>
            <Input id={fimId} type="date" {...register("endsAt")} />
          </Field>
        </CardContent>
      </Card>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={pendente}>
          {entry ? "Salvar alterações" : "Cadastrar item"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pendente}
          onClick={() => router.push("/knowledge")}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Um campo do formulário: rótulo, controle, dica e erro sempre na mesma ordem. */
function Field({
  id,
  label,
  required,
  hint,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /** Ocupa as duas colunas da grade. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-2${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <>
            {" "}
            <span aria-hidden="true">*</span>
            <span className="sr-only">(obrigatório)</span>
          </>
        )}
      </Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && (
        <p id={`${id}-erro`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
