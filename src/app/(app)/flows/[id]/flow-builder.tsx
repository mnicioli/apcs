"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { AlertTriangle, ArrowLeft, Check, Copy, Loader2, Play, Search } from "lucide-react";
import {
  createFlowVersionAction,
  advanceFlowVersionAction,
  deleteFlowNodeAction,
  deleteFlowTransitionAction,
  duplicateFlowAction,
  duplicateFlowNodeAction,
  publishFlowVersionAction,
  saveNodePositionsAction,
  setFlowStatusAction,
  upsertFlowNodeAction,
  upsertFlowTransitionAction,
} from "@/lib/actions/flows";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { cn } from "@/lib/utils";
import {
  NODE_PALETTE,
  conditionForConnection,
  defaultNodeConfiguration,
  handleForTransition,
  issuesByNodeId,
  nodeMatchesSearch,
  nodeOutlets,
  suggestNodeKey,
  transitionLabel,
  alternativas,
} from "@/modules/flow/flow.builder";
import {
  FLOW_CANNOT_ACTIVATE,
  FLOW_CHANNEL_LABELS,
  FLOW_NODE_TYPE_LABELS,
  FLOW_STATUS_LABELS,
  FLOW_VERSION_STATUS_LABELS,
  flowVersionTag,
} from "@/modules/flow/flow.labels";
import {
  canAdvanceVersion,
  canPublishVersion,
  isRollback,
  isVersionEditable,
  validateFlowGraph,
} from "@/modules/flow/flow.rules";
import type {
  AttendanceTeam,
  Flow,
  FlowNode,
  FlowNodeType,
  FlowTransition,
  FlowValidationIssue,
  FlowVersion,
} from "@/modules/flow/flow.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BuilderNode, type BuilderNodeData } from "./builder-node";
import { NodeInspector } from "./node-inspector";
import { FlowSimulator } from "./flow-simulator";

/**
 * O FLOW BUILDER — as quatro áreas do §2 do Prompt 2.
 *
 * ⚠️ A FONTE DA VERDADE AQUI É O DOMÍNIO, NÃO O CANVAS. `nodes` e `transitions`
 * são `FlowNode[]` / `FlowTransition[]` — o mesmo formato do banco —, e as
 * caixinhas do React Flow são DERIVADAS deles a cada render.
 *
 * O caminho contrário (deixar o React Flow guardar o estado e traduzir na hora
 * de salvar) é o que a documentação dele sugere, e seria um erro aqui: o
 * inspetor, o validador, a busca e o simulador todos falam o vocabulário do
 * domínio. Com o canvas mandando, cada um deles teria de traduzir — e as
 * traduções divergiriam.
 *
 * ⚠️ E NADA DESTE ARQUIVO DECIDE REGRA DE NEGÓCIO. Publicar, aprovar e validar
 * são chamadas ao banco; o que existe aqui é a leitura antecipada
 * (`validateFlowGraph`) para a tela não oferecer o que vai ser recusado.
 */

const nodeTypes = { apcs: BuilderNode };

export function FlowBuilder(props: BuilderProps) {
  // O provider precisa envolver quem usa `useReactFlow` — daí a casca.
  return (
    <ReactFlowProvider>
      <BuilderShell {...props} />
    </ReactFlowProvider>
  );
}

