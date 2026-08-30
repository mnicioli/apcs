"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Info, Loader2, Search, Users, X } from "lucide-react";
import { estimateAudienceAction, searchContactsAction } from "@/lib/actions/surveys";
import {
  SURVEY_AUDIENCE_DIMENSION_LABELS,
  SURVEY_AUDIENCE_UNAVAILABLE,
  audienceSummary,
} from "@/modules/survey/survey.labels";
import type { SurveyAudienceCriterion } from "@/modules/survey/survey.types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEBOUNCE_MS = 300;

/** Um contato já escolhido, com o nome que a tela mostra no chip. */
export interface ChosenContact {
  contactId: string;
  fullName: string | null;
}

/** Um público-alvo do catálogo — os mesmos de Eventos e Divulgação. */
export interface AudienceSegment {
  id: string;
  name: string;
  description: string | null;
}

/**
 * O SELETOR DE PÚBLICO (§22 a §31).
 *
 * ⚠️ O PÚBLICO DE UMA ENQUETE É O ASSOCIADO, e isto aqui é a tela dessa
 * decisão. Até 09/09 o seletor perguntava por Perfil (Produtor · Associado ·
 * Fornecedor) — a triagem do bot do site — e o banco resolvia sobre
 * `chat_contacts`. Resultado: "Público estimado: nenhum contato" com a base de
 * associados cheia. Ver 20260909000000_survey_audience_members.sql.
 *
 * Agora as dimensões são as mesmas de Eventos, Bolsa e Normativas: Público-alvo
 * (Criadores · Empresas · Técnicos · Universidades), Região e associados
 * específicos. Um número só, uma base só.
 *
 * ⚠️ AS DIMENSÕES INDISPONÍVEIS APARECEM, DESABILITADAS E EXPLICADAS.
 *
 * Perfil, Categoria e Carteira estão no §22. Havia três saídas: omiti-las,
 * mostrá-las funcionando (e falhar no salvar), ou mostrá-las desabilitadas com o
 * motivo. A terceira é a única honesta — quem abrir a tela procurando "Perfil"
 * vai encontrá-lo e vai descobrir que ele virou o Público-alvo, em vez de achar
 * que sumiu.
 *
 * ⚠️ A ESTIMATIVA VEM DO BANCO (§30, §66). A mesma função que o agendamento usa
 * para fotografar o público (`resolve_audience_criteria`) é a que responde aqui.
 * Recalcular a combinação em TypeScript daria um número que diverge do real no
 * primeiro ajuste da regra — e a divergência só apareceria depois do envio.
 */
