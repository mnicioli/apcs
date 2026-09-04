"use client";

import { Copy, Trash2 } from "lucide-react";
import {
  FLOW_ACTION_KEYS,
  flowActionDefinition,
  isFlowActionKey,
} from "@/modules/flow/flow.actions.registry";
import { alternativas } from "@/modules/flow/flow.builder";
import { FLOW_NODE_TYPE_LABELS } from "@/modules/flow/flow.labels";
import {
  CONDITION_OPERATORS,
  HANDOFF_PRIORITIES,
  QUESTION_KINDS,
  questionNeedsOptions,
  type ConditionOperator,
  type QuestionKind,
} from "@/modules/flow/flow.schema";
import type { AttendanceTeam, FlowNode, FlowTransition } from "@/modules/flow/flow.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * ÁREA 4 — as propriedades do que está selecionado.
 *
 * ⚠️ ESTE PAINEL NÃO SALVA. Ele avisa o Builder ("isto mudou") e o Builder
 * decide quando gravar — que é o auto save do §14, com espera. Um `save` a cada
 * tecla digitada mandaria uma consulta por letra do texto da mensagem.
 *
 * ⚠️ E ELE NÃO FALA "NODE", "TRANSITION" NEM "STATE MACHINE". O §0 do Prompt 2
 * é explícito: para quem usa, isto é um desenho de conversa. Os rótulos daqui
 * são "Etapa", "Ligação", "Pergunta", "Alternativas" — o vocabulário técnico
 * fica no código, onde ele serve para alguma coisa.
 */

const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  buttons: "Botões",
  list: "Lista",
  free_text: "Texto livre",
  number: "Número",
  yes_no: "Sim / Não",
};

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "é igual a",
  neq: "é diferente de",
  contains: "contém",
  gt: "é maior que",
  lt: "é menor que",
};

const PRIORITY_LABELS = { low: "Baixa", normal: "Normal", high: "Alta" } as const;

