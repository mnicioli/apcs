"use client";

import { useState } from "react";
import { AlertTriangle, Check, History } from "lucide-react";
import {
  checklistProgress,
  FLOW_CHECKLIST_ITEMS,
  isChecklistComplete,
  readFlowChecklist,
  toggleChecklistItem,
  type FlowChecklist,
} from "@/modules/flow/flow.checklist";
import { diffFlowGraphs, summarizeFlowDiff, type FlowDiff } from "@/modules/flow/flow.diff";
import { ADMIN_AUDIT_ACTION_LABELS } from "@/modules/admin/admin.labels";
import { formatDateTime } from "@/lib/utils";
import type { AdminAuditEntry } from "@/modules/admin/admin.types";
import type { FlowGraph } from "@/modules/flow/flow.rules";
import type { FlowVersion } from "@/modules/flow/flow.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * HOMOLOGAÇÃO — §21, §22, §23, §38 e §39 do Prompt 5.
 *
 * As quatro peças que fazem a diferença entre "o desenho está pronto" e "a APCS
 * decidiu colocá-lo no ar":
 *
 *   CHECKLIST     quem conferiu o quê, e quando           (§21)
 *   REPROVAÇÃO    por que voltou, escrito por quem reprovou (§22)
 *   RESUMO        o que muda em relação ao que está no ar  (§23, §39)
 *   HISTÓRICO     quem mexeu, quando                       (§38)
 *
 * ⚠️ NENHUMA DELAS É UMA TRAVA. As travas de verdade — nó inicial, beco sem
 * saída, ação sem handler, time inativo — moram em `validate_flow_version()`, no
 * banco, e valem para todo caminho. O que está aqui é material de CONVERSA entre
 * pessoas, e o comentário no topo de `flow.checklist.ts` explica por que
 * transformar afirmação humana em porta produz o hábito de marcar sem ler.
 */

/* -------------------------------------------------------------------------- */
/* §21 — o checklist                                                          */
/* -------------------------------------------------------------------------- */

