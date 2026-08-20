"use client";

import { useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { sendWhatsAppMessageAction } from "@/lib/actions/whatsapp";
import { WHATSAPP_MAX_BODY } from "@/modules/whatsapp/whatsapp.schema";

/**
 * O campo de resposta.
 *
 * ⚠️ ENTER ENVIA, SHIFT+ENTER QUEBRA LINHA.
 *
 * É a convenção de todo aplicativo de mensagem, e quem atende digita rápido —
 * exigir o clique no botão custaria um movimento de mão a cada mensagem, o dia
 * inteiro. O risco conhecido (enviar sem querer no meio de um parágrafo) é
 * pequeno porque o Shift+Enter é igualmente automático para quem já usa
 * WhatsApp o dia todo.
 */
export function Composer({ chatId, chatName }: { chatId: string; chatName: string }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * ⚠️ `useTransition` NÃO SEGURA UM SEGUNDO CLIQUE — ele só conta que há uma
   * transição em curso, e o React atualiza esse valor no próximo render. Dois
   * `Enter` rápidos passam pelos dois. Numa tela que manda WhatsApp para um
   * associado, isso é a mesma mensagem chegando duas vezes. A trava é o `ref`,
   * que muda de valor na hora.
   */
  const enviandoRef = useRef(false);

  function enviar(event?: FormEvent) {
    event?.preventDefault();

    const corpo = texto.trim();
    if (!corpo || enviandoRef.current) return;

    enviandoRef.current = true;
    setErro(null);

    startTransition(async () => {
      try {
        const resultado = await sendWhatsAppMessageAction({ chatId, body: corpo });

        if (resultado.ok) {
          // Só limpa quando deu certo. Um campo esvaziado por um envio que
          // falhou obrigaria a pessoa a reescrever o que ela acabou de digitar.
          setTexto("");
          if (areaRef.current) areaRef.current.style.height = "auto";
        } else {
          setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        }
      } catch {
        setErro("Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.");
      } finally {
        enviandoRef.current = false;
      }
    });
  }

  function aoTeclar(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // `isComposing` é o acento morto e o teclado de IME: durante a composição,
    // Enter confirma o caractere. Sem esta guarda, digitar "ç" ou "ã" em alguns
    // teclados enviaria a mensagem no meio da palavra.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    enviar();
  }

  const restante = WHATSAPP_MAX_BODY - texto.length;

  return (
    <form onSubmit={enviar} className="border-border border-t p-3">
      {erro && (
        <p role="alert" className="text-destructive mb-2 text-xs">
          {erro}
        </p>
      )}

      <div className="flex items-end gap-2">
        <label htmlFor="resposta" className="sr-only">
          Responder a {chatName}
        </label>
        <textarea
          id="resposta"
          ref={areaRef}
          rows={1}
          value={texto}
          maxLength={WHATSAPP_MAX_BODY}
          disabled={enviando}
          onChange={(e) => {
            setTexto(e.target.value);
            // Cresce com o texto até o teto do CSS. `auto` antes de medir, senão
            // a caixa só cresce e nunca volta a encolher ao apagar linhas.
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onKeyDown={aoTeclar}
          placeholder="Escreva uma mensagem…"
          className="border-border bg-background focus-visible:ring-ring max-h-40 min-h-11 w-full resize-none rounded-md border px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
        />

        <Button
          type="submit"
          size="icon"
          disabled={enviando || texto.trim().length === 0}
          className="h-11 w-11 shrink-0"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{enviando ? "Enviando" : "Enviar mensagem"}</span>
        </Button>
      </div>

      {/* Só avisa quando está perto do limite: um contador sempre à mostra é ruído. */}
      {restante < 200 && (
        <p className="text-muted-foreground mt-1 text-right text-[11px] tabular-nums">
          {restante} caracteres restantes
        </p>
      )}
    </form>
  );
}
