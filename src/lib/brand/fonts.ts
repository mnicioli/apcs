import { Inter, Manrope } from "next/font/google";

/**
 * As fontes da MARCA — as das páginas públicas, não as do CRM.
 *
 * Manrope nos títulos, Inter no texto: as do layout institucional validado.
 * `src/styles/apcs-landing.css` as consome por `var(--font-manrope)` e
 * `var(--font-inter)`, então quem abre o escopo `.apcs-landing` precisa ter
 * declarado as duas variáveis — e é para isso que este arquivo existe.
 *
 * ⚠️ VÊM POR `next/font`, QUE AS HOSPEDA NO PRÓPRIO DOMÍNIO. Nenhuma requisição
 * sai para o Google quando alguém abre a página, o que importa numa página que
 * coleta dado pessoal — e elimina o salto de layout da fonte trocando depois do
 * primeiro desenho.
 *
 * ⚠️ NÃO SÃO CARREGADAS NO LAYOUT RAIZ, e a ausência é a decisão. O CRM não usa
 * nenhuma das duas; baixá-las em toda tela do sistema seria peso sem uso. Cada
 * rota pública as declara no layout DELA — hoje `/associe-se` e `/eventos`.
 *
 * `next/font` deduplica: as duas rotas declarando a mesma família geram um
 * arquivo só no build.
 */

export const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
  weight: ["600", "700", "800"],
});

export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * As classes que abrem o escopo institucional numa raiz de rota pública.
 *
 * Um lugar só porque `.apcs-landing` sem as variáveis de fonte é uma página que
 * cai na fonte do sistema sem ninguém perceber — o tipo de defeito que passa em
 * teste e aparece na tela de quem se inscreve.
 */
export const PUBLIC_SHELL_CLASS = `apcs-landing bg-background min-h-screen ${manrope.variable} ${inter.variable}`;
