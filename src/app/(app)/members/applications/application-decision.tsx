"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveMembershipApplicationAction,
  rejectMembershipApplicationAction,
  reopenMembershipApplicationAction,
  startMembershipReviewAction,
} from "@/lib/actions/membership";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MembershipApplicationStatus } from "@/modules/membership/membership.types";

/**
 * As decisões sobre uma solicitação: assumir, aprovar, recusar, devolver.
 *
 * ⚠️ APROVAR ABRE UM DIÁLOGO EM VEZ DE AGIR NO CLIQUE. Aprovar CRIA uma linha
 * no registro de associados — é a operação menos reversível do módulo (o grafo
 * não tem saída de "aprovada"). Um clique acidental num botão da barra não pode
 * produzir um associado, então o diálogo é o passo de confirmação; a observação
 * é opcional dentro dele.
 *
 * Recusar exige motivo, e o motivo é validado no BANCO (código MA005) além
 * daqui: quem chamar a função por fora também precisa justificar.
 *
 * Os botões que a pessoa vê saem da SITUAÇÃO, e a situação vem do grafo do
 * banco. Se um dia o grafo mudar, o que a tela oferece continua sendo o que o
 * banco aceita — porque as duas listas abaixo espelham as arestas declaradas em
 * `membership_application_status_transitions`.
 */
export function ApplicationDecision({
  id,
  status,
}: {
  id: string;
  status: MembershipApplicationStatus;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<"approve" | "reject" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");

  const executar = (acao: () => Promise<{ ok: boolean; error?: { code: string } }>) => {
    setErro(null);
    startTransition(async () => {
      const resultado = await acao();
      if (!resultado.ok) {
        const codigo = resultado.error?.code as keyof typeof ACTION_ERROR_MESSAGES | undefined;
        setErro(codigo ? ACTION_ERROR_MESSAGES[codigo] : ACTION_ERROR_MESSAGES.unexpected);
        return;
      }
      setDialogo(null);
      setMotivo("");
      setObservacao("");
      // A action já revalidou o cache no servidor; o refresh é o que faz esta
      // tela buscar de novo sem uma navegação inteira.
      router.refresh();
    });
  };

  const podeDecidir = status === "pending" || status === "in_review";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "pending" && (
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() => executar(() => startMembershipReviewAction(id))}
          >
            Assumir análise
          </Button>
        )}

        {status === "in_review" && (
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() => executar(() => reopenMembershipApplicationAction(id))}
          >
            Devolver para a fila
          </Button>
        )}

        {status === "rejected" && (
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() => executar(() => reopenMembershipApplicationAction(id))}
          >
            Reabrir solicitação
          </Button>
        )}

        {podeDecidir && (
          <>
            <Button variant="outline" disabled={pendente} onClick={() => setDialogo("reject")}>
              Recusar
            </Button>
            <Button disabled={pendente} onClick={() => setDialogo("approve")}>
              Aprovar e cadastrar
            </Button>
          </>
        )}

        {status === "approved" && (
          <p className="text-muted-foreground text-sm">
            Esta solicitação já virou um associado. Para desfazer, inative o associado no registro.
          </p>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      <Dialog
        open={dialogo === "approve"}
        onClose={() => setDialogo(null)}
        title="Aprovar e cadastrar associado"
        description="A pessoa entra no registro de associados como ativa. Se já existir um associado com este e-mail, a solicitação é vinculada a ele em vez de criar um segundo cadastro."
      >
        <div className="space-y-2">
          <Label htmlFor="approve-note">Observação (opcional)</Label>
          <Textarea
            id="approve-note"
            rows={3}
            maxLength={1000}
            value={observacao}
            onChange={(evento) => setObservacao(evento.target.value)}
            placeholder="Fica registrada na solicitação e na trilha de auditoria."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogo(null)} disabled={pendente}>
            Cancelar
          </Button>
          <Button
            loading={pendente}
            onClick={() =>
              executar(() =>
                approveMembershipApplicationAction({ id, note: observacao || undefined }),
              )
            }
          >
            Aprovar e cadastrar
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={dialogo === "reject"}
        onClose={() => setDialogo(null)}
        title="Recusar solicitação"
        description="O motivo fica registrado. A solicitação pode ser reaberta depois, se a situação mudar."
      >
        <div className="space-y-2">
          <Label htmlFor="reject-reason">Motivo da recusa</Label>
          <Textarea
            id="reject-reason"
            rows={3}
            maxLength={1000}
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
            placeholder="Ex.: atuação fora do escopo da APCS."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogo(null)} disabled={pendente}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            loading={pendente}
            // O botão só habilita com motivo — mas o banco também exige, e é
            // ele quem decide: esta checagem é conveniência, não a regra.
            disabled={motivo.trim().length < 5}
            onClick={() =>
              executar(() => rejectMembershipApplicationAction({ id, reason: motivo }))
            }
          >
            Recusar solicitação
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
