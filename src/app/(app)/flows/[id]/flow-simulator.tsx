"use client";

import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import { flowActionDefinition, isFlowActionKey } from "@/modules/flow/flow.actions.registry";
import {
  advanceFlow,
  initialFlowState,
  type FlowEffect,
  type FlowEngineState,
} from "@/modules/flow/flow.engine";
import { readFlowIntent, unavailableFlowIntent, withFlowIntent } from "@/modules/flow/flow.intent";
import { BUSINESS_HOURS_VARIABLE } from "@/modules/flow/flow.hours";
import { matchOption, questionOptions } from "@/modules/flow/flow.node-config";
import { resolveTransition } from "@/modules/flow/flow.transitions";
import { FLOW_RUN_STATUS_LABELS } from "@/modules/flow/flow.labels";
import { APCS_INTENTS } from "@/modules/intelligence/intent.types";
import type { ConfidenceThresholds } from "@/modules/intelligence/intent.types";
import type {
  AttendanceTeam,
  CompiledFlowNode,
  FlowActionStatus,
  FlowDefinition,
  FlowNode,
  FlowTransition,
  FlowVariables,
} from "@/modules/flow/flow.types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * TESTAR FLUXO — o simulador completo dos §11 a §16 do Prompt 5.
 *
 * ============================================================================
 * ⚠️ ELE RODA O MOTOR DE VERDADE. É a propriedade que dá valor a tudo o mais.
 * ============================================================================
 *
 * `advanceFlow` é exatamente a função que atende no WhatsApp; `readFlowIntent` e
 * `withFlowIntent` são exatamente as que a camada de runtime usa para injetar a
 * leitura da IA; `resolveTransition` é exatamente a que escolhe a seta.
 *
 * Um simulador que reimplementasse qualquer um dos três seria pior que nenhum:
 * ele concordaria com o desenho e discordaria da produção, e a pessoa
 * homologaria um fluxo que atende diferente.
 *
 * ============================================================================
 * ⚠️ §12 — O QUE ELE NÃO TOCA, E COMO ISSO É GARANTIDO
 * ============================================================================
 *
 * Nada aqui envia WhatsApp, cria ticket, transfere conversa, altera contato nem
 * registra consentimento. E a garantia não é disciplina: é o fato de este
 * arquivo ser um COMPONENTE DE CLIENTE que importa apenas módulos puros de
 * `src/modules/`. Ele não tem cliente de banco, não tem `server-only`, não tem
 * server action. Não existe caminho a partir daqui para o mundo real — o pior
 * que pode acontecer é a tela mostrar a coisa errada.
 *
 * As ações de negócio não rodam: o simulador mostra qual SERIA executada e
 * deixa quem testa escolher o desfecho (§16 do Prompt 3). Isso substitui o
 * "sempre deu certo" de antes, que escondia metade dos caminhos do desenho.
 */

interface Linha {
  de: "bot" | "pessoa" | "sistema";
  texto: string;
  opcoes?: { key: string; label: string }[];
}

/** §16. O retrato de um passo, para o painel de depuração. */
interface PassoDebug {
  nodeAnterior: string | null;
  nodeAtual: string | null;
  transicao: string | null;
  resposta: string | null;
  acao: string | null;
  intent: string | null;
  confidence: number | null;
  banda: string | null;
}

/** §13. O que se sabe sobre quem está do outro lado, na simulação. */
interface Persona {
  nome: string;
  telefone: string;
  tipo: string;
  cidade: string;
  dentroDoHorario: boolean;
}

const PERSONA_PADRAO: Persona = {
  nome: "João",
  telefone: "5519991234567",
  tipo: "Associado",
  cidade: "Campinas",
  dentroDoHorario: true,
};

/**
 * §13. A persona vira VARIÁVEIS DE CONTEXTO, e é assim que o desenho a usa:
 * `Olá {{nome}}!` funciona no simulador exatamente como funcionará em produção.
 *
 * ⚠️ OS NOMES SÃO OS QUE O PROMPT 4 JÁ USA. `nome`, `telefone`, `cidade` são as
 * variáveis que o desenhador escreve nas mensagens; `sys_horario_atendimento` é
 * a do §34. Inventar nomes só para o simulador faria o teste passar e a
 * produção falhar — que é o pior defeito que um simulador pode ter.
 */
function variaveisDaPersona(persona: Persona): FlowVariables {
  return {
    nome: persona.nome.trim(),
    telefone: persona.telefone.trim(),
    tipo: persona.tipo.trim(),
    cidade: persona.cidade.trim(),
    [BUSINESS_HOURS_VARIABLE]: persona.dentroDoHorario ? "sim" : "nao",
  };
}

