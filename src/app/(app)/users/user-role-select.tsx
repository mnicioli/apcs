"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { setUserRoleKeyAction } from "@/lib/actions/roles";
import type { RoleDefinition } from "@/lib/rbac/rbac.runtime";
import type { RoleKey } from "@/lib/rbac/rbac.types";
import { Select } from "@/components/ui/select";

/**
 * O seletor de CARGO de uma linha da lista.
 *
 * ⚠️ A LISTA DE CARGOS VEM DE FORA, e não de uma constante. Desde
 * 20260903000100 a APCS cria cargos próprios: uma lista fixa aqui ofereceria
 * quatro opções num sistema que pode ter sete, e ninguém entenderia por que o
 * cargo recém-criado não aparece.
 *
 * ⚠️ SALVA NO `change`, sem botão de confirmar. É um campo só, e a mudança é
 * reversível no mesmo seletor — um "Salvar" ao lado de cada linha criaria vinte
 * botões numa tela de vinte pessoas, e o estado "escolhi mas não salvei" que
 * vem junto é justamente o que faz alguém sair da página achando que mudou.
 *
 * ⚠️ O VALOR VOLTA SOZINHO QUANDO O SERVIDOR RECUSA. Sem isso, o seletor ficaria
 * mostrando um cargo que a pessoa não tem — a tela mentindo sobre o banco, que é
 * o pior desfecho possível numa tela de permissão.
 */
export function UserRoleSelect({
  userId,
  roleKey,
  roles,
  locked,
}: {
  userId: string;
  roleKey: RoleKey;
  roles: readonly RoleDefinition[];
  /** Próprio usuário (AD002) ou último administrador (AD001). */
  locked: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState<RoleKey>(roleKey);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const rotulo = roles.find((cargo) => cargo.key === valor)?.label ?? valor;

  if (locked) {
    return (
      <div>
        <span className="text-sm">{rotulo}</span>
        <span className="text-muted-foreground block text-xs">Não pode ser alterado aqui</span>
      </div>
    );
  }

  function trocar(novo: RoleKey) {
    const anterior = valor;
    setValor(novo);
    setErro(null);

    startTransition(async () => {
      const resultado = await setUserRoleKeyAction({ userId, roleKey: novo });

      if (!resultado.ok) {
        setValor(anterior);
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      // O servidor redesenha: o aviso do administrador único e a trilha mudam
      // junto com o cargo.
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Select
        aria-label="Cargo"
        value={valor}
        disabled={pendente}
        onChange={(evento) => trocar(evento.target.value)}
        className="w-44"
      >
        {roles.map((cargo) => (
          <option key={cargo.key} value={cargo.key}>
            {cargo.label}
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
