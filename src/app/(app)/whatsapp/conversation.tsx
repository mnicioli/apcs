import Link from "next/link";
import { ArrowLeft, MessageCircle, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PigWatermark } from "@/components/brand/pig-watermark";
import { WHATSAPP_NO_CHAT_SELECTED } from "@/modules/whatsapp/whatsapp.labels";
import { whatsappDisplayName, formatWhatsAppPhone } from "@/modules/whatsapp/whatsapp.schema";
import { whatsappDayKey, whatsappDayLabel } from "@/modules/whatsapp/whatsapp.format";
import { whatsappHref, type WhatsAppParams } from "@/modules/whatsapp/whatsapp.routes";
import type { WhatsAppConversation } from "@/modules/whatsapp/whatsapp.types";
import { ChatToolbar } from "./chat-toolbar";
import { Composer } from "./composer";
import { MessageBubble } from "./message-bubble";

/**
 * A coluna da direita: cabeçalho, transcrição e campo de resposta.
 *
 * ⚠️ A TRANSCRIÇÃO ROLA SOZINHA, e o cabeçalho e o campo de resposta ficam
 * parados. Numa conversa de trezentas mensagens, um campo de resposta que
 * acompanha a rolagem obriga a pessoa a percorrer a conversa inteira para
 * responder — que é exatamente o que ela ia fazer.
 *
 * ⚠️ A MARCA D’ÁGUA FICA NO CASCO, NÃO DENTRO DA TRANSCRIÇÃO. Se ela morasse
 * no `<ol>`, subiria e desceria junto com as mensagens: um suíno deslizando
 * atrás do texto a cada rolagem é exatamente o que “não atrapalhar a conversa”
 * exclui. Aqui ela fica parada atrás de tudo — cabeçalho, transcrição e campo
 * de resposta — como papel de parede da coluna.
 */
export function Conversation({
  conversation,
  params,
  canReply,
  canWrite,
}: {
  conversation: WhatsAppConversation | null;
  params: WhatsAppParams;
  /** Pode responder AGORA (tem permissão E a integração está de pé). */
  canReply: boolean;
  /** Tem permissão de escrita, independentemente da integração. */
  canWrite: boolean;
}) {
  if (!conversation) {
    return (
      <ConversationShell>
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <MessageCircle className="h-8 w-8 opacity-40" aria-hidden="true" />
          <p className="max-w-xs text-sm">
            {params.chatId
              ? "Esta conversa não existe mais, ou você não tem acesso a ela."
              : WHATSAPP_NO_CHAT_SELECTED}
          </p>
        </div>
      </ConversationShell>
    );
  }

  const nome = whatsappDisplayName(conversation);

  return (
    <ConversationShell>
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        {/*
          A volta só existe no celular, onde a conversa SUBSTITUIU a lista. No
          desktop as duas estão na tela e um botão "voltar" não teria para onde.
        */}
        <Link
          href={whatsappHref(params, { chatId: null })}
          className="hover:bg-muted -ml-2 rounded-md p-2 md:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Voltar para a lista de conversas</span>
        </Link>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{nome}</h2>
          <p className="text-muted-foreground truncate text-xs">
            {conversation.isGroup ? (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" aria-hidden="true" />
                Grupo
              </span>
            ) : conversation.phone ? (
              formatWhatsAppPhone(conversation.phone)
            ) : (
              "Sem telefone"
            )}
          </p>
        </div>

        {/*
          O selo de cadastro responde a pergunta que quem atende faz primeiro:
          "quem é essa pessoa para a APCS?". Sem ele, todo atendimento começa
          com uma busca em outra tela.
        */}
        {conversation.contactId && <Badge variant="done">No cadastro</Badge>}
        {conversation.archived && <Badge>Arquivada</Badge>}

        {canWrite && <ChatToolbar chatId={conversation.id} archived={conversation.archived} />}
      </header>

      <Transcript conversation={conversation} />

      {canReply ? (
        <Composer chatId={conversation.id} chatName={nome} />
      ) : (
        <p className="border-border text-muted-foreground border-t px-4 py-4 text-center text-xs">
          {canWrite
            ? "A integração de WhatsApp está desligada: não é possível responder por aqui."
            : "Seu perfil pode ler as conversas, mas não responder."}
        </p>
      )}
    </ConversationShell>
  );
}

/**
 * O casco da coluna: a marca d’água atrás, o conteúdo à frente.
 *
 * ⚠️ O `z-10` NO CONTEÚDO NÃO É SUPERSTIÇÃO. Elementos posicionados pintam por
 * cima dos não posicionados, independentemente da ordem no HTML — sem ele, a
 * marca d’água (que é `absolute`) cobriria o cabeçalho, as mensagens e o campo
 * de resposta, mesmo vindo antes deles.
 *
 * A opacidade muda com o tema de propósito, e os números foram medidos na
 * tela. A arte é quase branca: no claro, 7% praticamente sumia contra o cartão
 * e 10% é o ponto em que o suíno se reconhece sem competir com o texto. No
 * escuro os mesmos 10% viram um borrão luminoso sobre fundo quase preto — daí
 * os 6%. Um número só serviria mal aos dois.
 */
function ConversationShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <PigWatermark className="top-1/2 right-0 z-0 h-[70%] -translate-y-1/2 opacity-[0.10] dark:opacity-[0.06]" />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/**
 * A transcrição, agrupada por dia.
 *
 * ⚠️ O SEPARADOR DE DIA NÃO É DECORAÇÃO. Sem ele, uma conversa que teve
 * mensagens em março e a próxima em agosto aparece como um diálogo contínuo — e
 * quem lê responde a uma pergunta de cinco meses atrás como se fosse de agora.
 */
function Transcript({ conversation }: { conversation: WhatsAppConversation }) {
  if (conversation.messages.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-sm">
        Nenhuma mensagem nesta conversa ainda.
      </div>
    );
  }

  let diaAnterior = "";

  return (
    <ol
      className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4"
      // Uma textura discreta separa a área de leitura do resto do sistema —
      // é o que faz o olho reconhecer "aqui é conversa" antes de ler. Usa o
      // token da borda, então acompanha o tema claro e o escuro sozinha.
      style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
        backgroundSize: "22px 22px",
      }}
    >
      {conversation.messages.map((message) => {
        const dia = whatsappDayKey(message.occurredAt);
        const novoDia = dia !== diaAnterior;
        diaAnterior = dia;

        return (
          <li key={message.id}>
            {novoDia && (
              <p className="my-3 flex justify-center">
                <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-[11px] font-medium">
                  {whatsappDayLabel(message.occurredAt)}
                </span>
              </p>
            )}
            <MessageBubble message={message} isGroup={conversation.isGroup} />
          </li>
        );
      })}
    </ol>
  );
}