export function SurveyAudienceSelector({
  criteria,
  onChange,
  segments,
  regions,
  contactNames,
  disabled = false,
  locked = false,
}: {
  criteria: SurveyAudienceCriterion[];
  /**
   * ⚠️ RECEBE O SETTER DO `useState`, e não uma função que aceita o array pronto.
   *
   * A diferença apareceu no navegador: dois cliques rápidos (marcar "SP" e
   * "Produtor" em seguida) faziam o SEGUNDO calcular o próximo estado a partir
   * do `criteria` ANTIGO — a prop ainda não tinha sido atualizada — e a primeira
   * seleção sumia. Com o setter, cada clique calcula a partir do estado real.
   */
  onChange: Dispatch<SetStateAction<SurveyAudienceCriterion[]>>;
  /** O catálogo de públicos-alvo ATIVOS. Só o que o banco aceitaria. */
  segments: AudienceSegment[];
  /** As UFs que existem de fato na base — não uma lista fixa de 27. */
  regions: string[];
  /** Nome de cada contato já escolhido, para o chip não mostrar um uuid. */
  contactNames: Map<string, string | null>;
  disabled?: boolean;
  /** §37: depois de agendada, o público está fotografado e não muda mais. */
  locked?: boolean;
}) {
  const [estimate, setEstimate] = useState<number | null>(null);
  const [isEstimating, startEstimate] = useTransition();
  const groupId = useId();

  const bloqueado = disabled || locked;
  const todaABase = criteria.some((c) => c.dimension === "all");

  // ⚠️ A estimativa depende do CONTEÚDO dos critérios, não da identidade do
  // array — que muda a cada render do formulário. Serializar dá uma dependência
  // estável, sem a qual o efeito dispararia sem parar.
  const chave = JSON.stringify(criteria);

  const estimar = useCallback(() => {
    startEstimate(async () => {
      const result = await estimateAudienceAction(JSON.parse(chave));
      // Falha de estimativa não derruba o formulário: o número some, a pessoa
      // continua trabalhando, e o agendamento (que é quem decide de verdade)
      // recusa se não houver ninguém.
      setEstimate(result.ok ? result.data.eligible : null);
    });
  }, [chave]);

  useEffect(() => {
    const timer = setTimeout(estimar, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [estimar]);

  function alternarTodaABase() {
    // Marcar "toda a base" LIMPA o resto: o atalho dispensa os demais critérios,
    // e deixá-los ao lado sugeriria uma restrição que não existe.
    onChange((atual) =>
      atual.some((c) => c.dimension === "all")
        ? []
        : [{ dimension: "all", segmentId: null, contactId: null, value: null }],
    );
  }

  function alternarValor(dimension: "region", value: string) {
    onChange((atual) => {
      const jaTem = atual.some((c) => c.dimension === dimension && c.value === value);
      const semAtalho = atual.filter((c) => c.dimension !== "all");

      return jaTem
        ? semAtalho.filter((c) => !(c.dimension === dimension && c.value === value))
        : [...semAtalho, { dimension, segmentId: null, contactId: null, value }];
    });
  }

  /**
   * ⚠️ GUARDA O NOME JUNTO DO ID, e não é redundância.
   *
   * O diálogo de agendamento mostra o público antes de confirmar o envio, e ele
   * lê os mesmos critérios que estão aqui. Numa enquete NOVA eles nunca
   * passaram pelo banco — sem o nome, a última tela antes do disparo diria
   * "Público-alvo: a0000000-0000-4000-8000-000000000001".
   *
   * `toInput` descarta o nome antes de salvar: quem manda no banco é o id.
   */
  function alternarPublico(segmentId: string, segmentName: string) {
    onChange((atual) => {
      const jaTem = atual.some((c) => c.dimension === "segment" && c.segmentId === segmentId);
      const semAtalho = atual.filter((c) => c.dimension !== "all");

      return jaTem
        ? semAtalho.filter((c) => !(c.dimension === "segment" && c.segmentId === segmentId))
        : [
            ...semAtalho,
            { dimension: "segment", segmentId, segmentName, contactId: null, value: null },
          ];
    });
  }

  function acrescentarContato(contactId: string) {
    onChange((atual) => {
      if (atual.some((c) => c.dimension === "contact" && c.contactId === contactId)) return atual;
      return [
        ...atual.filter((c) => c.dimension !== "all"),
        { dimension: "contact", segmentId: null, contactId, value: null },
      ];
    });
  }

  function removerContato(contactId: string) {
    onChange((atual) =>
      atual.filter((c) => !(c.dimension === "contact" && c.contactId === contactId)),
    );
  }

  const contatosEscolhidos = criteria
    .filter((c) => c.dimension === "contact" && c.contactId)
    .map((c) => c.contactId as string);

  return (
    <div className="space-y-5">
      {/* ---------------- §23: toda a base ---------------- */}
      <div className="space-y-2">
        <label className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors">
          <input
            type="checkbox"
            checked={todaABase}
            disabled={bloqueado}
            onChange={alternarTodaABase}
            className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {SURVEY_AUDIENCE_DIMENSION_LABELS.all}
            </span>
            <span className="text-muted-foreground block text-sm">
              Todos os associados ativos com WhatsApp cadastrado. Dispensa os demais critérios.
            </span>
          </span>
        </label>
      </div>

      {!todaABase && (
        <>
          {/* ---------------- §25: público-alvo ---------------- */}
          <fieldset className="space-y-2">
            <legend className="text-sm leading-none font-medium">
              {SURVEY_AUDIENCE_DIMENSION_LABELS.segment}
            </legend>
            {segments.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhum público-alvo ativo cadastrado.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {segments.map((publico) => {
                  const marcado = criteria.some(
                    (c) => c.dimension === "segment" && c.segmentId === publico.id,
                  );
                  return (
                    <Toggle
                      key={publico.id}
                      label={publico.name}
                      title={publico.description}
                      checked={marcado}
                      disabled={bloqueado}
                      onToggle={() => alternarPublico(publico.id, publico.name)}
                    />
                  );
                })}
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              O mesmo público-alvo de Eventos e Divulgação — vale sobre o cadastro de associados.
            </p>
          </fieldset>

          {/* ---------------- §26: região ---------------- */}
          <fieldset className="space-y-2">
            <legend className="text-sm leading-none font-medium">
              {SURVEY_AUDIENCE_DIMENSION_LABELS.region}
            </legend>
            {regions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhum associado com estado cadastrado.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {regions.map((uf) => {
                  const marcado = criteria.some((c) => c.dimension === "region" && c.value === uf);
                  return (
                    <Toggle
                      key={uf}
                      label={uf}
                      checked={marcado}
                      disabled={bloqueado}
                      onToggle={() => alternarValor("region", uf)}
                    />
                  );
                })}
              </div>
            )}
          </fieldset>

          {/* ---------------- §29: grupo específico ---------------- */}
          <ContactPicker
            chosen={contatosEscolhidos}
            names={contactNames}
            disabled={bloqueado}
            onAdd={acrescentarContato}
            onRemove={removerContato}
          />

          {/* ---------------- as três indisponíveis ---------------- */}
          <div className="border-border space-y-2 rounded-md border border-dashed p-3">
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-medium">Perfil</strong> virou o Público-alvo acima —
                Criadores, Empresas, Técnicos e Universidades são hoje os perfis do associado.{" "}
                <strong className="font-medium">Categoria e Carteira</strong> dependem de cadastros
                que ainda não existem neste sistema.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {(["profile", "category", "portfolio"] as const).map((dimension) => (
                <span
                  key={dimension}
                  title={SURVEY_AUDIENCE_UNAVAILABLE[dimension]}
                  aria-disabled="true"
                  className="border-border text-muted-foreground/60 inline-flex cursor-not-allowed items-center rounded-full border px-3 py-1 text-xs"
                >
                  {SURVEY_AUDIENCE_DIMENSION_LABELS[dimension]}
                  <span className="sr-only">
                    — indisponível: {SURVEY_AUDIENCE_UNAVAILABLE[dimension]}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---------------- §30: o resumo ---------------- */}
      <div
        className="bg-muted/50 flex items-center gap-2 rounded-md px-3 py-2"
        // A estimativa muda enquanto a pessoa clica: `polite` anuncia o número
        // novo sem interromper o que ela está fazendo.
        aria-live="polite"
      >
        {isEstimating ? (
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Users className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        )}
        <p className="text-sm">
          {isEstimating ? (
            <span className="text-muted-foreground">Calculando o público…</span>
          ) : estimate === null ? (
            <span className="text-muted-foreground">
              Não foi possível calcular o público agora.
            </span>
          ) : (
            <>
              <span className="font-medium">Público estimado: </span>
              {audienceSummary(estimate)}
            </>
          )}
        </p>
      </div>

      {locked && (
        <p className="text-muted-foreground text-xs" id={`${groupId}-travado`}>
          O público desta enquete já foi definido no agendamento. Para alterá-lo, volte a enquete
          para rascunho.
        </p>
      )}
    </div>
  );
}

/**
 * Uma opção de múltipla escolha em forma de pílula.
 *
 * É um `<button>` com `aria-pressed`, e não uma div com onClick: o estado
 * marcado/desmarcado precisa ser anunciado, e o teclado precisa alcançá-lo.
 */
function Toggle({
  label,
  title,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  /** A descrição do público-alvo, quando existe. Complemento, nunca a única via. */
  title?: string | null;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={onToggle}
      title={title ?? undefined}
      className={
        checked
          ? "bg-primary text-primary-foreground focus-visible:ring-ring inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
          : "border-border hover:bg-muted focus-visible:ring-ring inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
      }
    >
      {label}
    </button>
  );
}

/**
 * §29/§64. A busca de associados específicos.
 *
 * ⚠️ NÃO CARREGA A BASE. Exige dois caracteres, busca no servidor com debounce e
 * mostra no máximo o que a action devolve. O §29 é explícito, e a razão é
 * concreta: um seletor que baixa todos os associados é um endpoint de exportação
 * de telefones disfarçado de autocomplete.
 */
function ContactPicker({
  chosen,
  names,
  disabled,
  onAdd,
  onRemove,
}: {
  chosen: string[];
  names: Map<string, string | null>;
  disabled: boolean;
  onAdd: (contactId: string) => void;
  onRemove: (contactId: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ contactId: string; fullName: string | null }[]>([]);
  const [isSearching, startSearch] = useTransition();
  const fieldId = useId();
  const listId = useId();

  // Guarda os nomes que já vieram da busca, para o chip continuar legível depois
  // que a lista de resultados sumir.
  const conhecidos = useRef(new Map(names));
  for (const [id, nome] of names) conhecidos.current.set(id, nome);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      startSearch(async () => {
        const result = await searchContactsAction(term);
        if (!result.ok) {
          setResults([]);
          return;
        }
        setResults(result.data);
        for (const c of result.data) conhecidos.current.set(c.contactId, c.fullName);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term]);

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>{SURVEY_AUDIENCE_DIMENSION_LABELS.contact}</Label>

      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id={fieldId}
          type="search"
          value={term}
          disabled={disabled}
          placeholder="Buscar associado pelo nome"
          className="pl-9"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-describedby={`${fieldId}-ajuda`}
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      <p id={`${fieldId}-ajuda`} className="text-muted-foreground text-xs">
        Digite ao menos dois caracteres. Só aparecem associados ativos com WhatsApp cadastrado.
      </p>

      {isSearching && (
        <p className="text-muted-foreground text-xs" aria-live="polite">
          Buscando…
        </p>
      )}

      {results.length > 0 && (
        <ul id={listId} className="border-border max-h-48 overflow-y-auto rounded-md border">
          {results.map((contato) => {
            const jaEscolhido = chosen.includes(contato.contactId);
            return (
              <li key={contato.contactId}>
                <button
                  type="button"
                  disabled={disabled || jaEscolhido}
                  onClick={() => {
                    onAdd(contato.contactId);
                    setTerm("");
                    setResults([]);
                  }}
                  className="hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
                >
                  <span className="truncate">{contato.fullName ?? "Associado sem nome"}</span>
                  {jaEscolhido && (
                    <span className="text-muted-foreground text-xs">já selecionado</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Associados selecionados">
          {chosen.map((contactId) => (
            <li key={contactId}>
              <Badge variant="attention" className="gap-1 pr-1">
                {conhecidos.current.get(contactId) ?? "Associado selecionado"}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remover ${conhecidos.current.get(contactId) ?? "associado"}`}
                  onClick={() => onRemove(contactId)}
                  className="hover:bg-primary/10 rounded-full p-0.5 transition-colors disabled:opacity-50"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
