import { formatDateTime } from "@/lib/utils";
import { SURVEY_AUDIT_ACTION_LABELS, SURVEY_FIELD_LABELS } from "@/modules/survey/survey.labels";
import type { SurveyAuditEntry } from "@/modules/survey/survey.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A TRILHA DA ENQUETE (§58).
 *
 * ⚠️ Só ADMINISTRADOR e GESTOR chegam aqui — a RLS de `survey_audit_logs` é mais
 * estreita que a de `surveys`. Quando o Atendente abre o detalhe, esta seção
 * simplesmente não é renderizada (a consulta volta vazia), e é o comportamento
 * certo: ele consulta enquetes, não o histórico de quem mexeu nelas.
 *
 * ⚠️ E a trilha de RESPOSTA de enquete anônima não traz `contactId` — quem
 * gravou foi o banco, que decide isso na hora de escrever. Aqui não há o que
 * filtrar: o dado não existe na linha.
 */
export function SurveyHistory({ entries }: { entries: SurveyAuditEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico</CardTitle>
        <CardDescription>Tudo que aconteceu com esta enquete, do mais recente.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Histórico de alterações da enquete</caption>
            <thead className="text-muted-foreground border-border border-b text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                  Data e hora
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Usuário
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Ação
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Alteração
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-border border-b align-top last:border-0">
                  <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3">{autor(entry)}</td>
                  <td className="px-4 py-3">{SURVEY_AUDIT_ACTION_LABELS[entry.action]}</td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">{descrever(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Quem fez.
 *
 * A ordem das tentativas importa: o perfil vivo primeiro (o nome atual), depois
 * o nome CONGELADO nos metadados (para quem já saiu da empresa), e por fim "o
 * sistema" — que é a verdade para o que a rotina ou o chatbot fizeram, e não um
 * "desconhecido" que pareceria falha.
 */
function autor(entry: SurveyAuditEntry): string {
  const vivo = entry.actor?.fullName?.trim() || entry.actor?.email?.trim();
  if (vivo) return vivo;

  const congelado = entry.metadata.actor_name;
  if (typeof congelado === "string" && congelado.trim()) return congelado.trim();

  return "Sistema";
}

/**
 * O que mudou, em uma frase.
 *
 * ⚠️ Nunca despeja o jsonb cru na tela. O metadado é estrutura de auditoria, não
 * texto para humano — e um `JSON.stringify` ali revelaria nomes de coluna e
 * transformaria a trilha em algo que só um dev lê.
 */
function descrever(entry: SurveyAuditEntry): string {
  const meta = entry.metadata;

  if (entry.action === "survey_response_registered") {
    // §63. Em enquete anônima a linha não tem contato — e a frase reflete isso
    // sem inventar um "anônimo" que pareceria uma pessoa.
    return meta.anonymous === true ? "Resposta anônima registrada." : "Resposta registrada.";
  }

  if (entry.action === "survey_scheduled") {
    const destinatarios = typeof meta.recipients === "number" ? meta.recipients : null;
    return destinatarios === null
      ? "Envio agendado."
      : `Envio agendado para ${destinatarios} ${destinatarios === 1 ? "contato" : "contatos"}.`;
  }

  if (entry.action === "survey_closed" || entry.action === "survey_activated") {
    return meta.reason === "automatic" ? "Pela rotina automática." : "Manualmente.";
  }

  if (entry.action === "survey_cancelled" && typeof meta.reason === "string" && meta.reason) {
    return `Motivo: ${meta.reason}`;
  }

  if (entry.action === "survey_audience_updated") {
    const elegiveis = typeof meta.eligible === "number" ? meta.eligible : null;
    return elegiveis === null
      ? "Público-alvo alterado."
      : `Público-alvo alterado — ${elegiveis} ${elegiveis === 1 ? "contato" : "contatos"} elegíveis.`;
  }

  if (entry.action === "survey_question_updated") {
    return "Pergunta ou alternativas alteradas.";
  }

  // O diff campo a campo das edições descritivas.
  const changes = meta.changes;
  if (Array.isArray(changes) && changes.length > 0) {
    return changes
      .map((change) => {
        const campo = (change as { field?: string }).field ?? "";
        return SURVEY_FIELD_LABELS[campo] ?? campo;
      })
      .filter(Boolean)
      .join(", ");
  }

  if (entry.action === "survey_created") {
    const titulo = typeof meta.title === "string" ? meta.title : null;
    return titulo ? `"${titulo}"` : "";
  }

  return "";
}
