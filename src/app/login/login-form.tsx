"use client";

import { useActionState, useId, useState } from "react";
import { loginAction } from "@/lib/auth/actions";
import { AUTH_ERROR_MESSAGES, AUTH_INITIAL_STATE } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * ⚠️ O CAMPO DE E-MAIL É CONTROLADO, e o de senha não. Não é inconsistência.
 *
 * O React ZERA os campos não controlados quando uma ação de formulário termina.
 * Com a senha errada, o e-mail certo ia embora junto e a pessoa redigitava os
 * dois — que é o incômodo exato que "lembrar minhas credenciais" veio resolver.
 * Manter o e-mail em estado o preserva entre as tentativas.
 *
 * A senha continua fora do estado justamente porque esse apagamento é bom para
 * ela: senha que sobrevive na tela depois de uma tentativa é senha exposta a
 * quem passar atrás.
 */
export function LoginForm({ rememberedEmail }: { rememberedEmail: string }) {
  const [state, formAction, pending] = useActionState(loginAction, AUTH_INITIAL_STATE);
  const errorMessage = state.error ? AUTH_ERROR_MESSAGES[state.error] : null;

  const lembrarId = useId();
  const [email, setEmail] = useState(rememberedEmail);
  // Já veio um e-mail lembrado? Então a caixa já estava marcada — desmarcá-la
  // por padrão faria o próximo login apagar a lembrança sem ninguém pedir.
  const [lembrar, setLembrar] = useState(rememberedEmail !== "");

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
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          aria-invalid={!!errorMessage}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        {/*
          `current-password` é o que faz o gerenciador do navegador oferecer a
          senha guardada. É ELE quem guarda senha com segurança — este código
          não guarda nenhuma. Ver `lib/auth/remember.ts`.
        */}
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!errorMessage}
        />
      </div>

      <label htmlFor={lembrarId} className="flex items-center gap-2 text-sm">
        <input
          id={lembrarId}
          name="remember"
          type="checkbox"
          className="border-input accent-primary h-4 w-4 rounded"
          checked={lembrar}
          disabled={pending}
          onChange={(evento) => setLembrar(evento.target.checked)}
        />
        Lembrar minhas credenciais
      </label>
      {/*
        Dizer o que a caixa faz DE VERDADE. "Lembrar credenciais" costuma ser
        lido como "não vai pedir senha de novo" — e aqui não é isso. Uma linha
        agora evita a surpresa (e o chamado no suporte) depois.
      */}
      <p className="text-muted-foreground -mt-2 text-xs">
        Guarda apenas o e-mail neste navegador. A senha continua sendo pedida.
      </p>

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
