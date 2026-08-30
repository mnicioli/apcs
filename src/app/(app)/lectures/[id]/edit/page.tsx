import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getLecture, listLectureCities } from "@/lib/services/lectures";
import { searchDirectory } from "@/lib/services/profile";
import { isLectureId, lectureHref } from "@/modules/lecture/lecture.routes";
import { Card, CardContent } from "@/components/ui/card";
import { LectureForm } from "../../lecture-form";

export const metadata: Metadata = { title: "Editar palestra" };

/**
 * Edição (§30).
 *
 * ⚠️ O QUE ESTA TELA **NÃO** EDITA, e por quê:
 *
 *   protocolo, origem, data da solicitação   imutáveis no banco (trigger + grant)
 *   data e horário                           saem por "Reagendar" (§44)
 *   situação                                 sai por "Alterar situação" (§43)
 *   responsável e palestrante                têm ações próprias (§45, §46)
 *
 * Não é uma limitação da tela — é o recorte de `update_lecture`, que nem recebe
 * esses campos. Cada mudança tem a sua ação para o histórico poder dizer
 * "remarcou" e "mudou o tema" como coisas diferentes.
 */
export default async function EditLecturePage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "lectures.write")) redirect("/dashboard");

  const { id } = await params;
  // Mesma razão da tela de detalhe: endereço malformado é "não encontrada", e
  // não vira consulta ao banco.
  if (!isLectureId(id)) notFound();

  const [lecture, directory, cities] = await Promise.all([
    getLecture(id),
    searchDirectory(),
    listLectureCities(),
  ]);
  if (!lecture) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={lectureHref(lecture.id)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para a palestra
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Editar palestra</h1>
        <p className="text-muted-foreground text-sm">
          {lecture.protocol} · {lecture.name}
        </p>
      </div>

      <Card>
        <CardContent className="p-4 text-sm">
          Data, horário, situação, responsável e palestrante têm ações próprias na{" "}
          <Link href={lectureHref(lecture.id)} className="text-primary-strong hover:underline">
            tela da palestra
          </Link>
          . Assim o histórico registra cada mudança pelo que ela é.
        </CardContent>
      </Card>

      <LectureForm directory={directory} lecture={lecture} cities={cities} />
    </div>
  );
}
