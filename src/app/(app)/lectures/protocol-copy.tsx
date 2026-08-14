"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * O protocolo em destaque, com um botão para copiar (§46).
 *
 * O protocolo é o número que a pessoa do outro lado anotou — é por ele que a
 * APCS é procurada ("e a minha SOL-000042?"). Copiar à mão de uma fonte
 * monoespaçada é onde `0` vira `O` e `1` vira `l`.
 *
 * `navigator.clipboard` exige contexto seguro (HTTPS ou localhost). Onde ele não
 * existe, o botão simplesmente não aparece — em vez de aparecer e não fazer
 * nada, que é pior.
 */
export function ProtocolCopy({ protocol }: { protocol: string }) {
  const [copiado, setCopiado] = useState(false);
  const [disponivel, setDisponivel] = useState(false);

  // A checagem roda depois da montagem: no servidor não existe `navigator`, e
  // decidir isso durante a renderização faria o HTML do servidor e o do cliente
  // discordarem.
  useEffect(() => {
    setDisponivel(typeof navigator !== "undefined" && Boolean(navigator.clipboard));
  }, []);

  useEffect(() => {
    if (!copiado) return;
    const timer = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(timer);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(protocol);
      setCopiado(true);
    } catch {
      // Sem alarde: a pessoa continua vendo o protocolo na tela e pode
      // selecioná-lo à mão. Um erro aqui não merece interromper nada.
      setDisponivel(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-sm font-medium">{protocol}</span>

      {disponivel && (
        <button
          type="button"
          onClick={copiar}
          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring cursor-pointer rounded-md p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Copiar protocolo ${protocol}`}
        >
          {copiado ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      )}

      {/* O retorno é anunciado, e não só desenhado: sem isto, quem usa leitor de
          tela clica e não sabe se algo aconteceu. */}
      <span role="status" className="sr-only">
        {copiado ? "Protocolo copiado." : ""}
      </span>
    </span>
  );
}
