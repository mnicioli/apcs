import { ApcsAnimatedLogo, ApcsLogo } from "./apcs-logo";
import { Reveal } from "./reveal";

/**
 * As seções institucionais da landing.
 *
 * Todas são Server Components: nenhuma tem estado, e o único movimento é o
 * `Reveal`, que é um invólucro de cliente. Isso mantém o texto institucional
 * fora do pacote JavaScript — numa página que existe para carregar rápido no
 * celular de quem está no campo, é a diferença que mais aparece.
 *
 * ⚠️ O CTA é um LINK para a âncora do formulário, e não um botão com
 * `scrollIntoView`. Funciona sem JavaScript, o navegador move o foco para o
 * destino sozinho (é o que faz o `tabIndex={-1}` no título da seção) e a
 * rolagem suave vem do `scroll-behavior` de landing.css — que já respeita
 * `prefers-reduced-motion`. Menos código e mais robusto que o original.
 */

const FORM_ANCHOR = "#solicitacao";

const TRUST_SIGNALS = [
  "Entidade sem fins lucrativos",
  "Desde 1967",
  "Análise feita pela equipe da APCS",
];

const PILLARS = [
  {
    title: "Representação",
    body: "Uma voz organizada para defender pautas relevantes da suinocultura paulista e dialogar com a cadeia.",
  },
  {
    title: "Informação para decidir",
    body: "Mais proximidade com informações de mercado, temas técnicos e movimentos que impactam a atividade.",
  },
  {
    title: "Conexão coletiva",
    body: "Relacionamento com produtores, profissionais e empresas que compartilham desafios e oportunidades do setor.",
  },
];

/**
 * Os três passos escurecem e clareiam a partir da marca, em vez de trazerem
 * três vermelhos escritos à mão. Assim, o dia em que `--primary` mudar, os três
 * mudam junto — três hexadecimais soltos ficariam para trás sem avisar.
 */
const STEPS = [
  {
    title: "Conte quem você é",
    body: "Escolha o perfil que melhor representa sua atuação.",
    tint: "color-mix(in oklab, var(--primary), black 16%)",
  },
  {
    title: "Preencha seus dados",
    body: "Informe apenas o necessário para a equipe entender seu contexto.",
    tint: "var(--primary)",
  },
  {
    title: "Aguarde o contato",
    body: "A APCS analisará a solicitação e orientará os próximos passos.",
    tint: "color-mix(in oklab, var(--primary), white 12%)",
  },
];

