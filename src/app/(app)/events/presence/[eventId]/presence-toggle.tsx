"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { setParticipantPresenceAction } from "@/lib/actions/event-presence";
import { presenceLabel } from "@/modules/event/event.landing.labels";
import { cn } from "@/lib/utils";

/**
 * O TOGGLE DE PRESENÇA (§12, §13, §20, §23).
 *
 * ============================================================================
 * ⚠️ ELE NÃO REMOVE NINGUÉM, E NÃO MEXE NA CONFIRMAÇÃO.
 * ============================================================================
 * Desligar é um ESTADO, não uma exclusão: o participante continua na inscrição,
 * e o registro de que ele esteve presente continua na trilha (§13). E a
 * confirmação da inscrição não é tocada em nenhuma direção (§3) — a action só
 * sabe escrever `present`, e não existe caminho daqui até `confirmation`.
 *
 * ⚠️ TRÊS PROTEÇÕES CONTRA O DUPLO CLIQUE (§20), E CADA UMA PEGA UM CASO:
 *
 *   1. `pendenteRef` — dois cliques no mesmo quadro. `useState` é assíncrono:
 *      os dois passariam pelo `if` antes do primeiro `render`. O `ref` muda na
 *      hora.
 *   2. `disabled` — o clique enquanto a requisição está em curso.
 *   3. O COMPARE-AND-SET NO BANCO — o que sobrevive a um F5 no meio do envio e
 *      a dois operadores em máquinas diferentes na mesma linha.
 *      `set_participant_presence` só grava quando o valor MUDA, então uma
 *      repetição não gera uma segunda linha de trilha dizendo que houve
 *      alteração.
 *
 * ⚠️ O ESTADO OTIMISTA EXISTE PORQUE A PÁGINA É DO SERVIDOR (§23). Sem ele, o
 * toggle ficaria parado até o `router.refresh()` voltar — e quem está recebendo
 * uma fila de gente na porta clicaria duas vezes achando que não pegou. Ele é
 * DESFEITO quando a action falha: mostrar "presente" sobre uma gravação que não
 * aconteceu é pior que a espera, porque a lista viraria a prova errada de quem
 * estava no evento.
 *
 * É o mesmo desenho de `ConfirmationToggle`, deliberadamente — os dois são o
 * mesmo gesto na mesma tabela, e um deles se comportar diferente do outro na
 * mesma tabela seria o defeito.
 */
export function PresenceToggle({
  eventId,
  participantId,
  participantName,
  present,
}: {
  eventId: string;
  participantId: string;
  /** Só para o rótulo acessível — a tabela tem trinta toggles iguais. */
  participantName: string;
  present: boolean;
}) {
  const router = useRouter();
  const [otimista, setOtimista] = useState(present);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const pendenteRef = useRef(false);

  // O servidor é a autoridade: quando a página revalida com um valor diferente
  // do otimista, é o do servidor que vale.
  const ligado = pendente ? otimista : present;

  function alternar() {
    if (pendenteRef.current) return;

    const proximo = !ligado;
    pendenteRef.current = true;
    setOtimista(proximo);
    setErro(null);

    startTransition(async () => {
      try {
        const resultado = await setParticipantPresenceAction({
          // §18 — o evento vai junto; o banco recusa se o participante for de
          // outro.
          eventId,
          participantId,
          present: proximo,
        });

        if (!resultado.ok) {
          setOtimista(present);
          setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
          return;
        }

        // ⚠️ O `refresh` NÃO É SÓ PELA LINHA. Os indicadores do §9 (presentes,
        // ausentes) vêm da mesma consulta das linhas — sem ele, o toggle mudaria
        // e os contadores acima continuariam mostrando o número anterior.
        router.refresh();
      } catch {
        // Rede caiu no meio. Voltar ao valor do servidor é a leitura honesta:
        // não sabemos se gravou, e mostrar o novo estado seria afirmar que sim.
        setOtimista(present);
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
        "Presente, ativado" em vez de só "botão". O rótulo NOMEIA a pessoa
        porque a tabela tem um destes por linha — trinta botões chamados
        "Presença" são trinta botões indistinguíveis.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={`Presença — ${participantName}`}
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
        {presenceLabel(ligado)}
      </button>

      {erro && (
        <p role="alert" className="text-destructive text-xs">
          {erro}
        </p>
      )}
    </div>
  );
}
