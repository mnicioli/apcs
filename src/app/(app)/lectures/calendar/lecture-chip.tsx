"use client";

import Link from "next/link";
import { formatTime } from "@/lib/utils";
import { LECTURE_STATUS_LABELS } from "@/modules/lecture/lecture.labels";
import { lectureHref } from "@/modules/lecture/lecture.routes";
import type { Lecture } from "@/modules/lecture/lecture.types";
import { Badge } from "@/components/ui/badge";
import { STATUS_BADGE_VARIANT } from "../lecture-badges";

/**
 * Uma palestra dentro do calendário (§4).
 *
 * Mostra o MÍNIMO que o escopo pede — horário, nome, cidade, situação — porque
 * numa célula de dia com quatro palestras qualquer campo a mais transforma a
 * grade em parede de texto. O resto está a um clique, na tela de detalhe.
 *
 * É um LINK, não um `div` com `onClick`: abre em nova aba, funciona com teclado
 * e o navegador mostra o destino na barra de status. O `title` faz as vezes de
 * tooltip com o que não coube.
 *
 * ⚠️ ARRASTAR (§26) exige mouse, e isso é uma limitação real da API de
 * drag-and-drop do HTML. Quem navega por teclado reagenda pelo botão
 * "Reagendar" na tela da palestra — o mesmo caminho, a mesma action, a mesma
 * confirmação. O calendário anuncia isso em texto, em vez de fingir que a
 * funcionalidade está lá para todo mundo.
 */
export function LectureChip({
  lecture,
  draggable,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  lecture: Lecture;
  draggable: boolean;
  onDragStart: (lecture: Lecture) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const hora = lecture.startTime ? formatTime(lecture.startTime) : null;

  const detalhe = [
    hora ?? "sem horário",
    lecture.name,
    lecture.city,
    LECTURE_STATUS_LABELS[lecture.status],
  ].join(" · ");

  return (
    <Link
      href={lectureHref(lecture.id)}
      title={detalhe}
      draggable={draggable}
      onDragStart={(event) => {
        // O id vai no `dataTransfer` para o navegador ter o que arrastar (sem
        // isso o Firefox cancela o arrasto), mas quem a solta usa o estado do
        // React — o `dataTransfer` não é legível durante o `dragover`.
        event.dataTransfer.setData("text/plain", lecture.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(lecture);
      }}
      onDragEnd={onDragEnd}
      className={`hover:bg-muted focus-visible:ring-ring block rounded-md border px-2 py-1 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
        dragging ? "border-primary opacity-50" : "border-border"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="text-muted-foreground shrink-0 font-mono text-[11px]">{hora ?? "—"}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{lecture.name}</span>
      </span>

      <span className="mt-0.5 flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground truncate text-[11px]">{lecture.city}</span>
        <Badge variant={STATUS_BADGE_VARIANT[lecture.status]} className="px-1.5 py-0 text-[10px]">
          {LECTURE_STATUS_LABELS[lecture.status]}
        </Badge>
      </span>
    </Link>
  );
}
