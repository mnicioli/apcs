"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock, Save } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  createSurveyAction,
  scheduleSurveyAction,
  setSurveyAudienceAction,
  updateSurveyAction,
  updateSurveyQuestionAction,
} from "@/lib/actions/surveys";
import { SURVEY_ANSWER_TYPE_LABELS } from "@/modules/survey/survey.labels";
import { surveyHref } from "@/modules/survey/survey.routes";
import { surveyCoreSchema, type SurveyFormInput } from "@/modules/survey/survey.schema";
import type { SurveyAudienceCriterion, SurveyWithQuestion } from "@/modules/survey/survey.types";
import { TimeSelect } from "@/components/ui/time-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SurveyAudienceSelector, type AudienceSegment } from "./survey-audience-selector";
import { MIN_OPTIONS, SurveyOptionEditor } from "./survey-option-editor";
import { SurveyPreview } from "./survey-preview";
import { SurveyScheduleDialog } from "./survey-schedule-dialog";

/**
 * O separador usado para comparar listas por conteúdo (`join`).
 *
 * ⚠️ NUL PORQUE ELE NÃO PODE APARECER NO TEXTO. Com uma vírgula, duas
 * alternativas `["a,b", "c"]` e `["a", "b,c"]` produziriam a mesma string e o
 * formulário concluiria que nada mudou.
 *
 * ⚠️ E CONSTRUÍDO, NUNCA ESCRITO COMO O BYTE CRU. Ele estava literal dentro dos
 * `join("…")` deste arquivo, o que fazia o Git classificá-lo como BINÁRIO:
 * `git diff` mostrava "Bin 24495 -> 24597 bytes" e nenhuma linha. Um arquivo de
 * 650 linhas que ninguém consegue revisar em diff é um ponto cego permanente.
 */
const SEPARADOR = String.fromCharCode(0);

/**
 * O FORMULÁRIO DE ENQUETE — criação e edição (§10 a §38, §71).
 *
 * ⚠️ UM COMPONENTE, não dois. É o oposto da decisão de Palestras, e o motivo é
 * que aqui os dois formulários são o MESMO formulário: criar e editar preenchem
 * exatamente os mesmos campos. O que muda é o que acontece no salvar (uma action
 * ou três) e o que fica travado quando já existem respostas (§38).
 *
 * ⚠️ SALVAR PODE SER ATÉ TRÊS ESCRITAS, e não uma. O backend separa
 * deliberadamente os dados descritivos, a estrutura da pergunta e o público —
 * cada um tem regras próprias e ação própria na trilha. A ordem importa:
 *
 *   1. dados descritivos  (sempre)
 *   2. pergunta e alternativas  (só se a estrutura ainda pode mudar)
 *   3. público  (só enquanto rascunho)
 *
 * Se a 2 ou a 3 falharem, a 1 já valeu — e a tela diz exatamente isso, em vez de
 * fingir que nada aconteceu.
 *
 * ⚠️ AS VALIDAÇÕES DAQUI SÃO UX. O mesmo Zod roda dentro da action, e o banco
 * impõe as regras com CHECK, trigger e função (§63). O formulário existe para a
 * pessoa ver o erro no campo em vez de depois de enviar.
 */
