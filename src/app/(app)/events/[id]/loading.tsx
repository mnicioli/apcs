import { Card, CardContent } from "@/components/ui/card";

/** Esqueleto da tela de detalhes enquanto o servidor busca o evento. */
export default function EventDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o evento...</span>

      <div className="space-y-2">
        <div className="bg-muted h-4 w-40 animate-pulse rounded-md" />
        <div className="bg-muted h-8 w-72 max-w-full animate-pulse rounded-md" />
        <div className="bg-muted h-5 w-20 animate-pulse rounded-full" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-6 p-6">
            <div className="bg-muted h-56 w-full max-w-md animate-pulse rounded-lg" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-1">
                  <div className="bg-muted h-3 w-20 animate-pulse rounded-md" />
                  <div className="bg-muted h-4 w-36 animate-pulse rounded-md" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="bg-muted h-4 w-full animate-pulse rounded-md" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
