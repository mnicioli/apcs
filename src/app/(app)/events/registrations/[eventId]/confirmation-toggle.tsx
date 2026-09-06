"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { setParticipantConfirmationAction } from "@/lib/actions/event-landing";
import { PARTICIPANT_CONFIRMATION_LABELS } from "@/modules/event/event.landing.labels";
import type { ParticipantConfirmation } from "@/modules/event/event.landing.types";
import { cn } from "@/lib/utils";

/**
 * O TOGGLE DE CONFIRMAÇÃO (§10, §11, §22, §23).
 *
 * ============================================================================
 * ⚠️ ELE NÃO REMOVE NINGUÉM. DESLIGAR É UM ESTADO, NÃO UMA EXCLUSÃO (§11).
 * ============================================================================
 * "Se posteriormente João informar que não irá, Confirmado = OFF. O participante
 * continua existindo na inscrição." Isso não depende de ninguém lembrar: a
 * action só sabe trocar um enum, e não existe caminho de exclusão em lugar
 * nenhum deste módulo (§16).
 *
 * ⚠️ TRÊS PROTEÇÕES CONTRA O DUPLO CLIQUE (§23), E CADA UMA PEGA UM CASO:
 *
 *   1. `pendenteRef` — dois cliques no mesmo quadro. `useState` é assíncrono:
 *      os dois passariam pelo `if` antes do primeiro `render`. O `ref` muda na
 *      hora.
 *   2. `disabled` — o clique enquanto a requisição está em curso.
 *   3. O COMPARE-AND-SET NO BANCO — o que sobrevive a um F5 no meio do envio e
 *      a dois operadores em máquinas diferentes (§22). `set_participant_confirmation`
 *      só grava quando o valor MUDA, então uma repetição não gera uma segunda
 *      linha de auditoria dizendo que houve alteração.
 *
 * ⚠️ O ESTADO OTIMISTA EXISTE PORQUE A PÁGINA É DO SERVIDOR. Sem ele, o toggle
 * ficaria parado até o `router.refresh()` voltar — e quem está confirmando
 * trinta pessoas em sequência clicaria duas vezes achando que não pegou. Ele é
 * DESFEITO quando a action falha: mostrar "confirmado" sobre uma gravação que
 * não aconteceu é pior que a espera.
 */
export function ConfirmationToggle({
  eventId,
  participantId,
  participantName,
  confirmation,
}: {
  eventId: string;
  participantId: string;
  /** Só para o rótulo acessível — a tabela tem trinta toggles iguais. */
  participantName: string;
  confirmation: ParticipantConfirmation;
}) {
  const router = useRouter();
  const [otimista, setOtimista] = useState<ParticipantConfirmation>(confirmation);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const pendenteRef = useRef(false);

  // O servidor é a autoridade: quando a página revalida com um valor diferente
  // do otimista, é o do servidor que vale.
  const atual = pendente ? otimista : confirmation;
  const ligado = atual === "confirmed";

  function alternar() {
    if (pendenteRef.current) return;

    const proximo: ParticipantConfirmation = ligado ? "not_confirmed" : "confirmed";
    pendenteRef.current = true;
    setOtimista(proximo);
    setErro(null);

    startTransition(async () => {
      try {
        const resultado = await setParticipantConfirmationAction({
          // §26 — o evento vai junto; o banco recusa se o participante for de outro.
          eventId,
          participantId,
          confirmation: proximo,
        });

        if (!resultado.ok) {
          setOtimista(confirmation);
          setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
          return;
        }

        router.refresh();
      } catch {
        // Rede caiu no meio. Voltar ao valor do servidor é a leitura honesta:
        // não sabemos se gravou, e mostrar o novo estado seria afirmar que sim.
        setOtimista(confirmation);
        setErro("Não foi possível salvar. Verifique sua conexão e tente novamente.");
      } finally {
        pendenteRef.current = false;
      }
    });
  }

  return (
    <div className="space-y-1">
      {/*
        `role="switch"` + `aria-checked` é o que faz um leitor de tela anunciar
        "Confirmado, ativado" em vez de só "botão". O rótulo NOMEIA a pessoa
        porque a tabela tem um destes por linha — trinta botões chamados
        "Confirmado" são trinta botões indistinguíveis.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={`Confirmado — ${participantName}`}
        disabled={pendente}
        onClick={alternar}
        className={cn(
          "focus:ring-ring/40 inline-flex items-center gap-2 rounded-full py-0.5 pr-3 pl-0.5 text-xs font-medium transition-colors focus:ring-2 focus:outline-none disabled:opacity-60",
          ligado ? "bg-accent text-primary-strong" : "bg-muted text-muted-foreground",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
            ligado ? "bg-primary" : "bg-border",
          )}
        >
          <span
            className={cn(
              "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
              ligado && "translate-x-4",
            )}
          />
        </span>
        {PARTICIPANT_CONFIRMATION_LABELS[atual]}
      </button>

      {erro && (
        <p role="alert" className="text-destructive text-xs">
          {erro}
        </p>
      )}
    </div>
  );
}
