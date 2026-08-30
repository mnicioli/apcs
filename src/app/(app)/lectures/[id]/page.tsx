import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  getLecture,
  listLectureAudit,
  listLectureSpeakers,
  listStatusTransitions,
} from "@/lib/services/lectures";
import { searchDirectory } from "@/lib/services/profile";
import { formatCalendarDate, formatDateTime, formatTimeRange, todayInSaoPaulo } from "@/lib/utils";
import {
  LECTURE_FORMAT_LABELS,
  LECTURE_MODULE_TITLE,
  LECTURE_ORIGIN_LABELS,
  LECTURE_PRIORITY_LABELS,
  LECTURE_STAGE_HINTS,
  LECTURE_STAGE_LABELS,
  LECTURE_STATUS_HINTS,
  LECTURE_STATUS_LABELS,
  LECTURE_TYPE_LABELS,
  conflictWarning,
} from "@/modules/lecture/lecture.labels";
import { isLectureId, lecturesHref } from "@/modules/lecture/lecture.routes";
import {
  actorLabel,
  closingReason,
  lectureStage,
  speakerLabel,
  typeDescription,
} from "@/modules/lecture/lecture.rules";
import type { Lecture } from "@/modules/lecture/lecture.types";
import { BroadcastPanel } from "@/components/broadcast/broadcast-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LectureActions } from "../lecture-actions";
import {
  ORIGIN_BADGE_VARIANT,
  PRIORITY_BADGE_VARIANT,
  STAGE_BADGE_VARIANT,
  STATUS_BADGE_VARIANT,
} from "../lecture-badges";
import { LectureHistory } from "../lecture-history";
import { ProtocolCopy } from "../protocol-copy";

export const metadata: Metadata = { title: "Palestra" };

/**
 * A TELA DE DETALHE de uma palestra (§15, §43, §47, §59).
 *
 * É página e não modal porque segue o padrão do projeto (`/leads/[id]`,
 * `/market/[id]`, `/events/[id]`): dá para mandar o link para alguém, sobrevive
 * ao F5 e não precisa buscar dados no cliente. É também o que faz o §59 (deep
 * link) funcionar de graça.
 *
 * ⚠️ Esta página é a ÚNICA que oferece as ações administrativas. A grid abre
 * daqui, o calendário abre daqui. Espalhar as mesmas cinco ações por três telas
 * multiplicaria por três o lugar onde uma regra de permissão pode ficar
 * desatualizada.
 */
