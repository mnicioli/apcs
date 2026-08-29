"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { setUserRoleAction } from "@/lib/actions/admin";
import { ROLE_LABELS, VALID_ROLES, type Role } from "@/lib/rbac/rbac.types";
import { Select } from "@/components/ui/select";

/**
 * O seletor de papel de uma linha da lista.
 *
 * ⚠️ SALVA NO `change`, sem botão de confirmar. É um campo só, e a mudança é
 * reversível no mesmo seletor — um "Salvar" ao lado de cada linha criaria vinte
 * botões numa tela de vinte pessoas, e o estado "escolhi mas não salvei" que
 * vem junto é justamente o que faz alguém sair da página achando que mudou.
 *
 * ⚠️ O VALOR VOLTA SOZINHO QUANDO O SERVIDOR RECUSA. Sem isso, o seletor ficaria
 * mostrando "Gestor" para alguém que continua sendo "Atendente" — a tela
 * mentindo sobre o banco, que é o pior desfecho possível numa tela de permissão.
 */
export function UserRoleSelect({
  userId,
  role,
  locked,
}: {
  userId: string;
  role: Role;
  /** Próprio usuário (AD002) ou último administrador (AD001). */
  locked: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState<Role>(role);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  if (locked) {
    return (
      <div>
        <span className="text-sm">{ROLE_LABELS[role]}</span>
        <span className="text-muted-foreground block text-xs">Não pode ser alterado aqui</span>
      </div>
    );
  }

  function trocar(novo: Role) {
    const anterior = valor;
    setValor(novo);
    setErro(null);

    startTransition(async () => {
      const resultado = await setUserRoleAction({ userId, role: novo });

      if (!resultado.ok) {
        setValor(anterior);
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      // O servidor redesenha: o aviso do administrador único e a trilha mudam
      // junto com o papel.
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Select
        aria-label="Papel"
        value={valor}
        disabled={pendente}
        onChange={(evento) => trocar(evento.target.value as Role)}
        className="w-44"
      >
        {VALID_ROLES.map((papel) => (
          <option key={papel} value={papel}>
            {ROLE_LABELS[papel]}
          </option>
        ))}
      </Select>
      {erro && (
        <p role="alert" className="text-destructive text-xs">
          {erro}
        </p>
      )}
    </div>
  );
}
