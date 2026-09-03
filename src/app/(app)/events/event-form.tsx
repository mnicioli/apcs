"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createEventAction,
  requestEventImageUploadAction,
  updateEventAction,
} from "@/lib/actions/events";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  createEventFormSchema,
  editEventFormSchema,
  type EventFormData,
} from "@/modules/event/event.schema";
import type { EventSegment, EventSummary } from "@/modules/event/event.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimeSelect } from "@/components/ui/time-select";
import { EventImageField } from "./event-image-field";

/**
 * Formulário de evento — cadastro e edição, num arquivo só.
 *
 * As duas telas têm os mesmos oito campos e as mesmas validações; o que muda são
 * três coisas, e todas cabem em `event`: a imagem é obrigatória no cadastro e
 * opcional na edição, a regra da data no passado é diferente (ver
 * `editEventFormSchema`), e a action chamada no fim.
 *
 * ⚠️ AS VALIDAÇÕES DAQUI SÃO UX. O mesmo Zod roda dentro da action, e o banco
 * impõe as regras de negócio com CHECK e função. O formulário existe para a
 * pessoa ver o erro no campo em vez de depois de enviar.
 */
export function EventForm({
  segments,
  today,
  event,
}: {
  segments: EventSegment[];
  /** O "hoje" da APCS, decidido no servidor. O relógio do navegador pode estar em outro fuso. */
  today: string;
  /** Ausente = cadastro. Presente = edição. */
  event?: EventSummary;
}) {
  const router = useRouter();
  const isEdit = event !== undefined;

  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "uploading" | "saving">("idle");
  const [isPending, startTransition] = useTransition();

  const nameId = useId();
  const descriptionId = useId();
  const locationId = useId();
  const urlId = useId();
  const dateId = useId();
  const startId = useId();
  const endId = useId();
  const segmentsId = useId();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitted },
  } = useForm<EventFormData>({
    resolver: zodResolver(
      isEdit ? editEventFormSchema(today, event.eventDate) : createEventFormSchema(today),
    ),
    defaultValues: {
      name: event?.name ?? "",
      description: event?.description ?? "",
      location: event?.location ?? "",
      registrationUrl: event?.registrationUrl ?? "",
      eventDate: event?.eventDate ?? "",
      startTime: event?.startTime ?? "",
      endTime: event?.endTime ?? "",
      segmentIds: event?.segments.map((segment) => segment.id) ?? [],
    },
  });

  const busy = isPending || step !== "idle";

  // Proteção contra perda acidental — o CRM não tinha nenhuma, então esta é a
  // implementação mais simples que funciona.
  //
  // LIMITE HONESTO: `beforeunload` cobre fechar a aba, recarregar e sair para
  // fora do app. Ele NÃO intercepta navegação interna do App Router, que não
  // expõe um gancho para bloquear rota. Clicar num item do menu ainda perde o
  // rascunho.
  useEffect(() => {
    const sujo = isDirty || file !== null;
    if (!sujo || busy) return;

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, file, busy]);

  /**
   * Sobe a imagem e devolve `{eventId, storagePath}`.
   *
   * O arquivo vai DIRETO ao Supabase Storage, sem passar pelo servidor Next: a
   * Vercel corta o corpo de requisições serverless em 4,5 MB e o limite aqui é
   * 5 MB. O servidor só autoriza antes e confere os bytes depois.
   */
  async function uploadImage(
    chosen: File,
  ): Promise<{ eventId: string; storagePath: string } | { error: string }> {
    const ticket = await requestEventImageUploadAction({
      eventId: event?.id,
      filename: chosen.name,
      sizeBytes: chosen.size,
    });

    if (!ticket.ok) return { error: ACTION_ERROR_MESSAGES[ticket.error.code] };

    // Import dinâmico de propósito: o supabase-js no navegador acrescentaria
    // ~90 kB à página, inclusive para quem só abre a grid para consultar. Assim
    // o pacote só desce quando alguém realmente envia um arquivo.
    const { createClient } = await import("@/lib/supabase/client");

    const supabase = createClient();
    const { error } = await supabase.storage
      .from(ticket.data.bucket)
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, chosen);

    if (error) {
      console.error(`[events] envio ao storage falhou: ${error.message}`);
      return { error: "Não foi possível enviar a imagem. Tente novamente." };
    }

    return { eventId: ticket.data.eventId, storagePath: ticket.data.path };
  }

  function onSubmit(values: EventFormData) {
    setFormError(null);

    if (!isEdit && !file) {
      setFormError("Selecione a imagem do evento.");
      return;
    }

    startTransition(async () => {
      try {
        let eventId = event?.id;
        let storagePath: string | undefined;

        if (file) {
          setStep("uploading");
          const uploaded = await uploadImage(file);
          if ("error" in uploaded) {
            setFormError(uploaded.error);
            return;
          }
          eventId = uploaded.eventId;
          storagePath = uploaded.storagePath;
        }

        setStep("saving");

        const result =
          isEdit && event
            ? await updateEventAction({ ...values, eventId: event.id, storagePath })
            : await createEventAction({
                ...values,
                eventId: eventId as string,
                storagePath: storagePath as string,
              });

        if (!result.ok) {
          // O formulário NÃO é limpo: o trabalho de quem preencheu nove campos
          // não pode sumir porque o servidor recusou um deles.
          setFormError(ACTION_ERROR_MESSAGES[result.error.code]);
          return;
        }

        router.push(`/events/${result.data.id}?${isEdit ? "updated" : "created"}=1`);
      } finally {
        setStep("idle");
      }
    });
  }

  const selectedSegments = watch("segmentIds") ?? [];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* ⚠️ DUAS COLUNAS, A IMAGEM OCUPANDO A ALTURA INTEIRA. A conta, com o
          menu lateral de 256px: em `xl` sobram ~960px, e um grid de três frações
          dá ~304px para o cartaz e ~608px para os campos. Dentro dos campos, as
          duas colunas ficam com ~268px cada — folgado para o par hora+minuto,
          que precisa de ~166px.

          Abaixo de `xl` tudo empilha: a mesma decisão da tela de detalhe, pelo
          mesmo motivo — três frações de uma tela de 1024px dariam ~218px por
          coluna, e os campos de horário passariam a quebrar de linha. */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardContent className="p-6">
            <EventImageField
              file={file}
              onFileChange={setFile}
              currentImageUrl={event?.imageUrl ?? null}
              eventName={watch("name") || (event?.name ?? "Evento")}
              disabled={busy}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card>
            <CardContent className="space-y-6 p-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <Field
                  id={nameId}
                  label="Nome"
                  required
                  error={errors.name?.message}
                  className="sm:col-span-2"
                >
                  <Input
                    id={nameId}
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? `${nameId}-erro` : undefined}
                    placeholder="Workshop APCS"
                    {...register("name")}
                  />
                </Field>

                {/*
              A DESCRIÇÃO fica entre o nome e o local porque é assim que a
              mensagem de WhatsApp sai: nome, descrição, e só então onde e
              quando. O formulário na ordem da mensagem é o que permite conferir
              o resultado sem precisar imaginá-lo.
            */}
                <Field
                  id={descriptionId}
                  label="Descrição"
                  error={errors.description?.message}
                  hint="Opcional. Sai no WhatsApp logo abaixo do nome do evento."
                  className="sm:col-span-2"
                >
                  <Textarea
                    id={descriptionId}
                    rows={3}
                    maxLength={600}
                    aria-invalid={!!errors.description}
                    aria-describedby={errors.description ? `${descriptionId}-erro` : undefined}
                    placeholder="Um encontro para discutir mercado, sanidade e novidades do setor."
                    {...register("description")}
                  />
                </Field>

                <Field
                  id={locationId}
                  label="Local"
                  required
                  error={errors.location?.message}
                  hint="Texto livre — pode ser um endereço, uma cidade ou 'Online'."
                  className="sm:col-span-2"
                >
                  <Input
                    id={locationId}
                    aria-invalid={!!errors.location}
                    aria-describedby={errors.location ? `${locationId}-erro` : undefined}
                    placeholder="Auditório APCS"
                    {...register("location")}
                  />
                </Field>

                <Field
                  id={dateId}
                  label="Data do evento"
                  required
                  error={errors.eventDate?.message}
                >
                  <Input
                    id={dateId}
                    type="date"
                    aria-invalid={!!errors.eventDate}
                    aria-describedby={errors.eventDate ? `${dateId}-erro` : undefined}
                    {...register("eventDate")}
                  />
                </Field>

                <Field
                  id={urlId}
                  label="Link para inscrição"
                  error={errors.registrationUrl?.message}
                  hint="Opcional. Precisa começar com http:// ou https://."
                >
                  <Input
                    id={urlId}
                    type="url"
                    inputMode="url"
                    aria-invalid={!!errors.registrationUrl}
                    aria-describedby={errors.registrationUrl ? `${urlId}-erro` : undefined}
                    placeholder="https://apcs.org.br/inscricao"
                    {...register("registrationUrl")}
                  />
                </Field>

                {/*
              ⚠️ DOIS SELETORES, E NÃO O `<input type="time">` COM `step`.
              O campo nativo estava aqui com `step={300}`, e o seletor do Chrome
              listava os sessenta minutos assim mesmo — `step` vale para a
              validação do navegador, não para a lista que ele desenha. A tela
              oferecia 14:56 e o Zod recusava. Ver `ui/time-select.tsx`.

              A dica "De 5 em 5 minutos" saiu junto: ela existia para explicar
              uma regra que agora está desenhada na própria lista.
            */}
                <Field
                  id={startId}
                  label="Hora de início"
                  required
                  error={errors.startTime?.message}
                >
                  <TimeSelect
                    id={startId}
                    label="Hora de início"
                    required
                    value={watch("startTime") ?? ""}
                    disabled={busy}
                    invalid={!!errors.startTime}
                    describedBy={errors.startTime ? `${startId}-erro` : undefined}
                    onChange={(valor) =>
                      setValue("startTime", valor, {
                        shouldDirty: true,
                        // Revalidar só depois da primeira tentativa de envio: marcar
                        // "informe um horário" enquanto a pessoa ainda escolhe a
                        // hora é acusá-la de um erro que ela está no meio de não
                        // cometer. Mesma regra do formulário de Palestras.
                        shouldValidate: isSubmitted,
                      })
                    }
                  />
                </Field>

                <Field
                  id={endId}
                  label="Hora de término"
                  error={errors.endTime?.message}
                  hint="Opcional."
                >
                  <TimeSelect
                    id={endId}
                    label="Hora de término"
                    value={watch("endTime") ?? ""}
                    disabled={busy}
                    invalid={!!errors.endTime}
                    describedBy={errors.endTime ? `${endId}-erro` : undefined}
                    onChange={(valor) =>
                      setValue("endTime", valor, { shouldDirty: true, shouldValidate: isSubmitted })
                    }
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          {/* ⚠️ O PÚBLICO-ALVO EM CAIXA PRÓPRIA. Ele não é mais um campo do
              formulário: é a decisão de QUEM VAI RECEBER, e ela tem peso
              diferente de "qual o local". Misturado no meio dos outros, virava
              a última coisa da lista — o lugar onde se marca no automático.

              Fica na mesma coluna dos campos de propósito: quem preenche lê de
              cima para baixo e termina decidindo o público, com o cartaz à
              vista do lado. */}
          <Card>
            <CardContent className="space-y-2 p-6">
              {/* `fieldset`/`legend` de verdade: é o que faz o leitor de tela
                  anunciar "Público-alvo" antes de cada caixa de seleção. */}
              <fieldset className="space-y-2" aria-describedby={`${segmentsId}-erro`}>
                <legend className="text-sm leading-none font-medium">
                  Público-alvo <span aria-hidden="true">*</span>
                  <span className="sr-only">(obrigatório)</span>
                </legend>

                {segments.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nenhuma segmentação disponível.</p>
                ) : (
                  <div className="space-y-2 pt-1">
                    {segments.map((segment) => (
                      <label
                        key={segment.id}
                        className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors"
                      >
                        <input
                          type="checkbox"
                          value={segment.id}
                          disabled={busy}
                          className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                          {...register("segmentIds")}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{segment.name}</span>
                          {segment.description && (
                            <span className="text-muted-foreground block text-sm">
                              {segment.description}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {errors.segmentIds && (
                  <p id={`${segmentsId}-erro`} role="alert" className="text-destructive text-sm">
                    {errors.segmentIds.message}
                  </p>
                )}
              </fieldset>

              <p className="text-muted-foreground text-xs">
                {selectedSegments.length === 0
                  ? "Nenhum público selecionado."
                  : `${selectedSegments.length} público(s) selecionado(s).`}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {formError && (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      )}

      {step !== "idle" && (
        <p role="status" className="text-muted-foreground text-sm">
          {step === "uploading" ? "Enviando imagem..." : "Salvando evento..."}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {/* `loading` já desabilita o botão — dois cliques criariam dois eventos
            e deixariam uma imagem órfã no bucket. */}
        <Button type="submit" loading={busy}>
          {busy ? "Salvando..." : "Salvar evento"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => router.back()}>
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
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
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
