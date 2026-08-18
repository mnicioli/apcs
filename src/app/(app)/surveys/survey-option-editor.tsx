"use client";

import { useId, type Dispatch, type SetStateAction } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { numberEmoji } from "@/modules/survey/survey.labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** §16. O piso: uma "escolha única" com uma opção só é um aviso, não uma enquete. */
export const MIN_OPTIONS = 2;

/** §41. Acima disso a mensagem do WhatsApp deixa de caber numa tela de celular. */
export const MAX_OPTIONS = 10;

/**
 * O EDITOR DE ALTERNATIVAS (§15, §16, §17).
 *
 * ⚠️ A ORDEM É O DADO, não a apresentação. O número que aparece à esquerda de
 * cada alternativa é o que a pessoa vai digitar no WhatsApp, e é a posição no
 * array que o backend grava como `position`. Por isso reordenar aqui move o
 * ITEM no array — e não um campo "ordem" que alguém teria de manter coerente.
 *
 * ⚠️ REORDENAÇÃO POR BOTÃO, E NÃO POR ARRASTAR. Foi decisão, não limitação:
 * arrastar não existe para quem navega por teclado nem para leitor de tela, e o
 * §61 pede navegação por teclado. Dois botões com rótulo explícito
 * ("Mover 'Manter' para cima") funcionam para todo mundo e não precisam de
 * biblioteca nenhuma.
 */
export function SurveyOptionEditor({
  options,
  onChange,
  disabled = false,
  /** §38: com respostas gravadas, a estrutura não muda mais. */
  locked = false,
  lockedReason,
}: {
  options: string[];
  /** Setter do `useState` — atualização funcional, pelo mesmo motivo do seletor de público. */
  onChange: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
  locked?: boolean;
  lockedReason?: string;
}) {
  const groupId = useId();

  const bloqueado = disabled || locked;

  function atualizar(indice: number, valor: string) {
    onChange((atuais) => atuais.map((atual, i) => (i === indice ? valor : atual)));
  }

  function acrescentar() {
    onChange((atuais) => (atuais.length >= MAX_OPTIONS ? atuais : [...atuais, ""]));
  }

  function remover(indice: number) {
    onChange((atuais) =>
      atuais.length <= MIN_OPTIONS ? atuais : atuais.filter((_, i) => i !== indice),
    );
  }

  /** Troca com o vizinho — é a operação inteira de reordenar. */
  function mover(indice: number, direcao: -1 | 1) {
    onChange((atuais) => {
      const destino = indice + direcao;
      if (destino < 0 || destino >= atuais.length) return atuais;

      const proximo = [...atuais];
      const atual = proximo[indice];
      const vizinho = proximo[destino];
      if (atual === undefined || vizinho === undefined) return atuais;

      proximo[indice] = vizinho;
      proximo[destino] = atual;
      return proximo;
    });
  }

  const duplicadas = encontrarDuplicadas(options);

  return (
    <fieldset className="space-y-3" aria-describedby={`${groupId}-ajuda`}>
      <legend className="text-sm leading-none font-medium">
        Alternativas <span aria-hidden="true">*</span>
        <span className="sr-only">(obrigatório, mínimo de duas)</span>
      </legend>

      <ul className="space-y-2">
        {options.map((option, indice) => (
          <li key={indice} className="flex items-start gap-2">
            {/* O número é a POSIÇÃO que a pessoa vai digitar no chat. Fica fora
                do campo de propósito: não é editável, é consequência da ordem. */}
            <span
              aria-hidden="true"
              className="text-muted-foreground bg-muted mt-1 inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-sm"
            >
              {numberEmoji(indice + 1)}
            </span>

            <div className="min-w-0 flex-1">
              <Label htmlFor={`${groupId}-${indice}`} className="sr-only">
                Alternativa {indice + 1}
              </Label>
              <Input
                id={`${groupId}-${indice}`}
                value={option}
                disabled={bloqueado}
                maxLength={200}
                aria-invalid={duplicadas.has(indice)}
                placeholder={`Alternativa ${indice + 1}`}
                onChange={(event) => atualizar(indice, event.target.value)}
              />
            </div>

            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={bloqueado || indice === 0}
                aria-label={`Mover "${option || `alternativa ${indice + 1}`}" para cima`}
                onClick={() => mover(indice, -1)}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={bloqueado || indice === options.length - 1}
                aria-label={`Mover "${option || `alternativa ${indice + 1}`}" para baixo`}
                onClick={() => mover(indice, 1)}
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={bloqueado || options.length <= MIN_OPTIONS}
                aria-label={`Remover "${option || `alternativa ${indice + 1}`}"`}
                onClick={() => remover(indice)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {!bloqueado && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={options.length >= MAX_OPTIONS}
          onClick={acrescentar}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Adicionar alternativa
        </Button>
      )}

      <p id={`${groupId}-ajuda`} className="text-muted-foreground text-xs">
        {locked
          ? (lockedReason ??
            "Esta enquete já recebeu respostas: as alternativas não podem mais ser alteradas.")
          : `De ${MIN_OPTIONS} a ${MAX_OPTIONS} alternativas. O número à esquerda é o que o associado digita para responder.`}
      </p>

      {duplicadas.size > 0 && (
        <p role="alert" className="text-destructive text-sm">
          Há alternativas repetidas. Cada opção precisa ser distinta.
        </p>
      )}
    </fieldset>
  );
}

/**
 * Os ÍNDICES das alternativas repetidas — não os textos.
 *
 * Índices porque é o campo que precisa ficar marcado como inválido, e duas
 * alternativas iguais deixam os DOIS campos vermelhos: apontar só a segunda
 * sugeriria que a primeira está certa e a segunda é que é o problema, quando na
 * verdade a pessoa precisa decidir qual das duas fica.
 */
function encontrarDuplicadas(options: string[]): Set<number> {
  const vistos = new Map<string, number[]>();

  options.forEach((option, indice) => {
    const chave = option.trim().toLowerCase();
    if (!chave) return;
    vistos.set(chave, [...(vistos.get(chave) ?? []), indice]);
  });

  const duplicadas = new Set<number>();
  for (const indices of vistos.values()) {
    if (indices.length > 1) indices.forEach((i) => duplicadas.add(i));
  }
  return duplicadas;
}
