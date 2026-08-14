import { formatDateTime } from "@/lib/utils";
import {
  LECTURE_AUDIT_ACTION_LABELS,
  LECTURE_FIELD_LABELS,
  LECTURE_FORMAT_LABELS,
  LECTURE_PRIORITY_LABELS,
  LECTURE_STATUS_LABELS,
  LECTURE_TYPE_LABELS,
} from "@/modules/lecture/lecture.labels";
import { actorLabel } from "@/modules/lecture/lecture.rules";
import type { LectureAuditEntry, LectureFieldChange } from "@/modules/lecture/lecture.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * O HISTÓRICO da palestra (§47).
 *
 * Consome a trilha de auditoria do banco — não existe registro paralelo no
 * frontend. O que a tela faz é TRADUZIR: `lecture_status_changed` vira "Situação
 * alterada", `from: "under_review"` vira "De: Em análise".
 *
 * ⚠️ Os valores do diff chegam como o banco os gravou (o enum cru, a data ISO).
 * Traduzi-los aqui, e não na gravação, é o que permite renomear "Em análise"
 * amanhã sem reescrever a trilha — que é imutável de propósito.
 */
export function LectureHistory({ entries }: { entries: LectureAuditEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Histórico</CardTitle>
        <CardDescription>
          Quem fez o quê, e quando. A trilha não é editada nem apagada — nem pelo sistema.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <p className="text-muted-foreground px-6 pb-6 text-sm">Nenhum registro ainda.</p>
        ) : (
          <ul className="divide-border divide-y">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-2 px-6 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {LECTURE_AUDIT_ACTION_LABELS[entry.action]}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {/* O nome CONGELADO na trilha vem primeiro: ele sobrevive à
                        saída do perfil, que zeraria o vínculo. "Chatbot" é o
                        autor quando não há pessoa — a solicitação entrou
                        sozinha. */}
                    {entry.actorName ?? actorLabel(entry.actor) ?? "Chatbot"} ·{" "}
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>

                <EntryDetail entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** O corpo de uma entrada: o que mudou, quando há o que mostrar. */
function EntryDetail({ entry }: { entry: LectureAuditEntry }) {
  const metadata = entry.metadata;

  // Mudança de situação, cancelamento e rejeição: de onde para onde, e por quê.
  const from = typeof metadata.from === "string" ? metadata.from : null;
  const to = typeof metadata.to === "string" ? metadata.to : null;
  const reason = typeof metadata.reason === "string" ? metadata.reason : null;

  if (
    entry.action === "lecture_status_changed" ||
    entry.action === "lecture_cancelled" ||
    entry.action === "lecture_rejected"
  ) {
    return (
      <div className="text-muted-foreground space-y-1 text-sm">
        {from && to && (
          <p>
            De: <span className="text-foreground">{statusLabel(from)}</span> · Para:{" "}
            <span className="text-foreground">{statusLabel(to)}</span>
          </p>
        )}
        {reason && <p className="text-foreground">{reason}</p>}
      </div>
    );
  }

  // Atribuições: a trilha guarda os IDs dos perfis, que não dizem nada a quem
  // lê. O nome exigiria resolver perfis que podem nem existir mais — então a
  // linha se limita ao fato, que é o que importa no histórico.
  if (
    entry.action === "lecture_responsible_assigned" ||
    entry.action === "lecture_speaker_assigned"
  ) {
    return (
      <p className="text-muted-foreground text-sm">
        {to ? "Definido." : "Removido."} Veja o valor atual no topo desta página.
      </p>
    );
  }

  const changes = Array.isArray(metadata.changes) ? (metadata.changes as LectureFieldChange[]) : [];
  if (changes.length > 0) {
    return (
      <ul className="text-muted-foreground space-y-1 text-sm">
        {changes.map((change, index) => (
          <li key={`${change.field}-${index}`}>
            {LECTURE_FIELD_LABELS[change.field] ?? change.field}: De{" "}
            <span className="text-foreground">{fieldValue(change.field, change.from)}</span> · Para{" "}
            <span className="text-foreground">{fieldValue(change.field, change.to)}</span>
          </li>
        ))}
      </ul>
    );
  }

  // Criação: origem e protocolo já aparecem no topo da página. O que a linha
  // acrescenta é a situação com que a palestra nasceu.
  if (entry.action === "lecture_created") {
    const status = typeof metadata.status === "string" ? metadata.status : null;
    const origin = metadata.origin === "chatbot" ? "pelo chatbot" : "pelo time";
    return (
      <p className="text-muted-foreground text-sm">
        Criada {origin}
        {status ? ` como ${statusLabel(status)}` : ""}.
      </p>
    );
  }

  return null;
}

function statusLabel(value: string): string {
  return LECTURE_STATUS_LABELS[value as keyof typeof LECTURE_STATUS_LABELS] ?? value;
}

/**
 * O valor de um campo do diff, já em linguagem de tela.
 *
 * `null` vira "vazio" e não some: "De: vazio · Para: Toledo" conta uma história
 * que "Para: Toledo" sozinho não conta.
 */
function fieldValue(field: string, value: string | null): string {
  if (value === null || value === "") return "vazio";

  switch (field) {
    case "type":
      return LECTURE_TYPE_LABELS[value as keyof typeof LECTURE_TYPE_LABELS] ?? value;
    case "format":
      return LECTURE_FORMAT_LABELS[value as keyof typeof LECTURE_FORMAT_LABELS] ?? value;
    case "priority":
      return LECTURE_PRIORITY_LABELS[value as keyof typeof LECTURE_PRIORITY_LABELS] ?? value;
    case "eventDate":
    case "heldAt": {
      // Recorte de string, sem passar por `Date`: "2026-08-15" vira meia-noite
      // UTC, que em São Paulo é 21h do dia ANTERIOR.
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
    }
    case "startTime":
    case "endTime":
      return value.slice(0, 5);
    default:
      return value;
  }
}