export function SiteHeader() {
  return (
    <header className="border-hairline bg-background/90 sticky top-0 z-40 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center px-6 sm:px-8">
        <a
          href="#topo"
          className="rounded-md transition-opacity duration-150 hover:opacity-80"
          aria-label="APCS — ir para o topo da página"
        >
          <ApcsLogo />
        </a>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section id="topo" className="border-hairline border-b">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-y-2 px-6 py-14 sm:px-8 md:py-24 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7">
          <Reveal>
            <p className="text-primary text-xs font-semibold tracking-[0.18em]">
              ASSOCIE-SE À APCS
            </p>
          </Reveal>
          <Reveal delay={60}>
            <h1 className="mt-4 text-4xl leading-[1.1] font-extrabold text-balance sm:text-5xl md:text-[3.5rem]">
              Fortaleça sua atuação na suinocultura paulista.
            </h1>
          </Reveal>
        </div>

        <div className="lg:col-span-5 lg:row-span-2 lg:self-center">
          <Reveal delay={120}>
            <div className="flex flex-col items-center gap-3 py-8 text-center sm:gap-4 lg:py-6">
              <ApcsAnimatedLogo />
              <span aria-hidden className="bg-primary/30 h-px w-16" />
              <p className="text-muted-foreground text-sm leading-relaxed">
                <span className="font-display text-foreground block text-base font-bold">
                  Associação Paulista de Criadores de Suínos
                </span>
                <span className="mt-1 block">Representação institucional desde 1967</span>
              </p>
            </div>
          </Reveal>
        </div>

        <div className="lg:col-span-7 lg:col-start-1">
          <Reveal delay={120}>
            <p className="text-muted-foreground max-w-[38rem] text-lg">
              Faça sua solicitação de filiação à APCS, a Associação Paulista de Criadores de Suínos,
              e aproxime-se de uma entidade que representa o setor, organiza informação de mercado e
              conecta produtores, profissionais e empresas da cadeia.
            </p>
          </Reveal>
          <Reveal delay={160}>
            <p className="text-muted-foreground mt-4 max-w-[38rem] text-base">
              Preencha em poucos minutos. A equipe da APCS analisará seu perfil e orientará os
              próximos passos.
            </p>
          </Reveal>

          <div className="mt-8">
            <a
              href={FORM_ANCHOR}
              className="apcs-cta bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-14 w-full items-center justify-center rounded-md px-10 text-base font-semibold focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto"
            >
              Iniciar minha solicitação
            </a>
          </div>

          <Reveal delay={200}>
            <ul className="mt-8 flex flex-wrap gap-2">
              {TRUST_SIGNALS.map((sinal) => (
                <li
                  key={sinal}
                  className="border-hairline bg-card text-muted-foreground rounded-full border px-3 py-1.5 text-xs font-medium"
                >
                  {sinal}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function ValueSection() {
  return (
    <section className="border-hairline bg-primary/[0.05] border-b">
      <div className="mx-auto max-w-[1180px] px-6 py-14 sm:px-8 md:py-24">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="text-primary text-xs font-semibold tracking-[0.18em]">
                POR QUE ASSOCIAR-SE
              </p>
              <h2 className="mt-4 text-3xl leading-tight font-bold text-balance sm:text-4xl">
                Uma entidade que trabalha ao lado de quem move o setor.
              </h2>
            </Reveal>
            <Reveal delay={60}>
              <p className="text-muted-foreground mt-5 text-base">
                Associar-se é aproximar sua realidade de uma rede que transforma demandas
                individuais em atuação coletiva.
              </p>
            </Reveal>
          </div>

          <ul className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3 lg:col-span-7">
            {PILLARS.map((pilar, indice) => (
              <Reveal as="li" key={pilar.title} delay={indice * 80} className="h-full min-w-0">
                <div className="border-primary/20 bg-card flex h-full flex-col overflow-hidden rounded-xl border shadow-[0_6px_20px_-16px_color-mix(in_oklab,var(--primary)_70%,transparent)]">
                  <div className="bg-primary h-1 w-full" />
                  <div className="flex flex-1 flex-col p-5 sm:p-6">
                    <h3 className="text-primary text-lg font-semibold">{pilar.title}</h3>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {pilar.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function ProcessSection() {
  return (
    <section className="border-hairline border-b">
      <div className="mx-auto max-w-[1180px] px-6 py-16 sm:px-8 md:py-24">
        <Reveal>
          <p className="text-primary text-xs font-semibold tracking-[0.18em]">COMO FUNCIONA</p>
          <h2 className="mt-4 text-3xl font-bold sm:text-4xl">Sua solicitação em três passos.</h2>
        </Reveal>

        <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-3">
          {STEPS.map((passo, indice) => (
            <Reveal as="li" key={passo.title} delay={indice * 140} className="min-w-0">
              <div className="flex h-full flex-col gap-4 md:gap-0">
                <div
                  className={`${
                    indice === STEPS.length - 1 ? "apcs-arrow-last" : "apcs-arrow"
                  } text-primary-foreground flex items-center gap-4 px-6 pt-6 pb-9 md:h-[132px] md:flex-col md:items-start md:justify-center md:gap-1 md:pr-12 md:pb-6`}
                  style={{ backgroundColor: passo.tint }}
                >
                  <span className="font-display text-3xl leading-none font-extrabold opacity-90">
                    {String(indice + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-xs font-bold tracking-[0.22em]">PASSO</span>
                </div>

                <div className="border-hairline min-w-0 px-1 md:mt-5 md:border-t md:pt-5">
                  <h3 className="text-lg font-semibold">{passo.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm">{passo.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>

        <p className="border-primary/20 bg-primary/5 text-muted-foreground mt-10 rounded-xl border px-5 py-4 text-sm">
          O envio do formulário não representa aprovação automática da filiação.
        </p>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-hairline bg-surface border-t">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-6 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <ApcsLogo height={28} />
          <p className="text-muted-foreground text-sm">
            APCS, Associação Paulista de Criadores de Suínos. Entidade sem fins lucrativos.
          </p>
        </div>
        {/*
          O layout validado previa links para site oficial, Instagram e política
          de privacidade — os três marcados como pendentes de definição. Eles
          continuam ausentes, e a ausência é deliberada: um link institucional
          inventado numa página de cadastro é pior que link nenhum. Quando os
          endereços vierem, entram aqui.
        */}
      </div>
    </footer>
  );
}
