import type { ReactNode } from "react";
import { PUBLIC_SHELL_CLASS } from "@/lib/brand/fonts";
import "@/styles/apcs-landing.css";

/**
 * Casca das páginas públicas de inscrição em eventos.
 *
 * ⚠️ É A MESMA CASCA DE `/associe-se`, e essa é a resposta ao §6 ("utilizar o
 * design system existente, as cores institucionais existentes, a tipografia
 * existente"). `PUBLIC_SHELL_CLASS` declara Manrope e Inter por `next/font` e
 * abre o escopo `.apcs-landing`, onde os tokens do Tailwind passam a valer o
 * VERMELHO institucional (#C4262E, amostrado do logo oficial) em vez do laranja
 * do CRM.
 *
 * A consequência prática é o §6 inteiro sem uma linha de cor escrita à mão:
 * `bg-primary` aqui dentro já é o vermelho da APCS, e não há como uma
 * configuração de Landing Page mudar isso — não existe campo para cor em lugar
 * nenhum do módulo, desde o §19 do Prompt 1.
 *
 * ⚠️ SEM METADATA AQUI. Ela é por PÁGINA, gerada a partir do evento
 * (`generateMetadata` em `[slug]/page.tsx`, §39). Um title fixo no layout seria
 * herdado por todos os eventos e apareceria no WhatsApp de quem recebe o link.
 */
export default function EventosPublicosLayout({ children }: { children: ReactNode }) {
  return <div className={PUBLIC_SHELL_CLASS}>{children}</div>;
}
