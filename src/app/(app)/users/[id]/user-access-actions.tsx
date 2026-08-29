"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Power, PowerOff } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { resetUserPasswordAction, setUserActiveAction } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";

/**
 * As duas operações que mexem no ACESSO, e não no cadastro: mandar recuperação
 * de senha e ligar/desligar a conta.
 *
 * ⚠️ INATIVAR PEDE CONFIRMAÇÃO; REATIVAR NÃO. A assimetria é de propósito e
 * segue a assimetria da consequência: desligar tira o acesso de alguém que pode
 * estar no meio de um atendimento, e ligar de volta é o desfazer. Pedir
 * confirmação nos dois lados ensina a pessoa a clicar "sim" sem ler, que é
 * exatamente o que anula a proteção do lado que importa.
 *
 * ⚠️ A CONFIRMAÇÃO É UM SEGUNDO ESTADO DO BOTÃO, e não um `window.confirm`. O
 * diálogo do navegador não é estilizável, não diz o nome de quem será
 * desligado, e em alguns navegadores nem aparece se a aba não estiver em foco.
 */
export function UserAccessActions({
  userId,
  email,
  active,
  isSelf,
  lastActiveAdmin,
}: {
  userId: string;
  email: string;
  active: boolean;
  isSelf: boolean;
  lastActiveAdmin: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pendente, startTransition] = useTransition();

  // As duas travas do banco (AD004 e AD005), antecipadas na tela. O banco
  // continua sendo quem decide — isto só evita oferecer um clique que já se
  // sabe que vai ser recusado.
  const travado = isSelf || (active && lastActiveAdmin);
  const motivoTravado = isSelf
    ? "Você não pode inativar a própria conta."
    : "É o único administrador ativo do sistema.";

  function alternar(novo: boolean) {
    setErro(null);
    setAviso(null);
    setConfirmando(false);

    startTransition(async () => {
      const resultado = await setUserActiveAction({ userId, active: novo });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      router.refresh();
    });
  }

  function mandarReset() {
    setErro(null);
    setAviso(null);

    startTransition(async () => {
      const resultado = await resetUserPasswordAction({ userId });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setAviso(`E-mail de recuperação enviado para ${resultado.data.email}.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Button variant="outline" loading={pendente} onClick={mandarReset} className="w-full">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Enviar recuperação de senha
        </Button>
        <p className="text-muted-foreground text-xs">
          A pessoa recebe um link em <span className="font-medium">{email}</span> para definir uma
          senha nova. A senha atual continua valendo até ela usar o link.
        </p>
      </div>

      <div className="border-border space-y-2 border-t pt-4">
        {active ? (
          travado ? (
            <>
              <Button variant="outline" disabled className="w-full">
                <PowerOff className="h-4 w-4" aria-hidden="true" />
                Inativar conta
              </Button>
              <p className="text-muted-foreground text-xs">{motivoTravado}</p>
            </>
          ) : confirmando ? (
            <>
              <p className="text-sm font-medium">Inativar {email}?</p>
              <p className="text-muted-foreground text-xs">
                A pessoa perde o acesso imediatamente, inclusive em abas já abertas. O cadastro e o
                histórico ficam. Dá para reativar depois.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  loading={pendente}
                  onClick={() => alternar(false)}
                  className="flex-1"
                >
                  Inativar
                </Button>
                <Button
                  variant="ghost"
                  disabled={pendente}
                  onClick={() => setConfirmando(false)}
                  className="flex-1"
                >
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={pendente}
                onClick={() => setConfirmando(true)}
                className="w-full"
              >
                <PowerOff className="h-4 w-4" aria-hidden="true" />
                Inativar conta
              </Button>
              <p className="text-muted-foreground text-xs">
                Tira o acesso sem apagar nada. É o que se usa quando alguém sai da APCS.
              </p>
            </>
          )
        ) : (
          <>
            <Button loading={pendente} onClick={() => alternar(true)} className="w-full">
              <Power className="h-4 w-4" aria-hidden="true" />
              Reativar conta
            </Button>
            <p className="text-muted-foreground text-xs">
              A pessoa volta a entrar com o papel que já tinha. Confira o papel antes.
            </p>
          </>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="text-primary-strong text-sm">
          {aviso}
        </p>
      )}
    </div>
  );
}
