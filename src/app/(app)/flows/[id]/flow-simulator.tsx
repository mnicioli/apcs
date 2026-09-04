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
import { FLOW_RUN_STATUS_LABELS } from "@/modules/flow/flow.labels";
import type {
  AttendanceTeam,
  CompiledFlowNode,
  FlowDefinition,
  FlowNode,
  FlowTransition,
} from "@/modules/flow/flow.types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * TESTAR FLUXO — o simulador simples do §20.
 *
 * ⚠️ ELE RODA O MOTOR DE VERDADE. `advanceFlow` é exatamente a função que vai
 * atender no WhatsApp (Prompt 4); o que muda é quem executa os efeitos — aqui
 * eles viram balões na tela, lá viram mensagens.
 *
 * Uma simulação que reimplementasse a travessia seria pior que nenhuma: ela
 * concordaria com o desenho e discordaria da produção, e a pessoa homologaria um
 * fluxo que atende diferente. É o mesmo motivo pelo qual `searchKnowledge` chama
 * a função do banco em vez de repetir o `where`.
 *
 * ⚠️ O QUE ELE **NÃO** FAZ, E DIZ QUE NÃO FAZ: as ações de negócio não são
 * executadas (nenhum handler está ligado — §25 do Prompt 2 e §28 do Prompt 1).
 * O simulador mostra a ação que SERIA executada e segue como se ela tivesse dado
 * certo. Fingir que consultou a Bolsa seria mentir sobre o resultado; parar ali
 * tornaria o teste inútil na metade dos fluxos.
 */

interface Linha {
  de: "bot" | "pessoa" | "sistema";
  texto: string;
  opcoes?: { key: string; label: string }[];
}

export function FlowSimulator({
  nodes,
  transitions,
  teams,
  onClose,
}: {
  nodes: FlowNode[];
  transitions: FlowTransition[];
  teams: AttendanceTeam[];
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

  const [estado, setEstado] = useState<FlowEngineState | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [entrada, setEntrada] = useState("");

  function aplicar(resultado: { state: FlowEngineState; effects: FlowEffect[] }) {
    const novas: Linha[] = [];
    const proximo = resultado.state;

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
            texto: `Conversa transferida para ${time?.name ?? efeito.teamKey}.`,
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

          novas.push({
            de: "sistema",
            texto: `Aqui o sistema faria: ${rotulo}. No teste isso não é executado — a conversa segue como se tivesse dado certo.`,
          });

          // Retoma na hora, com sucesso e sem variáveis novas: é a única
          // suposição honesta possível sem chamar o CRM de verdade.
          const retomada = advanceFlow(definition, resultado.state, {
            kind: "actionResult",
            ok: true,
            variables: {},
          });
          setLinhas((atuais) => [...atuais, ...novas]);
          aplicar(retomada);
          return;
        }

        case "fail":
          novas.push({ de: "sistema", texto: explicarFalha(efeito.reason) });
          break;
      }
    }

    setLinhas((atuais) => [...atuais, ...novas]);
    setEstado(proximo);
  }

  function comecar() {
    setLinhas([]);
    aplicar(advanceFlow(definition, initialFlowState(), { kind: "start" }));
  }

  function responder(texto: string) {
    if (!estado || texto.trim() === "") return;
    setLinhas((atuais) => [...atuais, { de: "pessoa", texto }]);
    setEntrada("");
    aplicar(advanceFlow(definition, estado, { kind: "reply", text: texto }));
  }

  const esperandoResposta = estado?.status === "waiting_reply";
  const acabou =
    estado !== null && ["completed", "failed", "handed_off", "cancelled"].includes(estado.status);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Testar fluxo"
      description="Uma conversa de mentira sobre o desenho atual — inclusive o que ainda não foi publicado."
    >
      <div className="space-y-3">
        {definition.startNodeId === null ? (
          <p className="text-destructive text-sm">
            O desenho ainda não tem uma etapa inicial, então não há por onde a conversa começar.
          </p>
        ) : (
          <>
            <div className="border-border bg-muted/20 h-72 space-y-2 overflow-y-auto rounded-md border p-3">
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

            {estado && (
              <p className="text-muted-foreground text-xs">
                Motor: {FLOW_RUN_STATUS_LABELS[estado.status]}
                {Object.keys(estado.variables).length > 0 && (
                  <>
                    {" · "}
                    Coletado:{" "}
                    <span className="font-mono">
                      {Object.entries(estado.variables)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </span>
                  </>
                )}
              </p>
            )}

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
    default:
      return "A conversa não pôde continuar.";
  }
}
