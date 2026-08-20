import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Download,
  FileText,
  ImageOff,
  MapPin,
  Mic,
  User,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WHATSAPP_KIND_LABELS,
  WHATSAPP_MEDIA_FAILED,
  WHATSAPP_MEDIA_PENDING,
  WHATSAPP_MEDIA_TOO_LARGE,
  WHATSAPP_ORIGIN_LABELS,
  WHATSAPP_STATUS_LABELS,
} from "@/modules/whatsapp/whatsapp.labels";
import {
  whatsappClock,
  whatsappDuration,
  whatsappFileSize,
} from "@/modules/whatsapp/whatsapp.format";
import { formatWhatsAppPhone } from "@/modules/whatsapp/whatsapp.schema";
import type { WhatsAppMessage } from "@/modules/whatsapp/whatsapp.types";

/**
 * Uma mensagem na conversa.
 *
 * A regra visual é uma só: o que SAIU fica à direita, o que CHEGOU fica à
 * esquerda. É a convenção do WhatsApp, e imitá-la aqui não é falta de
 * imaginação — é o que permite ler a conversa sem aprender nada.
 */
export function MessageBubble({
  message,
  isGroup,
}: {
  message: WhatsAppMessage;
  isGroup: boolean;
}) {
  const saiu = message.direction === "outbound";
  const falhou = message.status === "failed";

  return (
    <div className={cn("flex", saiu ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg border px-3 py-2 text-sm shadow-sm sm:max-w-[70%]",
          saiu
            ? "border-primary/25 bg-accent rounded-br-sm"
            : "border-border bg-card rounded-bl-sm",
          falhou && "border-destructive/40 bg-destructive/5",
        )}
      >
        {/*
          Em grupo, quem falou é indispensável: sem o nome, uma conversa de doze
          pessoas vira um monólogo. Fora de grupo é ruído — já se sabe quem é.
        */}
        {isGroup && !saiu && (message.senderName || message.participantPhone) && (
          <p className="text-primary-strong mb-0.5 text-xs font-semibold">
            {message.senderName ??
              (message.participantPhone ? formatWhatsAppPhone(message.participantPhone) : "")}
          </p>
        )}

        {message.media && <MediaBlock message={message} />}

        {message.body && <p className="wrap-anywhere whitespace-pre-wrap">{message.body}</p>}

        {/* Chegou algo que não sabemos exibir. Ver `tipoDaMensagem` na ingestão. */}
        {message.kind === "unsupported" && !message.body && (
          <p className="text-muted-foreground italic">
            {WHATSAPP_KIND_LABELS.unsupported}. Abra no celular.
          </p>
        )}

        <p className="mt-1 flex items-center justify-end gap-1.5">
          {saiu && message.origin !== "agent" && (
            <span className="text-muted-foreground text-[10px] italic">
              {WHATSAPP_ORIGIN_LABELS[message.origin]}
            </span>
          )}
          {/*
            Quem respondeu, quando saiu do CRM. É o que permite, três dias
            depois, saber a quem perguntar o que foi combinado.
          */}
          {saiu && message.origin === "agent" && message.sentByName && (
            <span className="text-muted-foreground text-[10px]">{message.sentByName}</span>
          )}
          <time
            dateTime={message.occurredAt}
            className="text-muted-foreground text-[10px] tabular-nums"
          >
            {whatsappClock(message.occurredAt)}
          </time>
          {saiu && <DeliveryTick message={message} />}
        </p>

        {/*
          O motivo da falha vai NA BOLHA, e não num alerta que some. Quem
          descobre três dias depois que a mensagem não saiu precisa do motivo
          junto da mensagem — não de um "algo deu errado" que já desapareceu.
        */}
        {falhou && message.errorMessage && (
          <p className="text-destructive mt-1 text-[11px]">{message.errorMessage}</p>
        )}
      </div>
    </div>
  );
}

