"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { publishConsentTextAction } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * PUBLICA UMA VERSÃO NOVA do texto de consentimento.
 *
 * ⚠️ NÃO É UM EDITOR. Não há "salvar" sobre o texto vigente, e a ausência é a
 * regra inteira: uma autorização vale só para o texto que a pessoa leu, então
 * reescrever a versão de agosto apagaria a prova do que quem se cadastrou em
 * agosto aceitou. O banco recusa (AD003); a tela nem oferece.
 *
 * ⚠️ A VERSÃO É DIGITADA, e não gerada automaticamente. Quem publica precisa
 * poder dizer se aquilo é conserto de vírgula ou mudança de finalidade do
 * tratamento — e essa diferença é jurídica, não técnica. A sugestão abaixo é só
 * um atalho para o formato que o projeto vem usando.
 */
export function ConsentPublisher({ currentBody }: { currentBody: string }) {
  const router = useRouter();
  const versaoId = useId();
  const textoId = useId();

  const [abrir, setAbrir] = useState(false);
  // Começa com o texto atual: quase toda publicação é um ajuste do que já
  // existe, e obrigar a redigitar tudo convida a esquecer uma frase.
  const [texto, setTexto] = useState(currentBody);
  const [versao, setVersao] = useState(sugerirVersao());
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  if (!abrir) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbrir(true)}>
        Publicar nova versão
      </Button>
    );
  }

  function publicar() {
    setErro(null);
    startTransition(async () => {
      const resultado = await publishConsentTextAction({ version: versao, body: texto });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setAbrir(false);
      router.refresh();
    });
  }

  return (
    <div className="border-border space-y-4 rounded-lg border p-4">
      <div className="space-y-2">
        <Label htmlFor={versaoId}>
          Versão <span aria-hidden="true">*</span>
          <span className="sr-only">(obrigatório)</span>
        </Label>
        <Input
          id={versaoId}
          value={versao}
          disabled={pendente}
          maxLength={40}
          className="max-w-xs font-mono"
          onChange={(evento) => setVersao(evento.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Fica gravada em cada solicitação enviada a partir de agora. Uma versão já publicada não
          pode ser reescrita.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={textoId}>
          Texto <span aria-hidden="true">*</span>
          <span className="sr-only">(obrigatório)</span>
        </Label>
        <Textarea
          id={textoId}
          rows={4}
          maxLength={2000}
          value={texto}
          disabled={pendente}
          onChange={(evento) => setTexto(evento.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          É o que a pessoa lê antes de marcar &ldquo;aceito&rdquo; na landing. Diga o que será feito
          com os dados.
        </p>
      </div>

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={pendente}
          disabled={versao.trim().length < 3 || texto.trim().length < 20}
          onClick={publicar}
        >
          Publicar
        </Button>
        <Button variant="outline" size="sm" disabled={pendente} onClick={() => setAbrir(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/**
 * `2026-09-v1` — ano, mês e um contador.
 *
 * É só uma SUGESTÃO no campo, e quem publica pode trocar. Se já houver uma
 * versão daquele mês, o banco recusa (AD003) e a pessoa escolhe `-v2`; adivinhar
 * o contador aqui exigiria consultar o histórico para acertar um palpite que a
 * pessoa vai revisar de qualquer jeito.
 */
function sugerirVersao(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-v1`;
}