export default async function LectureDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string; conflicts?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "lectures.read")) redirect("/dashboard");

  const { id } = await params;

  // O id vem da URL, então é entrada de usuário: um endereço malformado é
  // "não encontrada", não "falha ao carregar". Ver `isLectureId`.
  if (!isLectureId(id)) notFound();

  const lecture = await getLecture(id);
  // §59: registro inexistente cai no `not-found.tsx`, que diz "Palestra não
  // encontrada" — em vez de uma tela quebrada ou de um objeto vazio.
  if (!lecture) notFound();

  const canWrite = hasPermission(role, "lectures.write");
  const today = todayInSaoPaulo();
  const stage = lectureStage(lecture, today);
  const encerramento = closingReason(lecture);

  const { created, updated, conflicts } = await searchParams;
  const sucesso = created
    ? "Palestra criada com sucesso."
    : updated
      ? "Palestra atualizada com sucesso."
      : null;
  const conflitos = Number(conflicts);

  // A trilha é de Administrador e Gestor. A RLS já devolveria vazio para o
  // Atendente; não pedir o dado é mais honesto do que pedir e descartar.
  const [audit, transitions, directory, speakers] = await Promise.all([
    canWrite ? listLectureAudit(lecture.id) : Promise.resolve([]),
    canWrite ? listStatusTransitions() : Promise.resolve([]),
    canWrite ? searchDirectory() : Promise.resolve([]),
    canWrite ? listLectureSpeakers() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={lecturesHref()}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para {LECTURE_MODULE_TITLE}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <ProtocolCopy protocol={lecture.protocol} />
            <h1 className="text-2xl font-semibold tracking-tight">{lecture.name}</h1>
            <p className="text-muted-foreground text-sm">{lecture.theme}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE_VARIANT[lecture.status]}>
              {LECTURE_STATUS_LABELS[lecture.status]}
            </Badge>
            {/* §75: a origem fica visível o tempo todo. Uma solicitação do
                chatbot NÃO é uma palestra confirmada, e quem abre a tela precisa
                saber disso antes de qualquer outra coisa. */}
            <Badge variant={ORIGIN_BADGE_VARIANT[lecture.origin]}>
              {LECTURE_ORIGIN_LABELS[lecture.origin]}
            </Badge>
            <Badge variant={PRIORITY_BADGE_VARIANT[lecture.priority]}>
              Prioridade {LECTURE_PRIORITY_LABELS[lecture.priority].toLowerCase()}
            </Badge>
          </div>
        </div>
      </div>

      {sucesso && (
        <p
          role="status"
          className="border-border bg-muted/50 flex items-center gap-2 rounded-md border px-4 py-3 text-sm"
        >
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          {sucesso}
        </p>
      )}

      {/* §25: o conflito veio junto do sucesso do cadastro. A palestra FOI
          criada; o aviso é para a próxima decisão, não um motivo para desfazer. */}
      {Number.isInteger(conflitos) && conflitos > 0 && (
        <p role="status" className="border-border bg-muted/50 rounded-md border px-4 py-3 text-sm">
          {conflictWarning(conflitos)}
        </p>
      )}

      {stage === "awaiting_outcome" && (
        <p className="border-border bg-muted/50 rounded-md border px-4 py-3 text-sm">
          <Badge variant={STAGE_BADGE_VARIANT[stage]}>{LECTURE_STAGE_LABELS[stage]}</Badge>{" "}
          <span className="ml-1">{LECTURE_STAGE_HINTS[stage]}</span>
        </p>
      )}

      {canWrite && (
        <LectureActions
          lecture={lecture}
          transitions={transitions}
          directory={directory}
          speakers={speakers}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">A palestra</CardTitle>
          <CardDescription>{LECTURE_STATUS_HINTS[lecture.status]}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Data">{formatCalendarDate(lecture.eventDate)}</Item>
          <Item label="Horário">
            {lecture.startTime
              ? formatTimeRange(lecture.startTime, lecture.endTime)
              : "Não definido"}
          </Item>
          <Item label="Cidade">{lecture.city}</Item>
          <Item label="Local">{lecture.location ?? "—"}</Item>

          <Item label="Tipo">{typeDescription(lecture, LECTURE_TYPE_LABELS)}</Item>
          <Item label="Formato">
            {lecture.format ? LECTURE_FORMAT_LABELS[lecture.format] : "—"}
          </Item>
          <Item label="Participantes estimados">
            {lecture.attendeesEstimated === null ? "—" : String(lecture.attendeesEstimated)}
          </Item>
          <Item label="Participantes presentes">
            {lecture.attendeesActual === null ? "—" : String(lecture.attendeesActual)}
          </Item>

          <Item label="Responsável">{actorLabel(lecture.responsible) ?? "Não definido"}</Item>
          <Item label="Palestrante">{speakerLabel(lecture) ?? "Não definido"}</Item>
          <Item label="Data da solicitação">{formatDateTime(lecture.requestedAt)}</Item>
          <Item label="Data de realização">
            {lecture.heldAt ? formatCalendarDate(lecture.heldAt) : "—"}
          </Item>
        </CardContent>
      </Card>

      {(lecture.notes || encerramento || lecture.outcomeNotes) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anotações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {lecture.notes && <Bloco titulo="Observações">{lecture.notes}</Bloco>}
            {encerramento && (
              <Bloco
                titulo={
                  lecture.status === "rejected" ? "Motivo da rejeição" : "Motivo do cancelamento"
                }
              >
                {encerramento}
              </Bloco>
            )}
            {lecture.outcomeNotes && (
              <Bloco titulo="Observações da realização">{lecture.outcomeNotes}</Bloco>
            )}
          </CardContent>
        </Card>
      )}

      <RequesterCard lecture={lecture} />

      {/* `lectureStatus` vai como prop porque só Palestras tem restrição de
          ESTADO — divulgar uma palestra cancelada mandaria gente para uma sala
          vazia. O painel usa isso para explicar por que o botão não aparece. */}
      <BroadcastPanel source="lecture" sourceId={lecture.id} lectureStatus={lecture.status} />

      {canWrite && <LectureHistory entries={audit} />}
    </div>
  );
}

/**
 * QUEM PEDIU (§43).
 *
 * Só aparece quando há alguém: uma palestra que o próprio time marcou não tem
 * solicitante, e um cartão com quatro traços não informa nada.
 *
 * ⚠️ Os dados vêm do SNAPSHOT congelado no pedido, não do cadastro atual do
 * contato. É o que faz a resposta a "quem pediu a SOL-000042?" sobreviver a uma
 * exclusão do titular por LGPD. Não há link para o cadastro do contato: o
 * módulo de contatos do chat é outra tela, com outra permissão, e o §43 pede
 * navegação "respeitando permissões" — enquanto essa ponte não existir, o dado
 * congelado é o que se mostra.
 */
function RequesterCard({ lecture }: { lecture: Lecture }) {
  const { requester } = lecture;
  const temAlgo = requester.name || requester.email || requester.phone || requester.organization;

  if (!temAlgo) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Solicitante</CardTitle>
        <CardDescription>
          Como estava no momento do pedido. Estes dados não mudam depois.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Item label="Nome">{requester.name ?? "—"}</Item>
        <Item label="Empresa ou instituição">{requester.organization ?? "—"}</Item>
        <Item label="E-mail">{requester.email ?? "—"}</Item>
        <Item label="Telefone">{requester.phone ?? "—"}</Item>
      </CardContent>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium break-words">{children}</p>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{titulo}</p>
      {/* `whitespace-pre-line` preserva as quebras que a pessoa digitou. O React
          escapa o conteúdo por padrão — não há HTML sendo injetado aqui. */}
      <p className="text-sm whitespace-pre-line">{children}</p>
    </div>
  );
}
