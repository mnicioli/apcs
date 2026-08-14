"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { createLectureAction, updateLectureAction } from "@/lib/actions/lectures";
import type { DirectoryEntry } from "@/lib/services/profile";
import {
  LECTURE_FORMAT_LABELS,
  LECTURE_PRIORITY_LABELS,
  LECTURE_STATUS_HINTS,
  LECTURE_STATUS_LABELS,
  LECTURE_TYPE_LABELS,
} from "@/modules/lecture/lecture.labels";
import { lectureHref } from "@/modules/lecture/lecture.routes";
import {
  LECTURE_ENTRY_STATUSES,
  createLectureSchema,
  scheduledNeedsTime,
  updateLectureSchema,
  type CreateLectureInput,
  type UpdateLectureInput,
} from "@/modules/lecture/lecture.schema";
import {
  LECTURE_FORMATS,
  LECTURE_PRIORITIES,
  LECTURE_TYPES,
  type Lecture,
} from "@/modules/lecture/lecture.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Formulário de palestra — cadastro (§21) e edição (§30).
 *
 * ⚠️ SÃO DOIS COMPONENTES, e não um com `if`. Tentei o contrário e o TypeScript
 * recusou pelo motivo certo: `useForm<A>` e `useForm<B>` devolvem `register`
 * incompatíveis, porque **os dois formulários não são o mesmo formulário**.
 *
 *   • **Cadastro** define tudo, inclusive data, horário e situação inicial.
 *   • **Edição** mexe só nos campos DESCRITIVOS. Data e horário saem por
 *     "Reagendar", situação por "Alterar situação", responsável e palestrante
 *     pelas próprias ações.
 *
 * Não é rigor formal: é o que permite o histórico registrar "remarcou" e "mudou
 * o tema" como coisas diferentes, em vez de esconder um reagendamento no meio de
 * um diff de doze campos. O backend impõe o mesmo recorte — `update_lecture` nem
 * recebe data.
 *
 * ⚠️ AS VALIDAÇÕES DAQUI SÃO UX. O mesmo Zod roda dentro da action, e o banco
 * impõe as regras com CHECK, trigger e função. O formulário existe para a pessoa
 * ver o erro no campo em vez de depois de enviar.
 */
export function LectureForm({
  directory,
  lecture,
  prefill,
}: {
  directory: DirectoryEntry[];
  /** Ausente = cadastro. Presente = edição. */
  lecture?: Lecture;
  /** Vem do clique num espaço vazio do calendário (§29). */
  prefill?: { date?: string; startTime?: string };
}) {
  return lecture ? (
    <EditLectureForm lecture={lecture} />
  ) : (
    <CreateLectureForm directory={directory} prefill={prefill} />
  );
}

// ----------------------------------------------------------------------------
// Cadastro (§21)
// ----------------------------------------------------------------------------

