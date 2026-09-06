"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { registrationsHref } from "@/modules/event/event.registrations.routes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A busca da tela inicial de Inscrições (§4).
 *
 * ⚠️ O ESTADO MORA NA URL, e não neste componente. A lista é renderizada no
 * servidor — é a URL que precisa mudar para vir gente nova do banco. De quebra,
 * uma busca pode ser compartilhada por link e sobrevive ao F5.
 *
 * ⚠️ E A BUSCA VOLTA PARA A PÁGINA 1. Sem isso, procurar algo estando na página
 * 3 daria "nenhum evento encontrado" sobre um resultado que tem duas páginas —
 * e a pessoa concluiria que o evento não existe.
 */
const DEBOUNCE_MS = 300;

export function EventSearch({ query }: { query: string }) {
  const router = useRouter();
  const [term, setTerm] = useState(query);
  const id = useId();

  useEffect(() => {
    if (term === query) return;

    // O atraso é o que impede uma navegação por tecla digitada. `replace` e não
    // `push`: cada letra não deve virar uma parada no botão "voltar".
    const timer = setTimeout(() => {
      router.replace(registrationsHref(1, term), { scroll: false });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, query, router]);

  return (
    <div className="max-w-md space-y-2">
      <Label htmlFor={id}>Evento ou endereço</Label>
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id={id}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar por nome do evento ou endereço"
          className="pl-9"
        />
      </div>
    </div>
  );
}
