"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ChatMessageRole, ChatOption } from "@/modules/chat/chat.types";

interface DisplayMessage {
  role: ChatMessageRole;
  content: string;
}

interface ChatApiResponse {
  messages: DisplayMessage[];
  options: ChatOption[];
  closed: boolean;
}

const FALLBACK_ERROR = "Não consegui falar com o servidor agora. Tente novamente em instantes.";

export function ChatWidget() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [options, setOptions] = useState<ChatOption[]>([]);
  const [closed, setClosed] = useState(false);
  const [draft, setDraft] = useState("");
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);

  // Rola para a última mensagem sempre que a conversa cresce.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Abre (ou retoma) a conversa. O cookie httpOnly cuida da identidade.
  useEffect(() => {
    // A trava tem que ser um ref, não uma variável do efeito: o StrictMode roda
    // efeito → cleanup → efeito no MESMO componente, e um duplo-refresh faz o
    // equivalente em produção. Sem ela, dois GET /api/chat saem antes de o
    // cookie existir, o servidor não tem como reconhecê-los como a mesma visita
    // e abre DUAS conversas — cada uma consumindo uma vaga do limite por IP/hora.
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    async function bootstrap() {
      try {
        const res = await fetch("/api/chat", { method: "GET" });
        const data = (await res.json()) as ChatApiResponse;
        setMessages(data.messages ?? []);
        setOptions(data.options ?? []);
        setClosed(data.closed ?? false);
      } catch {
        setError(FALLBACK_ERROR);
      } finally {
        setBooting(false);
      }
    }

    // Sem cancelamento no cleanup de propósito: com a trava acima existe uma
    // única requisição em voo, e descartá-la no unmount simulado do StrictMode
    // deixaria o widget preso em "Abrindo o atendimento...". Atualizar estado
    // após desmontar é no-op no React 18+.
    void bootstrap();
  }, []);

  const send = useCallback(
    async (text: string, optionValue?: string) => {
      const message = text.trim();
      if (!message || sending || closed) return;

      const previousOptions = options;
      setError(null);
      setSending(true);
      setOptions([]);
      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setDraft("");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `optionValue` só vai quando a pessoa clicou num botão. É o que
          // permite ao servidor tratar o consentimento de forma determinística,
          // sem depender de o modelo interpretar o texto.
          body: JSON.stringify(optionValue ? { message, optionValue } : { message }),
        });

        if (res.status === 409) {
          // A sessão expirou: recarregar reabre uma conversa nova.
          setError("Sua sessão expirou. Recarregue a página para começar de novo.");
          setClosed(true);
          return;
        }

        if (!res.ok) {
          // 400/413/429/500: devolve as opções para a pessoa não ficar sem saída.
          setError(FALLBACK_ERROR);
          setOptions(previousOptions);
          return;
        }

        const data = (await res.json()) as ChatApiResponse;
        setMessages((prev) => [...prev, ...(data.messages ?? [])]);
        setOptions(data.options ?? []);
        setClosed(data.closed ?? false);
      } catch {
        setError(FALLBACK_ERROR);
        setOptions(previousOptions);
      } finally {
        setSending(false);
      }
    },
    [closed, options, sending],
  );

  return (
    <div className="border-border bg-card flex h-[70vh] flex-col overflow-hidden rounded-lg border shadow-sm">
      <div
        className="flex-1 space-y-4 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-label="Conversa com o assistente da APCS"
      >
        {booting && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Abrindo o atendimento...
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-line",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {message.content}
            </div>
          </div>
        ))}

        {sending && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Digitando...
          </p>
        )}

        <div ref={endRef} />
      </div>

      {options.length > 0 && !closed && (
        <div className="border-border flex flex-wrap gap-2 border-t p-3">
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="outline"
              size="sm"
              disabled={sending}
              onClick={() => void send(option.label, option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive border-border border-t px-4 py-2 text-sm">
          {error}
        </p>
      )}

      <form
        className="border-border flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="chat-message" className="sr-only">
            Sua mensagem
          </Label>
          <Input
            id="chat-message"
            name="message"
            autoComplete="off"
            maxLength={1000}
            placeholder={closed ? "Conversa encerrada" : "Escreva sua mensagem..."}
            value={draft}
            disabled={closed || booting}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="icon"
          aria-label="Enviar mensagem"
          disabled={closed || booting || sending || draft.trim().length === 0}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