function CreateLectureForm({
  directory,
  prefill,
}: {
  directory: DirectoryEntry[];
  prefill?: { date?: string; startTime?: string };
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const ids = useFieldIds();
  const statusId = useId();
  const dateId = useId();
  const startId = useId();
  const endId = useId();
  const speakerId = useId();
  const responsibleId = useId();
  const requesterNameId = useId();
  const requesterEmailId = useId();
  const requesterPhoneId = useId();
  const requesterOrgId = useId();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isDirty, isSubmitted },
  } = useForm<CreateLectureInput>({
    resolver: zodResolver(createLectureSchema),
    defaultValues: {
      name: "",
      theme: "",
      city: "",
      location: "",
      type: "company",
      typeOther: "",
      format: "",
      eventDate: prefill?.date ?? "",
      startTime: prefill?.startTime ?? "",
      endTime: "",
      attendeesEstimated: "",
      notes: "",
      // §21 não lista a situação inicial, mas o backend exige uma e o §53 pede
      // que o time consiga lançar um registro histórico. "Planejada" é o caso
      // comum — a APCS decidiu fazer e está marcando. Ver docs/PALESTRAS.md.
      status: "planned",
      priority: "normal",
      speakerId: "",
      responsibleId: "",
      requesterName: "",
      requesterEmail: "",
      requesterPhone: "",
      requesterOrganization: "",
    },
  });

  const tipo = watch("type");
  const status = watch("status");
  const inicio = watch("startTime");

  // §23: trocar OUTROS por outro tipo LIMPA o detalhe. Sem isto, "Evento
  // técnico" ficaria pendurado num registro de universidade — o CHECK do banco
  // recusaria, e a pessoa veria "dados inválidos" sobre um campo que sumiu.
  useEffect(() => {
    if (tipo !== "other") setValue("typeOther", "", { shouldValidate: isSubmitted });
  }, [tipo, setValue, isSubmitted]);

  useUnsavedGuard(isDirty && !isPending);

  function onSubmit(values: CreateLectureInput) {
    setFormError(null);

    // §13. A checagem cruzada situação × horário não cabe no schema (o `and` de
    // dois objetos não aceita `refine` sobre o combinado sem perder a
    // inferência). Aqui ela chega antes do servidor, com a mensagem certa.
    const faltaHorario = scheduledNeedsTime(values);
    if (faltaHorario) {
      setError("startTime", { message: faltaHorario });
      return;
    }

    startTransition(async () => {
      const result = await createLectureAction(values);

      if (!result.ok) {
        // O formulário NÃO é limpo: o trabalho de quem preencheu quinze campos
        // não pode sumir porque o servidor recusou um deles.
        setFormError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      // O conflito viaja na URL para a tela de detalhe anunciá-lo junto do
      // sucesso (§25): a palestra FOI criada, e o aviso é para a próxima
      // decisão.
      const conflitos = result.data.conflicts.length;
      router.push(
        `${lectureHref(result.data.id)}?created=1${conflitos ? `&conflicts=${conflitos}` : ""}`,
      );
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identificação</CardTitle>
          <CardDescription>
            O que é a palestra e onde ela acontece. Campos com <span aria-hidden="true">*</span> são
            obrigatórios.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field id={ids.name} label="Nome" required error={errors.name?.message} wide>
            <Input id={ids.name} aria-invalid={!!errors.name} {...register("name")} />
          </Field>

          <Field id={ids.theme} label="Tema" required error={errors.theme?.message} wide>
            <Input
              id={ids.theme}
              aria-invalid={!!errors.theme}
              placeholder="Custo de produção"
              {...register("theme")}
            />
          </Field>

          <Field id={ids.city} label="Cidade" required error={errors.city?.message}>
            <Input
              id={ids.city}
              aria-invalid={!!errors.city}
              placeholder="Toledo"
              {...register("city")}
            />
          </Field>

          <Field
            id={ids.location}
            label="Local"
            error={errors.location?.message}
            hint="Opcional. O espaço dentro da cidade — cidade e local são coisas diferentes."
          >
            <Input
              id={ids.location}
              aria-invalid={!!errors.location}
              placeholder="Centro de Convenções APCS"
              {...register("location")}
            />
          </Field>

          <Field id={ids.type} label="Tipo" required error={errors.type?.message}>
            <Select id={ids.type} aria-invalid={!!errors.type} {...register("type")}>
              {LECTURE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {LECTURE_TYPE_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          {/* §23: o campo só existe quando o tipo é OUTROS. */}
          {tipo === "other" && (
            <Field id={ids.typeOther} label="Qual?" required error={errors.typeOther?.message}>
              <Input
                id={ids.typeOther}
                aria-invalid={!!errors.typeOther}
                placeholder="Evento técnico"
                {...register("typeOther")}
              />
            </Field>
          )}

          <Field id={ids.format} label="Formato" error={errors.format?.message}>
            <Select id={ids.format} {...register("format")}>
              <option value="">Não definido</option>
              {LECTURE_FORMATS.map((option) => (
                <option key={option} value={option}>
                  {LECTURE_FORMAT_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id={ids.attendees}
            label="Participantes estimados"
            error={errors.attendeesEstimated?.message}
            hint="Opcional. Deixe vazio se não há estimativa."
          >
            <Input
              id={ids.attendees}
              type="number"
              inputMode="numeric"
              min={1}
              aria-invalid={!!errors.attendeesEstimated}
              placeholder="80"
              {...register("attendeesEstimated")}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agenda</CardTitle>
          <CardDescription>
            Quando a palestra acontece. Data no passado é aceita — serve para lançar uma palestra
            que já ocorreu.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <Field id={dateId} label="Data" required error={errors.eventDate?.message}>
            <Input
              id={dateId}
              type="date"
              aria-invalid={!!errors.eventDate}
              {...register("eventDate")}
            />
          </Field>

          <Field id={startId} label="Hora de início" error={errors.startTime?.message}>
            <Input
              id={startId}
              type="time"
              aria-invalid={!!errors.startTime}
              {...register("startTime")}
            />
          </Field>

          <Field id={endId} label="Hora de término" error={errors.endTime?.message}>
            <Input
              id={endId}
              type="time"
              aria-invalid={!!errors.endTime}
              {...register("endTime")}
            />
          </Field>

          <Field
            id={statusId}
            label="Situação inicial"
            required
            error={errors.status?.message}
            hint={LECTURE_STATUS_HINTS[status]}
            wide3
          >
            <Select id={statusId} {...register("status")}>
              {LECTURE_ENTRY_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {LECTURE_STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          {(status === "confirmed" || status === "held") && !inicio && (
            <p role="status" className="text-muted-foreground text-sm sm:col-span-3">
              Confirmada e Realizada exigem horário de início.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time e prioridade</CardTitle>
          <CardDescription>
            Quem cuida da palestra e quem apresenta. Podem ser definidos depois.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field id={responsibleId} label="Responsável" error={errors.responsibleId?.message}>
            <Select id={responsibleId} {...register("responsibleId")}>
              <option value="">Não definido</option>
              {directory.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName ?? person.email}
                </option>
              ))}
            </Select>
          </Field>

          <Field id={speakerId} label="Palestrante" error={errors.speakerId?.message}>
            <Select id={speakerId} {...register("speakerId")}>
              <option value="">Não definido</option>
              {directory.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName ?? person.email}
                </option>
              ))}
            </Select>
          </Field>

          <Field id={ids.priority} label="Prioridade" error={errors.priority?.message}>
            <Select id={ids.priority} {...register("priority")}>
              {LECTURE_PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {LECTURE_PRIORITY_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          <Field id={ids.notes} label="Observações" error={errors.notes?.message} wide>
            <Textarea id={ids.notes} rows={3} {...register("notes")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Solicitante</CardTitle>
          <CardDescription>
            Opcional. Preencha quando a palestra foi pedida por alguém — por telefone, por e-mail,
            numa visita. Estes dados ficam congelados no registro.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field id={requesterNameId} label="Nome" error={errors.requesterName?.message}>
            <Input id={requesterNameId} {...register("requesterName")} />
          </Field>

          <Field
            id={requesterOrgId}
            label="Empresa ou instituição"
            error={errors.requesterOrganization?.message}
          >
            <Input id={requesterOrgId} {...register("requesterOrganization")} />
          </Field>

          <Field id={requesterEmailId} label="E-mail" error={errors.requesterEmail?.message}>
            <Input
              id={requesterEmailId}
              type="email"
              inputMode="email"
              {...register("requesterEmail")}
            />
          </Field>

          <Field id={requesterPhoneId} label="Telefone" error={errors.requesterPhone?.message}>
            <Input
              id={requesterPhoneId}
              type="tel"
              inputMode="tel"
              placeholder="(45) 99999-0000"
              {...register("requesterPhone")}
            />
          </Field>
        </CardContent>
      </Card>

      <FormFooter error={formError} isPending={isPending} submitLabel="Cadastrar palestra" />
    </form>
  );
}

// ----------------------------------------------------------------------------
// Edição (§30)
// ----------------------------------------------------------------------------

function EditLectureForm({ lecture }: { lecture: Lecture }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const ids = useFieldIds();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitted },
  } = useForm<UpdateLectureInput>({
    resolver: zodResolver(updateLectureSchema),
    defaultValues: {
      lectureId: lecture.id,
      name: lecture.name,
      theme: lecture.theme,
      city: lecture.city,
      location: lecture.location ?? "",
      type: lecture.type,
      typeOther: lecture.typeOther ?? "",
      format: lecture.format ?? "",
      // O campo trafega como string (é o que o `<input type="number">` guarda).
      // `String(null)` seria "null" na caixa — daí a checagem explícita.
      attendeesEstimated:
        lecture.attendeesEstimated === null ? "" : String(lecture.attendeesEstimated),
      priority: lecture.priority,
      notes: lecture.notes ?? "",
    },
  });

  const tipo = watch("type");

  useEffect(() => {
    if (tipo !== "other") setValue("typeOther", "", { shouldValidate: isSubmitted });
  }, [tipo, setValue, isSubmitted]);

  useUnsavedGuard(isDirty && !isPending);

  function onSubmit(values: UpdateLectureInput) {
    setFormError(null);

    startTransition(async () => {
      const result = await updateLectureAction(values);

      if (!result.ok) {
        setFormError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      router.push(`${lectureHref(result.data.id)}?updated=1`);
    });
  }

  const erros = errors as FieldErrors<UpdateLectureInput>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <input type="hidden" {...register("lectureId")} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identificação</CardTitle>
          <CardDescription>
            Campos com <span aria-hidden="true">*</span> são obrigatórios.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field id={ids.name} label="Nome" required error={erros.name?.message} wide>
            <Input id={ids.name} aria-invalid={!!erros.name} {...register("name")} />
          </Field>

          <Field id={ids.theme} label="Tema" required error={erros.theme?.message} wide>
            <Input id={ids.theme} aria-invalid={!!erros.theme} {...register("theme")} />
          </Field>

          <Field id={ids.city} label="Cidade" required error={erros.city?.message}>
            <Input id={ids.city} aria-invalid={!!erros.city} {...register("city")} />
          </Field>

          <Field
            id={ids.location}
            label="Local"
            error={erros.location?.message}
            hint="Opcional. O espaço dentro da cidade."
          >
            <Input id={ids.location} aria-invalid={!!erros.location} {...register("location")} />
          </Field>

          <Field id={ids.type} label="Tipo" required error={erros.type?.message}>
            <Select id={ids.type} aria-invalid={!!erros.type} {...register("type")}>
              {LECTURE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {LECTURE_TYPE_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          {tipo === "other" && (
            <Field id={ids.typeOther} label="Qual?" required error={erros.typeOther?.message}>
              <Input
                id={ids.typeOther}
                aria-invalid={!!erros.typeOther}
                {...register("typeOther")}
              />
            </Field>
          )}

          <Field id={ids.format} label="Formato" error={erros.format?.message}>
            <Select id={ids.format} {...register("format")}>
              <option value="">Não definido</option>
              {LECTURE_FORMATS.map((option) => (
                <option key={option} value={option}>
                  {LECTURE_FORMAT_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id={ids.attendees}
            label="Participantes estimados"
            error={erros.attendeesEstimated?.message}
          >
            <Input
              id={ids.attendees}
              type="number"
              inputMode="numeric"
              min={1}
              aria-invalid={!!erros.attendeesEstimated}
              {...register("attendeesEstimated")}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prioridade e observações</CardTitle>
          <CardDescription>
            Responsável e palestrante têm ações próprias na tela da palestra.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field id={ids.priority} label="Prioridade" error={erros.priority?.message}>
            <Select id={ids.priority} {...register("priority")}>
              {LECTURE_PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {LECTURE_PRIORITY_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          <Field id={ids.notes} label="Observações" error={erros.notes?.message} wide>
            <Textarea id={ids.notes} rows={3} {...register("notes")} />
          </Field>
        </CardContent>
      </Card>

      <FormFooter error={formError} isPending={isPending} submitLabel="Salvar alterações" />
    </form>
  );
}

// ----------------------------------------------------------------------------
// Peças compartilhadas
// ----------------------------------------------------------------------------

/** Os ids dos campos que existem nos DOIS formulários. */
function useFieldIds() {
  return {
    name: useId(),
    theme: useId(),
    city: useId(),
    location: useId(),
    type: useId(),
    typeOther: useId(),
    format: useId(),
    attendees: useId(),
    priority: useId(),
    notes: useId(),
  };
}

/**
 * Proteção contra perda acidental.
 *
 * LIMITE HONESTO: `beforeunload` cobre fechar a aba, recarregar e sair do app.
 * Ele NÃO intercepta navegação interna do App Router, que não expõe um gancho
 * para bloquear rota — clicar num item do menu ainda perde o rascunho.
 */
function useUnsavedGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}

function FormFooter({
  error,
  isPending,
  submitLabel,
}: {
  error: string | null;
  isPending: boolean;
  submitLabel: string;
}) {
  const router = useRouter();

  return (
    <>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {/* `loading` já desabilita o botão — dois cliques criariam duas
            palestras, com dois protocolos. */}
        <Button type="submit" loading={isPending}>
          {isPending ? "Salvando..." : submitLabel}
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </>
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
  wide3,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /** Ocupa as duas colunas da grade. */
  wide?: boolean;
  /** Ocupa as três colunas da grade da agenda. */
  wide3?: boolean;
  children: React.ReactNode;
}) {
  const span = wide3 ? " sm:col-span-3" : wide ? " sm:col-span-2" : "";

  return (
    <div className={`space-y-2${span}`}>
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
