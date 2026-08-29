"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { updateEventSegmentAction } from "@/lib/actions/admin";
import type { AdminSegment } from "@/modules/admin/admin.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Uma linha editável do catálogo.
 *
 * ⚠️ TEM BOTÃO DE SALVAR, ao contrário do seletor de papel da tela de Usuários.
 * A diferença é o número de campos: um seletor de uma opção salva no `change` e
 * a mudança é óbvia; três campos salvando sozinhos fariam cada tecla digitada
 * virar uma ida ao servidor, e "ativo" mudaria no meio de alguém reescrever o
 * nome.
 *
 * ⚠️ O BOTÃO SÓ ACORDA COM ALGO ALTERADO. Um "Salvar" sempre aceso em seis
 * linhas iguais convida a clicar em todas — e cada clique sem mudança seria uma
 * escrita e uma linha de auditoria dizendo que nada aconteceu.
 */
export function SegmentRow({ segment }: { segment: AdminSegment }) {
  const router = useRouter();
  const nomeId = useId();
  const descricaoId = useId();
  const ativoId = useId();

  const [nome, setNome] = useState(segment.name);
  const [descricao, setDescricao] = useState(segment.description ?? "");
  const [ativo, setAtivo] = useState(segment.active);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pendente, startTransition] = useTransition();

  const alterado =
    nome !== segment.name || descricao !== (segment.description ?? "") || ativo !== segment.active;

  function salvar() {
    setErro(null);
    setSalvo(false);

    startTransition(async () => {
      const resultado = await updateEventSegmentAction({
        segmentId: segment.id,
        name: nome,
        description: descricao || undefined,
        active: ativo,
      });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setSalvo(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* O slug aparece como INFORMAÇÃO, nunca como campo — ver o cabeçalho
            da página. Mostrá-lo evita a pergunta "por que não posso mudar?". */}
        <span className="text-muted-foreground font-mono text-xs">{segment.slug}</span>
        {!segment.active && <Badge variant="done">Inativo</Badge>}
        <span className="text-muted-foreground text-xs">
          {segment.eventCount === 0
            ? "Nenhum evento usa"
            : segment.eventCount === 1
              ? "1 evento usa"
              : `${segment.eventCount} eventos usam`}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
          <Label htmlFor={descricaoId}>Descrição</Label>
          <Input
            id={descricaoId}
            value={descricao}
            disabled={pendente}
            maxLength={300}
            placeholder="Opcional — ajuda quem escolhe o público de um evento"
            onChange={(evento) => setDescricao(evento.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={ativoId} className="flex items-center gap-2 text-sm">
          <input
            id={ativoId}
            type="checkbox"
            className="border-input accent-primary h-4 w-4 rounded"
            checked={ativo}
            disabled={pendente}
            onChange={(evento) => setAtivo(evento.target.checked)}
          />
          Oferecer este público em novos eventos
        </label>

        <div className="flex items-center gap-3">
          {salvo && !alterado && (
            <span role="status" className="text-muted-foreground text-xs">
              Salvo.
            </span>
          )}
          <Button size="sm" loading={pendente} disabled={!alterado} onClick={salvar}>
            Salvar
          </Button>
        </div>
      </div>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}
    </div>
  );
}
