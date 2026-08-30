"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

/**
 * A EXPLICAÇÃO QUE SÓ APARECE QUANDO ALGUÉM PERGUNTA.
 *
 * ⚠️ Nasceu de um problema de LAYOUT, e a origem explica o desenho. A barra de
 * filtros alinha os campos pela base (`items-end`); um parágrafo de ajuda
 * embaixo de UM dos campos empurrava aquela coluna para cima e deixava a linha
 * inteira torta. A dica não era menos verdadeira por isso — só não precisava
 * ocupar espaço permanente para uma frase que se lê uma vez na vida.
 *
 * ⚠️ NÃO É O `title=` DO NAVEGADOR. O `title` demora ~1 s para aparecer, some
 * sozinho, não responde ao teclado e é invisível no celular. Este abre no clique
 * E no foco, então funciona com Tab, com toque e com mouse.
 *
 * ⚠️ E NÃO É UM `<div>` COM `onMouseOver`: o gatilho é um `<button>` de
 * verdade, com `aria-describedby` apontando para o texto. Um leitor de tela
 * anuncia a dica junto do campo; sem isso, a informação simplesmente não existe
 * para quem não vê a tela.
 */
export function InfoTip({ text, label = "Mais informações" }: { text: string; label?: string }) {
  /**
   * ⚠️ DOIS ESTADOS PARA UMA DICA, e a razão é um defeito que o teste pegou: com
   * um estado só e um clique que ALTERNA, passar o mouse sobre o ícone abria a
   * dica e o clique — o gesto natural de quem quer lê-la — fechava na hora.
   *
   * `passando` é o que o mouse e o teclado abrem enquanto estão ali. `fixado` é
   * o que o clique deixa aberto depois que eles saem, que é como isto funciona
   * no toque (onde não existe "passar por cima").
   */
  const [passando, setPassando] = useState(false);
  const [fixado, setFixado] = useState(false);
  const aberto = passando || fixado;

  const id = useId();
  const box = useRef<HTMLSpanElement>(null);

  // Esc fecha, e um clique fora também. Uma dica que fica presa na tela vira
  // exatamente o estorvo que ela deveria evitar.
  useEffect(() => {
    if (!aberto) return;

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setFixado(false);
      setPassando(false);
    }

    function onClick(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setFixado(false);
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [aberto]);

  return (
    <span ref={box} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        // `aria-describedby` e não `aria-expanded`: isto descreve outra coisa,
        // não abre uma região. É esta ligação que faz a dica existir para quem
        // não vê a tela.
        aria-describedby={aberto ? id : undefined}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex cursor-help rounded-full focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => setFixado((atual) => !atual)}
        onMouseEnter={() => setPassando(true)}
        onMouseLeave={() => setPassando(false)}
        onFocus={() => setPassando(true)}
        onBlur={() => setPassando(false)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {aberto && (
        <span
          id={id}
          role="tooltip"
          // `absolute` + `z-20`: a dica flutua SOBRE a linha de filtros em vez de
          // empurrá-la — que é o defeito que ela veio consertar. A largura fixa
          // evita uma tira de uma linha só atravessando a tela.
          className="bg-popover text-popover-foreground border-border absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-md border p-2 text-xs leading-snug font-normal shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  );
}
