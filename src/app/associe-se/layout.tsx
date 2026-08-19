import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./landing.css";

/**
 * Casca da landing pública de associação.
 *
 * ⚠️ AS DUAS COISAS QUE ESTE ARQUIVO FAZ, E POR QUE ELAS FICAM AQUI
 *
 * 1. CARREGA AS FONTES DA MARCA. Manrope (títulos) e Inter (texto) são as do
 *    layout validado. Vêm por `next/font`, que as HOSPEDA NO PRÓPRIO DOMÍNIO:
 *    nenhuma requisição sai para o Google quando alguém abre a página, o que
 *    importa numa página que coleta dado pessoal — e elimina o salto de layout
 *    da fonte trocando depois do primeiro desenho.
 *    Ficam no layout DA ROTA, e não no raiz: o CRM não usa nenhuma das duas, e
 *    baixá-las em toda tela do sistema seria peso sem uso.
 *
 * 2. ABRE O ESCOPO `.apcs-landing`. É a fronteira entre a identidade VERMELHA
 *    da APCS e a LARANJA do CRM — ver o cabeçalho de landing.css.
 */

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
  weight: ["600", "700", "800"],
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const TITLE = "Associe-se à APCS — Associação Paulista de Criadores de Suínos";
const DESCRIPTION =
  "Solicite sua filiação à APCS: representação institucional, informação de mercado e conexão com produtores, profissionais e empresas da suinocultura paulista.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
  // A página é pública e existe para ser encontrada — é a única rota do sistema
  // de que isso é verdade.
  robots: { index: true, follow: true },
};

export default function AssocieSeLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`apcs-landing bg-background min-h-screen ${manrope.variable} ${inter.variable}`}
    >
      {children}
    </div>
  );
}
