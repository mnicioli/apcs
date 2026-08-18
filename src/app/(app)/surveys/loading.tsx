import { Card, CardContent } from "@/components/ui/card";

/**
 * Esqueleto da grid (§53).
 *
 * Repete o ESQUELETO da tela real — cabeçalho, barra de filtros e linhas — em
 * vez de um spinner centralizado. A diferença é concreta: o layout não pula
 * quando o conteúdo chega, e quem está esperando já sabe o que vai aparecer.
 *
 * `aria-hidden` porque não há informação aqui: quem usa leitor de tela recebe o
 * anúncio de carregamento pela navegação do Next, e ouvir doze caixas vazias
 * seria ruído.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-2">
        <div className="bg-muted h-8 w-40 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-80 animate-pulse rounded-md" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="space-y-1.5">
            <div className="bg-muted h-4 w-20 animate-pulse rounded-md" />
            <div className="bg-muted h-9 w-full animate-pulse rounded-md" />
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="bg-muted h-10 w-full animate-pulse rounded-md" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
