"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { updateUserAction } from "@/lib/actions/admin";
import { updateUserSchema } from "@/modules/admin/admin.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Nome e e-mail.
 *
 * ⚠️ O AVISO DA TROCA DE E-MAIL APARECE ENQUANTO SE DIGITA, e não depois de
 * salvar. O e-mail aqui é a identidade de LOGIN: trocá-lo muda por onde a
 * pessoa entra no sistema, o que não é óbvio numa tela chamada "Cadastro". Uma
 * confirmação depois do clique chegaria tarde — a decisão já teria sido tomada.
 *
 * ⚠️ O BOTÃO SÓ ACORDA COM ALGO ALTERADO, como nas outras telas de edição da
 * Administração: um "Salvar" sempre aceso convida ao clique que só produz uma
 * escrita e uma linha de auditoria dizendo que nada mudou.
 */
export function UserEditForm({
  userId,
  fullName,
  email,
}: {
  userId: string;
  fullName: string;
  email: string;
}) {
  const router = useRouter();
  const nomeId = useId();
  const emailId = useId();

  const [nome, setNome] = useState(fullName);
  const [endereco, setEndereco] = useState(email);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pendente, startTransition] = useTransition();

  const alterado = nome !== fullName || endereco !== email;
  const emailMudou = endereco.trim().toLowerCase() !== email.toLowerCase();

  function salvar() {
    setErro(null);
    setSalvo(false);

    // A mesma validação que a action repete no servidor — aqui ela só evita a
    // ida ao servidor para dizer o que dá para saber daqui.
    const analise = updateUserSchema.safeParse({ userId, fullName: nome, email: endereco });
    if (!analise.success) {
      setErro(analise.error.issues[0]?.message ?? ACTION_ERROR_MESSAGES.invalidInput);
      return;
    }

    startTransition(async () => {
      const resultado = await updateUserAction({ userId, fullName: nome, email: endereco });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setSalvo(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={nomeId}>Nome</Label>
        <Input
          id={nomeId}
          value={nome}
          disabled={pendente}
          maxLength={120}
          onChange={(evento) => setNome(evento.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={emailId}>E-mail</Label>
        <Input
          id={emailId}
          type="email"
          value={endereco}
          disabled={pendente}
          maxLength={254}
          onChange={(evento) => setEndereco(evento.target.value)}
        />
        {emailMudou ? (
          <p className="text-primary-strong text-xs">
            Este é o e-mail de login. Ao salvar, a pessoa passa a entrar por{" "}
            <span className="font-medium">{endereco.trim().toLowerCase()}</span> — a senha continua
            a mesma, e nenhum e-mail de confirmação é enviado.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">É por aqui que a pessoa entra no sistema.</p>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button loading={pendente} disabled={!alterado} onClick={salvar}>
          Salvar
        </Button>
        {salvo && !alterado && (
          <span role="status" className="text-muted-foreground text-xs">
            Salvo.
          </span>
        )}
      </div>
    </div>
  );
}
