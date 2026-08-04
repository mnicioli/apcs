"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/auth/actions";
import { AUTH_ERROR_MESSAGES, AUTH_INITIAL_STATE } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, AUTH_INITIAL_STATE);
  const errorMessage = state.error ? AUTH_ERROR_MESSAGES[state.error] : null;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@empresa.com"
          required
          aria-invalid={!!errorMessage}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!errorMessage}
        />
      </div>

      {errorMessage && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      )}

      <Button type="submit" className="w-full" loading={pending} disabled={pending}>
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