export function ChecklistCard({
  version,
  canWrite,
  pendente,
  onSalvar,
}: {
  version: FlowVersion;
  canWrite: boolean;
  pendente: boolean;
  onSalvar: (checklist: FlowChecklist) => void;
}) {
  const checklist = readFlowChecklist(version.checklist);
  const { done, total } = checklistProgress(checklist);
  const completo = isChecklistComplete(checklist);

  // ⚠️ VERSÃO PUBLICADA NÃO ACEITA MARCAÇÃO NOVA, e o banco recusa com FL008.
  // Desabilitar aqui evita o clique que vira erro — mas a barreira é lá.
  const congelada = version.status === "published" || version.status === "superseded";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Checklist de homologação</CardTitle>
        <Badge variant={completo ? "done" : "attention"}>
          {done} de {total}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ⚠️ A FRASE É IMPORTANTE E FÁCIL DE CORTAR. Sem ela, quem vê caixas de
            seleção ao lado de um botão "Publicar" conclui que precisa marcar
            tudo para publicar — e passa a marcar tudo sem ler, que é
            exatamente o que este checklist existe para NÃO produzir. */}
        <p className="text-muted-foreground text-xs">
          Isto não bloqueia a publicação: é o registro de quem conferiu o quê. O que impede publicar
          um desenho quebrado é a lista de pendências, que o sistema confere sozinho.
        </p>

        <ul className="space-y-2">
          {FLOW_CHECKLIST_ITEMS.map((item) => {
            const entrada = checklist[item.key];
            const marcado = entrada?.checked === true;

            return (
              <li key={item.key}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={marcado}
                    disabled={!canWrite || congelada || pendente}
                    onChange={(e) =>
                      onSalvar(toggleChecklistItem(checklist, item.key, e.target.checked, null))
                    }
                  />
                  <span className="min-w-0">
                    <span className={marcado ? "text-muted-foreground line-through" : ""}>
                      {item.label}
                    </span>
                    {marcado && entrada?.at && (
                      <span className="text-muted-foreground block text-xs">
                        {entrada.by ? `${entrada.by} · ` : ""}
                        {formatDateTime(entrada.at)}
                      </span>
                    )}
                    <span className="text-muted-foreground block text-xs">{item.help}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* §22 — a reprovação                                                         */
/* -------------------------------------------------------------------------- */

/**
 * O aviso de que ESTA versão foi reprovada, com o motivo.
 *
 * ⚠️ ELE FICA NO TOPO, e não escondido numa aba. Quem abre um rascunho que
 * voltou precisa ler o motivo ANTES de começar a mexer — descobrir depois de
 * meia hora de trabalho que o problema era outro é o desperdício que o §22
 * existe para evitar.
 */
export function RejectionNotice({ version }: { version: FlowVersion }) {
  if (!version.reviewNotes) return null;

  return (
    <div className="border-destructive/40 bg-destructive/5 flex items-start gap-2 rounded-md border px-3 py-2">
      <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">Esta versão foi reprovada</p>
        <p className="text-muted-foreground whitespace-pre-wrap">{version.reviewNotes}</p>
        {version.reviewedAt && (
          <p className="text-muted-foreground text-xs">{formatDateTime(version.reviewedAt)}</p>
        )}
      </div>
    </div>
  );
}

export function RejectDialog({
  pendente,
  onConfirmar,
  onFechar,
}: {
  pendente: boolean;
  onConfirmar: (motivo: string) => void;
  onFechar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const valido = motivo.trim().length >= 5;

  return (
    <Dialog
      open
      onClose={onFechar}
      title="Reprovar esta versão"
      description="Ela volta para rascunho. Quem desenhou vai ler o motivo ao abrir."
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="motivo-reprovacao">Motivo</Label>
          <Textarea
            id="motivo-reprovacao"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            placeholder="Ex.: a triagem de Financeiro está direcionando para o time de Marketing."
          />
          {/* ⚠️ A AJUDA DIZ PARA QUEM O TEXTO SERVE. "Campo obrigatório" faria a
              pessoa escrever "não" só para passar da tela. */}
          <p className="text-muted-foreground text-xs">
            Diga o que precisa mudar. Esta frase é a única informação que quem for corrigir vai ter.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            loading={pendente}
            disabled={!valido}
            onClick={() => onConfirmar(motivo.trim())}
          >
            Reprovar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* §23 e §39 — o resumo antes de publicar                                     */
/* -------------------------------------------------------------------------- */

export function PublishDialog({
  version,
  flowName,
  rascunho,
  publicada,
  pendente,
  onConfirmar,
  onFechar,
}: {
  version: FlowVersion;
  flowName: string;
  rascunho: FlowGraph;
  /** O desenho que está NO AR. `null` quando esta é a primeira publicação. */
  publicada: FlowGraph | null;
  pendente: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  /**
   * ⚠️ O DIFF É CALCULADO NO CLIENTE, e não no servidor. Os dois desenhos já
   * estão na memória desta tela — o rascunho porque está sendo editado, o
   * publicado porque a página o carregou. Uma chamada nova ao servidor
   * atrasaria a confirmação para recalcular o que já se sabe.
   */
  const diff: FlowDiff | null = publicada ? diffFlowGraphs(publicada, rascunho) : null;

  return (
    <Dialog
      open
      onClose={onFechar}
      title={version.status === "superseded" ? "Restaurar esta versão" : "Publicar esta versão"}
      description="Depois disto ela passa a atender as conversas reais."
    >
      <div className="space-y-4">
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">Fluxo</dt>
            <dd className="font-medium">{flowName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Versão</dt>
            <dd className="font-medium">v{version.version}</dd>
          </div>
        </dl>

        {/* -------- §39. O que muda -------- */}
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Alterações em relação ao que está no ar
            {diff && (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {summarizeFlowDiff(diff)}
              </span>
            )}
          </p>

          {!diff ? (
            /* ⚠️ A PRIMEIRA PUBLICAÇÃO NÃO TEM COM O QUE COMPARAR, e dizer isso
               é melhor que mostrar uma lista vazia — que se leria como "nada
               muda", o oposto da verdade. */
            <p className="text-muted-foreground text-sm">
              Esta é a primeira versão a ir ao ar neste fluxo. Não há nada anterior com que
              comparar.
            </p>
          ) : diff.entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              O desenho é idêntico ao que já está no ar.
            </p>
          ) : (
            <ul className="border-border max-h-56 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
              {diff.entries.map((entrada, i) => (
                <li key={`${entrada.key}-${i}`} className="flex items-start gap-2">
                  <span
                    className={
                      entrada.kind === "added"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : entrada.kind === "removed"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                    aria-hidden="true"
                  >
                    {entrada.kind === "added" ? "+" : entrada.kind === "removed" ? "−" : "~"}
                  </span>
                  <span className="min-w-0">
                    <span className="font-mono text-xs">{entrada.key}</span>
                    {entrada.details.length > 0 && (
                      <span className="text-muted-foreground block text-xs">
                        {entrada.details.join(" · ")}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-muted-foreground text-xs">
          A versão que está no ar hoje não é apagada: ela passa a “substituída” e continua no
          histórico, disponível para restauração. As conversas já em andamento seguem no desenho com
          que começaram.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button loading={pendente} onClick={onConfirmar}>
            <Check className="mr-1 h-4 w-4" aria-hidden="true" />
            {version.status === "superseded" ? "Restaurar" : "Publicar"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* §38 — o histórico                                                          */
/* -------------------------------------------------------------------------- */

export function HistoryCard({ entries }: { entries: AdminAuditEntry[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <History className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        <CardTitle className="text-base">Histórico</CardTitle>
      </CardHeader>

      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nada registrado ainda.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {entries.map((entrada) => (
              <li key={entrada.id} className="border-border/60 border-b pb-2 last:border-0">
                <p>
                  <span className="font-medium">{entrada.actorName ?? "Alguém"}</span>{" "}
                  {ADMIN_AUDIT_ACTION_LABELS[entrada.action]?.toLowerCase() ?? entrada.action}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTime(entrada.createdAt)}
                  {typeof entrada.metadata["motivo"] === "string" && entrada.metadata["motivo"] && (
                    <> · {String(entrada.metadata["motivo"])}</>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}

        {/* ⚠️ A LIMITAÇÃO PRECISA ESTAR ESCRITA NA TELA, e não só no código. A
            trilha guarda o NOME do fluxo como alvo (é assim que
            `log_admin_action` grava), então renomear parte o histórico em dois —
            e quem não souber vai achar que o registro sumiu. */}
        <p className="text-muted-foreground mt-3 text-xs">
          O histórico é buscado pelo nome do fluxo. Se o fluxo já foi renomeado, os registros
          anteriores à mudança ficaram com o nome antigo.
        </p>
      </CardContent>
    </Card>
  );
}
