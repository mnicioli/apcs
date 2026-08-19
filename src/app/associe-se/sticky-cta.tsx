"use client";

import { useEffect, useState } from "react";

/**
 * O botão fixo do rodapé, só no celular.
 *
 * Some quando o formulário está à vista: um botão "ir para o formulário"
 * flutuando POR CIMA do formulário é ruído, e no celular ele cobre justamente o
 * campo que a pessoa está preenchendo.
 *
 * ⚠️ `aria-hidden` e `tabIndex={-1}` andam juntos com a opacidade. Um elemento
 * invisível que continua na ordem de tabulação é uma armadilha para quem navega
 * por teclado ou leitor de tela — o foco vai para um lugar que ninguém vê.
 */
export function StickyCta({ targetId, href }: { targetId: string; href: string }) {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const alvo = document.getElementById(targetId);
    if (!alvo) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisivel(!!entry && !entry.isIntersecting && entry.boundingClientRect.top > 0),
      { rootMargin: "0px 0px -20% 0px" },
    );
    observer.observe(alvo);

    // No topo da página o botão não aparece: o CTA principal está logo ali.
    const aoRolar = () => setVisivel((atual) => (window.scrollY > 320 ? atual : false));
    window.addEventListener("scroll", aoRolar, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", aoRolar);
    };
  }, [targetId]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-[opacity,transform] duration-200 md:hidden"
      style={{
        opacity: visivel ? 1 : 0,
        transform: visivel ? "none" : "translate3d(0, 12px, 0)",
      }}
      aria-hidden={!visivel}
    >
      <a
        href={href}
        tabIndex={visivel ? 0 : -1}
        className="bg-primary text-primary-foreground focus-visible:ring-ring flex h-12 w-full items-center justify-center rounded-md text-base font-medium shadow-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        style={{ pointerEvents: visivel ? "auto" : "none" }}
      >
        Iniciar minha solicitação
      </a>
    </div>
  );
}
