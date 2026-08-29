"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { resumeMemberNotificationsAction } from "@/lib/actions/membership";
import { formatWhatsapp } from "@/modules/membership/membership.schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * O estado de notificações do associado — e o caminho de volta.
 *
 * ⚠️ TRÊS ESTADOS, E NÃO DOIS. "Recebe" e "Não recebe" não cobrem quem não tem
 * WhatsApp cadastrado: essa pessoa não pediu para sair, mas também não vai
 * receber nada. Mostrá-la como "Recebe" faria o time contar com um alcance que
 * não existe.
 *
 * ⚠️ REATIVAR ABRE UM DIÁLOGO E EXIGE DIZER QUEM PEDIU. Não é atrito por
 * atrito: o botão manda a APCS voltar a falar com alguém que tinha mandado
 * parar, e a única coisa que separa isso de um abuso é a pessoa ter pedido de
 * volta. O texto fica na trilha; é ele que responde "por que voltaram a me
 * mandar mensagem?" seis meses depois.
 *
 * ⚠️ O AVISO SOBRE O TELEFONE COMPARTILHADO É REAL, não jurídico decorativo. O
 * bloqueio é do NÚMERO — marido e mulher na mesma granja, um telefone de
 * escritório —, então reativar um associado pode reativar outro. A tela diz
 * isso ANTES, e a confirmação diz quantos foram DEPOIS.
 */
export function MemberNotifications({
  memberId,
  whatsapp,
  optedOut,
  canEdit,
}: {
  memberId: string;
  whatsapp: string | null;
  optedOut: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [liberados, setLiberados] = useState<number | null>(null);
  const [pendente, startTransition] = useTransition();

  if (!whatsapp) {
    return (
      <p className="text-muted-foreground text-sm">
        Sem WhatsApp cadastrado. Este associado não recebe divulgação de eventos nem enquetes.
      </p>
    );
  }

  if (!optedOut) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Recebe divulgação de eventos e enquetes em {formatWhatsapp(whatsapp)}.
        </p>
        {/* Aparece só depois de uma reativação feita nesta tela — some no
            próximo carregamento, porque a partir daí o estado normal É este. */}
        {liberados !== null && (
          <p role="status" className="font-medium">
            {liberados === 0
              ? "Não havia bloqueio neste número."
              : liberados === 1
                ? "Bloqueio desfeito. Este número volta a receber."
                : `${liberados} bloqueios desfeitos neste número — ele era compartilhado.`}
          </p>
        )}
      </div>
    );
  }

  function reativar() {
    setErro(null);
    startTransition(async () => {
      const resultado = await resumeMemberNotificationsAction({ memberId, note: nota });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setLiberados(resultado.data.unblocked);
      setAberto(false);
      setNota("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 text-sm">
      <Badge variant="alert">Não recebe</Badge>
      <p className="text-muted-foreground">
        Este número pediu para parar de receber mensagens da APCS. O bloqueio é do TELEFONE, não do
        cadastro: se outro associado usa {formatWhatsapp(whatsapp)}, ele também está bloqueado.
      </p>

      {canEdit ? (
        <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
          Voltar a receber
        </Button>
      ) : (
        <p className="text-muted-foreground">
          Desfazer o bloqueio é feito por Administrador ou Gestor.
        </p>
      )}

      {erro && !aberto && (
        <p role="alert" className="text-destructive">
          {erro}
        </p>
      )}

      <Dialog
        open={aberto}
        onClose={() => setAberto(false)}
        title="Voltar a receber mensagens"
        description="Só faça isso se a própria pessoa pediu. O bloqueio é do telefone, então outros associados que usam o mesmo número também voltam a receber."
      >
        <div className="space-y-2">
          <Label htmlFor="resume-note">Quem pediu, e por onde</Label>
          <Textarea
            id="resume-note"
            rows={3}
            maxLength={300}
            value={nota}
            onChange={(evento) => setNota(evento.target.value)}
            placeholder="Ex.: a própria Maria pediu por telefone em 29/08, falou com a Ana."
          />
          <p className="text-muted-foreground text-xs">
            Fica registrado no histórico do associado. É este texto que responde, depois, por que a
            APCS voltou a mandar mensagem.
          </p>
        </div>

        {erro && (
          <p role="alert" className="text-destructive mt-3 text-sm">
            {erro}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)} disabled={pendente}>
            Cancelar
          </Button>
          {/* O botão só habilita com a nota — mas o banco também exige (MA008),
              e é ele quem decide: isto é conveniência, não a regra. */}
          <Button loading={pendente} disabled={nota.trim().length < 5} onClick={reativar}>
            Voltar a receber
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
