"use client";

import { useId, useState, type DragEvent } from "react";
import { GripVertical } from "lucide-react";
import { LANDING_FIELD_HINTS, LANDING_FIELD_LABELS } from "@/modules/event/event.landing.labels";
import {
  CONTACT_LANDING_FIELD_KEYS,
  REQUIRED_LANDING_FIELD_KEYS,
  type LandingFieldKey,
} from "@/modules/event/event.landing.types";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * A ORDEM DOS CAMPOS DO FORMULÁRIO (§12, §13, §14).
 *
 * ============================================================================
 * ⚠️ AS SETAS SAÍRAM, E QUEM FICOU NO LUGAR DELAS FOI UM `<select>` DE POSIÇÃO.
 * ============================================================================
 * O pedido foi "remover as setas, porque o botão de seleção já tem a função". A
 * primeira metade é fácil; a segunda não existia ainda — não havia botão de
 * seleção nenhum nesta lista, só o arrastar e as duas setas.
 *
 * Tirar as setas e não pôr nada no lugar quebraria o §31: "Não fazer o Drag &
 * Drop depender exclusivamente do mouse." Quem navega por teclado e quem usa
 * leitor de tela não arrastam — e a única alternativa que existia eram as setas.
 *
 * O `<select>` é a resposta que atende as duas coisas. Ele some visualmente
 * como controle repetido (dois botões por linha viravam dez botões numa lista
 * de cinco), diz a posição atual em vez de só oferecer um passo por vez, e é
 * nativo: teclado e leitor de tela funcionam sem uma linha de código nossa. Numa
 * lista de cinco itens, escolher "3" na hora é melhor do que apertar a seta
 * duas vezes.
 *
 * ⚠️ E ELE NÃO É UM ATALHO PARA O ARRASTAR — é o caminho principal de quem não
 * usa mouse. Se ele sair um dia, o arrastar precisa ganhar teclado no mesmo
 * commit.
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
   * pediu um. O `<select>` de posição chama esta mesma função, e é justamente
   * ali que a diferença aparece: escolher "1" para o último campo tem de
   * empurrar todo mundo um degrau para baixo, e não jogar o primeiro para o fim.
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

              {/*
                ⚠️ A EXPLICAÇÃO SAIU DA LINHA E VIROU DICA. Ela era um parágrafo
                embaixo do rótulo; com o Builder em duas colunas, esta lista
                passou a ocupar metade da largura, e a frase começou a empurrar
                o selo e o seletor de posição para fora da linha.

                `InfoTip` nasceu de um problema idêntico na barra de filtros, e
                resolve o mesmo aqui: a dica flutua SOBRE a linha quando alguém
                pergunta, em vez de ocupar espaço permanente para algo que se lê
                uma vez na vida.

                ⚠️ O RÓTULO DO BOTÃO NOMEIA O CAMPO. Cinco botões chamados "Mais
                informações" fazem um leitor de tela anunciar cinco controles
                idênticos — o mesmo cuidado do seletor de posição, ali ao lado.
              */}
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
                <span className="truncate">
                  {rotulo}
                  {obrigatorio && (
                    <span className="text-destructive ml-0.5" aria-hidden="true">
                      *
                    </span>
                  )}
                </span>
                <InfoTip text={LANDING_FIELD_HINTS[campo]} label={`Sobre ${rotulo}`} />
              </p>

              {/* O selo é INFORMAÇÃO, não controle (§14). Não há caixa para
                  desmarcar: a obrigatoriedade é do sistema, e o Builder a
                  apresenta. */}
              <Badge variant={obrigatorio ? "attention" : "done"} className="shrink-0">
                {obrigatorio ? "Obrigatório" : contato ? "Telefone ou WhatsApp" : "Opcional"}
              </Badge>

              {/* ⚠️ O NOME ACESSÍVEL DIZ DE QUEM É A POSIÇÃO. Um `<select>` com
                  "1, 2, 3" e rótulo "Posição" repetido cinco vezes não responde
                  "posição de quê" para quem navega por leitor de tela — e a
                  lista inteira vira cinco controles idênticos. */}
              {/* ⚠️ O `value` É 1-BASED, IGUAL AO QUE SE LÊ NA OPÇÃO — e isso
                  não é detalhe. Com `value={indice}` e texto `indice + 1`, a
                  opção que MOSTRA "3" carregava o valor "2", e qualquer código
                  que procurasse a posição 3 (uma automação, um teste, alguém
                  lendo o HTML) acertava a errada por um. A conversão para
                  índice acontece num lugar só, aqui embaixo. */}
              <Select
                aria-label={`Posição de ${rotulo}`}
                className="h-8 w-16 shrink-0 px-2"
                disabled={disabled}
                value={indice + 1}
                onChange={(event) => mover(indice, Number(event.target.value) - 1)}
              >
                {fields.map((_, posicao) => (
                  <option key={posicao} value={posicao + 1}>
                    {posicao + 1}
                  </option>
                ))}
              </Select>
            </li>
          );
        })}
      </ul>

      <p id={`${grupoId}-ajuda`} className="text-muted-foreground text-xs">
        Arraste para reordenar, ou escolha a posição na lista ao lado de cada campo. A ordem daqui é
        a ordem em que a pessoa vê os campos na página pública. Nenhum campo pode ser removido nesta
        versão.
      </p>
    </fieldset>
  );
}
