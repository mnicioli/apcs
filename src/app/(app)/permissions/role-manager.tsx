"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/lib/actions/roles";
import type { RoleDefinition } from "@/lib/rbac/rbac.runtime";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PERMISSION_GROUP_NOTES,
} from "@/lib/rbac/rbac.labels";
import { ROLE_LABELS, VALID_ROLES, type Permission, type Role } from "@/lib/rbac/rbac.types";
import { suggestRoleKey } from "@/modules/admin/role.schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * OS CARGOS — criar, editar o que cada um abre, excluir.
 *
 * ⚠️ A REGRA QUE ESTA TELA PRECISA ENSINAR, PORQUE NÃO É ÓBVIA: um cargo se
 * apoia num PAPEL-BASE e só consegue TIRAR dele, nunca acrescentar. As caixas
 * fora do teto do papel-base aparecem desabilitadas, e não escondidas — quem
 * está montando um cargo precisa VER que "Publicar evento" existe e entender
 * por que não pode marcá-la aqui. Escondê-las faria a pessoa procurar a
 * permissão que sumiu.
 *
 * A explicação completa está na migration 20260903000100_custom_roles.sql.
 */

type Rascunho = {
  key: string;
  label: string;
  description: string;
  baseRole: Role;
  permissions: Set<Permission>;
};

function rascunhoNovo(): Rascunho {
  return {
    key: "",
    label: "",
    description: "",
    // ⚠️ ADMINISTRADOR É O PADRÃO porque é o único teto que permite montar
    // qualquer recorte. Começar em "Visualização" (que não tem nada) faria a
    // primeira tela do formulário mostrar todas as caixas desabilitadas.
    baseRole: "admin",
    permissions: new Set<Permission>(),
  };
}

function rascunhoDe(cargo: RoleDefinition): Rascunho {
  return {
    key: cargo.key,
    label: cargo.label,
    description: cargo.description ?? "",
    baseRole: cargo.baseRole,
    permissions: new Set(cargo.permissions),
  };
}

