import { AlertTriangle, Send } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import type { Permission } from "@/lib/rbac/rbac.types";
import {
  canBroadcastLecture,
  listBroadcastSegments,
  listBroadcastsFor,
  resolveBroadcastSubject,
} from "@/lib/services/broadcasts";
import {
  broadcastWhatsAppMessage,
  BROADCAST_STATUS_LABELS,
} from "@/modules/broadcast/broadcast.labels";
import type { BroadcastSource } from "@/modules/broadcast/broadcast.types";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BroadcastLauncher } from "./broadcast-launcher";

/**
 * O PAINEL DE DIVULGAÇÃO — o mesmo nas quatro telas.
 *
 * Normativa, Comunicação, Bolsa e Palestra publicam coisas diferentes, mas a
 * pergunta é sempre a mesma: "já avisamos a base? para quem? deu certo?". Um
 * painel por módulo daria quatro respostas com quatro desenhos.
 *
 * ⚠️ É SERVER COMPONENT E BUSCA O PRÓPRIO DADO. A alternativa — cada página
 * buscar e passar por props — obrigaria as três páginas a saber o que a
 * divulgação precisa, e a terceira que esquecesse de passar o histórico
 * mostraria um painel que diz "nunca divulgado" sobre algo já divulgado.
 *
 * ⚠️ A PRÉ-VISUALIZAÇÃO É A MENSAGEM DE VERDADE, composta pela MESMA função que
 * o worker usa. Não é uma aproximação para a tela: se as duas fossem
 * construções diferentes, a conferência antes de mandar para quatrocentas
 * pessoas não valeria nada.
 */
export async function BroadcastPanel({
  source,
  sourceId,
  /** Estado da palestra — só ela tem restrição de estado. */
  lectureStatus,
}: {
  source: BroadcastSource;
  sourceId: string;
  lectureStatus?: string;
}) {
  const PERMISSAO: Record<BroadcastSource, Permission> = {
    normative: "documents.write",
    communication: "documents.write",
    market_bulletin: "market.write",
    lecture: "lectures.write",
  };

  const role = await getCurrentUserRole();
  const podeDivulgar = hasPermission(role, PERMISSAO[source]);

  const [alvo, historico] = await Promise.all([
    resolveBroadcastSubject(source, sourceId),
    listBroadcastsFor(source, sourceId),
  ]);

  // Quem não pode divulgar ainda vê o histórico: "vocês avisaram?" é pergunta
  // de quem atende, não só de quem publica.
  const segmentos = podeDivulgar ? await listBroadcastSegments() : [];

  const impedimento = motivoParaNaoDivulgar(source, alvo !== null, lectureStatus);
  const previa = alvo ? broadcastWhatsAppMessage(alvo.subject) : null;
  const emAndamento = historico.find((b) => b.status === "running") ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-4 w-4" aria-hidden="true" />
          Divulgação por WhatsApp
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {impedimento ? (
          <p className="text-muted-foreground flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {impedimento}
          </p>
        ) : !podeDivulgar ? (
          <p className="text-muted-foreground text-sm">
            Seu perfil vê o histórico de divulgação, mas não dispara mensagens.
          </p>
        ) : (
          previa && (
            <BroadcastLauncher
              source={source}
              sourceId={sourceId}
              segments={segmentos}
              preview={previa}
              hasAttachment={alvo?.media !== null}
              resumeId={emAndamento?.id ?? null}
              resumeRemaining={
                emAndamento
                  ? emAndamento.totalRecipients -
                    emAndamento.totalSent -
                    emAndamento.totalErrors -
                    emAndamento.totalBlocked
                  : 0
              }
            />
          )
        )}

        <div className="border-border border-t pt-4">
          <h3 className="mb-2 text-sm font-medium">Histórico</h3>
          {historico.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nunca divulgado.</p>
          ) : (
            <ol className="space-y-3">
              {historico.map((divulgacao) => (
                <li key={divulgacao.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={divulgacao.status === "done" ? "done" : "attention"}>
                      {BROADCAST_STATUS_LABELS[divulgacao.status]}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(divulgacao.startedAt)}
                      {divulgacao.createdByName ? ` · ${divulgacao.createdByName}` : ""}
                    </span>
                  </div>

                  {/*
                    ⚠️ OS QUATRO NÚMEROS APARECEM SEPARADOS. "428 enviadas" sozinho
                    esconderia que 31 pessoas estão bloqueadas e 6 falharam — e é
                    justamente isso que alguém precisa saber para decidir se
                    reenvia ou se liga para alguém.
                  */}
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {divulgacao.totalSent} enviadas · {divulgacao.totalBlocked} bloqueadas ·{" "}
                    {divulgacao.totalErrors} com erro · {divulgacao.totalRecipients} no total
                  </p>

                  {divulgacao.segmentNames.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      Para: {divulgacao.segmentNames.join(", ")}
                    </p>
                  )}

                  {divulgacao.lastError && (
                    <p className="text-destructive text-xs">{divulgacao.lastError}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Por que o botão não está disponível — em português, dizendo O QUE FAZER.
 *
 * ⚠️ UM BOTÃO DESABILITADO SEM EXPLICAÇÃO é a pior versão desta tela: a pessoa
 * publica a normativa, volta aqui, não consegue divulgar e não tem como
 * descobrir que falta ativar a versão.
 */
function motivoParaNaoDivulgar(
  source: BroadcastSource,
  temAlvo: boolean,
  lectureStatus?: string,
): string | null {
  if (source === "lecture") {
    if (lectureStatus && !canBroadcastLecture(lectureStatus)) {
      return "Só palestras planejadas ou confirmadas podem ser divulgadas. Avisar a base sobre uma palestra que ainda não foi aprovada — ou que foi cancelada — é pior que não avisar.";
    }
    if (!temAlvo) return "Esta palestra não tem data definida.";
    return null;
  }

  if (!temAlvo) {
    return source === "market_bulletin"
      ? "Este boletim não tem versão ativa. Publique e ative uma versão antes de divulgar."
      : "Este documento não tem versão ativa. Publique e ative uma versão antes de divulgar.";
  }

  return null;
}
