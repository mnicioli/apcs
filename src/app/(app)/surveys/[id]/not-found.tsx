import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * A enquete não existe — ou o endereço está malformado.
 *
 * Os dois casos caem aqui de propósito: para quem está olhando, "não existe" e
 * "esse endereço não é válido" são a mesma informação útil, e distinguir só
 * ajudaria quem estivesse sondando ids.
 */
export default function NotFound() {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Enquete não encontrada</h1>
          <p className="text-muted-foreground text-sm">
            Ela pode ter sido excluída, ou o endereço está incorreto.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/surveys">Voltar para as enquetes</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
