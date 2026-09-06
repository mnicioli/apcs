import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PUBLIC_SHELL_CLASS } from "@/lib/brand/fonts";
import "@/styles/apcs-landing.css";

/**
 * Casca da landing pública de associação.
 *
 * ⚠️ AS FONTES E O ESCOPO SAÍRAM DAQUI, e passaram a ser compartilhados.
 *
 * `PUBLIC_SHELL_CLASS` (em `@/lib/brand/fonts`) declara Manrope e Inter por
 * `next/font` e abre `.apcs-landing`, a fronteira entre a identidade VERMELHA
 * da APCS e a LARANJA do CRM — ver o cabeçalho de `apcs-landing.css`.
 *
 * A mudança aconteceu quando a página pública de inscrição em eventos
 * (`/eventos/[slug]`) passou a precisar exatamente da mesma casca. Duas cópias
 * seriam duas identidades institucionais para manter em dia, e a segunda
 * ficaria para trás na primeira vez que a marca mudasse.
 */

const TITLE = "Associe-se à APCS — Associação Paulista de Criadores de Suínos";
const DESCRIPTION =
  "Solicite sua filiação à APCS: representação institucional, informação de mercado e conexão com produtores, profissionais e empresas da suinocultura paulista.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
  // A página é pública e existe para ser encontrada.
  robots: { index: true, follow: true },
};

export default function AssocieSeLayout({ children }: { children: ReactNode }) {
  return <div className={PUBLIC_SHELL_CLASS}>{children}</div>;
}
