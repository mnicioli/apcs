import { MembershipForm } from "./form/membership-form";
import { Reveal } from "./reveal";
import { Hero, ProcessSection, SiteFooter, SiteHeader, ValueSection } from "./sections";
import { StickyCta } from "./sticky-cta";

/**
 * A landing pública de associação — a ÚNICA página do sistema que qualquer um
 * na internet abre sem estar logado (fora o chat).
 *
 * Ela é Server Component: o que chega ao navegador como JavaScript é só o
 * formulário, o `Reveal` e o botão fixo do celular. O texto institucional, o
 * logo e as três seções são HTML pronto.
 *
 * A rota está na lista pública do middleware (`src/lib/supabase/middleware.ts`).
 * Sem isso, o visitante seria mandado para `/login` — que é o comportamento
 * certo para todo o resto do sistema e o errado para esta página.
 */

export default function AssocieSePage() {
  return (
    <>
      <SiteHeader />

      <main>
        <Hero />
        <ValueSection />
        <ProcessSection />

        <section className="bg-surface" aria-labelledby="solicitacao">
          <div className="mx-auto max-w-[1180px] px-6 py-16 sm:px-8 md:py-24">
            <div className="mx-auto max-w-[46rem] lg:max-w-[64rem]">
              <Reveal>
                <p className="text-primary text-xs font-semibold tracking-[0.18em]">
                  SOLICITAÇÃO DE FILIAÇÃO
                </p>
                {/*
                  `id="solicitacao"` + `tabIndex={-1}` no TÍTULO, e não numa div
                  vazia acima: assim o link do CTA rola até aqui E entrega o
                  foco ao cabeçalho da seção. Quem navega por teclado continua a
                  leitura no lugar certo, e o teclado do celular não abre — o
                  que aconteceria se o foco caísse no primeiro campo.
                */}
                <h2
                  id="solicitacao"
                  tabIndex={-1}
                  className="mt-4 scroll-mt-20 text-3xl font-bold focus:outline-none sm:text-4xl"
                >
                  Vamos conhecer seu perfil.
                </h2>
                <p className="text-muted-foreground mt-4 text-base">
                  Leva poucos minutos. Você poderá revisar as informações antes de enviar.
                </p>
              </Reveal>

              <div className="mt-10">
                <MembershipForm />
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <StickyCta targetId="solicitacao" href="#solicitacao" />
    </>
  );
}
