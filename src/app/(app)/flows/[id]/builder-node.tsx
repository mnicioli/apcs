"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_GLYPHS, type NodeOutlet } from "@/modules/flow/flow.builder";
import { FLOW_NODE_TYPE_LABELS } from "@/modules/flow/flow.labels";
import type { FlowNodeType } from "@/modules/flow/flow.types";

/**
 * A CAIXINHA DO CANVAS — o §4 do Prompt 2.
 *
 * ⚠️ UM COMPONENTE PARA OS SEIS TIPOS, e não seis componentes. O que muda entre
 * eles é o símbolo, a cor da borda e a prévia do conteúdo; a estrutura (título,
 * corpo, pontos de ligação, selo de problema) é a mesma. Seis cópias divergiriam
 * na primeira vez que alguém ajustasse o espaçamento de uma delas — e o canvas
 * ficaria com uma caixinha desalinhada que ninguém sabe explicar.
 *
 * ⚠️ E ELE NÃO USA COR FIXA. Tudo sai de token (`bg-card`, `border-primary`,
 * `text-muted-foreground`), como o resto do sistema — o canvas do React Flow
 * não é uma ilha com regras próprias.
 */

export interface BuilderNodeData extends Record<string, unknown> {
  /** A chave estável (§10). Aparece pequena, sob o nome. */
  chave: string;
  nome: string;
  /** `kind` e não `type`: `type` já é do React Flow. */
  kind: FlowNodeType;
  /** A prévia do conteúdo — o texto da mensagem, o time, a ação. */
  resumo: string;
  isStart: boolean;
  /** Os pontos de saída. Um por alternativa, nas perguntas de escolha (§9). */
  outlets: NodeOutlet[];
  /** A pendência de validação deste nó (§13). `null` quando está tudo certo. */
  problema: string | null;
  /** A busca do §19 apagou este nó? */
  apagado: boolean;
}

/** A cor da borda por tipo. Só tokens — nada de `border-blue-500`. */
const BORDA: Record<FlowNodeType, string> = {
  message: "border-border",
  question: "border-primary/60",
  condition: "border-border",
  action: "border-border",
  attendant: "border-primary/60",
  end: "border-border",
};

export const BuilderNode = memo(function BuilderNode({
  data,
  selected,
}: NodeProps & { data: BuilderNodeData }) {
  const { chave, nome, kind, resumo, isStart, outlets, problema, apagado } = data;

  return (
    <div
      className={cn(
        "bg-card w-56 rounded-lg border-2 shadow-sm transition-opacity",
        BORDA[kind],
        selected && "ring-ring ring-2 ring-offset-1",
        // ⚠️ APAGA, NÃO ESCONDE. Sumir com os nós que não casam com a busca
        // quebraria as setas que passam por eles — o desenho pareceria
        // desmontado. Apagados, eles continuam mostrando a topologia.
        apagado && "opacity-25",
        problema && "border-destructive",
      )}
    >
      {/* O nó inicial não recebe seta: é por onde a conversa entra. */}
      {!isStart && (
        <Handle type="target" position={Position.Top} className="!bg-muted-foreground !h-2 !w-2" />
      )}

      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1">
        <span aria-hidden="true" className="text-base leading-none">
          {NODE_GLYPHS[kind]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={nome}>
            {nome || FLOW_NODE_TYPE_LABELS[kind]}
          </p>
          <p className="text-muted-foreground truncate font-mono text-[10px]" title={chave}>
            {chave}
          </p>
        </div>
        {problema && (
          // O `title` carrega a explicação inteira. No canvas ela não cabe, e
          // mandar a pessoa procurar o motivo na lateral a cada selo seria
          // trabalho à toa — passar o mouse responde na hora.
          <span title={problema} className="shrink-0">
            <AlertTriangle className="text-destructive h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{problema}</span>
          </span>
        )}
      </div>

      {isStart && (
        <p className="text-primary px-3 pb-1 text-[10px] font-medium tracking-wide uppercase">
          ▶ Início
        </p>
      )}

      {resumo !== "" && (
        <p className="text-muted-foreground line-clamp-2 px-3 pb-2 text-xs" title={resumo}>
          {resumo}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* As saídas (§6, §9)                                                  */}
      {/* ------------------------------------------------------------------ */}
      {/* ⚠️ UMA BOLINHA POR ALTERNATIVA, COM O RÓTULO AO LADO. É isto que faz a
          ligação por CHAVE ser a única possível: a pessoa arrasta de "Eventos"
          para o nó de destino, e a condição `{answer, EVENTOS}` sai daí. Não há
          campo onde digitar um número, porque não há número. */}
      {outlets.length > 1 ? (
        <div className="border-border space-y-1 border-t px-3 py-1.5">
          {outlets.map((saida, indice) => (
            <div key={saida.id} className="relative flex items-center justify-between gap-2">
              <span className="text-muted-foreground truncate text-[11px]" title={saida.id}>
                {saida.label || saida.id}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={saida.id}
                // Alinha a bolinha com a LINHA da alternativa, e não com a borda
                // do nó: sem isto, cinco saídas empilhariam cinco bolinhas no
                // mesmo ponto e nenhuma seria clicável.
                style={{ top: `${indice * 22 + 11}px`, right: -6 }}
                className="!bg-primary !h-2.5 !w-2.5"
              />
            </div>
          ))}
        </div>
      ) : (
        outlets.length === 1 && (
          <Handle
            type="source"
            position={Position.Bottom}
            id={outlets[0]?.id}
            className="!bg-primary !h-2.5 !w-2.5"
          />
        )
      )}
    </div>
  );
});
