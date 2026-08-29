"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { AUTH_ERROR_MESSAGES, AUTH_INITIAL_STATE, AUTH_RESET_SENT_MESSAGE } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    AUTH_INITIAL_STATE,
  );

  /*
    ⚠️ O FORMULÁRIO SOME DEPOIS DE ENVIAR. Deixá-lo na tela convidaria ao
    segundo clique — que o Supabase recusa por excesso de tentativas, fazendo a
    pessoa concluir que nada foi enviado justamente quando foi.
  */
  if (state.sent) {
    return (
      <div className="space-y-3">
        <p role="status" className="flex items-start gap-2 text-sm">
          <MailCheck className="text-primary-strong mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {AUTH_RESET_SENT_MESSAGE}
        </p>
      </div>
    );
  }

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
          autoFocus
          aria-invalid={!!errorMessage}
        />
      </div>

      {errorMessage && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      )}

      <Button type="submit" className="w-full" loading={pending} disabled={pending}>
        {pending ? "Enviando..." : "Enviar link de recuperação"}
      </Button>
    </form>
  );
}
