"use client";

import { useId, useState, useTransition } from "react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { submitPublicEvaluationAction } from "@/lib/actions/event-evaluation-public";
import { PUBLIC_EVALUATION_COPY } from "@/modules/event/event.evaluation.labels";
import {
  SINGLE_ANSWER_TYPES,
  type EvaluationQuestion,
  type EvaluationSection,
} from "@/modules/event/event.evaluation.types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * O FORMULÁRIO PÚBLICO DA AVALIAÇÃO (§27, §29, §30).
 *
 * ============================================================================
 * ⚠️ O QUE ELE NÃO PEDE, E A AUSÊNCIA É O §6.
 * ============================================================================
 * Nome, e-mail, empresa, telefone, evento. O sistema já tem tudo isso, e quem
 * responde foi identificado pelo TOKEN. Pedir de novo seria transformar uma
 * pesquisa de dois minutos num cadastro — e dar a quem recebeu o link de
 * segunda mão a chance de se apresentar como outra pessoa.
 *
 * ============================================================================
 * ⚠️ O `value` DA NOTA NÃO VIAJA DAQUI (§32).
 * ============================================================================
 * O que sai é o `optionId`. Quanto a alternativa vale é o banco quem diz,
 * copiando de `numeric_value` — porque esta página é pública, e um número vindo
 * do navegador envenenaria a média do Prompt 3 sem precisar de permissão
 * nenhuma.
 *
 * ============================================================================
 * ⚠️ A OBRIGATORIEDADE É CONFERIDA NOS DOIS LADOS (§25).
 * ============================================================================
 * Aqui, para a pessoa ver o que falta sem perder o que já escreveu; e no banco,
 * contra as LINHAS que foram gravadas — que é a checagem que vale, e a única
 * que sobrevive a alguém que não passe por esta tela.
 *
 * ⚠️ E O `required` DO HTML NÃO É USADO. Ele barraria o envio com uma bolha do
 * navegador que não diz QUAL das doze perguntas falta, e que some ao rolar a
 * página. A validação daqui lista os enunciados.
 */
export function EvaluationForm({
  token,
  sections,
}: {
  token: string;
  sections: EvaluationSection[];
}) {
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);

  /** questionId → opções marcadas. Uma só, exceto em múltipla escolha. */
  const [escolhas, setEscolhas] = useState<Record<string, string[]>>({});
  /** questionId → texto livre. */
  const [textos, setTextos] = useState<Record<string, string>>({});

  const todas = sections.flatMap((bloco) => bloco.questions);

  if (enviada) {
    return (
      <div role="status" className="border-border bg-card rounded-lg border px-6 py-10 text-center">
        <h2 className="text-xl font-semibold tracking-tight">
          {PUBLIC_EVALUATION_COPY.successTitle}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">{PUBLIC_EVALUATION_COPY.successBody}</p>
      </div>
    );
  }

  function marcar(pergunta: EvaluationQuestion, optionId: string) {
    setEscolhas((atual) => {
      if (!(SINGLE_ANSWER_TYPES as readonly string[]).includes(pergunta.type)) {
        const marcadas = atual[pergunta.id] ?? [];
        return {
          ...atual,
          [pergunta.id]: marcadas.includes(optionId)
            ? marcadas.filter((id) => id !== optionId)
            : [...marcadas, optionId],
        };
      }
      return { ...atual, [pergunta.id]: [optionId] };
    });
  }

  function enviar() {
    setErro(null);

    const faltando = todas.filter((pergunta) => {
      if (!pergunta.required) return false;
      if (pergunta.type === "free_text") return !(textos[pergunta.id] ?? "").trim();
      return (escolhas[pergunta.id] ?? []).length === 0;
    });

    if (faltando.length > 0) {
      setErro(`Falta responder: ${faltando.map((p) => p.prompt).join("; ")}`);
      return;
    }

    const answers = todas.map((pergunta) => ({
      questionId: pergunta.id,
      optionIds: escolhas[pergunta.id] ?? [],
      text: (textos[pergunta.id] ?? "").trim() || null,
    }));

    startTransition(async () => {
      const resultado = await submitPublicEvaluationAction({ token, answers });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      setEnviada(true);
    });
  }

  return (
    <form
      className="space-y-8"
      onSubmit={(evento) => {
        evento.preventDefault();
        enviar();
      }}
    >
      {sections.map((bloco) => (
        <section key={bloco.id} className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{bloco.title}</h2>
            {bloco.description && (
              <p className="text-muted-foreground text-sm">{bloco.description}</p>
            )}
          </div>

          {bloco.questions.map((pergunta) => (
            <PerguntaPublica
              key={pergunta.id}
              pergunta={pergunta}
              marcadas={escolhas[pergunta.id] ?? []}
              texto={textos[pergunta.id] ?? ""}
              onMarcar={(optionId) => marcar(pergunta, optionId)}
              onTexto={(valor) => setTextos((atual) => ({ ...atual, [pergunta.id]: valor }))}
              disabled={pendente}
            />
          ))}
        </section>
      ))}

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      <Button type="submit" disabled={pendente} className="w-full sm:w-auto">
        {pendente ? PUBLIC_EVALUATION_COPY.submitting : PUBLIC_EVALUATION_COPY.submit}
      </Button>
    </form>
  );
}

function PerguntaPublica({
  pergunta,
  marcadas,
  texto,
  onMarcar,
  onTexto,
  disabled,
}: {
  pergunta: EvaluationQuestion;
  marcadas: string[];
  texto: string;
  onMarcar: (optionId: string) => void;
  onTexto: (valor: string) => void;
  disabled: boolean;
}) {
  const grupoId = useId();
  const unica = (SINGLE_ANSWER_TYPES as readonly string[]).includes(pergunta.type);

  if (pergunta.type === "free_text") {
    return (
      <div className="space-y-2">
        <Label htmlFor={grupoId}>
          {pergunta.prompt}
          {pergunta.required && <span aria-hidden="true"> *</span>}
        </Label>
        <Textarea
          id={grupoId}
          value={texto}
          onChange={(evento) => onTexto(evento.target.value)}
          rows={4}
          maxLength={4000}
          disabled={disabled}
        />
      </div>
    );
  }

  /**
   * ⚠️ `fieldset` + `legend`, E NÃO UM `<p>` COM CAIXINHAS SOLTAS. É o que faz
   * um leitor de tela anunciar o ENUNCIADO ao entrar no grupo — sem isso, quem
   * navega por teclado ouve "Excelente, botão de opção" onze vezes seguidas,
   * sem nunca saber sobre o que é a pergunta.
   */
  return (
    <fieldset className="border-border space-y-2 rounded-lg border p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">
        {pergunta.prompt}
        {pergunta.required && <span aria-hidden="true"> *</span>}
        {!unica && <span className="text-muted-foreground"> (pode marcar mais de uma)</span>}
      </legend>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {pergunta.options.map((opcao) => (
          <label key={opcao.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              // ⚠️ RÁDIO PARA ESCOLHA ÚNICA, CAIXA PARA MÚLTIPLA. Não é estética:
              // é o contrato que o navegador e o leitor de tela já conhecem —
              // rádio anuncia "1 de 5" e desmarca o irmão sozinho.
              type={unica ? "radio" : "checkbox"}
              name={grupoId}
              value={opcao.id}
              checked={marcadas.includes(opcao.id)}
              onChange={() => onMarcar(opcao.id)}
              className="accent-primary h-4 w-4"
            />
            {opcao.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