/** O visto de entrega. `title` para quem passa o mouse; `sr-only` para o leitor. */
function DeliveryTick({ message }: { message: WhatsAppMessage }) {
  const rotulo = WHATSAPP_STATUS_LABELS[message.status];
  const comum = "h-3.5 w-3.5 shrink-0";

  const icone =
    message.status === "pending" ? (
      <Clock className={cn(comum, "text-muted-foreground")} aria-hidden="true" />
    ) : message.status === "failed" ? (
      <AlertCircle className={cn(comum, "text-destructive")} aria-hidden="true" />
    ) : message.status === "sent" ? (
      <Check className={cn(comum, "text-muted-foreground")} aria-hidden="true" />
    ) : (
      <CheckCheck
        className={cn(comum, message.status === "read" ? "text-primary" : "text-muted-foreground")}
        aria-hidden="true"
      />
    );

  return (
    <span title={rotulo}>
      {icone}
      <span className="sr-only">{rotulo}</span>
    </span>
  );
}

/**
 * O anexo.
 *
 * ⚠️ QUATRO ESTADOS, E NENHUM DELES PODE SER SILÊNCIO. Um anexo que não
 * conseguimos guardar tem de DIZER isso e dizer onde ele ainda existe ("abra no
 * celular") — porque a mensagem existiu, o associado a mandou, e uma bolha vazia
 * faria o atendente responder a uma foto que ele acha que nunca chegou.
 */
function MediaBlock({ message }: { message: WhatsAppMessage }) {
  const media = message.media!;

  if (media.status !== "stored" || !media.url) {
    return (
      <p className="text-muted-foreground mb-1 flex items-center gap-2 text-xs italic">
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        {media.status === "pending"
          ? WHATSAPP_MEDIA_PENDING
          : media.status === "too_large"
            ? WHATSAPP_MEDIA_TOO_LARGE
            : WHATSAPP_MEDIA_FAILED}
      </p>
    );
  }

  const legenda = [
    WHATSAPP_KIND_LABELS[message.kind],
    whatsappFileSize(media.sizeBytes),
    whatsappDuration(media.durationSeconds),
  ]
    .filter(Boolean)
    .join(" · ");

  if (message.kind === "image" || message.kind === "sticker") {
    return (
      <a href={media.url} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        {/*
          eslint-disable-next-line @next/next/no-img-element -- a URL é assinada
          e de vida curta: o otimizador do Next teria de buscá-la de novo a cada
          renderização (a URL muda), o cache dele nunca acertaria, e o servidor
          passaria a proxiar arquivos de até 20 MB. Mesmo raciocínio de
          `SignedImage`.
        */}
        <img
          src={media.url}
          alt={media.fileName ?? WHATSAPP_KIND_LABELS[message.kind]}
          loading="lazy"
          className="bg-muted max-h-64 w-auto max-w-full rounded-md object-contain"
        />
      </a>
    );
  }

  if (message.kind === "audio") {
    return (
      <span className="mb-1 flex flex-col gap-1">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          {legenda}
        </span>
        {/*
          `preload="none"` de propósito: uma conversa com trinta áudios baixaria
          trinta arquivos ao abrir. Sem `<track>` porque um áudio de WhatsApp
          não tem legenda para oferecer — o rótulo acima é o que descreve o
          anexo para quem usa leitor de tela.
        */}
        <audio controls preload="none" src={media.url} className="max-w-full" />
      </span>
    );
  }

  if (message.kind === "video") {
    return (
      <span className="mb-1 flex flex-col gap-1">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Video className="h-3.5 w-3.5" aria-hidden="true" />
          {legenda}
        </span>
        {/* Mesmo raciocínio do áudio: nada é baixado antes de alguém dar play. */}
        <video controls preload="none" src={media.url} className="max-h-64 max-w-full rounded-md" />
      </span>
    );
  }

  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      download={media.fileName ?? undefined}
      className="border-border hover:bg-muted/50 mb-1 flex items-center gap-2 rounded-md border px-2 py-2"
    >
      <IconePorTipo kind={message.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {media.fileName ?? WHATSAPP_KIND_LABELS[message.kind]}
        </span>
        <span className="text-muted-foreground block text-[11px]">{legenda}</span>
      </span>
      <Download className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
    </a>
  );
}

function IconePorTipo({ kind }: { kind: WhatsAppMessage["kind"] }) {
  const comum = "h-5 w-5 shrink-0 text-muted-foreground";
  if (kind === "location") return <MapPin className={comum} aria-hidden="true" />;
  if (kind === "contact") return <User className={comum} aria-hidden="true" />;
  return <FileText className={comum} aria-hidden="true" />;
}