interface BuilderProps {
  flow: Flow;
  versions: FlowVersion[];
  version: FlowVersion;
  nodes: FlowNode[];
  transitions: FlowTransition[];
  teams: AttendanceTeam[];
  issues: FlowValidationIssue[];
  canWrite: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function BuilderShell({
  flow,
  versions,
  version,
  nodes: nosIniciais,
  transitions: setasIniciais,
  teams,
  issues: problemasDoServidor,
  canWrite,
}: BuilderProps) {
  const router = useRouter();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [nodes, setNodes] = useState<FlowNode[]>(nosIniciais);
  const [transitions, setTransitions] = useState<FlowTransition[]>(setasIniciais);
  const [selecionado, setSelecionado] = useState<{ tipo: "no" | "seta"; id: string } | null>(null);
  const [busca, setBusca] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [erro, setErro] = useState<string | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [emTransicao, startTransition] = useTransition();

  // ⚠️ SOMENTE RASCUNHO SE EDITA. Quem impõe é o gatilho no banco (FL001); isto
  // aqui é para a tela não OFERECER o que vai ser recusado — um canvas que
  // aceita arrastar e devolve erro a cada solta é pior do que um travado.
  const readOnly = !canWrite || !isVersionEditable(version.status);

  /* ---------------------------------------------------------------------- */
  /* Validação viva (§13)                                                    */
  /* ---------------------------------------------------------------------- */

  const chavesDeTimesAtivos = useMemo(
    () => teams.filter((t) => t.status === "active").map((t) => t.key),
    [teams],
  );

  const problemas = useMemo(
    () => validateFlowGraph({ nodes, transitions }, chavesDeTimesAtivos),
    [nodes, transitions, chavesDeTimesAtivos],
  );

  /**
   * ⚠️ O CANÁRIO DO ESPELHO. `validateFlowGraph` (TypeScript) e
   * `validate_flow_version` (banco) precisam contar a mesma história — existe um
   * teste que confere os CÓDIGOS, mas nenhum que confira o RESULTADO num
   * desenho real.
   *
   * Aqui os dois chegam juntos na primeira renderização, e uma divergência vira
   * uma linha de log. Não interrompe ninguém: a barreira continua sendo o banco.
   * Mas transforma "a tela dizia que podia publicar" numa pista, em vez de num
   * mistério.
   */
  useEffect(() => {
    const noServidor = problemasDoServidor.map((p) => p.code).sort();
    const naTela = validateFlowGraph(
      { nodes: nosIniciais, transitions: setasIniciais },
      chavesDeTimesAtivos,
    )
      .map((p) => p.code)
      .sort();

    if (noServidor.join("|") !== naTela.join("|")) {
      console.error("[flows] o espelho de validação divergiu do banco", {
        versionId: version.id,
        banco: noServidor,
        tela: naTela,
      });
    }
    // Só na montagem: depois disso o desenho mudou e a comparação não faria sentido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A pendência de cada nó, para o selo na caixinha. Índice, não busca — §23. */
  const problemaPorNo = useMemo(() => issuesByNodeId(problemas, nodes), [problemas, nodes]);

  /* ---------------------------------------------------------------------- */
  /* Auto save (§14)                                                         */
  /* ---------------------------------------------------------------------- */

  const nosSujos = useRef(new Set<string>());
  const posicoesSujas = useRef(new Map<string, { x: number; y: number }>());
  const setasSujas = useRef(new Set<string>());
  const [pulso, setPulso] = useState(0);

  const estadoAtual = useRef({ nodes, transitions });
  estadoAtual.current = { nodes, transitions };

  /**
   * ⚠️ ESPERA DE 800ms, E ELA NÃO É CHUTE. É o intervalo em que uma pessoa
   * digitando o texto de uma mensagem faz uma pausa natural — mais curto manda
   * uma consulta por palavra; mais longo faz o "Salvo" demorar tanto que a
   * pessoa desconfia e fica esperando na tela.
   */
  useEffect(() => {
    if (pulso === 0 || readOnly) return;

    const timer = setTimeout(async () => {
      const nosParaSalvar = [...nosSujos.current];
      const setasParaSalvar = [...setasSujas.current];
      const posicoes = [...posicoesSujas.current.entries()].map(([id, p]) => ({ id, ...p }));

      nosSujos.current.clear();
      setasSujas.current.clear();
      posicoesSujas.current.clear();

      if (nosParaSalvar.length + setasParaSalvar.length + posicoes.length === 0) return;

      setSaveState("saving");
      setErro(null);

      try {
        const { nodes: atuais, transitions: setasAtuais } = estadoAtual.current;

        for (const id of nosParaSalvar) {
          const no = atuais.find((n) => n.id === id);
          if (!no) continue;

          const resultado = await upsertFlowNodeAction(
            version.id,
            {
              type: no.type,
              key: no.key,
              name: no.name,
              position: no.position,
              isStart: no.isStart,
              // O `configuration` é validado pelo Zod dentro da action. Um nó
              // pela metade (a pessoa ainda digitando a alternativa) é recusado
              // com `invalidInput` — e isso é o certo: melhor não gravar do que
              // gravar um desenho que a publicação vai recusar.
              configuration: no.configuration,
            } as never,
            id,
          );
          if (!resultado.ok) throw new Error(ACTION_ERROR_MESSAGES[resultado.error.code]);
        }

        for (const id of setasParaSalvar) {
          const seta = setasAtuais.find((t) => t.id === id);
          if (!seta) continue;

          const resultado = await upsertFlowTransitionAction(
            version.id,
            {
              sourceNodeId: seta.sourceNodeId,
              targetNodeId: seta.targetNodeId,
              condition: seta.condition,
              label: seta.label ?? "",
              priority: seta.priority,
            },
            id,
          );
          if (!resultado.ok) throw new Error(ACTION_ERROR_MESSAGES[resultado.error.code]);
        }

        if (posicoes.length > 0) {
          const resultado = await saveNodePositionsAction(posicoes);
          if (!resultado.ok) throw new Error(ACTION_ERROR_MESSAGES[resultado.error.code]);
        }

        setSaveState("saved");
      } catch (falha) {
        setSaveState("error");
        setErro(falha instanceof Error ? falha.message : "Não foi possível salvar.");
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [pulso, readOnly, version.id]);

  const marcarNo = useCallback((id: string) => {
    nosSujos.current.add(id);
    setPulso((p) => p + 1);
  }, []);

  const marcarSeta = useCallback((id: string) => {
    setasSujas.current.add(id);
    setPulso((p) => p + 1);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* O canvas                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * ⚠️ O CACHE DE IDENTIDADE É O QUE FAZ MIL NÓS SEREM NAVEGÁVEIS (§23).
   *
   * O React Flow memoiza cada caixinha pela REFERÊNCIA de `data`. Sem este
   * cache, arrastar um nó recriaria o `data` de todos os outros — e mil
   * componentes seriam redesenhados a cada quadro da animação. Com ele, só o nó
   * cujo conteúdo mudou de fato perde a identidade.
   */
  const cacheDeDados = useRef(
    new Map<
      string,
      { no: FlowNode; problema: string | null; apagado: boolean; data: BuilderNodeData }
    >(),
  );

  const rfNodes = useMemo<Node<BuilderNodeData>[]>(() => {
    return nodes.map((no) => {
      const problema = problemaPorNo.get(no.id) ?? null;
      const apagado = busca.trim() !== "" && !nodeMatchesSearch(no, busca);

      // ⚠️ COMPARA POR REFERÊNCIA, e não por `JSON.stringify` do conteúdo. A
      // versão anterior serializava a configuração de CADA nó a cada render — e
      // arrastar redispara o render a cada quadro, então num fluxo de mil nós
      // (§23) era mil serializações por quadro para descobrir que nada mudou.
      //
      // `setNodes` só cria objeto novo para o nó que mudou, então a igualdade de
      // referência responde a mesma pergunta de graça.
      const anterior = cacheDeDados.current.get(no.id);
      const data =
        anterior &&
        anterior.no === no &&
        anterior.problema === problema &&
        anterior.apagado === apagado
          ? anterior.data
          : {
              chave: no.key,
              nome: no.name,
              kind: no.type,
              resumo: resumoDoNo(no, teams),
              isStart: no.isStart,
              outlets: nodeOutlets(no),
              problema,
              apagado,
            };

      cacheDeDados.current.set(no.id, { no, problema, apagado, data });

      return {
        id: no.id,
        type: "apcs",
        position: no.position,
        data,
        selected: selecionado?.tipo === "no" && selecionado.id === no.id,
        draggable: !readOnly,
      };
    });
  }, [nodes, problemaPorNo, busca, teams, selecionado, readOnly]);

  const rfEdges = useMemo<Edge[]>(() => {
    return transitions.map((seta) => {
      const origem = nodes.find((n) => n.id === seta.sourceNodeId);
      const opcoes = origem ? alternativas(origem.configuration) : [];

      return {
        id: seta.id,
        source: seta.sourceNodeId,
        target: seta.targetNodeId,
        sourceHandle: handleForTransition(seta.condition),
        label: transitionLabel(seta, opcoes),
        labelStyle: { fontSize: 11 },
        markerEnd: { type: MarkerType.ArrowClosed },
        selected: selecionado?.tipo === "seta" && selecionado.id === seta.id,
        animated: false,
      };
    });
  }, [transitions, nodes, selecionado]);

  /** Arrastar. Só a posição muda — e ela vai para a fila leve do auto save. */
  const onNodesChange = useCallback(
    (mudancas: NodeChange[]) => {
      if (readOnly) return;

      let mexeu = false;
      setNodes((atuais) => {
        let proximos = atuais;
        for (const mudanca of mudancas) {
          if (mudanca.type !== "position" || !mudanca.position) continue;
          mexeu = true;
          proximos = proximos.map((n) =>
            n.id === mudanca.id ? { ...n, position: mudanca.position! } : n,
          );
          // Só grava quando a pessoa SOLTA: durante o arrasto, `dragging` é true
          // e gravar cada quadro faria uma consulta a cada pixel.
          if (!mudanca.dragging && mudanca.position) {
            posicoesSujas.current.set(mudanca.id, mudanca.position);
          }
        }
        return proximos;
      });

      if (mexeu && mudancas.some((m) => m.type === "position" && !m.dragging)) {
        setPulso((p) => p + 1);
      }
    },
    [readOnly],
  );

  /** Ligar dois nós (§6). A condição sai da BOLINHA de onde a seta partiu (§9). */
  /**
   * Arrastar a PONTA de uma seta para outro lugar (§5, §6).
   *
   * ⚠️ É O GESTO QUE O PAINEL DE PROPRIEDADES MANDA FAZER para trocar a
   * alternativa de onde uma ligação sai — e ele só existe porque este handler
   * existe. `edgesReconnectable` sozinho não faz nada: a ponta é arrastada e
   * volta ao lugar, sem erro e sem efeito.
   *
   * Apaga e recria em vez de atualizar: a seta pode ter mudado de ORIGEM, e com
   * ela a condição inteira (de `{answer, EVENTOS}` para `{answer, FILIACAO}`).
   * Um update parcial deixaria a condição velha apontando de uma bolinha nova.
   */
  const religar = useCallback(
    async (antigaId: string, nova: Connection) => {
      if (readOnly) return;

      const origem = nodes.find((n) => n.id === nova.source);
      if (!origem || !nova.target) return;

      const condicao = conditionForConnection(origem, nova.sourceHandle);
      if (!condicao) return;

      setSaveState("saving");

      const apagou = await deleteFlowTransitionAction(antigaId);
      if (!apagou.ok) {
        setSaveState("error");
        setErro(ACTION_ERROR_MESSAGES[apagou.error.code]);
        return;
      }

      const anterior = transitions.find((t) => t.id === antigaId);
      const criou = await upsertFlowTransitionAction(version.id, {
        sourceNodeId: origem.id,
        targetNodeId: nova.target,
        condition: condicao,
        // O rótulo escrito à mão e a ordem sobrevivem: quem move a ponta de uma
        // seta não quis perder o texto que escreveu nela.
        label: anterior?.label ?? "",
        priority: anterior?.priority ?? 0,
      });

      if (!criou.ok) {
        setSaveState("error");
        setErro(ACTION_ERROR_MESSAGES[criou.error.code]);
        // A antiga já se foi; recarregar é o único jeito de a tela voltar a
        // mostrar o que o banco tem.
        router.refresh();
        return;
      }

      setTransitions((atuais) => [
        ...atuais.filter((t) => t.id !== antigaId),
        {
          id: criou.data.id,
          flowVersionId: version.id,
          sourceNodeId: origem.id,
          targetNodeId: nova.target!,
          condition: condicao,
          label: anterior?.label ?? null,
          priority: anterior?.priority ?? 0,
        },
      ]);
      setSelecionado(null);
      setSaveState("saved");
    },
    [readOnly, nodes, transitions, version.id, router],
  );

  const onConnect = useCallback(
    async (conexao: Connection) => {
      if (readOnly) return;

      const origem = nodes.find((n) => n.id === conexao.source);
      if (!origem || !conexao.target) return;

      const condicao = conditionForConnection(origem, conexao.sourceHandle);
      if (!condicao) return;

      // ⚠️ UMA SAÍDA, UMA SETA. Duas setas na mesma alternativa fariam a segunda
      // nunca executar — o motor segue a primeira que casa. Substituir é o que a
      // pessoa quis dizer ao arrastar de novo do mesmo ponto.
      const anterior = transitions.find(
        (t) =>
          t.sourceNodeId === origem.id &&
          handleForTransition(t.condition) === handleForTransition(condicao),
      );

      setSaveState("saving");

      if (anterior) {
        await deleteFlowTransitionAction(anterior.id);
        setTransitions((atuais) => atuais.filter((t) => t.id !== anterior.id));
      }

      const resultado = await upsertFlowTransitionAction(version.id, {
        sourceNodeId: origem.id,
        targetNodeId: conexao.target,
        condition: condicao,
        label: "",
        priority: transitions.filter((t) => t.sourceNodeId === origem.id).length,
      });

      if (!resultado.ok) {
        setSaveState("error");
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setTransitions((atuais) => [
        ...atuais,
        {
          id: resultado.data.id,
          flowVersionId: version.id,
          sourceNodeId: origem.id,
          targetNodeId: conexao.target!,
          condition: condicao,
          label: null,
          priority: atuais.filter((t) => t.sourceNodeId === origem.id).length,
        },
      ]);
      setSaveState("saved");
    },
    [readOnly, nodes, transitions, version.id],
  );

  /* ---------------------------------------------------------------------- */
  /* Caixa de ferramentas (§3)                                              */
  /* ---------------------------------------------------------------------- */

  const adicionarNo = useCallback(
    async (type: FlowNodeType, posicao?: { x: number; y: number }) => {
      if (readOnly) return;

      const key = suggestNodeKey(
        type,
        nodes.map((n) => n.key),
      );

      setSaveState("saving");

      const resultado = await upsertFlowNodeAction(version.id, {
        type,
        key,
        name: FLOW_NODE_TYPE_LABELS[type],
        // Sem posição declarada (clique na ferramenta, e não arrasto), cai numa
        // escadinha para não empilhar tudo no mesmo pixel.
        position: posicao ?? { x: 120 + nodes.length * 30, y: 120 + nodes.length * 20 },
        // ⚠️ O PRIMEIRO NÓ É O INÍCIO, automaticamente. Um fluxo sem nó inicial
        // não publica, e obrigar a pessoa a marcar isso à mão no primeiro nó
        // seria uma pegadinha na primeira vez que ela usa a tela.
        isStart: nodes.length === 0 && type !== "end",
        configuration: defaultNodeConfiguration(type),
      } as never);

      if (!resultado.ok) {
        setSaveState("error");
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      const novo: FlowNode = {
        id: resultado.data.id,
        flowVersionId: version.id,
        type,
        key,
        name: FLOW_NODE_TYPE_LABELS[type],
        configuration: defaultNodeConfiguration(type),
        position: posicao ?? { x: 120 + nodes.length * 30, y: 120 + nodes.length * 20 },
        metadata: {},
        isStart: nodes.length === 0 && type !== "end",
      };

      setNodes((atuais) => [...atuais, novo]);
      setSelecionado({ tipo: "no", id: novo.id });
      setSaveState("saved");
    },
    [readOnly, nodes, version.id],
  );

  /* ---------------------------------------------------------------------- */
  /* Excluir e duplicar (§5, §16)                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * ⚠️ APAGAR ACEITA UMA LISTA, e não um id, porque há DOIS caminhos até aqui: o
   * botão do painel de propriedades (sempre um) e a tecla Delete sobre uma
   * seleção do canvas (pode ser vários). Duas implementações divergiriam — e a
   * que ficasse para trás deixaria linhas órfãs na tela depois de apagar.
   */
  const apagarNos = useCallback(
    async (ids: string[]) => {
      if (readOnly || ids.length === 0) return;

      setSaveState("saving");
      const alvos = new Set(ids);

      for (const id of ids) {
        const resultado = await deleteFlowNodeAction(id);
        if (!resultado.ok) {
          setSaveState("error");
          setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
          return;
        }
      }

      setNodes((atuais) => atuais.filter((n) => !alvos.has(n.id)));
      // As setas que tocavam o nó caíram no banco por cascade; aqui elas somem
      // da tela pelo mesmo motivo — deixar uma seta apontando para o vazio
      // faria o canvas mostrar um estado que não existe.
      setTransitions((atuais) =>
        atuais.filter((t) => !alvos.has(t.sourceNodeId) && !alvos.has(t.targetNodeId)),
      );
      setSelecionado(null);
      setSaveState("saved");
    },
    [readOnly],
  );

  const apagarSetas = useCallback(
    async (ids: string[]) => {
      if (readOnly || ids.length === 0) return;

      setSaveState("saving");
      const alvos = new Set(ids);

      for (const id of ids) {
        const resultado = await deleteFlowTransitionAction(id);
        if (!resultado.ok) {
          setSaveState("error");
          setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
          return;
        }
      }

      setTransitions((atuais) => atuais.filter((t) => !alvos.has(t.id)));
      setSelecionado(null);
      setSaveState("saved");
    },
    [readOnly],
  );

  const excluirSelecionado = useCallback(async () => {
    if (!selecionado) return;
    if (selecionado.tipo === "seta") await apagarSetas([selecionado.id]);
    else await apagarNos([selecionado.id]);
  }, [selecionado, apagarNos, apagarSetas]);

  const duplicarNo = useCallback(async () => {
    if (readOnly || selecionado?.tipo !== "no") return;

    setSaveState("saving");
    const resultado = await duplicateFlowNodeAction(selecionado.id);

    if (!resultado.ok) {
      setSaveState("error");
      setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
      return;
    }

    // A cópia foi feita no servidor; recarregar é o caminho honesto — ela tem
    // chave e nome gerados lá, e adivinhá-los aqui criaria duas verdades.
    setSaveState("saved");
    router.refresh();
  }, [readOnly, selecionado, router]);

  /* ---------------------------------------------------------------------- */
  /* Ciclo de vida (Área 1)                                                  */
  /* ---------------------------------------------------------------------- */

  const noSelecionado =
    selecionado?.tipo === "no" ? (nodes.find((n) => n.id === selecionado.id) ?? null) : null;
  const setaSelecionada =
    selecionado?.tipo === "seta"
      ? (transitions.find((t) => t.id === selecionado.id) ?? null)
      : null;
  const origemDaSeta = setaSelecionada
    ? (nodes.find((n) => n.id === setaSelecionada.sourceNodeId) ?? null)
    : null;

  function executar(
    acao: () => Promise<{ ok: boolean; error?: { code: keyof typeof ACTION_ERROR_MESSAGES } }>,
  ) {
    startTransition(async () => {
      setErro(null);
      const resultado = await acao();
      if (!resultado.ok && resultado.error) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[34rem] flex-col gap-3">
      {/* ================= ÁREA 1 — informações do fluxo ================= */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/flows">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Voltar para a lista</span>
              </Link>
            </Button>
            <h1 className="truncate text-xl font-semibold tracking-tight">{flow.name}</h1>
            <Badge variant={flow.status === "active" ? "attention" : "default"}>
              {FLOW_STATUS_LABELS[flow.status]}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {FLOW_CHANNEL_LABELS[flow.channel]} · {flowVersionTag(version.version)} ·{" "}
            {FLOW_VERSION_STATUS_LABELS[version.status]}
            {version.createdBy?.fullName ? ` · criada por ${version.createdBy.fullName}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SaveIndicator state={saveState} />

          {/* A régua de versões. Trocar de versão é trocar a URL — assim o botão
              de voltar do navegador funciona, e um link para "a v2" é colável. */}
          {versions.length > 1 && (
            <select
              className="border-border bg-background h-9 rounded-md border px-2 text-sm"
              value={version.id}
              aria-label="Versão do fluxo"
              onChange={(e) => router.push(`/flows/${flow.id}?v=${e.target.value}`)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {flowVersionTag(v.version)} — {FLOW_VERSION_STATUS_LABELS[v.status]}
                </option>
              ))}
            </select>
          )}

          <Button variant="outline" size="sm" onClick={() => setSimulando(true)}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Testar fluxo
          </Button>

          {/* §16. Duplicar o FLUXO inteiro — a cópia nasce desligada e sem ser a
              entrada do canal, senão ela começaria a atender no mesmo instante.
              Duplicar uma ETAPA fica no painel de propriedades, que é onde a
              etapa está selecionada. */}
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              loading={emTransicao}
              title="Cria um fluxo novo com uma cópia deste desenho."
              onClick={() =>
                startTransition(async () => {
                  setErro(null);
                  const resultado = await duplicateFlowAction(flow.id);
                  if (!resultado.ok) {
                    setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
                    return;
                  }
                  router.push(`/flows/${resultado.data.id}?v=${resultado.data.versionId}`);
                })
              }
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Duplicar
            </Button>
          )}

          {canWrite && (
            <LifecycleButtons
              version={version}
              problemas={problemas}
              flow={flow}
              pendente={emTransicao}
              onAvancar={(para) => executar(() => advanceFlowVersionAction(version.id, para))}
              onPublicar={() => executar(() => publishFlowVersionAction(version.id))}
              onNovaVersao={() => executar(() => createFlowVersionAction(flow.id, version.id))}
              onLigar={() =>
                executar(() =>
                  setFlowStatusAction(flow.id, flow.status === "active" ? "inactive" : "active"),
                )
              }
            />
          )}
        </div>
      </header>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      {readOnly && (
        <p className="border-border bg-muted/30 text-muted-foreground rounded-md border px-3 py-2 text-sm">
          {!canWrite
            ? "Você pode consultar este fluxo, mas não editá-lo."
            : `Esta versão está ${FLOW_VERSION_STATUS_LABELS[version.status].toLowerCase()} e não pode ser alterada. Crie uma nova versão a partir dela para mexer no desenho.`}
        </p>
      )}

      {/* =========== ÁREAS 2, 3 e 4 — ferramentas, canvas e propriedades ========== */}
      {/* ⚠️ AS LATERAIS ENCOLHEM ANTES DO CANVAS. Com 13rem + 20rem fixos, um
          monitor de 1280px sobrava ~750px para o desenho — e é o desenho que a
          pessoa veio ver. As duas colunas laterais só crescem quando há tela
          sobrando (2xl). Desktop é a prioridade do §24; tablet fica utilizável e
          celular não é alvo. */}
      <div className="grid min-h-0 flex-1 grid-cols-[11rem_1fr_18rem] gap-3 2xl:grid-cols-[13rem_1fr_22rem]">
        {/* ---- ÁREA 3: caixa de ferramentas ---- */}
        <Card className="min-h-0 overflow-y-auto">
          <CardContent className="space-y-3 p-3">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Etapas
            </p>
            <div className="space-y-1.5">
              {NODE_PALETTE.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  disabled={readOnly}
                  title={item.hint}
                  onClick={() => void adicionarNo(item.type)}
                  draggable={!readOnly}
                  onDragStart={(e) =>
                    e.dataTransfer.setData("application/apcs-flow-node", item.type)
                  }
                  className={cn(
                    "border-border hover:bg-accent flex w-full items-start gap-2 rounded-md border p-2 text-left transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <span aria-hidden="true">{item.glyph}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="text-muted-foreground block text-[11px] leading-tight">
                      {item.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {/* --------- as pendências (§13) --------- */}
            <div className="border-border space-y-2 border-t pt-3">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Pendências
              </p>
              {problemas.length === 0 ? (
                <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Nada a corrigir.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {problemas.map((p, i) => (
                    <li key={`${p.code}-${i}`} className="text-destructive flex gap-1.5 text-xs">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{p.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ---- ÁREA 2: o canvas ---- */}
        <Card className="min-h-0 overflow-hidden">
          <div
            className="h-full w-full"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const tipo = e.dataTransfer.getData("application/apcs-flow-node") as FlowNodeType;
              if (!tipo) return;
              void adicionarNo(tipo, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            }}
          >
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onConnect={(c) => void onConnect(c)}
              // ⚠️ SEM ISTO, `edgesReconnectable` NÃO FAZ NADA — a ponta da seta
              // é arrastada e volta para o lugar, em silêncio. E o painel de
              // propriedades manda arrastá-la para trocar de alternativa, ou
              // seja: a instrução estaria mentindo.
              onReconnect={(antiga, nova) => void religar(antiga.id, nova)}
              onNodeClick={(_, no) => setSelecionado({ tipo: "no", id: no.id })}
              onEdgeClick={(_, seta) => setSelecionado({ tipo: "seta", id: seta.id })}
              onPaneClick={() => setSelecionado(null)}
              nodesConnectable={!readOnly}
              nodesDraggable={!readOnly}
              edgesReconnectable={!readOnly}
              // ⚠️ DELETE E BACKSPACE APAGAM O QUE ESTÁ SELECIONADO (§5) — mas
              // só com o CANVAS em foco. O React Flow ignora a tecla enquanto o
              // cursor está num campo, então apagar uma palavra do texto da
              // mensagem no painel ao lado não apaga a etapa.
              //
              // Em versão congelada a tecla é desligada: um canvas que aceita
              // apagar e devolve erro a cada tecla é pior do que um travado.
              deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
              onNodesDelete={(apagados) => void apagarNos(apagados.map((n) => n.id))}
              onEdgesDelete={(apagadas) => void apagarSetas(apagadas.map((e) => e.id))}
              fitView
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: false }}
            >
              <Background />
              <Controls />
              {/* §18. O minimapa só ganha sentido quando o desenho não cabe na
                  tela — abaixo disso ele é um quadrado cinza ocupando espaço. */}
              {nodes.length > 8 && <MiniMap pannable zoomable />}

              {/* §19. A busca fica SOBRE o canvas: procurar um nó e ter de
                  desviar o olho para a lateral quebra o que a busca serve. */}
              <Panel position="top-left">
                <div className="bg-card border-border flex items-center gap-1.5 rounded-md border px-2 py-1 shadow-sm">
                  <Search className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Procurar no desenho…"
                    aria-label="Procurar etapa no desenho"
                    className="h-7 w-48 border-0 px-0 shadow-none focus-visible:ring-0"
                  />
                  {busca !== "" && (
                    <button
                      type="button"
                      onClick={() => setBusca("")}
                      className="text-muted-foreground text-xs hover:underline"
                    >
                      limpar
                    </button>
                  )}
                </div>
              </Panel>

              <Panel position="top-right">
                <Button variant="outline" size="sm" onClick={() => fitView({ duration: 300 })}>
                  Centralizar
                </Button>
              </Panel>
            </ReactFlow>
          </div>
        </Card>

        {/* ---- ÁREA 4: propriedades ---- */}
        <Card className="min-h-0 overflow-y-auto">
          <NodeInspector
            node={noSelecionado}
            transition={setaSelecionada}
            sourceNode={origemDaSeta}
            teams={teams}
            readOnly={readOnly}
            onNodeChange={(patch) => {
              if (!noSelecionado) return;
              setNodes((atuais) =>
                atuais.map((n) => (n.id === noSelecionado.id ? { ...n, ...patch } : n)),
              );
              marcarNo(noSelecionado.id);
            }}
            onTransitionChange={(patch) => {
              if (!setaSelecionada) return;
              setTransitions((atuais) =>
                atuais.map((t) => (t.id === setaSelecionada.id ? { ...t, ...patch } : t)),
              );
              marcarSeta(setaSelecionada.id);
            }}
            onDuplicate={() => void duplicarNo()}
            onDelete={() => void excluirSelecionado()}
          />
        </Card>
      </div>

      {simulando && (
        <FlowSimulator
          nodes={nodes}
          transitions={transitions}
          teams={teams}
          onClose={() => setSimulando(false)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O indicador de salvamento (§14)                                            */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ O ESTADO DE ERRO NÃO SOME SOZINHO, e é a razão de este componente existir
 * em vez de um texto solto. "Salvando…" e "Salvo" são conforto; "não salvou" é
 * informação — e uma pessoa que fechou a aba achando que estava tudo gravado
 * perde o trabalho que o §14 existe para proteger.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;

  if (state === "saving") {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Salvando…
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs" aria-live="polite">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Salvo
      </span>
    );
  }

  return (
    <span className="text-destructive flex items-center gap-1.5 text-xs" role="alert">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      Não foi possível salvar
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Os botões do ciclo de vida                                                 */
/* -------------------------------------------------------------------------- */

function LifecycleButtons({
  version,
  flow,
  problemas,
  pendente,
  onAvancar,
  onPublicar,
  onNovaVersao,
  onLigar,
}: {
  version: FlowVersion;
  flow: Flow;
  problemas: FlowValidationIssue[];
  pendente: boolean;
  onAvancar: (para: FlowVersion["status"]) => void;
  onPublicar: () => void;
  onNovaVersao: () => void;
  onLigar: () => void;
}) {
  const podePublicar = canPublishVersion(version.status) && problemas.length === 0;

  return (
    <>
      {canAdvanceVersion(version.status, "testing") && (
        <Button variant="outline" size="sm" loading={pendente} onClick={() => onAvancar("testing")}>
          Enviar para teste
        </Button>
      )}
      {canAdvanceVersion(version.status, "pending_approval") && (
        <Button
          variant="outline"
          size="sm"
          loading={pendente}
          onClick={() => onAvancar("pending_approval")}
        >
          Enviar para aprovação
        </Button>
      )}
      {canAdvanceVersion(version.status, "approved") && (
        <Button
          variant="outline"
          size="sm"
          loading={pendente}
          onClick={() => onAvancar("approved")}
        >
          Aprovar
        </Button>
      )}
      {canAdvanceVersion(version.status, "draft") && version.status !== "draft" && (
        <Button variant="ghost" size="sm" loading={pendente} onClick={() => onAvancar("draft")}>
          Voltar para rascunho
        </Button>
      )}

      {canPublishVersion(version.status) && (
        <Button
          size="sm"
          loading={pendente}
          disabled={!podePublicar}
          onClick={onPublicar}
          // ⚠️ UM BOTÃO DESABILITADO SEM EXPLICAÇÃO É UM BECO SEM SAÍDA. A
          // pessoa clica, nada acontece, e não há o que ler.
          title={
            podePublicar
              ? undefined
              : "Corrija as pendências listadas à esquerda antes de publicar."
          }
        >
          {isRollback(version.status) ? "Restaurar esta versão" : "Publicar"}
        </Button>
      )}

      {!isVersionEditable(version.status) && (
        <Button variant="outline" size="sm" loading={pendente} onClick={onNovaVersao}>
          Criar nova versão
        </Button>
      )}

      <Button
        variant={flow.status === "active" ? "ghost" : "outline"}
        size="sm"
        loading={pendente}
        disabled={flow.status !== "active" && flow.activeVersionId === null}
        title={
          flow.status !== "active" && flow.activeVersionId === null
            ? FLOW_CANNOT_ACTIVATE
            : undefined
        }
        onClick={onLigar}
      >
        {flow.status === "active" ? "Desligar fluxo" : "Ligar fluxo"}
      </Button>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** A prévia que a caixinha mostra — o que identifica o nó de relance. */
function resumoDoNo(node: FlowNode, teams: AttendanceTeam[]): string {
  const texto = (campo: string) => {
    const valor = node.configuration[campo];
    return typeof valor === "string" ? valor : "";
  };

  switch (node.type) {
    case "message":
    case "question":
      return texto("text");
    case "condition":
      return texto("variable");
    case "action":
      return texto("actionKey");
    case "attendant": {
      const chave = texto("teamKey");
      return teams.find((t) => t.key === chave)?.name ?? chave;
    }
    case "end":
      return texto("message");
  }
}