export function NodeInspector({
  node,
  transition,
  sourceNode,
  teams,
  readOnly,
  onNodeChange,
  onTransitionChange,
  onDuplicate,
  onDelete,
}: {
  node: FlowNode | null;
  transition: FlowTransition | null;
  /** O nó de onde a seta selecionada sai — para mostrar as alternativas dele. */
  sourceNode: FlowNode | null;
  teams: AttendanceTeam[];
  readOnly: boolean;
  onNodeChange: (patch: Partial<Pick<FlowNode, "name" | "key" | "configuration">>) => void;
  onTransitionChange: (
    patch: Partial<Pick<FlowTransition, "condition" | "label" | "priority">>,
  ) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  if (transition) {
    return (
      <TransitionPanel
        transition={transition}
        sourceNode={sourceNode}
        readOnly={readOnly}
        onChange={onTransitionChange}
        onDelete={onDelete}
      />
    );
  }

  if (!node) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Clique em uma etapa ou em uma ligação do desenho para ver as propriedades dela.
      </p>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{FLOW_NODE_TYPE_LABELS[node.type]}</p>
          {node.isStart && <p className="text-primary text-xs">▶ Início do fluxo</p>}
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={onDuplicate} title="Duplicar etapa">
              <Copy className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Duplicar etapa</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete} title="Excluir etapa">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Excluir etapa</span>
            </Button>
          </div>
        )}
      </div>

      <Campo label="Nome">
        <Input
          value={node.name}
          disabled={readOnly}
          maxLength={120}
          onChange={(e) => onNodeChange({ name: e.target.value })}
        />
      </Campo>

      {/* ⚠️ A CHAVE FICA VISÍVEL E EDITÁVEL, mas depois do nome e com a
          explicação embaixo. Ela é o que as condições usam (§10) e o que sobrevive
          à troca de rótulo — esconder faria a pessoa não entender por que a seta
          continuou funcionando depois de ela renomear a alternativa. */}
      <Campo
        label="Identificação"
        ajuda="Usada nas regras do fluxo. Mude o nome à vontade; mudar isto pode soltar ligações."
      >
        <Input
          value={node.key}
          disabled={readOnly}
          className="font-mono text-xs"
          onChange={(e) => onNodeChange({ key: e.target.value.toUpperCase() })}
        />
      </Campo>

      {node.type === "message" && (
        <MessageFields node={node} readOnly={readOnly} onChange={onNodeChange} />
      )}
      {node.type === "question" && (
        <QuestionFields node={node} readOnly={readOnly} onChange={onNodeChange} />
      )}
      {node.type === "condition" && (
        <Campo label="Informação avaliada" ajuda="O que as ligações que saem daqui vão comparar.">
          <Input
            value={texto(node, "variable")}
            disabled={readOnly}
            className="font-mono text-xs"
            onChange={(e) =>
              onChangeConfig(node, onNodeChange, { variable: e.target.value.toLowerCase() })
            }
          />
        </Campo>
      )}
      {node.type === "action" && (
        <ActionFields node={node} readOnly={readOnly} onChange={onNodeChange} />
      )}
      {node.type === "attendant" && (
        <AttendantFields node={node} teams={teams} readOnly={readOnly} onChange={onNodeChange} />
      )}
      {node.type === "end" && (
        <Campo label="Mensagem de despedida" ajuda="Opcional. Em branco, o fluxo apenas encerra.">
          <Textarea
            rows={3}
            value={texto(node, "message")}
            disabled={readOnly}
            onChange={(e) => onChangeConfig(node, onNodeChange, { message: e.target.value })}
          />
        </Campo>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mensagem (§7)                                                              */
/* -------------------------------------------------------------------------- */

function MessageFields({
  node,
  readOnly,
  onChange,
}: {
  node: FlowNode;
  readOnly: boolean;
  onChange: (patch: { configuration: Record<string, unknown> }) => void;
}) {
  return (
    <>
      <Campo
        label="Texto"
        ajuda="Use {{nome}} para inserir algo que a conversa já coletou."
        obrigatorio
      >
        <Textarea
          rows={5}
          value={texto(node, "text")}
          disabled={readOnly}
          maxLength={1000}
          onChange={(e) => onChangeConfig(node, onChange, { text: e.target.value })}
        />
      </Campo>

      <Campo
        label="Imagem (endereço)"
        ajuda="Opcional. Cole o endereço de um material já publicado."
      >
        <Input
          value={texto(node, "imageUrl")}
          disabled={readOnly}
          onChange={(e) => onChangeConfig(node, onChange, { imageUrl: e.target.value })}
        />
      </Campo>

      <Campo label="PDF (endereço)" ajuda="Opcional.">
        <Input
          value={texto(node, "pdfUrl")}
          disabled={readOnly}
          onChange={(e) => onChangeConfig(node, onChange, { pdfUrl: e.target.value })}
        />
      </Campo>

      <Campo label="Esperar antes de enviar" ajuda="Em segundos. Zero envia junto com a anterior.">
        <Input
          type="number"
          min={0}
          max={60}
          value={numero(node, "delaySeconds")}
          disabled={readOnly}
          onChange={(e) =>
            onChangeConfig(node, onChange, { delaySeconds: Number(e.target.value) || 0 })
          }
        />
      </Campo>

      {/* ⚠️ "DESLIGADA" É DIFERENTE DE "APAGADA", e o texto de ajuda diz isso.
          Sem a frase, quem desmarca a caixa não sabe se o fluxo trava ali. */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={node.configuration.enabled !== false}
          disabled={readOnly}
          onChange={(e) => onChangeConfig(node, onChange, { enabled: e.target.checked })}
        />
        <span>
          Mensagem ativa
          <span className="text-muted-foreground block text-xs">
            Desmarcada, esta etapa é pulada — a conversa segue adiante sem receber o texto.
          </span>
        </span>
      </label>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Pergunta (§8, §9)                                                          */
/* -------------------------------------------------------------------------- */

function QuestionFields({
  node,
  readOnly,
  onChange,
}: {
  node: FlowNode;
  readOnly: boolean;
  onChange: (patch: { configuration: Record<string, unknown> }) => void;
}) {
  const kind = (texto(node, "kind") || "buttons") as QuestionKind;
  const opcoes = alternativas(node.configuration);

  function trocarOpcao(indice: number, campo: "key" | "label", valor: string) {
    const novas = opcoes.map((o, i) =>
      i === indice ? { ...o, [campo]: campo === "key" ? valor.toUpperCase() : valor } : o,
    );
    onChangeConfig(node, onChange, { options: novas });
  }

  return (
    <>
      <Campo label="Pergunta" obrigatorio>
        <Textarea
          rows={3}
          value={texto(node, "text")}
          disabled={readOnly}
          maxLength={1000}
          onChange={(e) => onChangeConfig(node, onChange, { text: e.target.value })}
        />
      </Campo>

      <Campo label="Como a pessoa responde">
        <Select
          value={kind}
          disabled={readOnly}
          onChange={(e) => onChangeConfig(node, onChange, { kind: e.target.value })}
        >
          {QUESTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {QUESTION_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Campo>

      <Campo
        label="Guardar a resposta como"
        ajuda="O nome pelo qual as etapas seguintes vão se referir a esta resposta."
        obrigatorio
      >
        <Input
          value={texto(node, "variable")}
          disabled={readOnly}
          className="font-mono text-xs"
          onChange={(e) =>
            onChangeConfig(node, onChange, { variable: e.target.value.toLowerCase() })
          }
        />
      </Campo>

      {kind === "yes_no" && (
        <p className="text-muted-foreground text-xs">
          As alternativas <strong>Sim</strong> e <strong>Não</strong> são fixas — elas já aparecem
          no desenho como duas saídas.
        </p>
      )}

      {(kind === "free_text" || kind === "number") && (
        <p className="text-muted-foreground text-xs">
          A resposta é guardada como a pessoa escrever, e a conversa segue por uma única saída. Para
          separar caminhos depois disso, use uma etapa de <strong>Condição</strong>.
        </p>
      )}

      {questionNeedsOptions(kind) && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Alternativas</p>
          {/* ⚠️ CADA ALTERNATIVA TEM RÓTULO **E** IDENTIFICAÇÃO, lado a lado, e é
              aqui que o §9 fica visível para quem desenha: o texto muda, a
              identificação fica. Escondê-la faria a pessoa não entender por que
              renomear "Eventos" para "Eventos e inscrições" não quebrou nada. */}
          {opcoes.map((opcao, indice) => (
            <div key={indice} className="flex gap-2">
              <Input
                value={opcao.label}
                placeholder="O que a pessoa lê"
                disabled={readOnly}
                onChange={(e) => trocarOpcao(indice, "label", e.target.value)}
              />
              <Input
                value={opcao.key}
                placeholder="IDENTIFICACAO"
                disabled={readOnly}
                className="w-40 font-mono text-xs"
                onChange={(e) => trocarOpcao(indice, "key", e.target.value)}
              />
              {!readOnly && opcoes.length > 2 && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Remover alternativa"
                  onClick={() =>
                    onChangeConfig(node, onChange, {
                      options: opcoes.filter((_, i) => i !== indice),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Remover alternativa</span>
                </Button>
              )}
            </div>
          ))}

          {!readOnly && opcoes.length < 10 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChangeConfig(node, onChange, {
                  options: [...opcoes, { key: `OPCAO_${opcoes.length + 1}`, label: "" }],
                })
              }
            >
              Adicionar alternativa
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Ação (§11)                                                                 */
/* -------------------------------------------------------------------------- */

function ActionFields({
  node,
  readOnly,
  onChange,
}: {
  node: FlowNode;
  readOnly: boolean;
  onChange: (patch: { configuration: Record<string, unknown> }) => void;
}) {
  const chave = texto(node, "actionKey");
  const definicao = isFlowActionKey(chave) ? flowActionDefinition(chave) : null;
  const argumentos = (node.configuration.arguments ?? {}) as Record<string, string>;

  return (
    <>
      <Campo label="O que fazer" obrigatorio>
        <Select
          value={chave}
          disabled={readOnly}
          onChange={(e) =>
            onChangeConfig(node, onChange, { actionKey: e.target.value, arguments: {} })
          }
        >
          {FLOW_ACTION_KEYS.map((k) => (
            <option key={k} value={k}>
              {flowActionDefinition(k).label}
            </option>
          ))}
        </Select>
      </Campo>

      {definicao && <p className="text-muted-foreground text-xs">{definicao.description}</p>}

      {/* Cada parâmetro da ação sai de uma informação já coletada na conversa. */}
      {definicao?.parameters.map((parametro) => (
        <Campo
          key={parametro.name}
          label={parametro.label}
          obrigatorio={parametro.required}
          ajuda="O nome da informação coletada em uma etapa anterior."
        >
          <Input
            value={argumentos[parametro.name] ?? ""}
            disabled={readOnly}
            className="font-mono text-xs"
            onChange={(e) =>
              onChangeConfig(node, onChange, {
                arguments: { ...argumentos, [parametro.name]: e.target.value.toLowerCase() },
              })
            }
          />
        </Campo>
      ))}

      {definicao && definicao.produces.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Esta ação devolve: <span className="font-mono">{definicao.produces.join(", ")}</span>. As
          etapas seguintes podem usar esses nomes numa condição.
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Transferência (§12)                                                        */
/* -------------------------------------------------------------------------- */

function AttendantFields({
  node,
  teams,
  readOnly,
  onChange,
}: {
  node: FlowNode;
  teams: AttendanceTeam[];
  readOnly: boolean;
  onChange: (patch: { configuration: Record<string, unknown> }) => void;
}) {
  const ativos = teams.filter((t) => t.status === "active");
  const escolhido = texto(node, "teamKey");
  const time = teams.find((t) => t.key === escolhido);

  return (
    <>
      <Campo label="Time que vai atender" obrigatorio>
        <Select
          value={escolhido}
          disabled={readOnly}
          onChange={(e) => onChangeConfig(node, onChange, { teamKey: e.target.value })}
        >
          <option value="">Escolha um time…</option>
          {ativos.map((t) => (
            <option key={t.id} value={t.key}>
              {t.name}
            </option>
          ))}
        </Select>
      </Campo>

      {/* ⚠️ TIME SEM NINGUÉM É UM AVISO NA HORA, e não uma descoberta na
          publicação. A conversa chegaria numa fila que ninguém abre. */}
      {time && time.memberCount === 0 && (
        <p className="text-destructive text-xs">
          Este time não tem ninguém. As conversas transferidas para ele vão ficar esperando.
        </p>
      )}

      <Campo label="Mensagem ao transferir" ajuda="Opcional. Em branco, usa o texto padrão.">
        <Textarea
          rows={2}
          value={texto(node, "message")}
          disabled={readOnly}
          onChange={(e) => onChangeConfig(node, onChange, { message: e.target.value })}
        />
      </Campo>

      <Campo label="Prazo para alguém assumir" ajuda="Em minutos. Opcional.">
        <Input
          type="number"
          min={1}
          value={node.configuration.slaMinutes === undefined ? "" : numero(node, "slaMinutes")}
          disabled={readOnly}
          onChange={(e) =>
            onChangeConfig(node, onChange, {
              slaMinutes: e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
        />
      </Campo>

      <Campo label="Prioridade na fila">
        <Select
          value={texto(node, "priority") || "normal"}
          disabled={readOnly}
          onChange={(e) => onChangeConfig(node, onChange, { priority: e.target.value })}
        >
          {HANDOFF_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
      </Campo>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* A ligação (§6, §10)                                                        */
/* -------------------------------------------------------------------------- */

function TransitionPanel({
  transition,
  sourceNode,
  readOnly,
  onChange,
  onDelete,
}: {
  transition: FlowTransition;
  sourceNode: FlowNode | null;
  readOnly: boolean;
  onChange: (patch: Partial<Pick<FlowTransition, "condition" | "label" | "priority">>) => void;
  onDelete: () => void;
}) {
  const condicao = transition.condition;

  /**
   * ⚠️ A CONDIÇÃO DE UMA SAÍDA DE PERGUNTA NÃO SE EDITA AQUI, e é de propósito.
   * Ela vem da BOLINHA de onde a seta saiu (§9) — mudá-la neste painel deixaria
   * a seta apontando para uma alternativa e saindo de outra, o que é um desenho
   * que mente. Para mandar "Eventos" para outro lugar, arrasta-se a ponta da
   * seta na bolinha certa.
   */
  const presaAAlternativa = condicao.type === "answer";

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">Ligação</p>
        {!readOnly && (
          <Button variant="ghost" size="sm" onClick={onDelete} title="Excluir ligação">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Excluir ligação</span>
          </Button>
        )}
      </div>

      {presaAAlternativa ? (
        <p className="text-muted-foreground text-sm">
          Esta ligação sai da alternativa{" "}
          <span className="font-mono text-xs">{condicao.optionKey}</span>
          {sourceNode ? ` de "${sourceNode.name}"` : ""}. Para mudar a alternativa, arraste a ponta
          da seta até o outro ponto de saída.
        </p>
      ) : (
        <>
          <Campo label="Quando seguir por aqui">
            <Select
              value={condicao.type}
              disabled={readOnly}
              onChange={(e) =>
                onChange({
                  condition:
                    e.target.value === "always"
                      ? { type: "always" }
                      : {
                          type: "variable",
                          name: sourceNode
                            ? texto(sourceNode, "variable") || "resposta"
                            : "resposta",
                          operator: "eq",
                          value: "",
                        },
                })
              }
            >
              <option value="always">Sempre</option>
              <option value="variable">Quando uma informação bater</option>
            </Select>
          </Campo>

          {condicao.type === "variable" && (
            <div className="space-y-2">
              <Campo label="Informação">
                <Input
                  value={condicao.name}
                  disabled={readOnly}
                  className="font-mono text-xs"
                  onChange={(e) =>
                    onChange({
                      condition: { ...condicao, name: e.target.value.toLowerCase() },
                    })
                  }
                />
              </Campo>
              <Campo label="Comparação">
                <Select
                  value={condicao.operator}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange({
                      condition: { ...condicao, operator: e.target.value as ConditionOperator },
                    })
                  }
                >
                  {CONDITION_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_LABELS[op]}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo label="Valor">
                <Input
                  value={condicao.value}
                  disabled={readOnly}
                  onChange={(e) => onChange({ condition: { ...condicao, value: e.target.value } })}
                />
              </Campo>
              {(condicao.operator === "gt" || condicao.operator === "lt") && (
                <p className="text-muted-foreground text-xs">
                  Comparação numérica. Se a informação não for um número, esta ligação não é
                  seguida.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <Campo label="Texto na seta" ajuda="Opcional. Só para deixar o desenho mais legível.">
        <Input
          value={transition.label ?? ""}
          disabled={readOnly}
          maxLength={120}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </Campo>

      {/* ⚠️ A ORDEM DECIDE QUANDO DUAS CONDIÇÕES CASAM AO MESMO TEMPO. Sem este
          campo, o desempate seria invisível — e a pessoa veria o fluxo escolher
          "o outro caminho" sem nada explicando por quê. */}
      <Campo label="Ordem" ajuda="Quando mais de uma ligação puder ser seguida, a menor vence.">
        <Input
          type="number"
          min={0}
          max={999}
          value={transition.priority}
          disabled={readOnly}
          onChange={(e) => onChange({ priority: Number(e.target.value) || 0 })}
        />
      </Campo>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tijolos                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ O RÓTULO ENVOLVE O CONTROLE, em vez de apontar para ele com `htmlFor`.
 *
 * A versão com `htmlFor` exigiria passar o `id` para dentro de cada `Input`,
 * `Select` e `Textarea` deste arquivo — e a tentação, num painel com trinta
 * campos, é resolver isso com uma `<div id={id}>` em volta. Aquilo COMPILA,
 * parece certo e não associa nada: o leitor de tela anuncia o campo sem nome, e
 * clicar no rótulo não foca o controle.
 *
 * O aninhamento associa por construção. Por isso a ajuda e o asterisco são
 * `<span className="block">` e não `<p>`: parágrafo dentro de rótulo é HTML
 * inválido.
 */
function Campo({
  label,
  ajuda,
  obrigatorio,
  children,
}: {
  label: string;
  ajuda?: string;
  obrigatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Label className="block space-y-1.5">
      <span className="block">
        {label}
        {obrigatorio && (
          <>
            {" "}
            <span aria-hidden="true">*</span>
            <span className="sr-only">(obrigatório)</span>
          </>
        )}
      </span>
      {children}
      {ajuda && <span className="text-muted-foreground block text-xs font-normal">{ajuda}</span>}
    </Label>
  );
}

function texto(node: FlowNode, campo: string): string {
  const valor = node.configuration[campo];
  return typeof valor === "string" ? valor : "";
}

function numero(node: FlowNode, campo: string): number {
  const valor = node.configuration[campo];
  return typeof valor === "number" ? valor : 0;
}

/** Aplica um pedaço da configuração sem perder o resto dela. */
function onChangeConfig(
  node: FlowNode,
  onChange: (patch: { configuration: Record<string, unknown> }) => void,
  patch: Record<string, unknown>,
) {
  onChange({ configuration: { ...node.configuration, ...patch } });
}
