import { CONTACT_PROFILE_LABELS } from "@/modules/chat/chat.labels";
import { SURVEY_AUDIENCE_DIMENSION_LABELS } from "@/modules/survey/survey.labels";
import { groupAudience } from "@/modules/survey/survey.rules";
import type {
  SurveyAudienceCriterion,
  SurveyAudienceDimension,
} from "@/modules/survey/survey.types";

/**
 * O PÚBLICO de uma enquete, dito em uma linha (§31).
 *
 * ⚠️ A regra de combinação aparece no TEXTO, não numa legenda: "ou" entre os
 * valores da mesma dimensão, "·" entre dimensões diferentes. Quem lê
 * "Região: SP ou PR · Perfil: Produtor" entende que precisa ser produtor E estar
 * num dos dois estados, sem precisar aprender uma convenção.
 *
 * Uma lista plana ("SP, PR, Produtor") não distingue as duas coisas — e é aí que
 * alguém marca dois perfis achando que soma quando na verdade restringe.
 */
export function SurveyAudienceSummary({
  criteria,
  className,
}: {
  criteria: readonly SurveyAudienceCriterion[];
  className?: string;
}) {
  const grupos = groupAudience(criteria);

  if (grupos.length === 0) {
    return <span className={className}>Público não definido</span>;
  }

  if (grupos[0]?.dimension === "all") {
    return <span className={className}>{SURVEY_AUDIENCE_DIMENSION_LABELS.all}</span>;
  }

  return (
    <span className={className}>
      {grupos.map((grupo, indice) => (
        <span key={grupo.dimension}>
          {indice > 0 && <span aria-hidden="true"> · </span>}
          {/* O separador é decorativo; para o leitor de tela a conjunção precisa
              estar escrita, senão as dimensões viram uma lista sem relação. */}
          {indice > 0 && <span className="sr-only"> e </span>}
          <span className="text-foreground/70">
            {SURVEY_AUDIENCE_DIMENSION_LABELS[grupo.dimension]}:
          </span>{" "}
          {grupo.values.map((valor, i) => (
            <span key={valor}>
              {i > 0 && " ou "}
              {rotulo(grupo.dimension, valor)}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * O valor cru vira rótulo de tela.
 *
 * `contact` mostra a CONTAGEM em vez dos ids: uma enquete para 30 contatos
 * específicos viraria uma parede de uuids na célula da grid, e nenhum deles diz
 * nada a quem lê.
 *
 * ⚠️ `profile` continua traduzido mesmo tendo sido aposentado
 * (20260909000000_survey_audience_members.sql). Enquetes agendadas ANTES da
 * mudança guardam critérios de Perfil como registro do que foi decidido, e o
 * resumo delas precisa continuar legível — apagar a tradução transformaria o
 * histórico em `producer`.
 */
function rotulo(dimension: SurveyAudienceDimension, valor: string): string {
  if (dimension === "profile") {
    return CONTACT_PROFILE_LABELS[valor as keyof typeof CONTACT_PROFILE_LABELS] ?? valor;
  }
  return valor;
}

/** Variante para a célula da grid: os contatos específicos viram contagem. */
export function SurveyAudienceShort({
  criteria,
  className,
}: {
  criteria: readonly SurveyAudienceCriterion[];
  className?: string;
}) {
  const contatos = criteria.filter((c) => c.dimension === "contact").length;
  const outros = criteria.filter((c) => c.dimension !== "contact");

  if (contatos > 0 && outros.length === 0) {
    return (
      <span className={className}>
        {contatos === 1 ? "1 contato específico" : `${contatos} contatos específicos`}
      </span>
    );
  }

  return <SurveyAudienceSummary criteria={criteria} className={className} />;
}
