"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { saveEvaluationStructureAction } from "@/lib/actions/event-evaluation";
import {
  evaluationStructureSchema,
  type EvaluationQuestionInput,
  type EvaluationSectionInput,
} from "@/modules/event/event.evaluation.schema";
import {
  EVALUATION_QUESTION_TYPE_HELP,
  EVALUATION_QUESTION_TYPE_LABELS,
} from "@/modules/event/event.evaluation.labels";
import {
  EVALUATION_QUESTION_TYPES,
  OPTION_BEARING_TYPES,
  type EvaluationDetail,
  type EvaluationQuestionType,
} from "@/modules/event/event.evaluation.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * O CONSTRUTOR DE PERGUNTAS (§24).
 *
 * ============================================================================
 * ⚠️ EDITA UM RASCUNHO EM MEMÓRIA E SALVA A ESTRUTURA INTEIRA.
 * ============================================================================
 * Não existe "adicionar bloco" nem "mover pergunta" como chamada ao servidor.
 * Todas as operações mexem num array local, e um único botão manda o formulário
 * completo para `save_event_evaluation_structure`.
 *
 * Isso é a decisão 3 da migration chegando à tela, e ela se paga aqui também:
 * reordenar não precisa de ida ao servidor por clique, remover uma pergunta e
 * acrescentar outra é UMA gravação, e o "salvar" é o único ponto em que algo
 * pode dar errado — em vez de cinco cliques dos quais o terceiro falhou.
 *
 * O preço é um rascunho não salvo que se perde ao sair da página. É aceitável
 * porque montar um formulário de avaliação é uma sessão curta e deliberada, e
 * não uma edição que fica aberta o dia inteiro.
 *
 * ============================================================================
 * ⚠️ SEM ARRASTAR E SOLTAR, E O §24 PERMITE ("use drag-and-drop apenas se já
 * houver componente/padrão adequado").
 * ============================================================================
 * Não há, e as setas ↑ ↓ fazem o mesmo trabalho com três vantagens: funcionam
 * no teclado, funcionam no celular e não custam uma dependência. O §24 é
 * explícito sobre não adicionar dependência pesada sem necessidade.
 *
 * ⚠️ E A ORDEM DO ARRAY É A ORDEM DO FORMULÁRIO. Nenhum `position` é enviado —
 * quem numera é o banco, com `ordinality` sobre o array recebido. Mandar a
 * posição daqui criaria uma segunda fonte para ela, e as duas divergiriam no
 * primeiro clique na seta.
 */

type Rascunho = EvaluationSectionInput[];

const ESCALA_PADRAO: EvaluationQuestionInput["options"] = [
  { label: "Excelente", value: 5 },
  { label: "Bom", value: 4 },
  { label: "Regular", value: 3 },
  { label: "Ruim", value: 2 },
  { label: "Péssimo", value: 1 },
];

export function EvaluationBuilder({
  detail,
  canWrite,
}: {
  detail: EvaluationDetail;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const [rascunho, setRascunho] = useState<Rascunho>(() =>
    detail.sections.map((bloco) => ({
      title: bloco.title,
      description: bloco.description,
      questions: bloco.questions.map((pergunta) => ({
        prompt: pergunta.prompt,
        type: pergunta.type,
        required: pergunta.required,
        isOverall: pergunta.isOverall,
        options: pergunta.options.map((opcao) => ({ label: opcao.label, value: opcao.value })),
      })),
    })),
  );

  if (detail.evaluationId === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Perguntas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Ligue a avaliação acima para copiar o modelo padrão da APCS e começar a editar as
            perguntas deste evento.
          </p>
        </CardContent>
      </Card>
    );
  }

  function alterarBloco(indice: number, mudanca: Partial<EvaluationSectionInput>) {
    setRascunho((atual) =>
      atual.map((bloco, i) => (i === indice ? { ...bloco, ...mudanca } : bloco)),
    );
  }

  function alterarPergunta(
    bloco: number,
    pergunta: number,
    mudanca: Partial<EvaluationQuestionInput>,
  ) {
    setRascunho((atual) =>
      atual.map((b, i) =>
        i !== bloco
          ? b
          : {
              ...b,
              questions: b.questions.map((q, j) =>
                j === pergunta ? ({ ...q, ...mudanca } as EvaluationQuestionInput) : q,
              ),
            },
      ),
    );
  }

  /**
   * ⚠️ TROCAR O TIPO REESCREVE AS ALTERNATIVAS, e não as preserva.
   *
   * Uma escolha única virando nota herdaria alternativas sem valor numérico — e
   * o banco recusaria a gravação inteira (AV003) por causa de uma pergunta que a
   * pessoa achou que tinha acabado de configurar. Trocar para nota já traz a
   * escala da APCS pronta; trocar para texto ou Sim/Não esvazia, porque esses
   * dois não têm alternativa para editar.
   */
  function trocarTipo(bloco: number, pergunta: number, tipo: EvaluationQuestionType) {
    const opcoes =
      tipo === "rating"
        ? ESCALA_PADRAO
        : tipo === "single_choice" || tipo === "multiple_choice"
          ? [
              { label: "Opção 1", value: null },
              { label: "Opção 2", value: null },
            ]
          : [];

    // ⚠️ SÓ `rating` PODE SER A GERAL (§34). Trocar o tipo sem desmarcar
    // deixaria o rascunho num estado que o banco recusa — e a pessoa levaria o
    // erro só ao salvar, sem saber qual das doze perguntas o causou.
    alterarPergunta(bloco, pergunta, {
      type: tipo,
      options: opcoes,
      ...(tipo === "rating" ? {} : { isOverall: false }),
    });
  }

  /**
   * ⚠️ MARCAR UMA DESMARCA TODAS AS OUTRAS (§34 do Prompt 3).
   *
   * A exclusividade é resolvida AQUI, no rascunho, e não por uma mensagem de
   * erro no salvamento. O schema e o banco também a impõem — mas descobrir que
   * há duas marcadas só ao clicar em "Salvar" obrigaria a pessoa a caçar, entre
   * doze perguntas em cinco blocos, qual das duas desmarcar.
   */
  function marcarGeral(bloco: number, pergunta: number, marcada: boolean) {
    setRascunho((atual) =>
      atual.map((b, i) => ({
        ...b,
        questions: b.questions.map((q, j) => ({
          ...q,
          isOverall: marcada && i === bloco && j === pergunta,
        })),
      })),
    );
  }

  function mover<T>(lista: T[], de: number, para: number): T[] {
    if (para < 0 || para >= lista.length) return lista;
    const copia = [...lista];
    const [item] = copia.splice(de, 1);
    if (item !== undefined) copia.splice(para, 0, item);
    return copia;
  }

  function salvar() {
    setErro(null);
    setSalvo(false);

    // ⚠️ O MESMO SCHEMA DA ACTION, aqui — é a regra do projeto. Rodá-lo antes de
    // chamar o servidor é o que permite dizer QUAL bloco está errado; a action
    // roda de novo, porque é ela que decide.
    const validado = evaluationStructureSchema.safeParse({
      eventId: detail.eventId,
      sections: rascunho,
    });

    if (!validado.success) {
      const problema = validado.error.issues[0];
      setErro(problema?.message ?? "Confira as perguntas antes de salvar.");
      return;
    }

    startTransition(async () => {
      const resultado = await saveEvaluationStructureAction(validado.data);

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      setSalvo(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Perguntas
          {detail.version !== null && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              versão {detail.version}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ⚠️ O AVISO DO §23 APARECE ANTES DE SALVAR, e não depois. Com respostas
            na versão corrente, salvar não edita: cria uma v+1. Descobrir isso
            depois de clicar seria descobrir tarde. */}
        {detail.versionHasAnswers && (
          <p className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
            Esta versão <strong>já tem respostas</strong>. Salvar qualquer mudança publica uma
            <strong> versão nova</strong> — as respostas antigas continuam ligadas à versão que
            aquelas pessoas leram, e nada é reescrito.
          </p>
        )}

        <fieldset disabled={!canWrite || pendente} className="space-y-6">
          {rascunho.map((bloco, indiceBloco) => (
            <div key={indiceBloco} className="border-border space-y-4 rounded-lg border p-4">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor={`bloco-${indiceBloco}`}>Bloco {indiceBloco + 1}</Label>
                  <Input
                    id={`bloco-${indiceBloco}`}
                    value={bloco.title}
                    onChange={(e) => alterarBloco(indiceBloco, { title: e.target.value })}
                    placeholder="Ex.: Avalie o evento — Empresa X"
                  />
                  <Textarea
                    value={bloco.description ?? ""}
                    onChange={(e) =>
                      alterarBloco(indiceBloco, { description: e.target.value || null })
                    }
                    placeholder="Descrição do bloco (opcional)"
                    rows={2}
                    aria-label={`Descrição do bloco ${indiceBloco + 1}`}
                  />
                </div>

                {canWrite && (
                  <div className="flex flex-col gap-1 pt-7">
                    <BotaoIcone
                      label={`Mover bloco ${indiceBloco + 1} para cima`}
                      onClick={() => setRascunho((a) => mover(a, indiceBloco, indiceBloco - 1))}
                      disabled={indiceBloco === 0}
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </BotaoIcone>
                    <BotaoIcone
                      label={`Mover bloco ${indiceBloco + 1} para baixo`}
                      onClick={() => setRascunho((a) => mover(a, indiceBloco, indiceBloco + 1))}
                      disabled={indiceBloco === rascunho.length - 1}
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </BotaoIcone>
                    <BotaoIcone
                      label={`Remover bloco ${indiceBloco + 1}`}
                      onClick={() => setRascunho((a) => a.filter((_, i) => i !== indiceBloco))}
                    >
                      <Trash2 className="text-destructive h-4 w-4" aria-hidden="true" />
                    </BotaoIcone>
                  </div>
                )}
              </div>

              <div className="space-y-4 pl-2">
                {bloco.questions.map((pergunta, indicePergunta) => (
                  <PerguntaEditor
                    key={indicePergunta}
                    pergunta={pergunta}
                    canWrite={canWrite}
                    onChange={(mudanca) => alterarPergunta(indiceBloco, indicePergunta, mudanca)}
                    onTipo={(tipo) => trocarTipo(indiceBloco, indicePergunta, tipo)}
                    onMarcarGeral={(marcada) => marcarGeral(indiceBloco, indicePergunta, marcada)}
                    onMover={(delta) =>
                      setRascunho((a) =>
                        a.map((b, i) =>
                          i !== indiceBloco
                            ? b
                            : {
                                ...b,
                                questions: mover(
                                  b.questions,
                                  indicePergunta,
                                  indicePergunta + delta,
                                ),
                              },
                        ),
                      )
                    }
                    onRemover={() =>
                      setRascunho((a) =>
                        a.map((b, i) =>
                          i !== indiceBloco
                            ? b
                            : {
                                ...b,
                                questions: b.questions.filter((_, j) => j !== indicePergunta),
                              },
                        ),
                      )
                    }
                    primeira={indicePergunta === 0}
                    ultima={indicePergunta === bloco.questions.length - 1}
                  />
                ))}

                {canWrite && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRascunho((a) =>
                        a.map((b, i) =>
                          i !== indiceBloco
                            ? b
                            : {
                                ...b,
                                questions: [
                                  ...b.questions,
                                  {
                                    prompt: "",
                                    type: "rating" as const,
                                    required: true,
                                    isOverall: false,
                                    options: ESCALA_PADRAO,
                                  },
                                ],
                              },
                        ),
                      )
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Adicionar pergunta
                  </Button>
                )}
              </div>
            </div>
          ))}

          {canWrite && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setRascunho((a) => [
                  ...a,
                  {
                    title: "",
                    description: null,
                    questions: [
                      {
                        prompt: "",
                        type: "rating",
                        required: true,
                        isOverall: false,
                        options: ESCALA_PADRAO,
                      },
                    ],
                  },
                ])
              }
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Adicionar bloco
            </Button>
          )}
        </fieldset>

        {erro && (
          <p role="alert" className="text-destructive text-sm">
            {erro}
          </p>
        )}
        {salvo && !erro && (
          <p role="status" className="text-muted-foreground text-sm">
            Perguntas salvas.
          </p>
        )}

        {canWrite && (
          <Button onClick={salvar} disabled={pendente}>
            {pendente ? "Salvando…" : "Salvar perguntas"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function PerguntaEditor({
  pergunta,
  canWrite,
  onChange,
  onTipo,
  onMarcarGeral,
  onMover,
  onRemover,
  primeira,
  ultima,
}: {
  pergunta: EvaluationQuestionInput;
  canWrite: boolean;
  onChange: (mudanca: Partial<EvaluationQuestionInput>) => void;
  onTipo: (tipo: EvaluationQuestionType) => void;
  /** Marca ESTA como a geral e desmarca todas as outras do formulário. */
  onMarcarGeral: (marcada: boolean) => void;
  onMover: (delta: number) => void;
  onRemover: () => void;
  primeira: boolean;
  ultima: boolean;
}) {
  const temOpcoes = (OPTION_BEARING_TYPES as readonly string[]).includes(pergunta.type);

  return (
    <div className="border-border/60 bg-muted/30 space-y-3 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-3">
          <Input
            value={pergunta.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            placeholder="Enunciado da pergunta"
            aria-label="Enunciado da pergunta"
          />

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select
                value={pergunta.type}
                onChange={(e) => onTipo(e.target.value as EvaluationQuestionType)}
                className="w-44"
                aria-label="Tipo da pergunta"
              >
                {EVALUATION_QUESTION_TYPES.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {EVALUATION_QUESTION_TYPE_LABELS[tipo]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Resposta</Label>
              <Select
                value={pergunta.required ? "on" : "off"}
                onChange={(e) => onChange({ required: e.target.value === "on" })}
                className="w-36"
                aria-label="Obrigatoriedade da pergunta"
              >
                <option value="on">Obrigatória</option>
                <option value="off">Opcional</option>
              </Select>
            </div>

            {/* ⚠️ SÓ APARECE EM PERGUNTA DE NOTA (§34 do Prompt 3). Nos outros
                tipos a opção seria uma caixa que o banco recusa — e oferecer o
                controle para depois dizer "não" é pior que não oferecer.

                ⚠️ E MARCAR AQUI DESMARCA A ANTERIOR, pelo `onMarcarGeral` do
                pai. Só uma pergunta pode ser a geral em todo o formulário, e
                deixar duas marcadas para o salvamento reclamar depois faria a
                pessoa caçar qual das doze desmarcar. */}
            {pergunta.type === "rating" && (
              <div className="space-y-1">
                <Label className="text-xs">Avaliação geral</Label>
                <Select
                  value={pergunta.isOverall ? "on" : "off"}
                  onChange={(e) => onMarcarGeral(e.target.value === "on")}
                  className="w-44"
                  aria-label="Esta é a pergunta de avaliação geral do evento"
                >
                  <option value="off">Pergunta comum</option>
                  <option value="on">É a nota geral</option>
                </Select>
              </div>
            )}

            <p className="text-muted-foreground max-w-sm flex-1 text-xs">
              {EVALUATION_QUESTION_TYPE_HELP[pergunta.type]}
              {pergunta.isOverall && (
                <>
                  {" "}
                  <strong>
                    É esta a nota que vira a &ldquo;Nota média geral&rdquo; em Resultados, e é por
                    ela que os filtros de nota funcionam.
                  </strong>
                </>
              )}
            </p>
          </div>
        </div>

        {canWrite && (
          <div className="flex flex-col gap-1">
            <BotaoIcone
              label="Mover pergunta para cima"
              onClick={() => onMover(-1)}
              disabled={primeira}
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </BotaoIcone>
            <BotaoIcone
              label="Mover pergunta para baixo"
              onClick={() => onMover(1)}
              disabled={ultima}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </BotaoIcone>
            <BotaoIcone label="Remover pergunta" onClick={onRemover}>
              <Trash2 className="text-destructive h-4 w-4" aria-hidden="true" />
            </BotaoIcone>
          </div>
        )}
      </div>

      {temOpcoes && (
        <div className="space-y-2 pl-1">
          <Label className="text-xs">Alternativas</Label>
          {pergunta.options.map((opcao, indice) => (
            <div key={indice} className="flex items-center gap-2">
              <Input
                value={opcao.label}
                onChange={(e) =>
                  onChange({
                    options: pergunta.options.map((o, i) =>
                      i === indice ? { ...o, label: e.target.value } : o,
                    ),
                  })
                }
                placeholder="Texto da alternativa"
                aria-label={`Texto da alternativa ${indice + 1}`}
                className="flex-1"
              />
              {/* ⚠️ O VALOR SÓ APARECE EM PERGUNTA DE NOTA (§5). Nas outras ele
                  seria um campo que não significa nada — e quem o preenchesse
                  criaria um número que a apuração do Prompt 3 somaria sem que
                  ninguém tivesse pedido. */}
              {pergunta.type === "rating" && (
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={opcao.value ?? ""}
                  onChange={(e) =>
                    onChange({
                      options: pergunta.options.map((o, i) =>
                        i === indice
                          ? { ...o, value: e.target.value === "" ? null : Number(e.target.value) }
                          : o,
                      ),
                    })
                  }
                  aria-label={`Valor da alternativa ${indice + 1}`}
                  className="w-20"
                />
              )}
              {canWrite && (
                <BotaoIcone
                  label={`Remover alternativa ${indice + 1}`}
                  onClick={() =>
                    onChange({ options: pergunta.options.filter((_, i) => i !== indice) })
                  }
                >
                  <Trash2 className="text-destructive h-4 w-4" aria-hidden="true" />
                </BotaoIcone>
              )}
            </div>
          ))}
          {canWrite && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  options: [
                    ...pergunta.options,
                    { label: "", value: pergunta.type === "rating" ? 0 : null },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Alternativa
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ⚠️ O NOME ACESSÍVEL VEM DE `aria-label`, e não do ícone. Um botão cujo único
 * conteúdo é um SVG decorativo (`aria-hidden`) é anunciado como "botão" e nada
 * mais — e uma coluna de seis desses seria ilegível em leitor de tela.
 */
function BotaoIcone({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-7 p-0"
    >
      {children}
    </Button>
  );
}
