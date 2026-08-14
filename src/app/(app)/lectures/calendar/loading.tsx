import { Card, CardContent } from "@/components/ui/card";

/** Esqueleto do calendário enquanto o servidor busca o período (§50). */
export default function LectureCalendarLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o calendário...</span>

      <div className="space-y-2">
        <div className="bg-muted h-8 w-40 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-96 max-w-full animate-pulse rounded-md" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <div className="bg-muted h-9 w-9 animate-pulse rounded-md" />
          <div className="bg-muted h-9 w-9 animate-pulse rounded-md" />
          <div className="bg-muted h-9 w-20 animate-pulse rounded-md" />
          <div className="bg-muted h-9 w-48 animate-pulse rounded-md" />
        </div>
        <div className="bg-muted h-9 w-72 animate-pulse rounded-md" />
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 42 }).map((_, index) => (
              <div key={index} className="bg-muted h-24 animate-pulse rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
