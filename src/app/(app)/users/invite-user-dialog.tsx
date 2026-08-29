"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { inviteUserAction } from "@/lib/actions/admin";
import type { RoleDefinition } from "@/lib/rbac/rbac.runtime";
import type { RoleKey } from "@/lib/rbac/rbac.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * O CONVITE — a porta de entrada que não existia.
 *
 * Antes disto, um usuário novo só nascia no painel do Supabase: alguém tinha de
 * ter acesso ao projeto, criar o usuário à mão e depois lembrar de voltar aqui
 * para dar o papel. Duas ferramentas e dois passos para uma tarefa que é uma só.
 *
 * ⚠️ O CARGO É ESCOLHIDO AGORA, JUNTO DO CONVITE. Toda pessoa convidada nasce
 * como `viewer` (é o trigger `handle_new_user`, e está certo: nunca confiar em
 * metadata de signup para definir permissão). O papel escolhido aqui é aplicado
 * logo depois, pela mesma action. Sem isso, alguém entraria e não veria nada,
 * esperando um segundo clique que ninguém lembrou de dar.
 *
 * ⚠️ O CONVITE DEPENDE DO SMTP DO SUPABASE, e quando ele falha a mensagem diz
 * isso — porque a solução é no painel do Supabase, não aqui. "Erro inesperado"
 * mandaria a pessoa tentar de novo para sempre.
 */
/**
 * ⚠️ OS CARGOS VÊM DE FORA. A APCS cria cargos próprios desde
 * 20260903000100 — uma lista fixa aqui convidaria sempre para os quatro
 * embutidos, e o cargo criado ontem não apareceria.
 */
export function InviteUserDialog({ roles }: { roles: readonly RoleDefinition[] }) {
  const router = useRouter();
  const emailId = useId();
  const nomeId = useId();
  const papelId = useId();

  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  // ⚠️ NUNCA COMEÇA EM ADMINISTRADOR. O primeiro da lista é ele (é o de maior
  // ordem na matriz), e um convite enviado sem alguém reparar no seletor daria
  // acesso total. "Comercial" é o cargo de quem trabalha no dia a dia; sem ele,
  // o de menor alcance.
  const [papel, setPapel] = useState<RoleKey>(
    () =>
      roles.find((cargo) => cargo.key === "comercial")?.key ??
      roles.find((cargo) => cargo.key === "viewer")?.key ??
      roles[roles.length - 1]?.key ??
      "viewer",
  );
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function fechar() {
    setAberto(false);
    setErro(null);
  }

  function convidar() {
    setErro(null);
    setAviso(null);

    startTransition(async () => {
      const resultado = await inviteUserAction({ email, fullName: nome || undefined, role: papel });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      // ⚠️ O CONVITE JÁ FOI, mesmo que o cargo não tenha sido aplicado. Dizer
      // "tudo certo" nesse caso deixaria a pessoa entrando como Visualização
      // sem ninguém saber por quê.
      setAviso(
        resultado.data.roleApplied
          ? `Convite enviado para ${email}.`
          : `Convite enviado para ${email}, mas o cargo não foi aplicado — ajuste na lista abaixo.`,
      );

      setEmail("");
      setNome("");
      setAberto(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => setAberto(true)}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        Convidar usuário
      </Button>

      {aviso && (
        <p role="status" className="text-sm">
          {aviso}
        </p>
      )}

      <Dialog
        open={aberto}
        onClose={fechar}
        title="Convidar para o sistema"
        description="A pessoa recebe um e-mail com o link para criar a própria senha. O cargo escolhido aqui já vale no primeiro acesso."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={emailId}>
              E-mail <span aria-hidden="true">*</span>
              <span className="sr-only">(obrigatório)</span>
            </Label>
            <Input
              id={emailId}
              type="email"
              inputMode="email"
              value={email}
              disabled={pendente}
              placeholder="nome@apcs.org.br"
              onChange={(evento) => setEmail(evento.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={nomeId}>Nome</Label>
            <Input
              id={nomeId}
              value={nome}
              disabled={pendente}
              placeholder="Opcional — a pessoa pode preencher depois"
              onChange={(evento) => setNome(evento.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={papelId}>Cargo</Label>
            <Select
              id={papelId}
              value={papel}
              disabled={pendente}
              onChange={(evento) => setPapel(evento.target.value)}
            >
              {roles.map((cargo) => (
                <option key={cargo.key} value={cargo.key}>
                  {cargo.label}
                </option>
              ))}
            </Select>
            {/* A descrição muda com a escolha: o nome de um cargo não diz o que
                ele abre, e errar aqui é dar acesso demais ou de menos. */}
            <p className="text-muted-foreground text-xs">
              {roles.find((cargo) => cargo.key === papel)?.description ?? ""}
            </p>
          </div>

          {erro && (
            <p role="alert" className="text-destructive text-sm">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button loading={pendente} disabled={email.trim().length < 5} onClick={convidar}>
            Enviar convite
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
