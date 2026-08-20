"use client";

import { useEffect, useRef, useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveWhatsAppChatAction, markWhatsAppChatReadAction } from "@/lib/actions/whatsapp";

/**
 * Os controles da conversa aberta: arquivar, e marcar como lida.
 *
 * ⚠️ MARCAR COMO LIDA ACONTECE AO ABRIR, E NÃO NUM BOTÃO.
 *
 * "Lida" quer dizer "alguém do time já olhou isto", e abrir a conversa É olhar.
 * Um botão separado produziria o pior dos dois mundos: um contador que fica
 * aceso depois de a pessoa ter lido tudo, e uma tarefa a mais no dia de quem já
 * está respondendo.
 *
 * A escrita PRECISA ser um efeito do cliente e não do servidor: um Server
 * Component que gravasse ao renderizar transformaria um GET em escrita — e
 * qualquer pré-carregamento de link do navegador zeraria contadores de
 * conversas que ninguém abriu.
 */
export function ChatToolbar({ chatId, archived }: { chatId: string; archived: boolean }) {
  const [pendente, startTransition] = useTransition();

  // Uma vez por conversa. Sem isto, o `revalidatePath` que a própria action
  // dispara reexecutaria o efeito num laço.
  const lidaRef = useRef<string | null>(null);

  useEffect(() => {
    if (lidaRef.current === chatId) return;
    lidaRef.current = chatId;

    // Sem `await` e sem tratar erro na tela: falhar em marcar como lida não é
    // algo que quem está lendo a conversa precise saber ou possa resolver. A
    // função no banco já é idempotente (`where unread_count > 0`).
    void markWhatsAppChatReadAction(chatId);
  }, [chatId]);

  function alternar() {
    startTransition(async () => {
      await archiveWhatsAppChatAction({ chatId, archived: !archived });
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={alternar}
      disabled={pendente}
      title={archived ? "Desarquivar conversa" : "Arquivar conversa"}
    >
      {archived ? (
        <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Archive className="h-4 w-4" aria-hidden="true" />
      )}
      <span className="sr-only">{archived ? "Desarquivar conversa" : "Arquivar conversa"}</span>
    </Button>
  );
}
