"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, Pencil } from "lucide-react";
import type { DirectoryEntry } from "@/lib/services/profile";
import { lectureEditHref } from "@/modules/lecture/lecture.routes";
import { isTerminal } from "@/modules/lecture/lecture.rules";
import type { Lecture, LectureTransition } from "@/modules/lecture/lecture.types";
import { Button } from "@/components/ui/button";
import { LectureAssignDialog } from "./lecture-assign-dialog";
import { LectureOutcomeDialog } from "./lecture-outcome-dialog";
import { LectureScheduleDialog } from "./lecture-schedule-dialog";
import { LectureStatusDialog } from "./lecture-status-dialog";

/**
 * A BARRA DE AÇÕES da tela de detalhe (§60).
 *
 * Só é renderizada para quem tem `lectures.write` — a página decide isso no
 * servidor. Aqui dentro, cada ação ainda decide se FAZ SENTIDO agora: reagendar
 * some numa palestra cancelada, registrar resultado só aparece na realizada,
 * alterar situação some quando não há transição possível.
 *
 * ⚠️ Esconder botão NÃO é autorização. Toda action confere `lectures.write` de
 * novo, e o banco confere a RLS depois dela. O que a tela faz é não oferecer o
 * que vai falhar.
 *
 * O RETORNO DE SUCESSO mora aqui, num `role="status"` — o projeto não tem
 * toast, e inventar um sistema de notificação para este módulo seria a
 * "arquitetura visual paralela" que o escopo proíbe. A mensagem aparece acima
 * das ações, é anunciada por leitor de tela e some sozinha.
 */
export function LectureActions({
  lecture,
  transitions,
  directory,
}: {
  lecture: Lecture;
  transitions: LectureTransition[];
  directory: DirectoryEntry[];
}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reagendando, setReagendando] = useState(false);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 6000);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Remarcar o que não vai mais acontecer não faz sentido, e mexer numa
  // realizada reescreveria história. É a mesma regra que `reschedule_lecture`
  // impõe (PL003) — aqui ela só evita oferecer o botão.
  const podeReagendar = !isTerminal(lecture.status);

  return (
    <div className="space-y-3">
      {feedback && (
        <p
          role="status"
          className="border-border bg-muted/50 flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          {feedback}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <LectureStatusDialog lecture={lecture} transitions={transitions} onDone={setFeedback} />

        {podeReagendar && (
          <LectureScheduleDialog
            lecture={lecture}
            open={reagendando}
            onOpenChange={setReagendando}
            onDone={setFeedback}
          />
        )}

        <LectureAssignDialog
          lecture={lecture}
          field="responsible"
          directory={directory}
          onDone={setFeedback}
        />

        <LectureAssignDialog
          lecture={lecture}
          field="speaker"
          directory={directory}
          onDone={setFeedback}
        />

        <LectureOutcomeDialog lecture={lecture} onDone={setFeedback} />

        <Button variant="outline" size="sm" asChild>
          <Link href={lectureEditHref(lecture.id)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar
          </Link>
        </Button>
      </div>

      {/* §54: não existe "Excluir". Uma palestra com histórico não se apaga — o
          caminho de negócio é cancelar, que está dentro de "Alterar situação".
          O banco também não permite: não há grant de DELETE. */}
    </div>
  );
}
