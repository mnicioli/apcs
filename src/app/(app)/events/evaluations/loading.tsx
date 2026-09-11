import { Card, CardContent } from "@/components/ui/card";

/**
 * Esqueleto enquanto o servidor busca os eventos e a gestão de avaliações.
 *
 * ⚠️ SERVE ÀS DUAS TELAS DO SEGMENTO — a seleção de evento e a lista de um
 * evento. `loading.tsx` na pasta pai cobre as rotas filhas, e as duas têm a
 * mesma forma: cabeçalho, cartões, filtros e tabela. Um segundo arquivo em
 * `[eventId]/` seria a mesma coisa desenhada de novo.
 *
 * O Next mostra isto automaticamente enquanto a página assíncrona resolve, sem
 * estado nem efeito no cliente. As barras usam `animate-pulse`, do Tailwind.
 */
export default function EvaluationsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando a gestão de avaliações...</span>

      <div className="space-y-2">
        <div className="bg-muted h-8 w-56 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-96 max-w-full animate-pulse rounded-md" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="bg-muted h-20 animate-pulse rounded-lg" />
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="bg-muted h-9 min-w-56 flex-1 animate-pulse rounded-md" />
        <div className="bg-muted h-9 w-40 animate-pulse rounded-md" />
        <div className="bg-muted h-9 w-44 animate-pulse rounded-md" />
        <div className="bg-muted h-9 w-52 animate-pulse rounded-md" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="bg-muted h-4 flex-1 animate-pulse rounded-md" />
              <div className="bg-muted h-4 w-40 animate-pulse rounded-md" />
              <div className="bg-muted h-5 w-24 animate-pulse rounded-full" />
              <div className="bg-muted h-5 w-20 animate-pulse rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
