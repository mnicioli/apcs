import type { Metadata } from "next";
import { APP_NAME } from "@/config/app";
import { ChatWidget } from "./chat-widget";

export const metadata: Metadata = {
  title: "Atendimento",
  description: "Fale com a APCS sobre o CSP — o programa de compras coletivas.",
};

/**
 * Atendimento ao público — página ABERTA, sem login.
 *
 * Liberada no middleware (`src/lib/supabase/middleware.ts`). Toda a lógica roda
 * no servidor via `/api/chat`; aqui só existe a casca e o widget.
 */
export default function ChatPage() {
  return (
    <main className="bg-muted flex min-h-dvh justify-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-muted-foreground text-sm">
            Atendimento sobre o CSP — o programa de compras coletivas da associação.
          </p>
        </header>

        <ChatWidget />

        <p className="text-muted-foreground text-xs">
          Este é um atendimento automatizado. Suas informações são usadas apenas para a APCS
          retornar o contato.
        </p>
      </div>
    </main>
  );
}
