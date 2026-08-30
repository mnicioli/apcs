"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Send } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  broadcastAudienceAction,
  resumeBroadcastAction,
  startBroadcastAction,
} from "@/lib/actions/broadcasts";
import type { BroadcastSource } from "@/modules/broadcast/broadcast.types";
import { Button } from "@/components/ui/button";

interface Segmento {
  id: string;
  name: string;
  description: string | null;
}

/**
 * ESCOLHER O PÚBLICO, CONFERIR A MENSAGEM, MANDAR.
 *
 * ⚠️ TRÊS PASSOS DELIBERADOS, e a ordem importa. Mandar mensagem de WhatsApp
 * para centenas de associados NÃO TEM BOTÃO DE DESFAZER — nem no WhatsApp, nem
 * aqui. Um único botão "Divulgar" que disparasse no primeiro clique seria a
 * decisão mais barata da tela e a mais cara da operação.
 *
 * ⚠️ O ALCANCE É CONSULTADO A CADA MUDANÇA DE SELEÇÃO, e vem do SERVIDOR — da
 * mesma função que monta a fila. Um número calculado no navegador (ou estimado)
 * discordaria da fila real, e a divergência só apareceria depois do envio.
 */
export function BroadcastLauncher({
  source,
  sourceId,
  segments,
  preview,
  hasDocument,
  hasImage,
  resumeId,
  resumeRemaining,
}: {
  source: BroadcastSource;
  sourceId: string;
  segments: Segmento[];
  preview: string;
  /** O PDF que leva a mensagem. */
  hasDocument: boolean;
  /** A imagem que sai ANTES, sem texto — hoje só a Bolsa tem. */
  hasImage: boolean;
  /** Divulgação que parou no meio — a tela oferece continuar. */
  resumeId: string | null;
  resumeRemaining: number;
}) {
  const router = useRouter();
  const grupoId = useId();

  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [alcance, setAlcance] = useState<{ reachable: number; blocked: number } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  /*
    ⚠️ O CANCELAMENTO (`ativo`) NÃO É ZELO EXCESSIVO. Marcar três públicos
    depressa dispara três consultas; sem ele, a resposta da PRIMEIRA pode chegar
    por último e a tela mostraria o alcance de uma seleção que já mudou — o
    número errado, com cara de certo, na tela em que ele mais importa.
  */
  useEffect(() => {
    if (escolhidos.length === 0) {
      setAlcance(null);
      return;
    }

    let ativo = true;
    void broadcastAudienceAction({ segmentIds: escolhidos }).then((resultado) => {
      if (!ativo) return;
      setAlcance(resultado.ok ? resultado.data : null);
    });

    return () => {
      ativo = false;
    };
  }, [escolhidos]);

  // Trocar a seleção depois de pedir confirmação volta um passo: o número que a
  // pessoa confirmou não é mais o número que sairia.
  function alternar(id: string) {
    setConfirmando(false);
    setErro(null);
    setEscolhidos((atual) =>
      atual.includes(id) ? atual.filter((outro) => outro !== id) : [...atual, id],
    );
  }

  function divulgar() {
    setErro(null);
    setAviso(null);

    startTransition(async () => {
      const resultado = await startBroadcastAction({ source, sourceId, segmentIds: escolhidos });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        setConfirmando(false);
        return;
      }

      const { queued, blocked, sent } = resultado.data;
      setAviso(
        `${sent} de ${queued} mensagens enviadas${blocked > 0 ? ` · ${blocked} bloqueadas` : ""}.` +
          (sent < queued ? " O restante continua na fila — use Continuar." : ""),
      );
      setEscolhidos([]);
      setConfirmando(false);
      router.refresh();
    });
  }

  function continuar() {
    if (!resumeId) return;
    setErro(null);
    setAviso(null);

    startTransition(async () => {
      const resultado = await resumeBroadcastAction({ broadcastId: resumeId });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setAviso(
        resultado.data.remaining > 0
          ? `${resultado.data.sent} enviadas. Ainda faltam ${resultado.data.remaining}.`
          : `${resultado.data.sent} enviadas. A fila terminou.`,
      );
      router.refresh();
    });
  }

  if (segments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhum público-alvo ativo. Ative um em Configurações → Públicos-alvo antes de divulgar.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {resumeId && resumeRemaining > 0 && (
        <div className="border-border bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <p className="text-sm">
            Uma divulgação parou no meio: faltam <strong>{resumeRemaining}</strong>.
          </p>
          <Button size="sm" variant="outline" loading={pendente} onClick={continuar}>
            Continuar
          </Button>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Para quem</legend>
        {segments.map((segmento) => (
          <label
            key={segmento.id}
            htmlFor={`${grupoId}-${segmento.id}`}
            className="flex items-start gap-2 text-sm"
          >
            <input
              id={`${grupoId}-${segmento.id}`}
              type="checkbox"
              className="border-input accent-primary mt-0.5 h-4 w-4 rounded"
              checked={escolhidos.includes(segmento.id)}
              disabled={pendente}
              onChange={() => alternar(segmento.id)}
            />
            <span>
              {segmento.name}
              {segmento.description && (
                <span className="text-muted-foreground block text-xs">{segmento.description}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {escolhidos.length > 0 && (
        <p className="text-sm" role="status">
          {alcance === null ? (
            <span className="text-muted-foreground">Calculando o alcance…</span>
          ) : (
            <>
              <strong>{alcance.reachable}</strong>{" "}
              {alcance.reachable === 1 ? "associado receberá" : "associados receberão"}
              {alcance.blocked > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · {alcance.blocked} {alcance.blocked === 1 ? "bloqueado" : "bloqueados"} (pediram
                  para não receber)
                </span>
              )}
            </>
          )}
        </p>
      )}

      <details className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
          Ver a mensagem que será enviada
        </summary>
        {/*
          `whitespace-pre-wrap`: a mensagem tem quebras de linha que são parte do
          formato. Renderizada sem elas, a pré-visualização mostraria um
          parágrafo corrido que não é o que a pessoa vai receber — e conferir
          uma coisa para mandar outra é pior que não conferir.
        */}
        <pre className="bg-muted/50 mt-2 rounded-md p-3 text-xs whitespace-pre-wrap">{preview}</pre>

        {/* ⚠️ DIZ QUANTAS MENSAGENS SAEM, e não só "tem anexo". Com imagem são
            DUAS por associado, e isso muda o que a pessoa vê chegando no
            celular dela — conferir uma coisa e mandar outra é pior que não
            conferir. */}
        {hasImage ? (
          <p className="text-muted-foreground mt-1 flex items-start gap-1.5 text-xs">
            <Paperclip className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              Cada associado recebe <strong>duas mensagens</strong>: a imagem primeiro, sem texto, e
              o arquivo em seguida com o texto acima.
            </span>
          </p>
        ) : (
          hasDocument && (
            <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
              <Paperclip className="h-3 w-3" aria-hidden="true" />O arquivo vai anexado à mensagem.
            </p>
          )
        )}
      </details>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="text-primary-strong text-sm">
          {aviso}
        </p>
      )}

      {confirmando ? (
        <div className="border-border space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">
            Enviar para {alcance?.reachable ?? 0}{" "}
            {alcance?.reachable === 1 ? "associado" : "associados"}?
          </p>
          {/* Dito na hora de confirmar, e não no rodapé: é aqui que a pessoa
              ainda pode parar. */}
          <p className="text-muted-foreground text-xs">
            Mensagem de WhatsApp não tem como ser cancelada depois de sair.
          </p>
          <div className="flex gap-2">
            <Button loading={pendente} onClick={divulgar} className="flex-1">
              <Send className="h-4 w-4" aria-hidden="true" />
              Enviar agora
            </Button>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setConfirmando(false)}
              className="flex-1"
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          // Sem público escolhido, ou com zero pessoas alcançáveis, não há o que
          // enviar — e um botão aceso que só sabe dar erro é um convite ao erro.
          disabled={pendente || escolhidos.length === 0 || (alcance?.reachable ?? 0) === 0}
          onClick={() => setConfirmando(true)}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Divulgar por WhatsApp
        </Button>
      )}
    </div>
  );
}
