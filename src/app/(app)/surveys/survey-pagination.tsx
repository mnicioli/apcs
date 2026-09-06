import { Pagination } from "@/components/ui/pagination";
import { surveysHref, surveysResultsHref } from "@/modules/survey/survey.routes";
import type { SurveyFilters, SurveySort } from "@/modules/survey/survey.types";

/**
 * Paginação das listagens de Enquetes (§6).
 *
 * ⚠️ O DESENHO SAIU DAQUI e virou `@/components/ui/pagination` — este arquivo
 * era idêntico a `lecture-pagination.tsx`, e a tela de Inscrições precisava do
 * mesmo. O que sobrou é o que só Enquetes tem.
 *
 * ⚠️ `base` CONTINUA AQUI porque a grid e a tela de Resultados compartilham a
 * mesma serialização (§59) e mudam só o destino. Duas paginações quase iguais
 * sairiam de sincronia no primeiro ajuste — foi o que aconteceu entre este
 * arquivo e o de Palestras.
 */
export function SurveyPagination({
  page,
  pageSize,
  total,
  filters,
  sort,
  base = "surveys",
}: {
  page: number;
  pageSize: number;
  total: number;
  filters: SurveyFilters;
  sort: SurveySort;
  base?: "surveys" | "results";
}) {
  const montar = base === "results" ? surveysResultsHref : surveysHref;

  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      href={(target) => montar({ filters, sort, page: target, pageSize })}
      label="Paginação das enquetes"
      noun={["enquete", "enquetes"]}
    />
  );
}
