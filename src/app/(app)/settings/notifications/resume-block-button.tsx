"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { resumeNotificationBlockAction } from "@/lib/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Desfaz um bloqueio pela lista.
 *
 * ⚠️ EXIGE DIZER QUEM PEDIU, exatamente como na ficha do associado, e pelo mesmo
 * motivo: reativar é a APCS voltar a mandar mensagem para quem tinha mandado
 * parar, e o que separa isso de um abuso é a pessoa ter pedido de volta. A nota
 * é a autorização — o banco recusa sem ela (MA008), então esta validação é
 * conveniência.
 */
export function ResumeBlockButton({ blockId }: { blockId: string }) {
  const router = useRouter();
  const notaId = useId();

  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function reativar() {
    setErro(null);
    startTransition(async () => {
      const resultado = await resumeNotificationBlockAction({ blockId, note: nota });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setAberto(false);
      setNota("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Badge variant="alert">Não recebe</Badge>
      <Button variant="outline" size="sm" className="block" onClick={() => setAberto(true)}>
        Voltar a receber
      </Button>

      <Dialog
        open={aberto}
        onClose={() => setAberto(false)}
        title="Voltar a receber mensagens"
        description="Só faça isso se a própria pessoa pediu. O bloqueio é do telefone, então quem mais usa o mesmo número também volta a receber."
      >
        <div className="space-y-2">
          <Label htmlFor={notaId}>Quem pediu, e por onde</Label>
          <Textarea
            id={notaId}
            rows={3}
            maxLength={300}
            value={nota}
            onChange={(evento) => setNota(evento.target.value)}
            placeholder="Ex.: a própria pessoa pediu por telefone, falou com a Ana."
          />
          <p className="text-muted-foreground text-xs">
            Fica registrado. É este texto que responde, depois, por que a APCS voltou a mandar
            mensagem.
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
          <Button loading={pendente} disabled={nota.trim().length < 5} onClick={reativar}>
            Voltar a receber
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