export function RoleManager({
  roles,
  ceilings,
  counts,
}: {
  roles: readonly RoleDefinition[];
  /** O que cada papel-base entrega de fato — ver `app_role_ceilings`. */
  ceilings: Record<string, readonly Permission[]>;
  /** Contas ATIVAS por cargo. */
  counts: Record<string, number>;
}) {
  const [editando, setEditando] = useState<RoleDefinition | "novo" | null>(null);
  const [excluindo, setExcluindo] = useState<RoleDefinition | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Um cargo parte de um <strong className="text-foreground">papel-base</strong> e só pode{" "}
          <strong className="text-foreground">tirar</strong> dele. É assim que a matriz nunca
          promete um botão que o banco recusa — e é por isso que, para dar um acesso que o
          papel-base não tem, o caminho é escolher outro papel-base.
        </p>
        <Button onClick={() => setEditando("novo")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo cargo
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-border text-muted-foreground border-b text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Cargo</th>
              <th className="px-4 py-3 font-medium">Parte de</th>
              <th className="px-4 py-3 font-medium">Abre</th>
              <th className="px-4 py-3 font-medium">Pessoas</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {roles.map((cargo) => {
              const pessoas = counts[cargo.key] ?? 0;
              const teto = ceilings[cargo.baseRole]?.length ?? 0;
              const bloqueado = cargo.key === "admin";

              return (
                <tr key={cargo.key} className="border-border border-b last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{cargo.label}</span>
                    {cargo.isBuiltin && (
                      <Badge className="ml-2" variant="done">
                        original
                      </Badge>
                    )}
                    <span className="text-muted-foreground block font-mono text-[11px]">
                      {cargo.key}
                    </span>
                    {cargo.description && (
                      <span className="text-muted-foreground block max-w-md text-xs">
                        {cargo.description}
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-4 py-3">{ROLE_LABELS[cargo.baseRole]}</td>
                  <td className="text-muted-foreground px-4 py-3">
                    {/* O denominador importa: "12 de 33" diz quanto foi tirado,
                        e "12" sozinho não diz nada. */}
                    {cargo.permissions.length} de {teto}
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {pessoas === 0 ? "ninguém" : pessoas === 1 ? "1 pessoa" : `${pessoas} pessoas`}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={bloqueado}
                        title={
                          bloqueado
                            ? "O cargo Administrador não pode ser alterado — é a saída de emergência do sistema."
                            : undefined
                        }
                        onClick={() => setEditando(cargo)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Editar {cargo.label}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cargo.isBuiltin || pessoas > 0}
                        title={
                          cargo.isBuiltin
                            ? "Os cargos originais do sistema não podem ser excluídos."
                            : pessoas > 0
                              ? "Há pessoas com este cargo. Mova-as para outro antes."
                              : undefined
                        }
                        onClick={() => setExcluindo(cargo)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Excluir {cargo.label}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editando && (
        <RoleEditorDialog
          cargo={editando === "novo" ? null : editando}
          ceilings={ceilings}
          chavesExistentes={roles.map((c) => c.key)}
          onClose={() => setEditando(null)}
        />
      )}

      {excluindo && <RoleDeleteDialog cargo={excluindo} onClose={() => setExcluindo(null)} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O editor                                                                    */
/* -------------------------------------------------------------------------- */

function RoleEditorDialog({
  cargo,
  ceilings,
  chavesExistentes,
  onClose,
}: {
  cargo: RoleDefinition | null;
  ceilings: Record<string, readonly Permission[]>;
  chavesExistentes: readonly string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const nomeId = useId();
  const chaveId = useId();
  const descricaoId = useId();
  const baseId = useId();

  const criando = cargo === null;
  const [rascunho, setRascunho] = useState<Rascunho>(() =>
    cargo ? rascunhoDe(cargo) : rascunhoNovo(),
  );
  // ⚠️ A chave só é sugerida ENQUANTO ninguém a editou à mão. Sem isto, digitar
  // a chave e depois corrigir uma letra do nome apagaria o que foi digitado.
  const [chaveTocada, setChaveTocada] = useState(!criando);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const teto = useMemo(
    () => new Set(ceilings[rascunho.baseRole] ?? []),
    [ceilings, rascunho.baseRole],
  );

  function trocarBase(base: Role) {
    setRascunho((atual) => ({
      ...atual,
      baseRole: base,
      // ⚠️ PODA O QUE O NOVO TETO NÃO COMPORTA. Guardar a marcação "para o caso
      // de voltar" faria o formulário mandar ao banco uma permissão que ele
      // recusa — e o erro apareceria no Salvar, longe da causa.
      permissions: new Set(
        [...atual.permissions].filter((p) => (ceilings[base] ?? []).includes(p)),
      ),
    }));
  }

  function alternar(permissao: Permission) {
    setRascunho((atual) => {
      const proximo = new Set(atual.permissions);
      if (proximo.has(permissao)) proximo.delete(permissao);
      else proximo.add(permissao);
      return { ...atual, permissions: proximo };
    });
  }

  function marcarTudo(marcar: boolean) {
    setRascunho((atual) => ({
      ...atual,
      permissions: marcar ? new Set(teto) : new Set<Permission>(),
    }));
  }

  const chaveRepetida =
    criando && rascunho.key.length > 0 && chavesExistentes.includes(rascunho.key);

  function salvar() {
    setErro(null);

    startTransition(async () => {
      const permissions = [...rascunho.permissions];
      const resultado = criando
        ? await createRoleAction({
            key: rascunho.key,
            label: rascunho.label,
            description: rascunho.description || undefined,
            baseRole: rascunho.baseRole,
            permissions,
          })
        : await updateRoleAction({
            key: rascunho.key,
            label: rascunho.label,
            description: rascunho.description || undefined,
            permissions,
          });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      onClose();
      router.refresh();
    });
  }

  const somenteLeituraNoNome = cargo?.isBuiltin === true;

  return (
    <Dialog
      open
      onClose={onClose}
      className="w-[min(94vw,54rem)]"
      title={criando ? "Novo cargo" : `Editar ${cargo.label}`}
      description={
        criando
          ? "Escolha de qual papel o cargo parte e desmarque o que ele não deve abrir."
          : "Desmarque o que este cargo não deve abrir. O papel-base não muda depois de criado."
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={nomeId}>
              Nome do cargo <span aria-hidden="true">*</span>
              <span className="sr-only">(obrigatório)</span>
            </Label>
            <Input
              id={nomeId}
              value={rascunho.label}
              disabled={pendente || somenteLeituraNoNome}
              placeholder="Secretaria Executiva"
              onChange={(evento) => {
                const label = evento.target.value;
                setRascunho((atual) => ({
                  ...atual,
                  label,
                  key: chaveTocada ? atual.key : suggestRoleKey(label),
                }));
              }}
            />
            {somenteLeituraNoNome && (
              <p className="text-muted-foreground text-xs">
                Os cargos originais do sistema não são renomeados — o nome deles aparece em
                históricos antigos. O que se edita aqui é o que o cargo abre.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={chaveId}>Identificação</Label>
            <Input
              id={chaveId}
              value={rascunho.key}
              disabled={pendente || !criando}
              placeholder="secretaria-executiva"
              onChange={(evento) => {
                setChaveTocada(true);
                setRascunho((atual) => ({ ...atual, key: evento.target.value }));
              }}
            />
            <p className="text-muted-foreground text-xs">
              {criando
                ? "Aparece no histórico e nas consultas ao banco. Letras minúsculas, números e hífen."
                : "Não muda depois de criado — é por ela que o histórico aponta para este cargo."}
            </p>
            {chaveRepetida && (
              <p role="alert" className="text-destructive text-xs">
                Já existe um cargo com esta identificação.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={descricaoId}>Descrição</Label>
          <Textarea
            id={descricaoId}
            rows={2}
            value={rascunho.description}
            disabled={pendente || somenteLeituraNoNome}
            placeholder="Uma frase dizendo o que essa pessoa faz na APCS."
            onChange={(evento) =>
              setRascunho((atual) => ({ ...atual, description: evento.target.value }))
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={baseId}>Parte do papel</Label>
          <Select
            id={baseId}
            value={rascunho.baseRole}
            disabled={pendente || !criando}
            onChange={(evento) => trocarBase(evento.target.value as Role)}
          >
            {VALID_ROLES.map((papel) => (
              <option key={papel} value={papel}>
                {ROLE_LABELS[papel]}
              </option>
            ))}
          </Select>
          <p className="text-muted-foreground text-xs">
            {criando
              ? "É o teto do cargo: só dá para marcar o que este papel já entrega. Não muda depois."
              : "Escolhido na criação e imutável: trocá-lo mudaria em silêncio o que o banco entrega a quem já tem o cargo."}
          </p>
          {/*
            ⚠️ O AVISO DO PAPEL-BASE ADMINISTRADOR É O MAIS IMPORTANTE DESTA
            TELA. Desmarcar caixas recorta a INTERFACE; no banco, a pessoa
            continua com o papel Administrador. Quem monta o cargo precisa saber
            disso para não confundir "não vê" com "não consegue".
          */}
          {rascunho.baseRole === "admin" && (
            <p className="border-border bg-muted/40 text-muted-foreground rounded-md border px-3 py-2 text-xs">
              No banco, quem tem este cargo continua sendo <strong>Administrador</strong>. O que
              você desmarcar aqui some do menu e faz o sistema recusar a ação — mas não é um cadeado
              no banco de dados. Use para organizar o trabalho, não para conter alguém.
            </p>
          )}
        </div>

        <fieldset className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <legend className="text-sm font-medium">
              O que este cargo abre
              <span className="text-muted-foreground ml-2 font-normal">
                {rascunho.permissions.size} de {teto.size}
              </span>
            </legend>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendente}
                onClick={() => marcarTudo(true)}
              >
                Marcar tudo
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendente}
                onClick={() => marcarTudo(false)}
              >
                Limpar
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {PERMISSION_GROUPS.map((grupo) => {
              const nota = PERMISSION_GROUP_NOTES[grupo.status];
              return (
                <div key={grupo.title} className="border-border rounded-md border p-3">
                  <p className="text-xs font-semibold tracking-wide uppercase">
                    {grupo.title}
                    {grupo.status === "roadmap" && <Badge className="ml-2">Em breve</Badge>}
                    {grupo.status === "unused" && (
                      <Badge className="ml-2" variant="done">
                        Sem tela
                      </Badge>
                    )}
                  </p>
                  {nota && <p className="text-muted-foreground mt-1 text-xs">{nota}</p>}

                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    {grupo.permissions.map((permissao) => {
                      const noTeto = teto.has(permissao);
                      return (
                        <label
                          key={permissao}
                          className={
                            noTeto
                              ? "hover:bg-muted flex cursor-pointer items-start gap-2 rounded-md p-1.5 transition-colors"
                              : "flex items-start gap-2 rounded-md p-1.5 opacity-50"
                          }
                        >
                          <input
                            type="checkbox"
                            className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                            checked={rascunho.permissions.has(permissao)}
                            disabled={pendente || !noTeto}
                            onChange={() => alternar(permissao)}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm">{PERMISSION_LABELS[permissao]}</span>
                            <span className="text-muted-foreground block font-mono text-[11px]">
                              {permissao}
                              {!noTeto && " · fora do papel-base"}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>

        {erro && (
          <p role="alert" className="text-destructive text-sm">
            {erro}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pendente}>
          Cancelar
        </Button>
        <Button
          loading={pendente}
          disabled={rascunho.label.trim().length < 2 || rascunho.key.length < 2 || chaveRepetida}
          onClick={salvar}
        >
          {criando ? "Criar cargo" : "Salvar"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* A exclusão                                                                  */
/* -------------------------------------------------------------------------- */

function RoleDeleteDialog({ cargo, onClose }: { cargo: RoleDefinition; onClose: () => void }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function excluir() {
    setErro(null);
    startTransition(async () => {
      const resultado = await deleteRoleAction({ key: cargo.key });
      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Excluir ${cargo.label}?`}
      description="O cargo some da lista e da matriz. Ninguém pode estar com ele no momento da exclusão — o banco recusa se houver."
    >
      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pendente}>
          Cancelar
        </Button>
        <Button variant="destructive" loading={pendente} onClick={excluir}>
          Excluir
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
