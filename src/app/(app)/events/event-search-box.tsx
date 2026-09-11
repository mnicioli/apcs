"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A BUSCA DAS TRÊS TELAS DE SELEÇÃO DE EVENTO — Inscrições, Lista de Presença e
 * Avaliações.
 *
 * ============================================================================
 * ⚠️ ESTE ARQUIVO EXISTE PORQUE O TERCEIRO APARECEU.
 * ============================================================================
 * `presence-event-search.tsx` trazia esta nota, escrita quando havia duas
 * cópias:
 *
 *   "É GÊMEO DE `EventSearch` (Inscrições), E NÃO O MESMO COMPONENTE. A única
 *    diferença é a rota que ele monta (...) um componente compartilhado
 *    precisaria receber a função de endereço como propriedade, o que troca
 *    vinte linhas duplicadas por uma indireção que esconde para onde a tela
 *    navega. **Se um terceiro aparecer, aí vale extrair.**"
 *
 * Avaliações é o terceiro. A conta virou: três cópias do mesmo `debounce`, do
 * mesmo `replace` sem `push` e do mesmo voltar-para-a-página-1 são três lugares
 * para a próxima correção não chegar — e a terceira, a menos usada, seria a que
 * ficaria para trás.
 *
 * ⚠️ O QUE A INDIREÇÃO CUSTA CONTINUA VERDADE: lendo este arquivo não dá para
 * saber para onde a tela navega. O preço é pago em `href`, que é uma função
 * nomeada (`presenceHref`, `evaluationsHref`) passada pela página — então quem
 * lê a PÁGINA continua vendo o destino, que é onde a pergunta costuma nascer.
 */
const DEBOUNCE_MS = 300;

export interface EventSearchBoxProps {
  query: string;
  /**
   * Monta o endereço da busca. ⚠️ Recebe SEMPRE a página 1: procurar estando na
   * página 3 daria "nenhum evento encontrado" sobre um resultado que tem duas
   * páginas, e a pessoa concluiria que o evento não existe.
   */
  href: (query: string) => string;
  label: string;
  placeholder: string;
}

export function EventSearchBox({ query, href, label, placeholder }: EventSearchBoxProps) {
  const router = useRouter();
  const [term, setTerm] = useState(query);
  const id = useId();

  useEffect(() => {
    if (term === query) return;

    // O atraso é o que impede uma navegação por tecla digitada. `replace` e não
    // `push`: cada letra não deve virar uma parada no botão "voltar".
    const timer = setTimeout(() => {
      router.replace(href(term), { scroll: false });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // ⚠️ `href` FICA FORA DAS DEPENDÊNCIAS DE PROPÓSITO. As páginas a declaram
    // como seta inline, então ela é uma função NOVA a cada render — incluí-la
    // reiniciaria o temporizador a cada tecla e a busca nunca dispararia.
    // O que precisa disparar o efeito é o texto, e ele está aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, query, router]);

  return (
    <div className="max-w-md space-y-2">
      <Label htmlFor={id}>{label}</Label>
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
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
    </div>
  );
}