export function SurveyForm({
  survey,
  segments,
  regions,
  contactNames,
  hasResponses = false,
}: {
  /** `undefined` = criação. */
  survey?: SurveyWithQuestion;
  segments: AudienceSegment[];
  regions: string[];
  contactNames: Map<string, string | null>;
  /** §38: com respostas gravadas, pergunta e alternativas ficam travadas. */
  hasResponses?: boolean;
}) {
  const router = useRouter();

  const titleId = useId();
  const descriptionId = useId();
  const questionId = useId();
  const answerTypeId = useId();
  const endsId = useId();
  const scheduledId = useId();
  const anonId = useId();

  const [options, setOptions] = useState<string[]>(
    survey?.question?.options.filter((o) => o.active).map((o) => o.text) ?? ["", ""],
  );
  const [criteria, setCriteria] = useState<SurveyAudienceCriterion[]>(
    survey ? [...survey.audience] : [],
  );
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [agendando, setAgendando] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitted },
  } = useForm<SurveyFormInput>({
    resolver: zodResolver(surveyCoreSchema),
    defaultValues: {
      title: survey?.title ?? "",
      description: survey?.description ?? "",
      question: survey?.question?.text ?? "",
      options: [],
      startsAt: toLocalInput(survey?.startsAt),
      endsAt: toLocalInput(survey?.endsAt),
      scheduledAt: toLocalInput(survey?.scheduledAt),
      isAnonymous: survey?.isAnonymous ?? false,
      allowsResponseChange: survey?.allowsResponseChange ?? false,
    },
  });

  const pergunta = watch("question") ?? "";
  const titulo = watch("title") ?? "";

  const opcoesValidas = options.map((o) => o.trim()).filter((o) => o !== "");

  // ⚠️ AS ALTERNATIVAS PRECISAM ENTRAR NO ESTADO DO REACT HOOK FORM.
  //
  // Elas moram em `useState` porque o editor precisa reordenar e remover itens,
  // o que `register` não faz. Mas o resolver valida os valores do RHF — e sem
  // esta sincronização ele via `options: []` para sempre, a validação falhava, e
  // `handleSubmit` NUNCA CHAMAVA o handler.
  //
  // O efeito disso no navegador era o pior possível: clicar em "Salvar" não
  // fazia nada. Sem erro, sem rede, sem pista. Encontrado percorrendo o fluxo no
  // preview, não pelo type-check nem pelo build — que passavam.
  useEffect(() => {
    setValue("options", opcoesValidas, { shouldValidate: false, shouldDirty: false });
    // `opcoesValidas` é derivado de `options`; depender do array serializado
    // evita reexecutar o efeito a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opcoesValidas.join(SEPARADOR), setValue]);

  // §38/§60. Encerrada e cancelada não se editam; com respostas, a estrutura
  // trava. O backend impõe o mesmo — aqui é só para a pessoa não perder o
  // trabalho de digitar algo que vai ser recusado.
  const terminal = survey?.status === "closed" || survey?.status === "cancelled";
  const estruturaTravada = hasResponses || terminal;
  const publicoTravado = survey !== undefined && survey.status !== "draft";

  // §62. Sair com alterações não salvas pede confirmação. `beforeunload` cobre
  // fechar a aba e recarregar; a navegação interna do Next não dispara este
  // evento, e é uma limitação conhecida — ver o comentário abaixo.
  const sujo = isDirty || opcoesMudaram(survey, options) || publicoMudou(survey, criteria);

  useEffect(() => {
    if (!sujo) return;

    function avisar(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Navegadores modernos ignoram a mensagem personalizada e mostram a
      // própria — `preventDefault` é o que basta para o diálogo aparecer.
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  const faltamOpcoes = opcoesValidas.length < MIN_OPTIONS;
  const opcoesRepetidas =
    new Set(opcoesValidas.map((o) => o.toLowerCase())).size !== opcoesValidas.length;

  /**
   * Salva e devolve o id — ou `null` se falhou.
   *
   * Devolve o id (em vez de navegar) porque "Salvar e agendar" precisa dele para
   * o passo seguinte, e "Salvar rascunho" precisa dele para navegar.
   */
  async function salvar(dados: SurveyFormInput): Promise<string | null> {
    setErro(null);
    setAviso(null);

    const payload = {
      ...dados,
      options: opcoesValidas,
      startsAt: fromLocalInput(dados.startsAt),
      endsAt: fromLocalInput(dados.endsAt),
      scheduledAt: fromLocalInput(dados.scheduledAt),
    };

    // ---------- criação ----------
    if (!survey) {
      const criada = await createSurveyAction(payload);
      if (!criada.ok) {
        setErro(ACTION_ERROR_MESSAGES[criada.error.code]);
        return null;
      }

      if (criteria.length > 0) {
        const publico = await setSurveyAudienceAction(criada.data.id, toInput(criteria));
        if (!publico.ok) {
          // A enquete EXISTE. Dizer "não foi possível criar" mandaria a pessoa
          // criar de novo e ela acabaria com duas.
          setAviso(
            `A enquete foi criada como rascunho, mas o público não pôde ser salvo: ${
              ACTION_ERROR_MESSAGES[publico.error.code]
            }`,
          );
        }
      }

      return criada.data.id;
    }

    // ---------- edição ----------
    const atualizada = await updateSurveyAction(survey.id, payload);
    if (!atualizada.ok) {
      setErro(ACTION_ERROR_MESSAGES[atualizada.error.code]);
      return null;
    }

    if (!estruturaTravada) {
      const perguntaSalva = await updateSurveyQuestionAction(survey.id, {
        question: payload.question,
        options: opcoesValidas,
      });
      if (!perguntaSalva.ok) {
        setAviso(
          `Os dados da enquete foram salvos, mas a pergunta não: ${
            ACTION_ERROR_MESSAGES[perguntaSalva.error.code]
          }`,
        );
      }
    }

    if (!publicoTravado && publicoMudou(survey, criteria)) {
      const publico = await setSurveyAudienceAction(survey.id, toInput(criteria));
      if (!publico.ok) {
        setAviso(
          `Os dados da enquete foram salvos, mas o público não: ${
            ACTION_ERROR_MESSAGES[publico.error.code]
          }`,
        );
      }
    }

    return survey.id;
  }

  function salvarRascunho(dados: SurveyFormInput) {
    startTransition(async () => {
      const id = await salvar(dados);
      if (!id) return;
      // Se houve aviso, fica na tela para a pessoa ler antes de sair.
      if (aviso) return;
      router.push(surveyHref(id));
      router.refresh();
    });
  }

  function abrirAgendamento(dados: SurveyFormInput) {
    startTransition(async () => {
      const id = await salvar(dados);
      if (!id) return;
      setAgendando(true);
      if (!survey) router.replace(`${surveyHref(id)}/edit`);
    });
  }

  const bloqueado = isPending || terminal;

  return (
    <form className="space-y-6" onSubmit={handleSubmit(salvarRascunho)}>
      {/* ============ 1. Informações da enquete (§10, §11, §12) ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Informações da enquete</CardTitle>
          <CardDescription>O que identifica esta enquete para o time da APCS.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={titleId}>
              Título <span aria-hidden="true">*</span>
              <span className="sr-only">(obrigatório)</span>
            </Label>
            <Input
              id={titleId}
              maxLength={200}
              disabled={bloqueado}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? `${titleId}-erro` : undefined}
              {...register("title")}
            />
            {errors.title && (
              <p id={`${titleId}-erro`} role="alert" className="text-destructive text-sm">
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={descriptionId}>Descrição</Label>
            <Textarea
              id={descriptionId}
              rows={2}
              maxLength={2000}
              disabled={bloqueado}
              placeholder="Opcional — contexto para quem for consultar depois."
              {...register("description")}
            />
          </div>
        </CardContent>
      </Card>

      {/* ============ 2 e 3. Pergunta e alternativas (§13 a §17) ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Pergunta</CardTitle>
          <CardDescription>
            {estruturaTravada
              ? "Esta enquete já recebeu respostas ou está encerrada: a pergunta e as alternativas não podem mais mudar."
              : "O que o associado vai ler no WhatsApp."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={questionId}>
              Pergunta <span aria-hidden="true">*</span>
              <span className="sr-only">(obrigatório)</span>
            </Label>
            <Textarea
              id={questionId}
              rows={2}
              maxLength={500}
              disabled={bloqueado || estruturaTravada}
              aria-invalid={Boolean(errors.question)}
              placeholder="Como você acredita que ficará o valor da @ do suíno nas próximas semanas?"
              {...register("question")}
            />
            {errors.question && (
              <p role="alert" className="text-destructive text-sm">
                {errors.question.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={answerTypeId}>Tipo de resposta</Label>
            {/* §14. Um select com uma opção só, e não um campo escondido: a
                pessoa precisa saber que existe um tipo e qual é o dele. Os
                outros cinco tipos existem no banco e estão desligados por um
                CHECK — oferecê-los aqui seria oferecer o que o servidor recusa. */}
            <Select
              id={answerTypeId}
              value="single_choice"
              disabled
              aria-describedby={`${answerTypeId}-ajuda`}
            >
              <option value="single_choice">{SURVEY_ANSWER_TYPE_LABELS.single_choice}</option>
            </Select>
            <p id={`${answerTypeId}-ajuda`} className="text-muted-foreground text-xs">
              O associado escolhe uma alternativa. Os demais tipos ainda não estão disponíveis.
            </p>
          </div>

          <SurveyOptionEditor
            options={options}
            onChange={setOptions}
            disabled={bloqueado}
            locked={estruturaTravada}
          />

          {faltamOpcoes && (
            <p role="alert" className="text-destructive text-sm">
              Informe ao menos {MIN_OPTIONS} alternativas.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ============ 4. Público (§22 a §31) ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Público da enquete</CardTitle>
          <CardDescription>
            Quem vai receber. Dentro de um mesmo critério vale <strong>ou</strong>; entre critérios
            diferentes vale <strong>e</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SurveyAudienceSelector
            criteria={criteria}
            onChange={setCriteria}
            segments={segments}
            regions={regions}
            contactNames={contactNames}
            disabled={bloqueado}
            locked={publicoTravado}
          />
        </CardContent>
      </Card>

      {/* ============ 5. Agendamento (§20, §32, §35) ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Agendamento do envio</CardTitle>
          <CardDescription>
            Quando a enquete abre, quando fecha e quando a mensagem sai.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {/* ⚠️ UM CAMPO PARA DOIS INSTANTES — envio e abertura andam juntos.
              O banco continua guardando `scheduled_at` e `starts_at` separados,
              e o schema continua exigindo envio >= início; o que sumiu foi a
              PERGUNTA, não a capacidade. Eram dois campos que na prática
              recebiam sempre o mesmo valor, e a diferença entre eles só
              aparecia como um erro em vermelho quando alguém errava a ordem.

              Consequência a conhecer: deixou de ser possível abrir a enquete
              para respostas às 08:00 e só mandar a mensagem às 09:00. Se isso
              voltar a ser preciso, é separar os dois campos de novo — nada no
              banco impede. */}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={scheduledId}>Data e hora do envio</Label>
            <DateTimeField
              id={scheduledId}
              label="Data e hora do envio"
              value={watch("scheduledAt") ?? ""}
              disabled={bloqueado}
              invalid={Boolean(errors.scheduledAt ?? errors.startsAt)}
              onChange={(valor) => {
                // Revalidar só depois da primeira tentativa de envio: cobrar
                // ordem de datas enquanto a pessoa ainda escolhe é ruído.
                const opcoes = { shouldDirty: true, shouldValidate: isSubmitted } as const;
                setValue("scheduledAt", valor, opcoes);
                // A abertura acompanha o envio: é a fusão dos dois campos.
                setValue("startsAt", valor, opcoes);
              }}
            />
            {(errors.scheduledAt ?? errors.startsAt) && (
              <p role="alert" className="text-destructive text-sm">
                {(errors.scheduledAt ?? errors.startsAt)?.message}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              A mensagem sai neste instante, e a enquete passa a aceitar respostas.
            </p>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={endsId}>Encerramento</Label>
            <DateTimeField
              id={endsId}
              label="Encerramento"
              value={watch("endsAt") ?? ""}
              disabled={bloqueado}
              invalid={Boolean(errors.endsAt)}
              onChange={(valor) =>
                setValue("endsAt", valor, { shouldDirty: true, shouldValidate: isSubmitted })
              }
            />
            {errors.endsAt && (
              <p role="alert" className="text-destructive text-sm">
                {errors.endsAt.message}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Depois deste instante nenhuma resposta é aceita.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ============ 6. Configurações (§21) ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Configurações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors">
            <input
              id={anonId}
              type="checkbox"
              disabled={bloqueado || hasResponses}
              className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
              {...register("isAnonymous")}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Respostas anônimas</span>
              {/* §21. O texto do escopo, palavra por palavra: é ele que impede
                  alguém de achar que "anônimo" significa que a pessoa pode
                  responder duas vezes. */}
              <span className="text-muted-foreground block text-sm">
                A resposta continuará sendo controlada internamente para impedir participação
                duplicada, mas os resultados individuais não serão exibidos.
              </span>
              {hasResponses && (
                <span className="text-muted-foreground mt-1 block text-xs">
                  Esta enquete já recebeu respostas: o anonimato não pode mais ser alterado.
                </span>
              )}
            </span>
          </label>
        </CardContent>
      </Card>

      {/* ============ 7. Preview (§19, §70) ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Prévia</CardTitle>
          <CardDescription>Aproximadamente o que o associado vai receber.</CardDescription>
        </CardHeader>
        <CardContent>
          <SurveyPreview question={pergunta} options={options} />
        </CardContent>
      </Card>

      {/* ⚠️ O CATCH-ALL DE VALIDAÇÃO. Se qualquer campo estiver inválido,
          `handleSubmit` não chama o handler — e sem esta mensagem o botão
          simplesmente não faria nada, que é o pior desfecho possível para quem
          está tentando salvar. Os campos com erro já se marcam sozinhos; isto
          garante que EXISTA uma explicação visível mesmo quando o campo com
          problema está fora da tela. */}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-destructive text-sm">
          {errors.options?.message ??
            "Alguns campos precisam de atenção antes de salvar. Confira os destacados acima."}
        </p>
      )}

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="alert" className="text-destructive text-sm">
          {aviso}
        </p>
      )}

      {/* ============ Ações (§33, §34, §53) ============ */}
      <div className="flex flex-wrap gap-2">
        {/* `loading` já desabilita o botão — dois cliques criariam duas
            enquetes, e o §74 pede que o frontend impeça isso. */}
        <Button
          type="submit"
          loading={isPending}
          disabled={faltamOpcoes || opcoesRepetidas || terminal}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Salvar rascunho
        </Button>

        {!publicoTravado && (
          <Button
            type="button"
            variant="outline"
            disabled={
              isPending || faltamOpcoes || opcoesRepetidas || terminal || criteria.length === 0
            }
            onClick={handleSubmit(abrirAgendamento)}
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            Salvar e agendar envio
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            // §62. A navegação interna do Next não dispara `beforeunload`, então
            // a confirmação de saída precisa ser explícita aqui.
            if (sujo && !window.confirm("Existem alterações não salvas. Deseja sair?")) return;
            router.push(survey ? surveyHref(survey.id) : "/surveys");
          }}
        >
          Cancelar
        </Button>
      </div>

      {survey && (
        <SurveyScheduleDialog
          open={agendando}
          onClose={() => setAgendando(false)}
          survey={survey}
          title={titulo}
          question={pergunta}
          optionCount={opcoesValidas.length}
          criteria={criteria}
          // O que a pessoa acabou de digitar, e não o que estava gravado antes.
          defaults={{
            scheduledAt: watch("scheduledAt") ?? "",
            startsAt: watch("startsAt") ?? "",
            endsAt: watch("endsAt") ?? "",
          }}
          onScheduled={() => {
            setAgendando(false);
            router.push(surveyHref(survey.id));
            router.refresh();
          }}
          schedule={(input) => scheduleSurveyAction(survey.id, input)}
        />
      )}
    </form>
  );
}

/** Os critérios no formato que o schema da action espera. */
function toInput(criteria: SurveyAudienceCriterion[]) {
  return criteria.map((c) => ({
    dimension: c.dimension,
    segmentId: c.segmentId ?? "",
    contactId: c.contactId ?? "",
    value: c.value ?? "",
  }));
}

function opcoesMudaram(survey: SurveyWithQuestion | undefined, options: string[]): boolean {
  const atuais = survey?.question?.options.filter((o) => o.active).map((o) => o.text) ?? [];
  const novas = options.map((o) => o.trim()).filter((o) => o !== "");
  return atuais.join(SEPARADOR) !== novas.join(SEPARADOR);
}

function publicoMudou(
  survey: SurveyWithQuestion | undefined,
  criteria: SurveyAudienceCriterion[],
): boolean {
  const chave = (c: SurveyAudienceCriterion) =>
    `${c.dimension}|${c.segmentId ?? ""}|${c.contactId ?? ""}|${c.value ?? ""}`;
  const antes = (survey?.audience ?? []).map(chave).sort().join(SEPARADOR);
  const depois = criteria.map(chave).sort().join(SEPARADOR);
  return antes !== depois;
}

/**
 * ⚠️ A PONTE ENTRE O INSTANTE E O CAMPO — e é onde um fuso vira um bug.
 *
 * O banco guarda `timestamptz` (um instante absoluto). O
 * `<input type="datetime-local">` fala em HORA LOCAL, sem fuso. Converter com
 * `.slice(0, 16)` no ISO — que é a tentação — mostraria a hora em UTC: uma
 * enquete que fecha às 23h de São Paulo apareceria como 02h do dia seguinte.
 *
 * `toLocaleString` com `sv-SE` dá o formato ISO curto já no fuso do navegador,
 * que é exatamente o que o campo espera.
 */
function toLocalInput(instant: string | null | undefined): string {
  if (!instant) return "";
  const data = new Date(instant);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("sv-SE", { hour12: false }).slice(0, 16).replace(" ", "T");
}

/**
 * DATA + HORA, com a hora vindo do `TimeSelect` de 5 em 5 minutos.
 *
 * ⚠️ POR QUE NÃO O `<input type="datetime-local">` COM `step`. Era o que estava
 * aqui, e é a mesma armadilha que `ui/time-select.tsx` descreve: o `step` vale
 * para a VALIDAÇÃO do navegador, não para a lista que ele desenha. O seletor
 * oferecia 12:07, o Zod recusava com "escolha de 5 em 5 minutos", e a pessoa
 * levava um erro por ter escolhido o que a própria tela ofereceu.
 *
 * ⚠️ PARA FORA CONTINUA SENDO "AAAA-MM-DDTHH:MM" — exatamente o que o campo
 * nativo produzia. `toLocalInput`, `fromLocalInput`, o schema e a action não
 * sabem que algo mudou.
 */
function DateTimeField({
  id,
  label,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
}) {
  const [data = "", hora = ""] = value ? value.split("T") : ["", ""];

  // ⚠️ METADE NÃO É VALOR. Sem os dois pedaços o campo vale "", pelo mesmo
  // motivo do `TimeSelect`: completar o que falta seria o sistema inventando um
  // instante que ninguém escolheu.
  const juntar = (d: string, h: string) => (d && h ? `${d}T${h}` : "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id={id}
        type="date"
        className="w-44"
        value={data}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-label={`${label} — data`}
        onChange={(evento) => onChange(juntar(evento.target.value, hora))}
      />
      <TimeSelect
        id={`${id}-hora`}
        label={label}
        value={hora}
        disabled={disabled}
        invalid={invalid}
        onChange={(novaHora) => onChange(juntar(data, novaHora))}
      />
    </div>
  );
}

/** E a volta: o que a pessoa digitou (hora local) vira instante absoluto. */
function fromLocalInput(local: string | undefined): string {
  if (!local) return "";
  const data = new Date(local);
  return Number.isNaN(data.getTime()) ? "" : data.toISOString();
}
