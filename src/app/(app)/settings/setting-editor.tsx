"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { setAppSettingAction } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Editor de um texto configurável.
 *
 * ⚠️ O CAMPO NUNCA FICA VAZIO NO SALVAMENTO — o botão exige conteúdo, e o banco
 * exige também (CHECK de tamanho). Uma confirmação de opt-out em branco seria a
 * pessoa que acabou de pedir para parar recebendo uma mensagem vazia, achando
 * que o pedido não funcionou.
 */
export function SettingEditor({
  settingKey,
  label,
  help,
  value,
}: {
  settingKey: string;
  label: string;
  help: string;
  value: string;
}) {
  const router = useRouter();
  const campoId = useId();

  const [texto, setTexto] = useState(value);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pendente, startTransition] = useTransition();

  const alterado = texto.trim() !== value.trim();

  function salvar() {
    setErro(null);
    setSalvo(false);

    startTransition(async () => {
      const resultado = await setAppSettingAction({ key: settingKey, value: texto });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setSalvo(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={campoId}>{label}</Label>
      <Textarea
        id={campoId}
        rows={3}
        maxLength={2000}
        value={texto}
        disabled={pendente}
        onChange={(evento) => setTexto(evento.target.value)}
      />
      <p className="text-muted-foreground text-xs">{help}</p>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          loading={pendente}
          disabled={!alterado || texto.trim().length === 0}
          onClick={salvar}
        >
          Salvar
        </Button>
        {salvo && !alterado && (
          <span role="status" className="text-muted-foreground text-xs">
            Salvo. A próxima mensagem já sai com este texto.
          </span>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}
    </div>
  );
}
