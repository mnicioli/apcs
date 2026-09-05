"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * O ENDEREÇO PÚBLICO DA PÁGINA (§27).
 *
 * ⚠️ A ORIGEM VEM DO SERVIDOR, e nunca daqui. `getSiteOrigin()` resolve
 * `NEXT_PUBLIC_SITE_URL` → domínio de produção da Vercel → cabeçalho da
 * requisição, nessa ordem, e por razões de segurança que estão documentadas
 * naquele arquivo. Montar a URL com `window.location.origin` funcionaria e
 * seria a coisa errada: numa prévia da Vercel a pessoa copiaria um endereço
 * que morre no dia seguinte.
 *
 * ⚠️ E O AVISO DE RASCUNHO NÃO É DECORAÇÃO. Enquanto a página não está
 * publicada, este endereço **não abre** — copiá-lo e mandar para alguém
 * produziria um 404 e um telefonema. A frase existe para isso.
 */
export function LandingUrl({
  origin,
  slug,
  published,
}: {
  /** Origem já resolvida pelo servidor, sem barra final. */
  origin: string;
  slug: string;
  published: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  const url = `${origin}/eventos/${slug}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // `navigator.clipboard` exige contexto seguro e permissão. Quando não dá,
      // o endereço continua na tela para ser selecionado à mão — que é por que
      // ele é exibido por extenso em vez de escondido atrás do botão.
      setCopiado(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Endereço público</p>

      <div className="flex flex-wrap items-center gap-2">
        <code className="border-border bg-muted min-w-0 flex-1 truncate rounded-md border px-3 py-2 text-xs">
          {url}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copiar}>
          {copiado ? (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copiar
            </>
          )}
        </Button>
      </div>

      {/* `role="status"` para o leitor de tela anunciar a confirmação da cópia,
          que de outra forma seria uma mudança visual silenciosa. */}
      <p role="status" className="sr-only">
        {copiado ? "Endereço copiado." : ""}
      </p>

      <p className="text-muted-foreground text-xs">
        {published
          ? "A página está no ar neste endereço."
          : "Este endereço só passa a funcionar depois que a página for publicada."}
      </p>
    </div>
  );
}
