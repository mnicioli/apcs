"use client";

import { useActionState } from "react";
import { updatePasswordAction } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { AUTH_ERROR_MESSAGES, AUTH_INITIAL_STATE } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, AUTH_INITIAL_STATE);
  const errorMessage = state.error ? AUTH_ERROR_MESSAGES[state.error] : null;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Nova senha</Label>
        {/*
          `new-password` (e não `current-password`) é o que faz o gerenciador do
          navegador OFERECER uma senha forte e, depois, guardar a nova em vez de
          insistir na antiga.

          `minLength` repete a regra do servidor de propósito: aqui ela vira
          aviso antes do envio, lá ela é a que vale. Quem confia só no navegador
          confia numa validação que qualquer um desliga.
        */}
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          autoFocus
          aria-invalid={!!errorMessage}
        />
        <p className="text-muted-foreground text-xs">
          Pelo menos {PASSWORD_MIN_LENGTH} caracteres. Uma frase que só você saiba funciona melhor
          que uma palavra com símbolos.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmation">Repita a nova senha</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          aria-invalid={state.error === "passwordsDoNotMatch"}
        />
      </div>

      {errorMessage && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      )}

      <Button type="submit" className="w-full" loading={pending} disabled={pending}>
        {pending ? "Salvando..." : "Salvar nova senha"}
      </Button>
    </form>
  );
}
