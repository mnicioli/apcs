import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listLectureSpeakers } from "@/lib/services/lectures";
import { searchDirectory } from "@/lib/services/profile";
import { LECTURE_MODULE_TITLE } from "@/modules/lecture/lecture.labels";
import { isCalendarDate } from "@/modules/lecture/lecture.calendar";
import { lecturesHref } from "@/modules/lecture/lecture.routes";
import { LectureForm } from "../lecture-form";

export const metadata: Metadata = { title: "Nova palestra" };

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Cadastro interno (§21).
 *
 * A origem é `internal` e NÃO é um campo: quem cria por aqui está autenticado, e
 * a policy de insert do banco exige `origin = 'internal'`. A origem `chatbot` só
 * existe por uma porta, e ela não passa por esta tela.
 *
 * ⚠️ O `redirect` protege a ROTA. Esconder o botão "Nova palestra" da grid não
 * impede ninguém de digitar `/lectures/new` — e a action ainda checa a permissão
 * uma terceira vez.
 *
 * `date` e `time` vêm do clique num espaço vazio do calendário (§29). São
 * validados aqui: um parâmetro colado errado não deve virar um campo preenchido
 * com lixo.
 */
export default async function NewLecturePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; time?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "lectures.write")) redirect("/dashboard");

  const { date, time } = await searchParams;
  const [directory, speakers] = await Promise.all([searchDirectory(), listLectureSpeakers()]);

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
        <h1 className="text-2xl font-semibold tracking-tight">Nova palestra</h1>
        <p className="text-muted-foreground text-sm">
          Para uma palestra que a APCS vai realizar, ou para registrar um pedido que chegou por fora
          do chatbot.
        </p>
      </div>

      <LectureForm
        directory={directory}
        speakers={speakers}
        prefill={{
          date: date && isCalendarDate(date) ? date : undefined,
          startTime: time && HORA.test(time) ? time : undefined,
        }}
      />
    </div>
  );
}
