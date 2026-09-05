"use client";

import { useId, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { LANDING_FIELD_HINTS, LANDING_FIELD_LABELS } from "@/modules/event/event.landing.labels";
import {
  CONTACT_LANDING_FIELD_KEYS,
  REQUIRED_LANDING_FIELD_KEYS,
  type LandingFieldKey,
} from "@/modules/event/event.landing.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A ORDEM DOS CAMPOS DO FORMULÁRIO (§12, §13, §14).
 *
 * ⚠️ O ARRASTAR NÃO É A ÚNICA FORMA DE REORDENAR, E ISSO NÃO É EXTRA — É O §31.
 * "Não fazer o Drag & Drop depender exclusivamente do mouse." Quem navega por
 * teclado e quem usa leitor de tela não arrastam nada; os dois botões de seta
 * fazem exatamente a mesma operação, com rótulo que diz o que vai acontecer
 * ("Mover E-mail para cima"). É o mesmo desenho de `SurveyOptionEditor`, que
 * chegou à mesma conclusão antes.
 *
 * ⚠️ SEM BIBLIOTECA DE DRAG & DROP. `draggable` + três manipuladores do próprio
 * HTML dão conta de uma lista de cinco itens. Uma dependência nova aqui seria
 * ~30 kB no pacote do navegador para resolver o que o navegador já resolve — e
 * o projeto não tem nenhuma outra tela que a justifique.
 *
 * ⚠️ O QUE ESTA LISTA **NÃO** FAZ (§13): mexer em obrigatoriedade, nome técnico,
 * identificador ou validação. Ela move item de posição num array, e só. A
 * obrigatoriedade aparece como SELO — informação, não controle —, porque o §14
 * é explícito: "Não permitir que o administrador desconfigure essas regras
 * nesta primeira versão. O Builder apenas apresenta essas regras."
 */
export function LandingFieldList({
  fields,
  onChange,
  disabled = false,
}: {
  fields: LandingFieldKey[];
  onChange: (fields: LandingFieldKey[]) => void;
  disabled?: boolean;
}) {
  const grupoId = useId();

  /** Quem está sendo arrastado. `null` = ninguém. */
  const [arrastando, setArrastando] = useState<number | null>(null);
  /** Sobre quem o cursor está agora — é o que desenha a linha de destino. */
  const [alvo, setAlvo] = useState<number | null>(null);

  /**
   * Tira o item de uma posição e o põe em outra.
   *
   * ⚠️ MOVER, E NÃO TROCAR. Arrastar o último item para o topo com uma TROCA
   * mandaria o primeiro para o fim — dois itens mudam de lugar quando a pessoa
   * pediu um. As setas usam a mesma função com `destino = origem ± 1`, onde
   * mover e trocar dão no mesmo resultado.
   */
  function mover(origem: number, destino: number) {
    if (origem === destino) return;
    if (destino < 0 || destino >= fields.length) return;

    const proximo = [...fields];
    const [item] = proximo.splice(origem, 1);
    if (item === undefined) return;
    proximo.splice(destino, 0, item);
    onChange(proximo);
  }

  function aoSoltar(event: DragEvent<HTMLLIElement>, destino: number) {
    event.preventDefault();
    if (arrastando !== null) mover(arrastando, destino);
    setArrastando(null);
    setAlvo(null);
  }

  return (
    <fieldset className="space-y-3" aria-describedby={`${grupoId}-ajuda`}>
      <legend className="text-sm leading-none font-medium">Campos do formulário</legend>

      <ul className="space-y-2">
        {fields.map((campo, indice) => {
          const obrigatorio = (REQUIRED_LANDING_FIELD_KEYS as readonly string[]).includes(campo);
          const contato = (CONTACT_LANDING_FIELD_KEYS as readonly string[]).includes(campo);
          const rotulo = LANDING_FIELD_LABELS[campo];

          return (
            <li
              key={campo}
              draggable={!disabled}
              onDragStart={(event) => {
                setArrastando(indice);
                // Alguns navegadores só iniciam o arrasto se houver dado.
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", campo);
              }}
              onDragEnd={() => {
                setArrastando(null);
                setAlvo(null);
              }}
              onDragOver={(event) => {
                // Sem `preventDefault` o navegador recusa o soltar — é a
                // pegadinha clássica da API nativa.
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (alvo !== indice) setAlvo(indice);
              }}
              onDragLeave={() => setAlvo((atual) => (atual === indice ? null : atual))}
              onDrop={(event) => aoSoltar(event, indice)}
              className={cn(
                "border-border bg-card flex items-center gap-2 rounded-lg border p-2 transition-colors",
                !disabled && "cursor-grab active:cursor-grabbing",
                arrastando === indice && "opacity-50",
                alvo === indice && arrastando !== null && arrastando !== indice && "border-primary",
              )}
            >
              <GripVertical
                className={cn(
                  "h-4 w-4 shrink-0",
                  disabled ? "opacity-30" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {rotulo}
                  {obrigatorio && (
                    <span className="text-destructive ml-0.5" aria-hidden="true">
                      *
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {LANDING_FIELD_HINTS[campo]}
                </p>
              </div>

              {/* O selo é INFORMAÇÃO, não controle (§14). Não há caixa para
                  desmarcar: a obrigatoriedade é do sistema, e o Builder a
                  apresenta. */}
              <Badge variant={obrigatorio ? "attention" : "done"} className="shrink-0">
                {obrigatorio ? "Obrigatório" : contato ? "Telefone ou WhatsApp" : "Opcional"}
              </Badge>

              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || indice === 0}
                  aria-label={`Mover ${rotulo} para cima`}
                  onClick={() => mover(indice, indice - 1)}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || indice === fields.length - 1}
                  aria-label={`Mover ${rotulo} para baixo`}
                  onClick={() => mover(indice, indice + 1)}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <p id={`${grupoId}-ajuda`} className="text-muted-foreground text-xs">
        Arraste para reordenar, ou use as setas. A ordem daqui é a ordem em que a pessoa vê os
        campos na página pública. Nenhum campo pode ser removido nesta versão.
      </p>
    </fieldset>
  );
}
