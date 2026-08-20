import Link from "next/link";
import { Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { WHATSAPP_EMPTY_STATES, WHATSAPP_FILTER_LABELS } from "@/modules/whatsapp/whatsapp.labels";
import { whatsappDisplayName } from "@/modules/whatsapp/whatsapp.schema";
import { whatsappListStamp } from "@/modules/whatsapp/whatsapp.format";
import { whatsappHref, type WhatsAppParams } from "@/modules/whatsapp/whatsapp.routes";
import {
  WHATSAPP_FILTERS,
  type WhatsAppChat,
  type WhatsAppCounts,
} from "@/modules/whatsapp/whatsapp.types";

/**
 * A coluna da esquerda: busca, abas e as conversas.
 *
 * Server Component inteiro. Nada aqui precisa de estado do navegador — as abas
 * são links, a busca é um `<form method="get">`, e a conversa aberta é um
 * parâmetro da URL. O resultado é que a lista funciona sem JavaScript e o
 * navegador cuida do histórico de graça.
 */
export function ChatList({
  params,
  items,
  counts,
  truncated,
}: {
  params: WhatsAppParams;
  items: WhatsAppChat[];
  counts: WhatsAppCounts;
  truncated: boolean;
}) {
  return (
    <>
      <div className="border-border space-y-3 border-b p-3">
        {/*
          Busca por GET, sem JavaScript: o resultado fica na URL, então ele pode
          ser recarregado, compartilhado e voltado com o botão do navegador.
          Os campos ocultos preservam o recorte — sem eles, buscar dentro de
          "Arquivadas" jogaria a pessoa de volta para "Todas".
        */}
        <form method="get" role="search" className="relative">
          {params.filter !== "all" && <input type="hidden" name="filtro" value={params.filter} />}
          <label htmlFor="busca-conversa" className="sr-only">
            Buscar conversa ou contato
          </label>
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          />
          <input
            id="busca-conversa"
            name="q"
            type="search"
            defaultValue={params.search}
            placeholder="Buscar conversa ou contato"
            className="border-border bg-background focus-visible:ring-ring h-10 w-full rounded-md border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
        </form>

        <nav aria-label="Filtrar conversas" className="flex flex-wrap gap-1">
          {WHATSAPP_FILTERS.map((option) => {
            const ativo = option === params.filter;
            return (
              <Link
                key={option}
                href={whatsappHref(params, { filter: option })}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  ativo ? "bg-accent text-primary-strong" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {WHATSAPP_FILTER_LABELS[option]}
                {counts[option] > 0 && (
                  <span className="ml-1.5 tabular-nums opacity-70">{counts[option]}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground p-6 text-sm">
          {params.search
            ? `Nenhuma conversa encontrada para “${params.search}”.`
            : WHATSAPP_EMPTY_STATES[params.filter]}
        </p>
      ) : (
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-y-auto">
          {items.map((chat) => (
            <li key={chat.id}>
              <ChatRow chat={chat} params={params} />
            </li>
          ))}
        </ul>
      )}

      <p className="border-border text-muted-foreground border-t px-3 py-2 text-center text-xs">
        {rodape(items.length, truncated)}
      </p>
    </>
  );
}

/**
 * O rodapé conta quantas conversas estão à vista.
 *
 * Quando a lista bate no teto ele DIZ isso, em vez de deixar a pessoa concluir
 * que a conversa que ela procura não existe. Ver `MAX_CHATS` no service.
 */
function rodape(quantidade: number, truncated: boolean): string {
  if (quantidade === 0) return "— nenhuma conversa —";
  const plural = quantidade === 1 ? "1 conversa" : `${quantidade} conversas`;
  return truncated ? `${plural} — há mais; use a busca` : `— ${plural} —`;
}

function ChatRow({ chat, params }: { chat: WhatsAppChat; params: WhatsAppParams }) {
  const aberta = params.chatId === chat.id;
  const nome = whatsappDisplayName(chat);
  const naoLidas = chat.unreadCount;

  return (
    <Link
      href={whatsappHref(params, { chatId: chat.id })}
      aria-current={aberta ? "true" : undefined}
      className={cn(
        "flex items-center gap-3 px-3 py-3 transition-colors",
        aberta ? "bg-accent" : "hover:bg-muted/50",
      )}
    >
      <Avatar name={nome} isGroup={chat.isGroup} />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm",
              naoLidas > 0 ? "text-foreground font-semibold" : "text-foreground font-medium",
            )}
          >
            {nome}
          </span>
          <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
            {whatsappListStamp(chat.lastMessageAt)}
          </span>
        </span>

        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-muted-foreground truncate text-xs">
            {/*
              O "Você:" antes da prévia responde, sem abrir a conversa, a
              pergunta que a lista existe para responder: "esta conversa está
              esperando por mim?". Uma conversa cuja última mensagem é nossa
              está esperando pela pessoa, não pelo time.
            */}
            {chat.lastMessageFromMe && <span className="text-muted-foreground/80">Você: </span>}
            {chat.lastMessagePreview ?? "Sem mensagens"}
          </span>

          {naoLidas > 0 && (
            <span className="bg-primary text-primary-foreground flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
              {naoLidas > 99 ? "99+" : naoLidas}
              <span className="sr-only"> mensagens não lidas</span>
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

/**
 * ⚠️ INICIAIS, E NÃO A FOTO DE PERFIL DO WHATSAPP — de propósito.
 *
 * O fornecedor manda a URL da foto, e ela está guardada em `photo_url`. Exibi-la
 * faria o navegador de cada pessoa do time buscar a imagem no CDN do WhatsApp a
 * cada carregamento: contaria à Meta quem a APCS anda olhando e quando, por uma
 * requisição que sai do computador de quem atende. E as URLs expiram, então
 * metade da lista viraria quadrado quebrado.
 *
 * A inicial identifica a linha tão bem quanto — que é para o que o avatar serve
 * numa lista.
 */
function Avatar({ name, isGroup }: { name: string; isGroup: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="bg-muted text-muted-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
    >
      {isGroup ? <Users className="h-4 w-4" /> : inicial(name)}
    </span>
  );
}

function inicial(name: string): string {
  const primeira = name.trim().charAt(0).toUpperCase();
  // Um nome que começa com dígito é um telefone sem cadastro. "5" como avatar
  // não identifica nada; o "#" ao menos diz "este aqui não tem nome".
  return /[A-ZÀ-Þ]/.test(primeira) ? primeira : "#";
}
