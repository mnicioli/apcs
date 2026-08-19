"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Aparição discreta ao rolar: opacidade + um deslocamento pequeno, uma vez só.
 *
 * ⚠️ Componente de cliente com FILHOS DE SERVIDOR. As seções da landing são
 * Server Components e chegam aqui como `children` — o que roda no navegador é
 * só o observador. Trocar isto por um `"use client"` na página inteira mandaria
 * todo o texto institucional para o pacote JavaScript sem precisar.
 *
 * O `data-revealed` mora no atributo, não numa classe, porque a transição é
 * declarada em landing.css: React só vira o interruptor.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "header";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [revelado, setRevelado] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Quem pediu para o movimento parar já vê o conteúdo posto: sem isto, o
    // elemento ficaria invisível para sempre, porque o CSS zera a opacidade.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevelado(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevelado(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-revealed={revelado}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn("apcs-reveal", className)}
    >
      {children}
    </Tag>
  );
}
