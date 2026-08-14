import { TriangleAlert } from "lucide-react";
import { formatCalendarDate, formatTimeRange } from "@/lib/utils";
import { conflictWarning } from "@/modules/lecture/lecture.labels";
import type { LectureConflict } from "@/modules/lecture/lecture.types";

/**
 * O AVISO DE CONFLITO DE HORÁRIO (§25).
 *
 * ⚠️ É um AVISO, não um erro — e a diferença precisa aparecer na tela, não só
 * no código. O §33 é explícito: conflito não bloqueia, porque pode haver mais de
 * um palestrante disponível. Por isso:
 *
 *   • o texto diz o que foi encontrado e devolve a decisão a quem está olhando;
 *   • a cor NÃO é a de erro (`text-destructive`) — isso mandaria a pessoa
 *     desfazer algo que talvez esteja certo;
 *   • `role="status"` e não `role="alert"`: é informação, não interrupção.
 *
 * Mostra o que o §25 pede para a decisão ser possível: qual palestra, quando,
 * onde e quem cuida dela.
 */
export function LectureConflictAlert({ conflicts }: { conflicts: LectureConflict[] }) {
  if (conflicts.length === 0) return null;

  return (
    <div role="status" className="border-border bg-muted/50 space-y-3 rounded-md border p-4">
      <p className="flex items-start gap-2 text-sm font-medium">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {conflictWarning(conflicts.length)}
      </p>

      <ul className="space-y-2">
        {conflicts.map((conflict) => (
          <li key={conflict.id} className="text-sm">
            <span className="font-medium">{conflict.name}</span>{" "}
            <span className="text-muted-foreground font-mono text-xs">{conflict.protocol}</span>
            <span className="text-muted-foreground block text-xs">
              {formatCalendarDate(conflict.eventDate)} ·{" "}
              {formatTimeRange(conflict.startTime, conflict.endTime)} · {conflict.city}
              {conflict.responsibleName && ` · Responsável: ${conflict.responsibleName}`}
              {conflict.speakerName && ` · Palestrante: ${conflict.speakerName}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
