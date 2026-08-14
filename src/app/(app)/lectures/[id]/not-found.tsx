import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LECTURE_MODULE_TITLE } from "@/modules/lecture/lecture.labels";
import { lecturesHref } from "@/modules/lecture/lecture.routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * §59: um deep link para uma palestra que não existe.
 *
 * Pode ser um link antigo, um protocolo digitado errado ou um registro que
 * nunca existiu. A tela não tenta adivinhar qual — diz o que aconteceu e oferece
 * a saída.
 */
export default function LectureNotFound() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Palestra não encontrada</h1>

      <Card>
        <CardContent className="space-y-4 p-6">
          <p className="text-muted-foreground text-sm">
            A palestra que você procurou não existe ou não está disponível para o seu perfil.
          </p>
          <Button variant="outline" asChild>
            <Link href={lecturesHref()}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Voltar para {LECTURE_MODULE_TITLE}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
