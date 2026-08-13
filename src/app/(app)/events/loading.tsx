import { Card, CardContent } from "@/components/ui/card";

/**
 * Esqueleto da grid enquanto o servidor busca os eventos.
 *
 * `loading.tsx` é o mecanismo do App Router: o Next mostra isto automaticamente
 * enquanto a página assíncrona resolve, sem estado nem efeito no cliente. As
 * barras usam `animate-pulse`, do Tailwind — nenhum plugin de animação novo.
 */
export default function EventsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando eventos...</span>

      <div className="space-y-2">
        <div className="bg-muted h-8 w-40 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-96 max-w-full animate-pulse rounded-md" />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="bg-muted h-9 min-w-56 flex-1 animate-pulse rounded-md" />
        <div className="bg-muted h-9 w-40 animate-pulse rounded-md" />
        <div className="bg-muted h-9 w-44 animate-pulse rounded-md" />
        <div className="bg-muted h-9 w-44 animate-pulse rounded-md" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="bg-muted h-10 w-16 shrink-0 animate-pulse rounded-md" />
              <div className="bg-muted h-4 flex-1 animate-pulse rounded-md" />
              <div className="bg-muted h-4 w-24 animate-pulse rounded-md" />
              <div className="bg-muted h-5 w-16 animate-pulse rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
