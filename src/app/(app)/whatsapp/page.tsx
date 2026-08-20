import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  getWhatsAppConversation,
  listWhatsAppChats,
  whatsAppIntegrationStatus,
} from "@/lib/services/whatsapp";
import { parseWhatsAppParams } from "@/modules/whatsapp/whatsapp.routes";
import { whatsappNotConfigured } from "@/modules/whatsapp/whatsapp.labels";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "./auto-refresh";
import { ChatList } from "./chat-list";
import { Conversation } from "./conversation";

export const metadata: Metadata = { title: "WhatsApp" };

/**
 * A CAIXA DE ENTRADA DO WHATSAPP.
 *
 * Duas colunas: as conversas à esquerda, a transcrição e a resposta à direita.
 * É a tela que fica aberta o dia inteiro, e o desenho sai daí:
 *
 * • A ALTURA É FIXA e o rolamento é INTERNO (cada coluna rola sozinha). Com a
 *   página rolando, ler uma conversa longa empurraria a lista para fora da tela
 *   e o campo de resposta junto — e responder exigiria rolar de volta.
 *
 * • O ESTADO MORA NA URL (`?filtro=&q=&conversa=`). Ver whatsapp.routes.ts: é
 *   o tipo de tela em que alguém manda link para o colega o dia todo.
 *
 * • NO CELULAR, UMA COLUNA POR VEZ. Duas colunas em 375 px não são duas
 *   colunas, são duas tiras ilegíveis.
 */
export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "whatsapp.read")) redirect("/dashboard");

  const params = parseWhatsAppParams(await searchParams);
  const podeResponder = hasPermission(role, "whatsapp.write");
  const integracao = whatsAppIntegrationStatus();

  // A lista e a conversa em paralelo: são leituras independentes, e somá-las em
  // série atrasaria a tela a cada clique numa conversa.
  const [inbox, conversa] = await Promise.all([
    listWhatsAppChats(params.filter, params.search),
    params.chatId ? getWhatsAppConversation(params.chatId) : Promise.resolve(null),
  ]);

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] min-h-[30rem] flex-col gap-4">
      {/*
        ⚠️ O AVISO DE INTEGRAÇÃO DESLIGADA VEM ANTES DE TUDO, e não é enfeite.
        Uma caixa vazia por falta de configuração é visualmente IDÊNTICA a uma
        caixa vazia por ninguém ter escrito. Sem esta linha, alguém passaria a
        semana achando que o WhatsApp está quieto.
      */}
      {!integracao.configured && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-4 py-3 text-sm"
        >
          {whatsappNotConfigured(integracao.missing)}
        </p>
      )}

      <div className="border-border bg-card flex min-h-0 flex-1 overflow-hidden rounded-lg border">
        <aside
          aria-label="Conversas"
          className={cn(
            "border-border flex min-h-0 w-full flex-col md:max-w-sm md:border-r",
            // No celular, abrir uma conversa substitui a lista.
            params.chatId && "hidden md:flex",
          )}
        >
          <ChatList
            params={params}
            items={inbox.items}
            counts={inbox.counts}
            truncated={inbox.truncated}
          />
        </aside>

        <section
          aria-label="Conversa"
          className={cn("min-h-0 flex-1 flex-col", params.chatId ? "flex" : "hidden md:flex")}
        >
          <Conversation
            conversation={conversa}
            params={params}
            canReply={podeResponder && integracao.configured}
            canWrite={podeResponder}
          />
        </section>
      </div>

      {/*
        A caixa se atualiza sozinha. Ver `AutoRefresh` para por que é sondagem e
        não tempo real.
      */}
      <AutoRefresh />
    </div>
  );
}
