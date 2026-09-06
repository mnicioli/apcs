import type { Metadata } from "next";
import { PUBLIC_LANDING_NOT_FOUND } from "@/modules/event/event.landing.labels";
import { CabecalhoInstitucional, RodapeInstitucional } from "./[slug]/landing-chrome";

/**
 * §5 — o endereço não leva a nenhuma inscrição disponível.
 *
 * ⚠️ ELA NÃO DIZ POR QUÊ, E É O PONTO. Chega-se aqui por três caminhos — o slug
 * não existe, a página está em rascunho, a página foi inativada — e os três
 * recebem exatamente esta tela. Distinguir "não existe" de "existe mas está
 * oculta" confirmaria a existência de um evento que ainda está sendo preparado
 * para quem estivesse tentando endereços.
 *
 * ⚠️ E NÃO OFERECE UMA LISTA DE EVENTOS. Um "veja os outros eventos da APCS"
 * seria simpático e transformaria esta rota num catálogo público — que é
 * exatamente o que a decisão 1 da migration evitou ao não abrir policy para
 * `anon`.
 *
 * A identidade institucional continua: quem clicou num link da APCS e caiu aqui
 * precisa reconhecer onde está.
 */
export const metadata: Metadata = {
  title: PUBLIC_LANDING_NOT_FOUND.title,
  robots: { index: false, follow: false },
};

export default function EventoNaoEncontrado() {
  return (
    <>
      <CabecalhoInstitucional />

      <main className="mx-auto flex max-w-[46rem] flex-col items-center px-5 py-20 text-center sm:px-6">
        <h1 className="font-display text-primary-strong text-2xl font-extrabold tracking-tight uppercase sm:text-3xl">
          {PUBLIC_LANDING_NOT_FOUND.title}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-md text-base leading-relaxed">
          {PUBLIC_LANDING_NOT_FOUND.message}
        </p>
      </main>

      <RodapeInstitucional />
    </>
  );
}
