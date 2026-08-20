"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * A caixa se atualiza sozinha.
 *
 * ⚠️ SONDAGEM, E NÃO TEMPO REAL — e a escolha tem motivo.
 *
 * O Supabase tem Realtime, e ele seria mais elegante. Não é usado em NENHUM
 * lugar deste projeto (procurado: não há `.channel(` em `src/`), então adotá-lo
 * aqui traria a primeira conexão WebSocket do sistema, um segundo modelo de
 * autorização para manter em sincronia com a RLS, e reconexão para depurar —
 * tudo isso para ganhar segundos numa tela em que a mensagem já demorou o tempo
 * do webhook para chegar.
 *
 * Um `router.refresh()` a cada 15 segundos rebusca só o payload do servidor,
 * mantém a rolagem e o texto digitado no campo de resposta, e passa pela mesma
 * RLS de sempre. Quando o volume justificar, trocar isto por Realtime é mexer
 * neste arquivo e em nenhum outro.
 *
 * ⚠️ SÓ COM A ABA VISÍVEL. Uma aba esquecida aberta a noite toda faria uma
 * consulta a cada 15 segundos até de manhã — por ninguém. `visibilitychange`
 * também força uma atualização imediata ao voltar para a aba, que é exatamente
 * quando a pessoa quer ver o que chegou.
 */
const INTERVALO_MS = 15_000;

export function AutoRefresh({ intervalMs = INTERVALO_MS }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function parar() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }

    function comecar() {
      parar();
      timer = setInterval(() => router.refresh(), intervalMs);
    }

    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible") {
        router.refresh();
        comecar();
      } else {
        parar();
      }
    }

    if (document.visibilityState === "visible") comecar();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      parar();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [router, intervalMs]);

  return null;
}