export function FlowSimulator({
  nodes,
  transitions,
  teams,
  thresholds,
  onClose,
}: {
  nodes: FlowNode[];
  transitions: FlowTransition[];
  teams: AttendanceTeam[];
  /**
   * §14. As barras de confiança CONFIGURADAS, vindas do servidor.
   *
   * ⚠️ NÃO SÃO AS CONSTANTES DO CÓDIGO. Se o simulador usasse os padrões
   * enquanto a APCS baixou a barra para 0,80, ele mostraria "média" onde a
   * produção decidiria "alta" — e o fluxo homologado atenderia por outro
   * caminho. Ver `loadFlowConfidenceThresholds`.
   */
  thresholds: ConfidenceThresholds;
  onClose: () => void;
}) {
  /**
   * ⚠️ O RETRATO É MONTADO AQUI, A PARTIR DO RASCUNHO — e não lido do banco.
   *
   * `definition` só existe depois de publicar (§22), e o ponto de testar é
   * justamente experimentar ANTES. Esta compilação espelha
   * `compile_flow_definition()`, inclusive na ordenação das transições, que é
   * parte do contrato do motor.
   */
  const definition = useMemo<FlowDefinition>(
    () => ({
      schema: 1,
      startNodeId: nodes.find((n) => n.isStart)?.id ?? null,
      nodes: nodes.map(
        (n): CompiledFlowNode => ({
          id: n.id,
          key: n.key,
          type: n.type,
          name: n.name,
          isStart: n.isStart,
          configuration: n.configuration,
          position: n.position,
          metadata: n.metadata,
        }),
      ),
      transitions: [...transitions]
        .sort(
          (a, b) =>
            a.sourceNodeId.localeCompare(b.sourceNodeId) ||
            a.priority - b.priority ||
            a.id.localeCompare(b.id),
        )
        .map((t) => ({
          id: t.id,
          sourceNodeId: t.sourceNodeId,
          targetNodeId: t.targetNodeId,
          condition: t.condition,
          label: t.label,
          priority: t.priority,
        })),
    }),
    [nodes, transitions],
  );

  const chaveDoNo = useMemo(
    () => new Map(definition.nodes.map((n) => [n.id, n.key])),
    [definition],
  );

  const [estado, setEstado] = useState<FlowEngineState | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [entrada, setEntrada] = useState("");
  const [passo, setPasso] = useState<PassoDebug | null>(null);
  const [persona, setPersona] = useState<Persona>(PERSONA_PADRAO);
  const [mostrarPersona, setMostrarPersona] = useState(false);
  const [mostrarIA, setMostrarIA] = useState(false);

  /** §15. A leitura que o teste quer FINGIR que a IA devolveu. */
  const [intentSimulado, setIntentSimulado] = useState<string>(APCS_INTENTS[0]);
  const [confiancaSimulada, setConfiancaSimulada] = useState(0.96);
  const [assuntoSimulado, setAssuntoSimulado] = useState("");

  /**
   * §16. O desfecho que a ação de negócio deve fingir.
   *
   * ⚠️ ANTES ERA SEMPRE `success`, E ISSO ESCONDIA METADE DO DESENHO. Um fluxo
   * bem feito tem três saídas de cada nó de ação — deu certo, não encontrei,
   * falhou — e o simulador só percorria uma. A pessoa homologava sem nunca ter
   * visto o que acontece quando a Bolsa não tem publicação vigente.
   *
   * ⚠️ E É UMA ESCOLHA, E NÃO UM SORTEIO. Um simulador que sorteasse desfechos
   * daria resultados diferentes para o mesmo desenho, e quem estivesse
   * conferindo não saberia se a diferença veio da mudança que acabou de fazer.
   */
  const [desfechoAcao, setDesfechoAcao] = useState<FlowActionStatus>("success");

  function registrarPasso(
    anterior: FlowEngineState | null,
    proximo: FlowEngineState,
    extra: Partial<PassoDebug>,
  ) {
    setPasso({
      nodeAnterior: anterior?.currentNodeId
        ? (chaveDoNo.get(anterior.currentNodeId) ?? null)
        : null,
      nodeAtual: proximo.currentNodeId ? (chaveDoNo.get(proximo.currentNodeId) ?? null) : null,
      transicao: null,
      resposta: null,
      acao: null,
      intent: proximo.variables["sys_intent"] ?? null,
      confidence: proximo.variables["sys_intent_confidence"]
        ? Number(proximo.variables["sys_intent_confidence"])
        : null,
      banda: proximo.variables["sys_intent_band"] ?? null,
      ...extra,
    });
  }

  function aplicar(
    resultado: { state: FlowEngineState; effects: FlowEffect[] },
    anterior: FlowEngineState | null,
    extra: Partial<PassoDebug> = {},
  ) {
    const novas: Linha[] = [];
    const proximo = resultado.state;
    let acaoVista: string | null = extra.acao ?? null;

    for (const efeito of resultado.effects) {
      switch (efeito.kind) {
        case "sendMessage":
          novas.push({ de: "bot", texto: efeito.text });
          if (efeito.imageUrl) novas.push({ de: "sistema", texto: `[imagem] ${efeito.imageUrl}` });
          if (efeito.pdfUrl) novas.push({ de: "sistema", texto: `[PDF] ${efeito.pdfUrl}` });
          break;

        case "askQuestion":
        case "repeatQuestion":
          novas.push({ de: "bot", texto: efeito.text, opcoes: efeito.options });
          break;

        case "assignTeam": {
          const time = teams.find((t) => t.key === efeito.teamKey);
          if (efeito.message) novas.push({ de: "bot", texto: efeito.message });
          novas.push({
            de: "sistema",
            texto:
              `Conversa transferida para ${time?.name ?? efeito.teamKey}` +
              (efeito.slaMinutes ? ` (prazo de ${efeito.slaMinutes} min)` : "") +
              ".",
          });
          break;
        }

        case "complete":
          if (efeito.message) novas.push({ de: "bot", texto: efeito.message });
          novas.push({ de: "sistema", texto: "Atendimento encerrado." });
          break;

        case "runAction": {
          const rotulo = isFlowActionKey(efeito.actionKey)
            ? flowActionDefinition(efeito.actionKey).label
            : efeito.actionKey;

          acaoVista = `${rotulo} → ${DESFECHO_LABELS[desfechoAcao]}`;

          novas.push({
            de: "sistema",
            texto:
              `Aqui o sistema faria: ${rotulo}. No teste a consulta não acontece — ` +
              `o desfecho escolhido é “${DESFECHO_LABELS[desfechoAcao]}”.`,
          });

          const retomada = advanceFlow(definition, resultado.state, {
            kind: "actionResult",
            status: desfechoAcao,
            // Sem variáveis: fingir que a Bolsa devolveu um endereço seria
            // inventar conteúdo, e o §12 é explícito que o simulador não toca
            // em dado real. O desenho que depender do valor mostra o `{{...}}`
            // vazio, que é a informação honesta.
            variables: {},
          });

          setLinhas((atuais) => [...atuais, ...novas]);
          aplicar(retomada, resultado.state, { ...extra, acao: acaoVista });
          return;
        }

        case "fail":
          novas.push({ de: "sistema", texto: explicarFalha(efeito.reason) });
          break;
      }
    }

    setLinhas((atuais) => [...atuais, ...novas]);
    setEstado(proximo);
    registrarPasso(anterior, proximo, { ...extra, acao: acaoVista });
  }

  function comecar() {
    setLinhas([]);
    setPasso(null);

    // §13. A persona entra ANTES do primeiro nó — é o que faz `{{nome}}` já
    // valer na mensagem de boas-vindas.
    const inicial: FlowEngineState = {
      ...initialFlowState(),
      variables: variaveisDaPersona(persona),
    };

    aplicar(advanceFlow(definition, inicial, { kind: "start" }), null);
  }

  /**
   * A seta que o motor seguiu.
   *
   * ⚠️ É A MESMA FUNÇÃO DO MOTOR (`resolveTransition`), com os MESMOS
   * argumentos — e não uma dedução a partir de origem e destino. A dedução
   * erraria quando duas setas ligam o mesmo par de nós com condições
   * diferentes, que é justamente o caso em que quem homologa mais precisa saber
   * qual foi.
   */
  function setaEscolhida(
    anterior: FlowEngineState,
    variaveis: FlowVariables,
    answerKey: string | null,
  ): string | null {
    if (!anterior.currentNodeId) return null;
    const seta = resolveTransition(definition, anterior.currentNodeId, variaveis, answerKey);
    if (!seta) return null;

    const origem = chaveDoNo.get(seta.sourceNodeId) ?? "?";
    const destino = chaveDoNo.get(seta.targetNodeId) ?? "?";
    return seta.label ? `${seta.label} (${origem} → ${destino})` : `${origem} → ${destino}`;
  }

  function responder(texto: string, leituraIA?: FlowVariables) {
    if (!estado || (texto.trim() === "" && !leituraIA)) return;

    setLinhas((atuais) => [...atuais, { de: "pessoa", texto }]);
    setEntrada("");

    const comIA: FlowEngineState = leituraIA
      ? { ...estado, variables: { ...estado.variables, ...leituraIA } }
      : estado;

    const noAtual = definition.nodes.find((n) => n.id === comIA.currentNodeId) ?? null;
    const escolhida = noAtual ? matchOption(texto, questionOptions(noAtual)) : null;

    aplicar(advanceFlow(definition, comIA, { kind: "reply", text: texto }), comIA, {
      resposta: escolhida ? escolhida.key : texto.trim() === "" ? "(vazia)" : "(texto livre)",
      transicao: setaEscolhida(comIA, comIA.variables, escolhida?.key ?? null),
    });
  }

  /**
   * §15. Manda a mensagem COM uma leitura de IA fabricada.
   *
   * ⚠️ ELA PASSA PELAS MESMAS FUNÇÕES DA PRODUÇÃO — `readFlowIntent` aplica as
   * barras configuradas e `withFlowIntent` grava as quatro variáveis. O que se
   * finge é só o que o MODELO teria dito; tudo depois disso é o caminho real.
   */
  function responderComIA() {
    const leitura =
      intentSimulado === "__indisponivel__"
        ? unavailableFlowIntent()
        : readFlowIntent(
            {
              intent: intentSimulado as (typeof APCS_INTENTS)[number],
              confidence: confiancaSimulada,
              subject: assuntoSimulado.trim() || null,
            },
            thresholds,
          );

    responder(entrada || "(mensagem de teste)", withFlowIntent({}, leitura));
  }

  const esperandoResposta = estado?.status === "waiting_reply";
  const acabou =
    estado !== null && ["completed", "failed", "handed_off", "cancelled"].includes(estado.status);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Testar fluxo"
      description="Uma conversa de mentira sobre o desenho atual — inclusive o que ainda não foi publicado. Nada é enviado, gravado nem transferido de verdade."
    >
      <div className="space-y-3">
        {definition.startNodeId === null ? (
          <p className="text-destructive text-sm">
            O desenho ainda não tem uma etapa inicial, então não há por onde a conversa começar.
          </p>
        ) : (
          <>
            {/* -------- §13. Quem está do outro lado -------- */}
            <div className="border-border rounded-md border">
              <button
                type="button"
                className="hover:bg-muted/40 flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium"
                onClick={() => setMostrarPersona((v) => !v)}
                aria-expanded={mostrarPersona}
              >
                <span>
                  Quem está conversando:{" "}
                  <span className="text-muted-foreground font-normal">
                    {persona.nome}, {persona.tipo}, {persona.cidade}
                    {persona.dentroDoHorario ? "" : " · fora do horário"}
                  </span>
                </span>
                <span aria-hidden="true">{mostrarPersona ? "−" : "+"}</span>
              </button>

              {mostrarPersona && (
                <div className="border-border grid gap-2 border-t p-3 sm:grid-cols-2">
                  <p className="text-muted-foreground col-span-full text-xs">
                    Estes valores viram variáveis do contexto. Um <code>{"{{nome}}"}</code> na
                    mensagem já mostra o que a pessoa vai ler.
                  </p>

                  <CampoPersona
                    id="sim-nome"
                    label="Nome"
                    value={persona.nome}
                    onChange={(nome) => setPersona((p) => ({ ...p, nome }))}
                  />
                  <CampoPersona
                    id="sim-telefone"
                    label="Telefone"
                    value={persona.telefone}
                    onChange={(telefone) => setPersona((p) => ({ ...p, telefone }))}
                  />
                  <CampoPersona
                    id="sim-tipo"
                    label="Tipo"
                    value={persona.tipo}
                    onChange={(tipo) => setPersona((p) => ({ ...p, tipo }))}
                  />
                  <CampoPersona
                    id="sim-cidade"
                    label="Cidade"
                    value={persona.cidade}
                    onChange={(cidade) => setPersona((p) => ({ ...p, cidade }))}
                  />

                  <label className="col-span-full flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={persona.dentroDoHorario}
                      onChange={(e) =>
                        setPersona((p) => ({ ...p, dentroDoHorario: e.target.checked }))
                      }
                    />
                    Dentro do horário de atendimento
                    <span className="text-muted-foreground text-xs">
                      (define <code>sys_horario_atendimento</code>)
                    </span>
                  </label>

                  <p className="text-muted-foreground col-span-full text-xs">
                    Mudanças aqui valem a partir do próximo “Recomeçar”.
                  </p>
                </div>
              )}
            </div>

            {/* -------- A conversa -------- */}
            <div className="border-border bg-muted/20 h-64 space-y-2 overflow-y-auto rounded-md border p-3">
              {linhas.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  Clique em “Iniciar conversa” para percorrer o fluxo.
                </p>
              )}

              {linhas.map((linha, i) => (
                <div key={i} className={linha.de === "pessoa" ? "flex justify-end" : ""}>
                  <div
                    className={
                      linha.de === "sistema"
                        ? "text-muted-foreground text-xs italic"
                        : linha.de === "pessoa"
                          ? "bg-primary text-primary-foreground max-w-[80%] rounded-lg rounded-br-none px-3 py-1.5 text-sm"
                          : "bg-card border-border max-w-[80%] rounded-lg rounded-tl-none border px-3 py-1.5 text-sm"
                    }
                  >
                    <p className="whitespace-pre-wrap">{linha.texto}</p>
                    {linha.opcoes && linha.opcoes.length > 0 && (
                      <ol className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                        {linha.opcoes.map((o, indice) => (
                          <li key={o.key}>
                            {indice + 1}. {o.label || o.key}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* -------- §16. O painel de depuração -------- */}
            {passo && (
              <dl className="border-border bg-muted/20 grid gap-x-4 gap-y-1 rounded-md border p-3 text-xs sm:grid-cols-2">
                <Linha16 termo="Etapa anterior" valor={passo.nodeAnterior} />
                <Linha16 termo="Etapa atual" valor={passo.nodeAtual} />
                <Linha16 termo="Resposta lida" valor={passo.resposta} />
                <Linha16 termo="Ligação seguida" valor={passo.transicao} />
                <Linha16 termo="Ação" valor={passo.acao} />
                <Linha16
                  termo="Intenção"
                  valor={
                    passo.intent
                      ? `${passo.intent}` +
                        (passo.confidence !== null ? ` · ${passo.confidence.toFixed(2)}` : "") +
                        (passo.banda ? ` · ${BANDA_LABELS[passo.banda] ?? passo.banda}` : "")
                      : null
                  }
                />
                {estado && Object.keys(estado.variables).length > 0 && (
                  <div className="col-span-full">
                    <dt className="text-muted-foreground">Variáveis</dt>
                    <dd className="font-mono break-all">
                      {Object.entries(estado.variables)
                        .map(([k, v]) => `${k}=${v || "∅"}`)
                        .join("  ")}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {estado && (
              <p className="text-muted-foreground text-xs">
                Motor: {FLOW_RUN_STATUS_LABELS[estado.status]} · nós percorridos:{" "}
                {estado.nodeExecutions}
              </p>
            )}

            {/* -------- §14. A resposta -------- */}
            <div className="flex gap-2">
              <Input
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    responder(entrada);
                  }
                }}
                placeholder={
                  esperandoResposta
                    ? "Responda como a pessoa responderia…"
                    : "A conversa não está aberta"
                }
                disabled={!esperandoResposta}
                aria-label="Resposta da pessoa"
              />
              <Button onClick={() => responder(entrada)} disabled={!esperandoResposta}>
                <Send className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Enviar</span>
              </Button>
            </div>

            {/* ⚠️ §14. OS CAMINHOS QUE NINGUÉM TESTA À MÃO. Responder vazio ou
                com bobagem é o que mais acontece no WhatsApp de verdade, e é o
                que menos se testa — dá trabalho digitar errado de propósito. */}
            <div className="flex flex-wrap gap-2 text-xs">
              <Button
                variant="outline"
                size="sm"
                disabled={!esperandoResposta}
                onClick={() => responder("")}
              >
                Resposta vazia
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!esperandoResposta}
                onClick={() => responder("asdf")}
              >
                Resposta inválida
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!esperandoResposta}
                onClick={() => setMostrarIA((v) => !v)}
                aria-expanded={mostrarIA}
              >
                Simular IA
              </Button>

              <label className="ml-auto flex items-center gap-1">
                <span className="text-muted-foreground">Ações respondem:</span>
                <select
                  className="border-border bg-background rounded-md border px-2 py-1"
                  value={desfechoAcao}
                  onChange={(e) => setDesfechoAcao(e.target.value as FlowActionStatus)}
                  aria-label="Desfecho das ações no teste"
                >
                  <option value="success">deu certo</option>
                  <option value="not_found">não encontrei</option>
                  <option value="failure">falhou</option>
                </select>
              </label>
            </div>

            {/* -------- §15. Simular IA -------- */}
            {mostrarIA && (
              <div className="border-border grid gap-2 rounded-md border p-3 sm:grid-cols-3">
                <p className="text-muted-foreground col-span-full text-xs">
                  Finge o que a IA teria entendido da mensagem digitada acima. A leitura passa pelas
                  MESMAS funções da produção — inclusive as barras de confiança configuradas (alta ≥{" "}
                  {thresholds.high.toFixed(2)}, confirma ≥ {thresholds.medium.toFixed(2)}).
                  <strong> A IA não escolhe a etapa</strong>: ela só grava as variáveis, e quem
                  decide são as ligações que você desenhou.
                </p>

                <div className="space-y-1">
                  <Label htmlFor="sim-intent">Intenção</Label>
                  <select
                    id="sim-intent"
                    className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-sm"
                    value={intentSimulado}
                    onChange={(e) => setIntentSimulado(e.target.value)}
                  >
                    {APCS_INTENTS.map((intent) => (
                      <option key={intent} value={intent}>
                        {intent}
                      </option>
                    ))}
                    <option value="__indisponivel__">IA fora do ar</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="sim-conf">Confiança</Label>
                  <Input
                    id="sim-conf"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={confiancaSimulada}
                    onChange={(e) => setConfiancaSimulada(Number(e.target.value))}
                    disabled={intentSimulado === "__indisponivel__"}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="sim-assunto">Assunto extraído</Label>
                  <Input
                    id="sim-assunto"
                    value={assuntoSimulado}
                    onChange={(e) => setAssuntoSimulado(e.target.value)}
                    placeholder="Câmara Ambiental"
                    disabled={intentSimulado === "__indisponivel__"}
                  />
                </div>

                <div className="col-span-full">
                  <Button size="sm" disabled={!esperandoResposta} onClick={responderComIA}>
                    Responder com esta leitura
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={comecar}>
                {linhas.length === 0 ? "Iniciar conversa" : "Recomeçar"}
              </Button>
              {acabou && (
                <p className="text-muted-foreground text-xs">
                  A conversa terminou. Recomece para testar outro caminho.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Miudezas                                                                   */
/* -------------------------------------------------------------------------- */

function CampoPersona({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Linha16({ termo, valor }: { termo: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground">{termo}</dt>
      <dd className="font-mono break-all">{valor ?? "—"}</dd>
    </div>
  );
}

const DESFECHO_LABELS: Record<FlowActionStatus, string> = {
  success: "deu certo",
  not_found: "não encontrei",
  failure: "falhou",
  // `retry` não aparece no seletor: ele não é um desfecho, é um pedido de nova
  // tentativa que o motor resolve sozinho. Está aqui porque o `Record` é
  // completo, e é o TypeScript cobrando que nenhum desfecho fique sem rótulo.
  retry: "pediu nova tentativa",
};

const BANDA_LABELS: Record<string, string> = {
  high: "confiança alta",
  medium: "confiança média",
  low: "confiança baixa",
};

/**
 * ⚠️ A FALHA DO MOTOR VIRA UMA FRASE QUE DIZ O QUE CONSERTAR. O código cru
 * (`no_matching_transition`) é útil no log e inútil na tela: quem está testando
 * quer saber qual seta falta, não o nome interno do problema.
 */
function explicarFalha(reason: string): string {
  switch (reason) {
    case "no_start_node":
      return "O desenho não tem uma etapa inicial.";
    case "node_not_found":
      return "A conversa apontou para uma etapa que não existe mais.";
    case "no_matching_transition":
      return "A conversa parou: não há ligação saindo desta etapa para o caminho escolhido.";
    case "not_waiting_reply":
      return "Esta etapa não estava esperando resposta.";
    case "hop_limit":
      return "O desenho entrou em um ciclo que nunca para. Confira as ligações que voltam.";
    case "loop_detected":
      return "A conversa deu voltas demais sem chegar a lugar nenhum. Confira se há um caminho que sempre volta para a mesma pergunta.";
    case "fallback_without_team":
      return "As tentativas acabaram e o desfecho é transferir, mas nenhum time foi escolhido.";
    default:
      return "A conversa não pôde continuar.";
  }
}
